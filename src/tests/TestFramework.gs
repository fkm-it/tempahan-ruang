/**
 * @file TestFramework.gs
 * Rangka ujian ringan yang berjalan di DUA tempat:
 *   1. Apps Script (runTestsPart1..4 di Code.gs) — pada spreadsheet & folder Drive SEMENTARA.
 *   2. Node.js (npm test) — dengan mock GAS (tools/gas-mock.js).
 * Data produksi tidak pernah disentuh: Database, Drive, Env dan prefix cache ditindih semasa ujian.
 */
const TestRunner = {
  /** Senarai suite — diselesaikan semasa panggilan (tiada kebergantungan susunan muat). */
  suites: function () {
    return [TestSuiteUtils, TestSuiteSecurity, TestSuiteRepository, TestSuiteAuth, TestSuiteCrud, TestSuitePush, TestSuiteAdmin, TestSuiteWorker]
      .concat(TestRunner.appSuites());
  },

  /** Suite domain projek: isytihar `const AppTests = { suites: function () { return [TestSuiteX]; } }` dalam src/tests/. */
  appSuites: function () {
    return typeof AppTests !== 'undefined' && AppTests.suites ? AppTests.suites() : [];
  },

  /** Nama suite bagi bahagian n (bahagian 5 = suite domain projek). */
  partSuites: function (n) {
    return Number(n) === 5 ? TestRunner.appSuites().map(function (s) { return s.name; }) : TestRunner.PARTS[n];
  },

  /** Bahagian ujian untuk Apps Script (setiap bahagian < 6 minit). */
  PARTS: {
    1: ['Utils', 'Security', 'Repository'],
    2: ['Auth'],
    3: ['Modul (CrudEngine)'],
    4: ['Kategori & Notifikasi telefon', 'Admin & API', 'Pekerja Supabase']
  },

  /**
   * @param {{live?:boolean, filter?:string, suites?:string[], budgetMs?:number}} options
   *   live=true dalam Apps Script sebenar; suites = nama suite untuk dijalankan;
   *   budgetMs = had masa ujian (baki ditanda SKIP supaya teardown sempat berjalan).
   */
  runAll: function (options) {
    options = options || {};
    const results = [];
    const started = Date.now();
    const sandbox = TestRunner.setup(options);
    const budget = options.budgetMs || 0;
    try {
      TestRunner.suites().forEach(function (suite) {
        if (options.suites && options.suites.indexOf(suite.name) < 0) return;
        suite.tests.forEach(function (tc) {
          const name = tc[0];
          const fn = tc[1];
          const opts = tc[2] || {};
          const full = suite.name + ' › ' + name;
          if (options.filter && full.toLowerCase().indexOf(options.filter.toLowerCase()) < 0) return;
          if (opts.nodeOnly && options.live) { results.push({ name: full, status: 'SKIP' }); return; }
          if (budget && Date.now() - started > budget) { results.push({ name: full, status: 'SKIP', error: 'Had masa — jalankan semula bahagian ini' }); return; }
          const t0 = Date.now();
          try {
            Database.resetRequestCache();
            fn(TestAssert, sandbox);
            results.push({ name: full, status: 'PASS', ms: Date.now() - t0 });
          } catch (e) {
            results.push({ name: full, status: 'FAIL', ms: Date.now() - t0, error: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0, 4).join('\n') });
          }
        });
      });
    } finally {
      TestRunner.teardown(sandbox, options);
    }
    const summary = {
      total: results.length,
      passed: results.filter(function (r) { return r.status === 'PASS'; }).length,
      failed: results.filter(function (r) { return r.status === 'FAIL'; }).length,
      skipped: results.filter(function (r) { return r.status === 'SKIP'; }).length,
      ms: Date.now() - started
    };
    return { summary: summary, results: results };
  },

  setup: function (options) {
    const sandbox = { prevPrefix: AppCache.PREFIX };
    AppCache.PREFIX = 'kdtest' + Utilities.getUuid().slice(0, 8) + ':';
    sandbox.ss = SpreadsheetApp.create(CONFIG.APP_SLUG + '_TEST_' + Date.now());
    sandbox.folder = DriveApp.createFolder(CONFIG.APP_SLUG + '_TEST_' + Date.now());
    Env.useOverrides({
      APP_ENV: 'DEV',
      SPREADSHEET_ID: sandbox.ss.getId(),
      AUTH_PEPPER: 'test-pepper-' + Utilities.getUuid(),
      FORM_SECRET: 'test-secret-' + Utilities.getUuid(),
      PBKDF2_ITERATIONS: '1000',
      ATTACHMENT_FOLDER_ID: sandbox.folder.getId(),
      BACKUP_FOLDER_ID: sandbox.folder.getId(),
      BOOTSTRAP_SUPER_ADMIN_EMAIL: 'super@test.local',
      LAST_BACKUP_AT: '',
      MIGRATED_FOR: '' // jangan sentuh tandatangan migrasi produksi
    });
    Database.useSpreadsheet(sandbox.ss);
    DriveService.folderOverride = sandbox.folder;
    Migration.run({});
    // Ujian teras menganggap pendaftaran dibuka (lalai projek mungkin menutupnya)
    SettingsRepository.setMany({ ALLOW_REGISTRATION: 'TRUE' }, 'TEST');
    return sandbox;
  },

  teardown: function (sandbox, options) {
    Database.useSpreadsheet(null);
    DriveService.folderOverride = null;
    Env.useOverrides(null);
    AppCache.PREFIX = sandbox.prevPrefix;
    if (options.live) {
      try { DriveApp.getFileById(sandbox.ss.getId()).setTrashed(true); } catch (e) { /* abaikan */ }
      try { sandbox.folder.setTrashed(true); } catch (e) { /* abaikan */ }
    }
  },

  format: function (result) {
    const lines = result.results.map(function (r) {
      return (r.status === 'PASS' ? '✔' : r.status === 'SKIP' ? '○' : '✘') + ' ' + r.name + (r.status === 'SKIP' && r.error ? ' — ' + r.error : '') +
        (r.ms !== undefined ? ' (' + r.ms + 'ms)' : '') + (r.status === 'FAIL' ? '\n    → ' + r.error + '\n' + r.stack : '');
    });
    const s = result.summary;
    lines.push('');
    lines.push('Jumlah: ' + s.total + ' · Lulus: ' + s.passed + ' · Gagal: ' + s.failed + ' · Langkau: ' + s.skipped + ' · ' + s.ms + 'ms');
    return lines.join('\n');
  }
};

