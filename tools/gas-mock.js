/**
 * gas-mock.js — Emulasi in-memory perkhidmatan Google Apps Script untuk ujian & dev server tempatan.
 *
 * Meliputi subset API yang digunakan sistem: SpreadsheetApp, PropertiesService, CacheService,
 * LockService, Utilities, DriveApp, Session, HtmlService & ContentService (minimum), MailApp, ScriptApp, MimeType.
 * Tingkah laku penting yang dicontohi:
 *   - setValues() menolak dimensi tidak sepadan (seperti GAS)
 *   - getRange() di luar grid melontar ralat "out of bounds"
 *   - Byte[] bertanda (-128..127) seperti Java
 */
'use strict';
const crypto = require('crypto');

const toSigned = (buf) => Array.from(buf, (b) => (b << 24) >> 24);
const toBuffer = (arr) => Buffer.from(arr.map((b) => b & 0xff));
const asBuffer = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuffer(v));

// ---------------------------------------------------------------- Spreadsheet
class MockRange {
  constructor(sheet, row, col, nr, nc) {
    if (nr < 1 || nc < 1) throw new Error('The number of rows/columns in the range must be at least 1.');
    if (row < 1 || col < 1 || row + nr - 1 > sheet.maxRows || col + nc - 1 > sheet.maxCols + 200) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((line) => line.map((v) => (v instanceof Date ? v.toISOString() : String(v))));
  }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.nr) throw new Error(`The number of rows in the data does not match the number of rows in the range. The data has ${values.length} but the range has ${this.nr}.`);
    values.forEach((line, r) => {
      if (line.length !== this.nc) throw new Error(`The number of columns in the data does not match the number of columns in the range. The data has ${line.length} but the range has ${this.nc}.`);
      const target = (this.sheet.data[this.row - 1 + r] = this.sheet.data[this.row - 1 + r] || []);
      line.forEach((v, c) => {
        // Sheets membuang apostrof pelarian di hadapan
        if (typeof v === 'string' && v.startsWith('=')) throw new Error('Mock: formula ditulis tanpa pelarian: ' + v);
        if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
        target[this.col - 1 + c] = v;
      });
    });
    this.sheet.ss.writes++;
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.nr; r++) {
      const line = this.sheet.data[this.row - 1 + r];
      if (line) for (let c = 0; c < this.nc; c++) line[this.col - 1 + c] = '';
    }
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class MockSheet {
  constructor(ss, name) {
    Object.assign(this, { ss, name, data: [], maxRows: 1000, maxCols: 26, hidden: false, protections: [], frozen: 0 });
  }
  getName() { return this.name; }
  getRange(row, col, nr = 1, nc = 1) { this.ss.reads++; return new MockRange(this, row, col, nr, nc); }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((line) => { (line || []).forEach((v, i) => { if (v !== '' && v !== undefined) max = Math.max(max, i + 1); }); });
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  deleteRow(row) { this.data.splice(row - 1, 1); this.maxRows -= 1; return this; }
  setFrozenRows(n) { this.frozen = n; }
  hideSheet() { this.hidden = true; return this; }
  isSheetHidden() { return this.hidden; }
  getProtections() { return this.protections; }
  protect() {
    const editors = [{ getEmail: () => 'owner@example.com' }, { getEmail: () => 'other@example.com' }];
    const p = {
      setDescription() { return p; }, addEditor() { return p; },
      removeEditors(list) { list.forEach((u) => { const i = editors.indexOf(u); if (i >= 0) editors.splice(i, 1); }); return p; },
      getEditors() { return editors.slice(); }, canDomainEdit() { return false; }, setDomainEdit() { return p; }
    };
    this.protections.push(p);
    return p;
  }
}

class MockSpreadsheet {
  constructor(name) {
    this.id = 'ss_' + crypto.randomBytes(6).toString('hex');
    this.name = name;
    this.sheets = [new MockSheet(this, 'Sheet1')];
    this.reads = 0;
    this.writes = 0;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('A sheet with the name "' + n + '" already exists.');
    const s = new MockSheet(this, n); this.sheets.push(s); return s;
  }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

// ---------------------------------------------------------------- Drive
class MockBlob {
  constructor(bytes, mime, name) { this.bytes = bytes; this.mime = mime || 'application/octet-stream'; this.name = name || ''; }
  getBytes() { return this.bytes.slice(); }
  getDataAsString() { return toBuffer(this.bytes).toString('utf8'); }
  getContentType() { return this.mime; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getAs(mime) {
    if (mime !== 'application/pdf') throw new Error('Mock getAs hanya PDF');
    const html = this.getDataAsString();
    return new MockBlob(toSigned(Buffer.from('%PDF-1.4\n% mock\n' + html.length)), 'application/pdf', this.name);
  }
}

function makeDrive(state) {
  let seq = 0;
  const newId = (p) => p + '_' + (++seq) + '_' + crypto.randomBytes(3).toString('hex');
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };

