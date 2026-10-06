/**
 * runtime.mjs — jalankan backend Apps Script (backend.mjs, dijana daripada src/**.gs) di Supabase Edge Function
 * dengan data dalam Postgres.
 *
 * Model:
 *  - Setiap "sheet" disimpan dalam Postgres (private.sheets + private.sheet_rows, satu baris = satu rekod, kunci = lajur ID).
 *  - Per permintaan: perkhidmatan GAS tiruan (SpreadsheetApp, CacheService, PropertiesService, MailApp, …) dibina di atas
 *    salinan data dalam memori; kod GAS berjalan SEGERAK tanpa perubahan; tulisan dikumpul lalu disimpan dalam SATU
 *    transaksi selepas itu (diff baris demi baris).
 *  - Konkurensi: optimistik. Versi setiap sheet yang dibaca disemak semasa commit (di bawah kunci nasihat); jika berubah,
 *    permintaan dijalankan semula dengan data terkini — setara dengan LockService GAS, tanpa menunggu.
 *  - Data yang belum dimuat (sheet log besar / kunci cache kongsi) ditemui semasa larian → dimuat → larian diulang.
 *  - Cache isolat: sheet kekal dalam memori antara permintaan dan hanya dimuat semula jika versinya berubah.
 *  - Email: MailApp.sendEmail → private.outbox; pekerja Apps Script menghantarnya (MailApp sebenar).
 */
import nodeCrypto from 'node:crypto';
import { Buffer } from 'node:buffer';

/** Sheet besar yang hanya dimuat apabila diperlukan; tulisan padanya (tambah baris) selamat digabung tanpa semakan konflik. */
export const LAZY_SHEETS = ['AUDIT_LOGS', 'SYSTEM_LOGS', 'NOTIFICATIONS'];
/** Kunci CacheService yang mesti dikongsi merentas permintaan (keselamatan). Selainnya cache per permintaan sahaja. */
export const SHARED_KV = ['kd1:rl:', 'kd1:loginfail:', 'kd1:reset:', 'kd1:idem:'];
export const TIME_ZONE = 'Asia/Kuala_Lumpur';
const APPEND_BASE = 1000000;

class NeedData extends Error {
  constructor(what) { super('Data belum dimuat: ' + what); this.name = 'NeedData'; }
}

const toSigned = (buf) => Array.from(buf, (b) => (b << 24) >> 24);
const toBuffer = (arr) => Buffer.from(arr.map((b) => b & 0xff));
const asBuffer = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuffer(v));
const trimRow = (row) => { let n = row.length; while (n > 0 && (row[n - 1] === '' || row[n - 1] === undefined || row[n - 1] === null)) n--; return row.slice(0, n).map((v) => (v === undefined || v === null ? '' : v)); };
const cloneRow = (r) => r.slice();

/**
 * Kunci baris dalam Postgres: ID (lajur pertama). ID berganda (data lama) diberi akhiran mengikut kejadian:
 * X, X#2, X#3 … — peraturan SAMA semasa import & commit, jadi diff sentiasa konsisten.
 */
export function keyRows(rows) {
  const seen = new Map();
  const out = [];
  for (const vals of rows) {
    if (!vals || vals[0] === '' || vals[0] === undefined || vals[0] === null) continue;
    const id = String(vals[0]);
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    out.push([n === 1 ? id : id + '#' + n, vals]);
  }
  return out;
}