const TestAssert = {
  ok: function (cond, msg) { if (!cond) throw new Error(msg || 'Dijangka benar'); },
  eq: function (a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'dijangka ' + JSON.stringify(b) + ', dapat ' + JSON.stringify(a));
  },
  /** fn mesti melontar AppError dengan kod tertentu. */
  throws: function (fn, code, msg) {
    try { fn(); } catch (e) {
      if (code && e.code !== code) throw new Error((msg ? msg + ': ' : '') + 'kod dijangka ' + code + ', dapat ' + (e.code || e.message));
      return e;
    }
    throw new Error((msg ? msg + ': ' : '') + 'dijangka melontar ' + (code || 'ralat'));
  },
  /** Respons API gagal dengan kod tertentu. */
  apiFail: function (res, code) {
    if (res.success) throw new Error('Dijangka gagal (' + code + '), tetapi berjaya');
    if (code && res.code !== code) throw new Error('Kod dijangka ' + code + ', dapat ' + res.code + ' (' + res.message + ')');
    return res;
  },
  apiOk: function (res) {
    if (!res.success) throw new Error('Dijangka berjaya, dapat ' + res.code + ': ' + res.message);
    return res.data;
  }
};

/** Pembantu ujian dikongsi. */
const TestHelpers = {
  seq: 0,
  email: function (tag) { TestHelpers.seq++; return (tag || 'user') + TestHelpers.seq + '_' + Utilities.getUuid().slice(0, 6) + '@test.local'; },

  /** Daftar + log masuk melalui API sebenar. @return {{token, user, ctx}} */
  user: function (tag, email) {
    const em = email || TestHelpers.email(tag);
    const res = api({ action: 'auth.register', payload: { fullName: 'Pengguna ' + (tag || 'Ujian'), email: em, password: 'Rahsia123' } });
    const data = TestAssert.apiOk(res);
    return { token: data.token, user: data.user, email: em, ctx: AuthService.resolveSession(data.token) };
  },

  /** Cipta pengguna dan naikkan peranan secara langsung (bypass UI). */
  admin: function (role) {
    const u = TestHelpers.user('admin');
    UserRepository.update(u.user.id, { role: role || ROLES.ADMIN });
    UserService.invalidate(u.user.id);
    u.ctx = AuthService.resolveSession(u.token);
    return u;
  },

  call: function (token, action, payload) {
    return api({ action: action, payload: payload || {}, token: token });
  },

  categoryId: function () { return CategoryRepository.active()[0].category_id; },

  /** PNG 1x1 sah (base64). */
  PNG_1PX: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
};