  class MockFile {
    constructor(blob, parent) {
      Object.assign(this, { id: newId('file'), blob, parent, trashed: false, sharing: 'PRIVATE', description: '' });
      state.files[this.id] = this;
    }
    getId() { return this.id; }
    getName() { return this.blob.name; }
    getSize() { return this.blob.bytes.length; }
    getBlob() { return this.blob; }
    setSharing(a) { this.sharing = a; return this; }
    setDescription(d) { this.description = d; return this; }
    setTrashed(t) { this.trashed = t; return this; }
    isTrashed() { return this.trashed; }
    getParents() { return iter(this.parent ? [this.parent] : []); }
    moveTo(f) { this.parent = f; return this; }
    makeCopy(name, folder) {
      const f = new MockFile(new MockBlob(this.blob.bytes, this.blob.mime, name), folder);
      f.mime = 'application/vnd.google-apps.spreadsheet';
      folder.files.push(f);
      return f;
    }
    getMimeType() { return this.mime || this.blob.mime; }
  }
  class MockFolder {
    constructor(name, parent) {
      Object.assign(this, { id: newId('folder'), name, parent, folders: [], files: [], sharing: 'PRIVATE' });
      state.folders[this.id] = this;
    }
    getId() { return this.id; }
    getName() { return this.name; }
    createFolder(n) { const f = new MockFolder(n, this); this.folders.push(f); return f; }
    getFoldersByName(n) { return iter(this.folders.filter((f) => f.name === n)); }
    createFile(blob) { const f = new MockFile(blob, this); this.files.push(f); return f; }
    getFilesByType(mime) { return iter(this.files.filter((f) => !f.trashed && f.getMimeType() === mime)); }
    setSharing(a) { this.sharing = a; return this; }
    getSharingAccess() { return this.sharing; }
  }
  return {
    Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN' },
    Permission: { NONE: 'NONE', VIEW: 'VIEW', EDIT: 'EDIT' },
    createFolder: (n) => new MockFolder(n, null),
    getFolderById: (id) => { const f = state.folders[id]; if (!f) throw new Error('No item with the given ID could be found.'); return f; },
    getFileById: (id) => {
      const f = state.files[id];
      if (f) return f;
      const ss = state.spreadsheets[id];
      if (ss) {
        const file = new MockFile(new MockBlob([], 'application/vnd.google-apps.spreadsheet', ss.name), null);
        file.mime = 'application/vnd.google-apps.spreadsheet';
        state.files[id] = file;
        return file;
      }
      throw new Error('No item with the given ID could be found.');
    },
    _state: state
  };
}

// ---------------------------------------------------------------- Factory
function createGasEnvironment(options = {}) {
  const state = { files: {}, folders: {}, spreadsheets: {}, props: Object.assign({}, options.properties || {}), cache: new Map(), mails: [], triggers: [], fetches: [], fetchHandler: null };
  const activeUser = { email: options.activeUser === undefined ? 'owner@example.com' : options.activeUser };

  const SpreadsheetApp = {
    create(name) { const ss = new MockSpreadsheet(name); state.spreadsheets[ss.id] = ss; return ss; },
    openById(id) { const ss = state.spreadsheets[id]; if (!ss) throw new Error('Spreadsheet tidak wujud: ' + id); return ss; },
    flush() {},
    ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperties: () => Object.assign({}, state.props),
      getProperty: (k) => (k in state.props ? state.props[k] : null),
      setProperty(k, v) { state.props[k] = String(v); return this; },
      deleteProperty(k) { delete state.props[k]; return this; }
    })
  };

  const now = () => Date.now();
  const CacheService = {
    getScriptCache: () => ({
      get(k) { const e = state.cache.get(k); if (!e) return null; if (e.exp < now()) { state.cache.delete(k); return null; } return e.v; },
      put(k, v, ttl = 600) {
        if (String(v).length > 100 * 1024) throw new Error('Argument too large');
        state.cache.set(k, { v: String(v), exp: now() + Math.min(ttl, 21600) * 1000 });
      },
      remove(k) { state.cache.delete(k); }
    })
  };

  let lockHeld = false;
  const LockService = {
    getScriptLock: () => ({
      tryLock() { if (lockHeld) return false; lockHeld = true; return true; },
      waitLock() { if (lockHeld) throw new Error('Lock timeout'); lockHeld = true; },
      releaseLock() { lockHeld = false; },
      hasLock() { return lockHeld; }
    })
  };

  const tzFormat = (date, tz, pattern) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).reduce((m, p) => { m[p.type] = p.value; return m; }, {});
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return pattern
      .replace('yyyy', parts.year).replace('MMM', months[Number(parts.month) - 1]).replace('MM', parts.month)
      .replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1' },
    Charset: { UTF_8: 'utf8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, value) => toSigned(crypto.createHash(alg).update(asBuffer(value)).digest()),
    computeHmacSha256Signature: (value, key) => toSigned(crypto.createHmac('sha256', asBuffer(key)).update(asBuffer(value)).digest()),
    computeRsaSha256Signature: (value, pem) => toSigned(crypto.sign('RSA-SHA256', asBuffer(value), pem)),
    base64Encode: (v) => asBuffer(v).toString('base64'),
    base64EncodeWebSafe: (v) => asBuffer(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => toSigned(Buffer.from(String(s), 'base64')),
    newBlob: (data, mime, name) => new MockBlob(typeof data === 'string' ? toSigned(Buffer.from(data, 'utf8')) : data.slice(), mime, name),
    formatDate: tzFormat,
    sleep: () => {}
  };

  const Session = {
    getScriptTimeZone: () => 'Asia/Kuala_Lumpur',
    getActiveUser: () => ({ getEmail: () => activeUser.email }),
    getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' })
  };

  /**
   * UrlFetchApp: respons diprogram melalui state.fetchHandler(url, params) → { code, body }.
   * Lalai: token OAuth sah & FCM 200. Semua permintaan direkod dalam state.fetches.
   */
  const makeResponse = (r) => ({ getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {})) });
  const defaultFetch = (url) => (/oauth2\.googleapis\.com\/token/.test(url)
    ? { code: 200, body: { access_token: 'ya29.mock', expires_in: 3599, token_type: 'Bearer' } }
    : { code: 200, body: { name: 'projects/x/messages/1' } });
  const UrlFetchApp = {
    fetch: (url, params) => { state.fetches.push({ url, params }); return makeResponse((state.fetchHandler || defaultFetch)(url, params || {})); },
    fetchAll: (reqs) => reqs.map((r) => { state.fetches.push({ url: r.url, params: r }); return makeResponse((state.fetchHandler || defaultFetch)(r.url, r)); })
  };

  const MailApp = {
    sendEmail: (msg) => { state.mails.push(msg); },
    getRemainingDailyQuota: () => 100
  };

  const ScriptApp = {
    getService: () => ({ getUrl: () => options.webAppUrl || 'https://script.google.com/macros/s/MOCK/exec' }),
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
    newTrigger: (fn) => {
      const b = { timeBased: () => b, everyDays: () => b, everyHours: () => b, everyMinutes: () => b, atHour: () => b, create: () => { const t = { getHandlerFunction: () => fn }; state.triggers.push(t); return t; } };
      return b;
    }
  };

  // HtmlOutput dengan sekatan sama seperti Apps Script sebenar
  const ALLOWED_META = ['apple-mobile-web-app-capable', 'google-site-verification', 'mobile-web-app-capable', 'viewport'];
  const makeOutput = () => {
    const o = {
      meta: {}, title: '', xframe: 'DEFAULT', favicon: '',
      setTitle(t) { o.title = t; return o; },
      addMetaTag(name, content) {
        if (ALLOWED_META.indexOf(name) < 0) throw new Error('Exception: The meta tag you specified is not allowed in this context.');
        o.meta[name] = content; return o;
      },
      setXFrameOptionsMode(m) { o.xframe = m; return o; },
      setFaviconUrl(u) { if (!/^https:\/\/.+\.(png|ico|gif|jpg)$/i.test(u)) throw new Error('Invalid favicon URL'); o.favicon = u; return o; },
      getContent() { return ''; }
    };
    return o;
  };
  const HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    createHtmlOutputFromFile: () => makeOutput(),
    createTemplateFromFile: () => { const t = { evaluate: () => makeOutput() }; return t; }
  };

  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput: (text) => {
      const o = { text: String(text), mime: 'text/plain',
        setMimeType(m) { o.mime = m; return o; }, getContent() { return o.text; }, getMimeType() { return o.mime; } };
      return o;
    }
  };

  const DriveApp = makeDrive(state);
  const MimeType = { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' };

  return {
    globals: { SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities, Session, MailApp, ScriptApp, HtmlService, ContentService, DriveApp, MimeType, UrlFetchApp },
    state,
    setActiveUser: (email) => { activeUser.email = email; },
    clearCache: () => state.cache.clear()
  };
}

module.exports = { createGasEnvironment };