// ---------------------------------------------------------------- Spreadsheet (dalam memori, jejak perubahan)
class Range {
  constructor(sheet, row, col, nr, nc) {
    if (nr < 1 || nc < 1) throw new Error('The number of rows/columns in the range must be at least 1.');
    if (row < 1 || col < 1 || row + nr - 1 > sheet.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getValues() {
    /* Sheet "tambah sahaja" (log besar belum dimuat): membaca baris data memerlukan muatan penuh */
    if (this.sheet.appendOnly && this.row + this.nr - 1 > 1 && this.row <= this.sheet.appendBase) this.sheet.needFull();
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = new Array(this.nc);
      for (let c = 0; c < this.nc; c++) { const v = src[this.col - 1 + c]; line[c] = v === undefined || v === null ? '' : v; }
      out.push(line);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map((l) => l.map((v) => String(v))); }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.nr) throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' + (values && values.length) + ' but the range has ' + this.nr + '.');
    values.forEach((line, r) => {
      if (line.length !== this.nc) throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' + line.length + ' but the range has ' + this.nc + '.');
      const idx = this.row - 1 + r;
      const target = (this.sheet.data[idx] = this.sheet.data[idx] || []);
      line.forEach((v, c) => {
        if (v instanceof Date) v = v.toISOString();
        if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1); /* Sheets membuang apostrof pelarian */
        target[this.col - 1 + c] = v === undefined || v === null ? '' : v;
      });
    });
    this.sheet.dirty = true;
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.nr; r++) {
      const line = this.sheet.data[this.row - 1 + r];
      if (line) for (let c = 0; c < this.nc; c++) line[this.col - 1 + c] = '';
    }
    this.sheet.dirty = true;
    return this;
  }
  clear() { return this.clearContent(); }
  getRow() { return this.row; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
}

