/**
 * @file Database.gs
 * Akses spreadsheet + kunci (LockService) + cache peringkat-permintaan.
 *
 * - Spreadsheet ID dibaca daripada Script Properties (tidak di-hardcode).
 * - withLock(): kunci skrip boleh-masuk-semula (re-entrant) untuk operasi tulis kritikal.
 * - Cache permintaan: data jadual dibaca SEKALI per eksekusi, dibatalkan apabila ditulis.
 */
const Database = (function () {
  let spreadsheet = null;
  let override = null;
  let lockDepth = 0;
  let requestCache = {};

  function open() {
    if (override) return override;
    if (spreadsheet) return spreadsheet;
    const id = Env.get('SPREADSHEET_ID');
    if (!id) throw new AppError(ERROR_CODES.CONFIG_ERROR, 'Pangkalan data belum dikonfigurasi. Jalankan setupDatabase().', { missing: 'SPREADSHEET_ID' });
    spreadsheet = SpreadsheetApp.openById(id);
    return spreadsheet;
  }

  function sheet(name) {
    const sh = open().getSheetByName(name);
    if (!sh) throw new AppError(ERROR_CODES.CONFIG_ERROR, 'Struktur pangkalan data tidak lengkap. Jalankan setupDatabase().', { missingSheet: name });
    return sh;
  }

  /** Untuk ujian / migrasi: guna spreadsheet lain tanpa mengubah Script Properties. */
  function useSpreadsheet(ss) {
    override = ss || null;
    resetRequestCache();
  }

  /**
   * Jalankan fn di bawah kunci skrip. Panggilan bersarang tidak mengunci semula.
   * @throws {AppError} BUSY jika kunci tidak diperoleh dalam masa.
   */
  function withLock(fn) {
    if (lockDepth > 0) {
      lockDepth++;
      try { return fn(); } finally { lockDepth--; }
    }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      throw new AppError(ERROR_CODES.BUSY, 'Sistem sedang sibuk. Sila cuba sebentar lagi.');
    }
    lockDepth = 1;
    try {
      /* Apps Script: data mungkin sedang/telah dipindahkan ke Supabase → tolak tulisan ke Google Sheets (baca segar, bukan cache) */
      if (!(typeof EDGE_RUNTIME !== 'undefined' && EDGE_RUNTIME) && PropertiesService.getScriptProperties().getProperty('SUPABASE_ACTIVE')) {
        throw new AppError(ERROR_CODES.MAINTENANCE, 'Sistem sedang dinaik taraf. Sila cuba semula dalam seminit.');
      }
      const result = fn();
      SpreadsheetApp.flush();
      return result;
    } finally {
      lockDepth = 0;
      lock.releaseLock();
    }
  }

  function inLock() {
    return lockDepth > 0;
  }

  function cacheGet(key) {
    return Object.prototype.hasOwnProperty.call(requestCache, key) ? requestCache[key] : undefined;
  }
  function cacheSet(key, value) {
    requestCache[key] = value;
    return value;
  }
  function invalidate(key) {
    delete requestCache[key];
  }
  function resetRequestCache() {
    requestCache = {};
  }

  return {
    open: open,
    sheet: sheet,
    useSpreadsheet: useSpreadsheet,
    withLock: withLock,
    inLock: inLock,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    invalidate: invalidate,
    resetRequestCache: resetRequestCache
  };
})();

/**
 * Cache merentas permintaan (CacheService) dengan serialisasi JSON + kunci berversi.
 * Nilai > 100KB tidak dicache (had CacheService).
 */
const AppCache = {
  PREFIX: 'kd1:',

  store: function () {
    return CacheService.getScriptCache();
  },

  get: function (key) {
    try {
      const raw = AppCache.store().get(AppCache.PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  put: function (key, value, ttlSeconds) {
    try {
      const raw = JSON.stringify(value);
      if (raw.length < 95000) AppCache.store().put(AppCache.PREFIX + key, raw, Math.min(21600, ttlSeconds || 300));
    } catch (e) {
      AppLogger.warn('Cache put gagal', { key: key });
    }
  },

  remove: function (key) {
    try { AppCache.store().remove(AppCache.PREFIX + key); } catch (e) { /* abaikan */ }
  },

  /** Versi data sesuatu sheet (berubah pada setiap tulisan melalui repository). */
  version: function (sheet) {
    const k = 'ver:' + sheet;
    let v = AppCache.get(k);
    if (!v) { v = Utilities.getUuid().slice(0, 8); AppCache.put(k, v, 21600); }
    return v;
  },

  bump: function (sheet) { AppCache.put('ver:' + sheet, Utilities.getUuid().slice(0, 8), 21600); },

  /**
   * Cache hasil bacaan yang bergantung pada sheet tertentu: dibatalkan serta-merta apabila mana-mana sheet itu ditulis
   * melalui repository (kunci mengandungi versi data). Suntingan terus dalam Google Sheets dikesan selepas `ttlSeconds`.
   */
  rememberFor: function (sheets, key, ttlSeconds, compute) {
    const vers = sheets.map(function (s) { return AppCache.version(s); }).join('.');
    return AppCache.remember('rf:' + key + ':' + vers, ttlSeconds, compute);
  },

  /** Ambil daripada cache atau kira & simpan. */
  remember: function (key, ttlSeconds, compute) {
    const hit = AppCache.get(key);
    if (hit !== null) return hit;
    const value = compute();
    AppCache.put(key, value, ttlSeconds);
    return value;
  }
};
