/**
 * @file WorkerService.gs
 * Mod Supabase: data sistem berada dalam Postgres (Supabase Edge Function `api`, lihat supabase/functions/api).
 * Apps Script kekal sebagai PEKERJA:
 *   - menghantar email (MailApp) dan notifikasi telefon (FCM) yang dibaris gilir oleh pelayan Supabase → pencetus `workerTick` setiap minit
 *     (+ "kejutan" segera daripada pelayan selepas setiap tindakan yang menghasilkan email)
 *   - mencetuskan penyelenggaraan berkala (peringatan, auto-selesai) melalui system.tick
 *   - sandaran harian: salin semua data ke Google Sheets dalam folder Backup
 *   - meneruskan permintaan lama (klien yang masih menggunakan URL /exec) ke Supabase
 *
 * Keadaan (Script Property SUPABASE_ACTIVE):
 *   ''          → mod biasa (Google Sheets) — sebelum pemindahan
 *   'migrating' → pemindahan sedang berjalan: tulisan ditolak sementara
 *   '1'         → Supabase aktif: Apps Script tidak lagi melayan API sendiri
 */
const WorkerService = {
  SIG_PREFIX: 'druang-worker-v2',

  /** URL API Supabase (ditulis oleh CI ke DeployInfo.gs daripada backend.json; Script Property mengatasi). */
  apiUrl: function () {
    return Env.get('SUPABASE_API_URL', '') || (typeof DEPLOY_INFO !== 'undefined' && DEPLOY_INFO.apiUrl ? DEPLOY_INFO.apiUrl : '');
  },

  state: function () {
    if (typeof EDGE_RUNTIME !== 'undefined' && EDGE_RUNTIME) return '';
    return String(Env.get('SUPABASE_ACTIVE', '') || '');
  },

  active: function () { return WorkerService.state() === '1' && !!WorkerService.apiUrl(); },

  /**
   * Tandatangan pekerja = HMAC-SHA256(AUTH_PEPPER, 'druang-worker-v2|' + ts + '|' + action + '|' + sha256(JSON payload)).
   * Pelayan Supabase menyemak dengan pepper yang sama (dipindahkan semasa import); sah 5 minit, terikat pada kandungan.
   */
  signature: function (action, payload, ts) {
    const pepper = Env.get('AUTH_PEPPER');
    if (!pepper) throw new AppError(ERROR_CODES.CONFIG_ERROR, 'AUTH_PEPPER tiada.');
    const bodyHash = SecurityUtils.sha256Hex(JSON.stringify(payload));
    return SecurityUtils.bytesToHex(Utilities.computeHmacSha256Signature(WorkerService.SIG_PREFIX + '|' + ts + '|' + action + '|' + bodyHash, pepper));
  },

  /** POST ke API Supabase. @return {Object} respons JSON */
  post: function (body, timeoutNote) {
    const url = WorkerService.apiUrl();
    if (!url) throw new AppError(ERROR_CODES.CONFIG_ERROR, 'URL API Supabase belum ditetapkan.');
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'text/plain; charset=utf-8', payload: JSON.stringify(body), muteHttpExceptions: true, followRedirects: true,
      /* Pelayan Google berada di AS — paksa fungsi berjalan di Singapura (dekat pangkalan data), bukan us-east */
      headers: { 'x-region': 'ap-southeast-1' }
    });
    const code = res.getResponseCode();
    const text = res.getContentText();
    try { return JSON.parse(text); } catch (e) {
      throw new Error('Respons Supabase tidak sah (HTTP ' + code + ')' + (timeoutNote ? ' ' + timeoutNote : '') + ': ' + String(text).slice(0, 200));
    }
  },

  call: function (action, payload) {
    const p = payload || {};
    const ts = Date.now();
    const r = WorkerService.post({ action: action, payload: p, ts: ts, worker: WorkerService.signature(action, p, ts) });
    if (!r || !r.success) throw new Error((r && r.code) + ': ' + (r && r.message));
    return r.data;
  },

  /** Teruskan permintaan API klien lama ke Supabase. */
  proxy: function (request) {
    try {
      return WorkerService.post(request);
    } catch (e) {
      return ApiResponse.fail(ERROR_CODES.BUSY, 'Sambungan ke pelayan gagal. Sila muat semula halaman.');
    }
  },

  /**
   * Satu kitaran pekerja: penyelenggaraan (pelayan memutuskan sama ada tiba masanya) + hantar email tertunggak.
   * @param {{force?:boolean}} [opts]
   */
  tick: function (opts) {
    if (!WorkerService.active()) return { skipped: 'Supabase belum aktif' };
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) return { skipped: 'kitaran lain sedang berjalan' };
    const out = { sent: 0, failed: 0 };
    try {
      for (let round = 0; round < 5; round++) {
        const tickPayload = { force: !!(opts && opts.force && round === 0), limit: 20 };
        /* Laporkan sekali setiap kitaran sama ada FCM dikonfigurasi di sini (pelayan memaparkan butang notifikasi telefon) */
        if (round === 0) tickPayload.pushRelay = PushService.enabled();
        const data = WorkerService.call('system.tick', tickPayload);
        if (round === 0) out.maintenance = data.maintenance;
        const mails = data.mails || [];
        if (!mails.length) break;
        const results = mails.map(function (m) {
          try {
            if (m.kind === 'push') {
              const r = PushService.relay(m.payload);
              out.pushed = (out.pushed || 0) + r.sent;
              return { id: m.id, ok: true, revoke: r.dead };
            }
            if (m.kind !== 'mail') throw new Error('Jenis tidak disokong: ' + m.kind);
            MailApp.sendEmail(m.payload);
            out.sent++;
            return { id: m.id, ok: true };
          } catch (e) {
            out.failed++;
            return { id: m.id, ok: false, error: String(e && e.message || e) };
          }
        });
        WorkerService.call('system.ack', { results: results });
        if (mails.length < 20) break;
      }
      if (out.maintenance && out.maintenance.daily) {
        try { out.backup = WorkerService.backup(); } catch (e) { out.backupError = String(e && e.message || e); }
      }
    } finally {
      lock.releaseLock();
    }
    if (out.sent || out.failed || out.pushed || out.backup || out.backupError) console.log('Pekerja: ' + JSON.stringify(out));
    return out;
  },

  /** Sandaran harian: semua data Supabase → spreadsheet baharu dalam folder Backup (simpan beberapa salinan terkini). */
  backup: function () {
    const folderId = Env.get('BACKUP_FOLDER_ID');
    if (!folderId) return { skipped: 'BACKUP_FOLDER_ID tiada' };
    const data = WorkerService.call('system.export', {});
    const root = DriveApp.getFolderById(folderId);
    const folder = DriveService.child(root, Utilities.formatDate(new Date(), DateUtils.tz(), 'yyyy'));
    const name = CONFIG.APP_SLUG + '_Backup_' + Utilities.formatDate(new Date(), DateUtils.tz(), 'yyyyMMdd_HHmm');
    const ss = SpreadsheetApp.create(name);
    const first = ss.getSheets()[0];
    (data.sheets || []).forEach(function (s, i) {
      const sh = i === 0 ? first.setName(s.name) : ss.insertSheet(s.name);
      const width = Math.max(1, (s.header || []).length, (s.rows || []).reduce(function (m, r) { return Math.max(m, r.length); }, 0));
      const pad = function (r) { const x = r.slice(0, width); while (x.length < width) x.push(''); return x.map(function (v) { return v === null || v === undefined ? '' : (typeof v === 'string' ? StringUtils.sheetSafe(v) : v); }); };
      const values = [pad(s.header || [])].concat((s.rows || []).map(pad));
      if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
      sh.getRange(1, 1, values.length, width).setNumberFormat('@').setValues(values);
    });
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(folder);
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* polisi domain */ }
    Env.set('LAST_BACKUP_AT', DateUtils.nowIso());
    return { fileId: ss.getId(), name: name, sheets: (data.sheets || []).length, pruned: BackupService.prune(folder) };
  },

  /** Semua sheet pangkalan data Google Sheets semasa → format import. */
  snapshot: function () {
    const ss = Database.open();
    return ss.getSheets().map(function (sh) {
      const lr = sh.getLastRow();
      const lc = sh.getLastColumn();
      const values = lr && lc ? sh.getRange(1, 1, lr, lc).getValues() : [];
      const conv = function (row) {
        return row.map(function (v) {
          if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
          return v === null || v === undefined ? '' : v;
        });
      };
      return { name: sh.getName(), header: values.length ? conv(values[0]) : [], rows: values.slice(1).map(conv) };
    });
  },

  /** Pelayan Supabase bertanya: adakah import dengan nonce ini dimulakan oleh skrip ini? */
  verifyImport: function (nonce) {
    const props = PropertiesService.getScriptProperties();
    const want = props.getProperty('SUPABASE_IMPORT_NONCE') || '';
    const ok = !!want && props.getProperty('SUPABASE_ACTIVE') === 'migrating' && SecurityUtils.constantTimeEquals(String(nonce || ''), want);
    return { ok: ok };
  },

  /** Pindah data + Script Properties ke Supabase (sekali). Dipanggil oleh pindahKeSupabase(). */
  migrate: function () {
    if (!WorkerService.apiUrl()) throw new Error('URL API Supabase belum ditetapkan (DEPLOY_INFO.apiUrl / SUPABASE_API_URL).');
    if (WorkerService.state() === '1') throw new Error('Supabase sudah aktif. Pemindahan telah dibuat.');
    const nonce = SecurityUtils.randomToken();
    Env.set('SUPABASE_IMPORT_NONCE', nonce);
    Env.set('SUPABASE_ACTIVE', 'migrating');
    /* Tunggu tulisan yang sedang berjalan selesai; tulisan baharu menyemak semula keadaan di bawah kunci (Database.withLock) */
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheets = WorkerService.snapshot();
      const props = PropertiesService.getScriptProperties().getProperties();
      delete props.SUPABASE_ACTIVE;
      delete props.SUPABASE_IMPORT_NONCE;
      ['AUTH_PEPPER', 'FORM_SECRET'].forEach(function (k) { if (!props[k] && Env.get(k)) props[k] = Env.get(k); });
      props.WORKER_URL = ScriptApp.getService().getUrl() || '';
      props.OWNER_EMAIL = Session.getEffectiveUser().getEmail() || '';
      let r = null;
      let sendError = null;
      try { r = WorkerService.post({ action: 'system.import', payload: { sheets: sheets, props: props, nonce: nonce } }); } catch (e) { sendError = e; }
      if (!r || !r.success) {
        /* Jawapan mungkin hilang walaupun import berjaya → semak dengan pelayan sebelum kembali ke Google Sheets */
        let done = false;
        try { WorkerService.call('system.status', {}); done = true; } catch (e2) { done = false; }
        if (!done) throw sendError || new Error('Import gagal: ' + (r && r.code) + ' — ' + (r && r.message));
        r = { success: true, data: { recovered: true, sheets: sheets.length, rows: 0, props: 0 } };
      }
      Env.set('SUPABASE_ACTIVE', '1');
      PropertiesService.getScriptProperties().deleteProperty('SUPABASE_IMPORT_NONCE');
      WorkerService.ensureTrigger();
      return r.data;
    } catch (e) {
      Env.set('SUPABASE_ACTIVE', '');
      throw e;
    } finally {
      lock.releaseLock();
    }
  },

  /** Pencetus pekerja setiap minit (idempoten). */
  ensureTrigger: function () {
    const have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    if (have.indexOf('workerTick') < 0) ScriptApp.newTrigger('workerTick').timeBased().everyMinutes(1).create();
    return true;
  }
};