class Sheet {
  constructor(name, data) {
    this.name = name;
    this.data = data;
    this.maxRows = Math.max(1000, data.length + 500);
    this.maxCols = 26;
    this.dirty = false;
    this.hidden = false;
    this.appendOnly = false;
    this.appendBase = 0;
  }
  getName() { return this.name; }
  getRange(row, col, nr, nc) {
    if (typeof row === 'string') throw new Error('Notasi A1 tidak disokong');
    return new Range(this, row, col, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  /** Indeks baris data yang wujud (sheet "tambah sahaja" adalah jarang — elak gelung sepanjang tatasusunan). */
  rowIndexes() { return this.appendOnly ? Object.keys(this.data).map(Number) : this.data.map((_, i) => i); }
  getLastRow() {
    if (this.appendOnly) {
      let last = this.appendBase;
      for (const i of this.rowIndexes()) { const l = this.data[i]; if (i >= this.appendBase && l && l.some((v) => v !== '' && v !== undefined && v !== null)) last = Math.max(last, i + 1); }
      return last;
    }
    for (let i = this.data.length - 1; i >= 0; i--) {
      const l = this.data[i];
      if (l && l.some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const idx of this.rowIndexes()) { const l = this.data[idx]; if (l) for (let i = l.length - 1; i >= max; i--) if (l[i] !== '' && l[i] !== undefined && l[i] !== null) { max = i + 1; break; } }
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return Math.max(this.maxCols, this.getLastColumn()); }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  deleteRow(row) { if (this.appendOnly) this.needFull(); this.data.splice(row - 1, 1); this.maxRows -= 1; this.dirty = true; return this; }
  deleteRows(row, n) { if (this.appendOnly) this.needFull(); this.data.splice(row - 1, n); this.maxRows -= n; this.dirty = true; return this; }
  appendRow(values) { this.data[this.getLastRow()] = values.slice(); this.dirty = true; return this; }
  setFrozenRows() { return this; }
  hideSheet() { this.hidden = true; return this; }
  isSheetHidden() { return this.hidden; }
  getProtections() { return [{}]; }
  protect() {
    const p = { setDescription: () => p, addEditor: () => p, removeEditors: () => p, getEditors: () => [], canDomainEdit: () => false, setDomainEdit: () => p };
    return p;
  }
  getSheetId() { return this.name; }
}

// ---------------------------------------------------------------- Runtime
/**
 * @param {{store:Object, createBackend:function, log?:Object, now?:function}} opts
 *   store: lihat store-pg.mjs (atau stor memori dalam ujian).
 */
export function createRuntime(opts) {
  const store = opts.store;
  const createBackend = opts.createBackend;
  const log = opts.log || console;
  const now = opts.now || (() => Date.now());
  const lazy = new Set(LAZY_SHEETS);
  /** Cache isolat: name → {ver, header, rows, snap:Map<k,json>} ; props → {ver, map} */
  const cache = { sheets: new Map(), props: null };
  const stats = { passes: 0, conflicts: 0, loads: 0 };

  function entryOf(s) {
    const rows = s.rows || [];
    const snap = new Map();
    for (const [k, r] of keyRows(rows)) snap.set(k, JSON.stringify(trimRow(r)));
    return { ver: s.ver, header: s.header || [], rows, snap };
  }

  async function refresh(vers, wantedLazy) {
    const need = [];
    for (const name of Object.keys(vers.sheets)) {
      if (lazy.has(name) && !wantedLazy.has(name)) continue;
      const c = cache.sheets.get(name);
      if (!c || c.ver !== vers.sheets[name]) need.push(name);
    }
    for (const name of [...cache.sheets.keys()]) if (!(name in vers.sheets)) cache.sheets.delete(name);
    const jobs = [];
    if (need.length) {
      stats.loads++;
      jobs.push(store.loadSheets(need).then((list) => { for (const s of list) cache.sheets.set(s.name, entryOf(s)); }));
    }
    if (!cache.props || cache.props.ver !== vers.props) jobs.push(store.loadProps().then((p) => { cache.props = p; }));
    await Promise.all(jobs);
  }

  /** Perkhidmatan GAS untuk satu larian. */
  function makeContext(vers, kvLoaded) {
    const ctx = {
      vers,
      working: new Map(), /* name → Sheet (disalin semasa diakses) */
      accessed: new Map(), /* name → ver dijangka (null = dijangka TIADA) */
      created: new Set(),
      deleted: new Set(),
      missingSheets: new Set(),
      missingKv: new Set(),
      kvWrites: new Map(),
      kvExpect: new Map(),
      kvLocal: new Map(),
      propsSet: {},
      propsDel: new Set(),
      props: Object.assign({}, cache.props ? cache.props.map : {}, { SPREADSHEET_ID: 'supabase' }), /* Database.open() memerlukan ID */
      outbox: []
    };

    /* Log ditahan sehingga larian akhir (larian penemuan data dibuang — lognya tidak bermakna) */
    ctx.logs = [];
    ctx.console = {};
    ['log', 'info', 'warn', 'error'].forEach((lvl) => { ctx.console[lvl] = (...a) => ctx.logs.push([lvl, a]); });
    ctx.flushLogs = () => ctx.logs.forEach(([lvl, a]) => (log[lvl] || log.log).apply(log, a));
    const exists = (name) => !ctx.deleted.has(name) && (ctx.created.has(name) || Object.prototype.hasOwnProperty.call(vers.sheets, name));
    function sheetByName(name) {
      name = String(name);
      if (ctx.working.has(name)) return ctx.working.get(name);
      if (!exists(name)) { if (!ctx.accessed.has(name)) ctx.accessed.set(name, null); return null; }
      const c = cache.sheets.get(name);
      if ((!c || c.ver !== vers.sheets[name]) && lazy.has(name) && vers.headers && vers.headers[name]) {
        /* Log besar belum dimuat: benarkan TAMBAH baris tanpa memuat semua; bacaan → muat penuh & ulang */
        const sh = new Sheet(name, [vers.headers[name].slice()]);
        sh.appendOnly = true;
        sh.appendBase = APPEND_BASE; /* baris maya: data sedia ada dianggap berada di baris 2..APPEND_BASE */
        sh.maxRows = APPEND_BASE + 500;
        sh.needFull = () => { ctx.missingSheets.add(name); throw new NeedData(name); };
        ctx.working.set(name, sh);
        return sh;
      }
      if (!c || c.ver !== vers.sheets[name]) { ctx.missingSheets.add(name); throw new NeedData(name); }
      const sh = new Sheet(name, [c.header.slice()].concat(c.rows.map(cloneRow)));
      ctx.working.set(name, sh);
      if (!lazy.has(name)) ctx.accessed.set(name, c.ver);
      return sh;
    }
    const spreadsheet = {
      getId: () => 'supabase',
      getName: () => 'Supabase',
      getUrl: () => '',
      getSheetByName: sheetByName,
      getSheets: () => Object.keys(vers.sheets).concat([...ctx.created]).filter((n, i, a) => a.indexOf(n) === i && exists(n)).map(sheetByName),
      insertSheet: (name) => {
        name = String(name);
        if (exists(name)) throw new Error('A sheet with the name "' + name + '" already exists.');
        if (!ctx.accessed.has(name)) ctx.accessed.set(name, null);
        ctx.deleted.delete(name);
        ctx.created.add(name);
        const sh = new Sheet(name, []);
        sh.dirty = true;
        ctx.working.set(name, sh);
        return sh;
      },
      deleteSheet: (sh) => { ctx.working.delete(sh.name); ctx.created.delete(sh.name); ctx.deleted.add(sh.name); }
    };
    const SpreadsheetApp = {
      create: () => spreadsheet,
      openById: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet,
      flush() {},
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }
    };

    const PropertiesService = {
      getScriptProperties: () => ({
        getProperties: () => Object.assign({}, ctx.props),
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(ctx.props, k) ? ctx.props[k] : null),
        getKeys: () => Object.keys(ctx.props),
        setProperty(k, v) { ctx.props[k] = String(v); ctx.propsSet[k] = String(v); ctx.propsDel.delete(k); return this; },
        setProperties(obj, deleteOthers) {
          if (deleteOthers) Object.keys(ctx.props).forEach((k) => { if (!(k in obj)) this.deleteProperty(k); });
          Object.keys(obj || {}).forEach((k) => this.setProperty(k, obj[k]));
          return this;
        },
        deleteProperty(k) { delete ctx.props[k]; delete ctx.propsSet[k]; ctx.propsDel.add(k); return this; }
      })
    };

    const shared = (k) => SHARED_KV.some((p) => k.indexOf(p) === 0);
    const kvGet = (k) => {
      k = String(k);
      const t = now();
      if (!shared(k)) { const e = ctx.kvLocal.get(k); return e && e.exp > t ? e.v : null; }
      if (ctx.kvWrites.has(k)) { const e = ctx.kvWrites.get(k); return e && e.exp > t ? e.v : null; }
      if (kvLoaded.has(k)) { const e = kvLoaded.get(k); return e && e.exp > t ? e.v : null; }
      ctx.missingKv.add(k);
      return null;
    };
    /* Nilai asal kunci kongsi (untuk compare-and-set semasa commit: elak kemas kini hilang di bawah konkurensi) */
    const kvExpect = (k) => {
      if (ctx.kvExpect.has(k)) return;
      const e = kvLoaded.get(k);
      ctx.kvExpect.set(k, e && e.exp > now() ? e.v : null);
    };
    const kvPut = (k, v, ttl) => {
      k = String(k);
      v = String(v);
      if (v.length > 100 * 1024) throw new Error('Argument too large: value');
      const e = { v, exp: now() + Math.min(ttl === undefined ? 600 : ttl, 21600) * 1000 };
      if (shared(k)) { kvExpect(k); ctx.kvWrites.set(k, e); } else ctx.kvLocal.set(k, e);
    };
    const kvRemove = (k) => { k = String(k); if (shared(k)) { kvExpect(k); ctx.kvWrites.set(k, null); } else ctx.kvLocal.delete(k); };
    const scriptCache = {
      get: kvGet, put: kvPut, remove: kvRemove,
      getAll: (keys) => { const o = {}; keys.forEach((k) => { const v = kvGet(k); if (v !== null) o[k] = v; }); return o; },
      putAll: (obj, ttl) => Object.keys(obj).forEach((k) => kvPut(k, obj[k], ttl)),
      removeAll: (keys) => keys.forEach(kvRemove)
    };
    const CacheService = { getScriptCache: () => scriptCache, getUserCache: () => scriptCache, getDocumentCache: () => scriptCache };

    const lock = { tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true };
    const LockService = { getScriptLock: () => lock, getUserLock: () => lock, getDocumentLock: () => lock };

    const blob = (bytes, mime, name) => {
      const b = {
        bytes, mime: mime || 'application/octet-stream', name: name || '',
        getBytes: () => bytes.slice(), getDataAsString: () => toBuffer(bytes).toString('utf8'),
        getContentType: () => b.mime, getName: () => b.name, setName: (n) => { b.name = n; return b; },
        setContentType: (m) => { b.mime = m; return b; }
      };
      return b;
    };
    const Utilities = {
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1', SHA_512: 'sha512' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => nodeCrypto.randomUUID(),
      computeDigest: (alg, value) => toSigned(nodeCrypto.createHash(alg).update(asBuffer(value)).digest()),
      computeHmacSha256Signature: (value, key) => toSigned(nodeCrypto.createHmac('sha256', asBuffer(key)).update(asBuffer(value)).digest()),
      computeRsaSha256Signature: (value, pem) => toSigned(nodeCrypto.sign('RSA-SHA256', asBuffer(value), pem)),
      base64Encode: (v) => asBuffer(v).toString('base64'),
      base64EncodeWebSafe: (v) => asBuffer(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: (s) => toSigned(Buffer.from(String(s), 'base64')),
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (data, mime, name) => blob(typeof data === 'string' ? toSigned(Buffer.from(data, 'utf8')) : data.slice(), mime, name),
      formatDate: (date, tz, pattern) => formatDate(date, tz, pattern),
      sleep: () => {}
    };

    const Session = {
      getScriptTimeZone: () => TIME_ZONE,
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => ctx.props.OWNER_EMAIL || '' })
    };

    const MailApp = {
      sendEmail: function (a, subject, body, options) {
        const msg = typeof a === 'object' && a !== null ? Object.assign({}, a) : Object.assign({ to: a, subject: subject, body: body }, options || {});
        if (!msg.to) throw new Error('Penerima email kosong');
        ctx.outbox.push({ kind: 'mail', payload: msg });
      },
      getRemainingDailyQuota: () => 100
    };

    const ScriptApp = {
      getService: () => ({ getUrl: () => ctx.props.WORKER_URL || '' }),
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => {
        const b = { timeBased: () => b, everyDays: () => b, everyHours: () => b, everyMinutes: () => b, atHour: () => b, create: () => ({ getHandlerFunction: () => '' }) };
        return b;
      },
      getOAuthToken: () => ''
    };

    const notSupported = (what) => () => { throw new Error(what + ' tidak tersedia di pelayan Supabase.'); };
    const DriveApp = {
      getFileById: notSupported('Google Drive'), getFolderById: notSupported('Google Drive'), createFolder: notSupported('Google Drive'),
      searchFiles: notSupported('Google Drive'), searchFolders: notSupported('Google Drive'), getRootFolder: notSupported('Google Drive'),
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' }, Permission: { VIEW: 'VIEW', NONE: 'NONE' }
    };
    const UrlFetchApp = { fetch: notSupported('UrlFetchApp'), fetchAll: notSupported('UrlFetchApp') };
    const output = () => {
      const o = { setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: () => o, setFaviconUrl: () => o, getContent: () => '' };
      return o;
    };
    const HtmlService = {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
      createHtmlOutputFromFile: output, createHtmlOutput: output,
      createTemplateFromFile: () => ({ evaluate: output })
    };
    const ContentService = {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: (text) => { const o = { text: String(text), setMimeType: () => o, getContent: () => o.text }; return o; }
    };

    ctx.globals = {
      SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities, Session, MailApp, ScriptApp, HtmlService,
      ContentService, DriveApp, UrlFetchApp, MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
      console: ctx.console, EDGE_RUNTIME: true, globalThis: {}
    };
    return ctx;
  }

  /** Kumpul perubahan larian → muatan commit (null jika tiada tulisan). */
  function collect(ctx) {
    const sheets = [];
    const checks = [];
    for (const [name, ver] of ctx.accessed) checks.push({ name, ver });
    for (const name of ctx.deleted) if (Object.prototype.hasOwnProperty.call(ctx.vers.sheets, name)) sheets.push({ name, deleted: true });
    for (const [name, sh] of ctx.working) {
      if (!sh.dirty) continue;
      const header = trimRow(sh.data[0] || []);
      const created = ctx.created.has(name);
      const c = created || sh.appendOnly ? null : cache.sheets.get(name);
      const rows = [];
      for (const i of sh.rowIndexes()) {
        if (i < 1) continue;
        const r = sh.data[i];
        if (!r || r[0] === '' || r[0] === undefined || r[0] === null) continue;
        rows.push(trimRow(r));
      }
      const keyed = keyRows(rows);
      const keys = new Set(keyed.map((x) => x[0]));
      const change = { name, created, header: (!c || JSON.stringify(header) !== JSON.stringify(c.header)) ? header : null, upserts: [], deletes: [], rowsAfter: rows };
      if (sh.appendOnly) {
        if (JSON.stringify(header) === JSON.stringify(trimRow(ctx.vers.headers[name] || []))) change.header = null;
        change.upserts = keyed.map(([k, vals], i) => ({ k, vals, ord: i }));
        change.appendOnly = true;
      } else if (created) {
        change.replace = true;
        change.header = header;
        change.upserts = keyed.map(([k, vals], i) => ({ k, vals, ord: i }));
      } else {
        keyed.forEach(([k, vals], i) => {
          if (c.snap.get(k) !== JSON.stringify(vals)) change.upserts.push({ k, vals, ord: i });
        });
        for (const k of c.snap.keys()) if (!keys.has(k)) change.deletes.push(k);
      }
      if (change.replace || change.header || change.upserts.length || change.deletes.length) sheets.push(change);
    }
    const kv = [];
    for (const [k, e] of ctx.kvWrites) {
      const expect = ctx.kvExpect.has(k) ? ctx.kvExpect.get(k) : null;
      kv.push(e ? { k, v: e.v, exp: e.exp, expect } : { k, del: true, expect });
    }
    const props = { set: ctx.propsSet, del: [...ctx.propsDel] };
    const hasProps = Object.keys(props.set).length || props.del.length;
    if (!sheets.length && !kv.length && !hasProps && !ctx.outbox.length) return null;
    return { sheets, checks: sheets.length ? checks : [], kv, props: hasProps ? props : null, outbox: ctx.outbox };
  }

  function applyCommitted(changes, res) {
    for (const ch of changes.sheets) {
      if (ch.deleted || lazy.has(ch.name)) { cache.sheets.delete(ch.name); continue; }
      const ver = res.vers[ch.name];
      if (ver === undefined) { cache.sheets.delete(ch.name); continue; }
      const prev = cache.sheets.get(ch.name);
      cache.sheets.set(ch.name, entryOf({ ver, header: ch.header || (prev ? prev.header : []), rows: ch.rowsAfter }));
    }
    if (changes.props && res.propsVer !== undefined && cache.props) {
      const map = Object.assign({}, cache.props.map, changes.props.set);
      changes.props.del.forEach((k) => delete map[k]);
      cache.props = { ver: res.propsVer, map };
    }
  }

  /**
   * Jalankan `task(B)` (segerak) dengan backend baharu; ulang sehingga semua data tersedia & commit berjaya.
   * @return {Promise<{result:*, outbox:number}>}
   */
  async function execute(task, options) {
    const o = options || {};
    const maxPasses = o.maxPasses || 10;
    const kvLoaded = new Map();
    const pre = o.preloadKv && o.preloadKv.length ? store.loadKv(o.preloadKv) : null;
    let vers = await store.versions();
    if (pre) { const got = await pre; o.preloadKv.forEach((k) => kvLoaded.set(k, got[k] || null)); }
    const wantedLazy = new Set(o.lazy || []);
    for (let pass = 0; pass < maxPasses; pass++) {
      stats.passes++;
      await refresh(vers, wantedLazy);
      const ctx = makeContext(vers, kvLoaded);
      const B = createBackend(ctx.globals);
      let result;
      let error = null;
      try { result = task(B, ctx); } catch (e) { error = e; }
      if (ctx.missingSheets.size || ctx.missingKv.size) {
        ctx.missingSheets.forEach((n) => wantedLazy.add(n));
        if (ctx.missingKv.size) {
          const keys = [...ctx.missingKv];
          const got = await store.loadKv(keys);
          keys.forEach((k) => kvLoaded.set(k, got[k] || null));
        }
        continue;
      }
      ctx.flushLogs();
      if (error && error.name === 'NeedData') throw new Error('Data tidak dapat dimuat: ' + error.message);
      const changes = collect(ctx);
      if (changes) {
        const res = await store.commit(changes);
        if (res.conflict) {
          stats.conflicts++;
          vers = await store.versions();
          /* Muat semula kunci kongsi yang diketahui (cth. rid idempotensi yang baru ditulis oleh permintaan lain) */
          const known = [...new Set([...kvLoaded.keys()].concat(res.conflict.filter((c) => c.indexOf('kv:') === 0).map((c) => c.slice(3))))];
          if (known.length) {
            const got = await store.loadKv(known);
            known.forEach((k) => kvLoaded.set(k, got[k] || null));
          }
          continue;
        }
        applyCommitted(changes, res);
      }
      if (error) throw error;
      return { result, outbox: changes ? changes.outbox.length : 0 };
    }
    throw new Error('Pelayan sibuk (terlalu banyak cubaan semula). Sila cuba lagi.');
  }

  /**
   * Permintaan API biasa → ApiResponse (sama seperti doPost Apps Script).
   * Idempotensi meta.rid: jawapan tindakan yang MENULIS disimpan (kv, transaksi sama dengan tulisan itu) selama 10 minit;
   * cubaan semula dengan rid sama mendapat jawapan asal tanpa menjalankan tindakan dua kali.
   */
  async function handle(request) {
    const rid = request && request.meta && typeof request.meta.rid === 'string' && /^[A-Za-z0-9_-]{12,64}$/.test(request.meta.rid) ? request.meta.rid : '';
    const key = rid ? 'kd1:idem:rid:' + rid : '';
    return execute((B, ctx) => {
      const cache = ctx.globals.CacheService.getScriptCache();
      if (key) {
        const raw = cache.get(key);
        if (raw) { try { const hit = JSON.parse(raw); if (hit && hit.res) return hit.res; } catch (e) { /* abaikan */ } }
      }
      const res = B.Router.run(request);
      const wrote = ctx.created.size > 0 || [...ctx.working.values()].some((sh) => sh.dirty && !lazy.has(sh.name));
      if (key && wrote) { try { cache.put(key, JSON.stringify({ res }), 600); } catch (e) { /* jawapan terlalu besar — tidak dicache */ } }
      return res;
    }, { preloadKv: key ? [key] : [] });
  }

  const prop = (k) => (cache.props && cache.props.map ? cache.props.map[k] : undefined);
  return { execute, handle, prop, stats, cache, NeedData };
}

/** Utilities.formatDate untuk corak yang digunakan sistem (yyyy MM dd HH mm ss MMM EEE). */
export function formatDate(date, tz, pattern) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(d).reduce((m, p) => { m[p.type] = p.value; return m; }, {});
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  const offMin = Math.round((Date.parse(parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second + 'Z') - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const XXX = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
  return String(pattern).replace(/yyyy|MMM|MM|dd|HH|mm|ss|SSS|EEE|XXX|Z|'[^']*'/g, (t) => {
    switch (t) {
      case 'yyyy': return parts.year;
      case 'MMM': return months[Number(parts.month) - 1];
      case 'MM': return parts.month;
      case 'dd': return parts.day;
      case 'HH': return parts.hour;
      case 'mm': return parts.minute;
      case 'ss': return parts.second;
      case 'SSS': return ms;
      case 'EEE': return parts.weekday;
      case 'XXX': return XXX;
      case 'Z': return XXX.replace(':', '');
      default: return t.slice(1, -1);
    }
  });
}
