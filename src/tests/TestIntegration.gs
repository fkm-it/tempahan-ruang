/**
 * @file TestIntegration.gs
 * Ujian integrasi: repository, auth, kategori, notifikasi telefon, admin & keselamatan API.
 * Ujian enjin modul: TestModules.gs.
 */
const TestSuiteRepository = {
  name: 'Repository',
  tests: [
    ['insert / findById / update / updateMany', function (t) {
      const repo = Repo.of('FEEDBACK');
      const id = IdUtils.generate('B');
      repo.insert({ feedback_id: id, name: 'A', email: 'a@b.c', message: 'm', status: 'NEW', created_at: DateUtils.nowIso(), updated_at: '' });
      Database.resetRequestCache();
      t.eq(repo.findById(id).name, 'A');
      repo.update(id, { status: 'REVIEWED' });
      t.eq(repo.findById(id).status, 'REVIEWED');
      t.eq(repo.updateMany(Object.fromEntries ? Object.fromEntries([[id, { name: 'B' }]]) : (function () { const o = {}; o[id] = { name: 'B' }; return o; })()), 1);
      Database.resetRequestCache();
      t.eq(repo.findById(id).name, 'B');
    }],
    ['Formula injection disimpan sebagai teks & dibaca semula tepat', function (t) {
      const repo = Repo.of('FEEDBACK');
      const id = IdUtils.generate('B');
      repo.insert({ feedback_id: id, name: '=IMPORTXML("http://evil")', email: 'a@b.c', message: '+1-2', status: 'NEW', created_at: '', updated_at: '' });
      Database.resetRequestCache();
      t.eq(repo.findById(id).name, '=IMPORTXML("http://evil")');
      t.eq(repo.findById(id).message, '+1-2');
    }],
    ['Lajur tambahan manual dikekalkan semasa update', function (t) {
      const sh = Database.sheet('FEEDBACK');
      const col = sh.getLastColumn() + 1;
      sh.getRange(1, col, 1, 1).setValues([['nota_admin']]);
      Database.resetRequestCache();
      const repo = Repo.of('FEEDBACK');
      const id = IdUtils.generate('B');
      repo.insert({ feedback_id: id, name: 'X', email: 'x@y.z', message: 'm', status: 'NEW', created_at: '', updated_at: '' });
      const row = repo.locateRow(id);
      sh.getRange(row, col, 1, 1).setValues([['penting']]);
      Database.resetRequestCache();
      repo.update(id, { status: 'CLOSED' });
      t.eq(sh.getRange(row, col, 1, 1).getValues()[0][0], 'penting');
    }],
    ['hardDelete & deleteWhere', function (t) {
      const repo = Repo.of('PUSH_TOKENS');
      const a = IdUtils.generate('K'), b = IdUtils.generate('K');
      repo.insertMany([
        { token_id: a, user_id: 'U-X', token: 't1', platform: 'WEB', user_agent: '', status: 'ACTIVE', created_at: '', last_seen_at: '' },
        { token_id: b, user_id: 'U-X', token: 't2', platform: 'WEB', user_agent: '', status: 'ACTIVE', created_at: '', last_seen_at: '' }
      ]);
      t.ok(repo.hardDelete(a));
      Database.resetRequestCache();
      t.eq(repo.findById(a), null);
      t.eq(repo.deleteWhere(function (r) { return r.user_id === 'U-X'; }), 1);
    }],
    ['Kunci sibuk → BUSY (penulisan serentak)', function (t) {
      const lock = LockService.getScriptLock();
      lock.tryLock(1);
      try {
        t.throws(function () { Repo.of('FEEDBACK').insert({ feedback_id: IdUtils.generate('B') }); }, ERROR_CODES.BUSY);
      } finally {
        lock.releaseLock();
      }
    }, { nodeOnly: true }],
    ['Migrasi automatik selepas deploy: sekali sahaja setiap tandatangan', function (t) {
      Env.set('MIGRATED_FOR', '');
      t.ok(Migration.autoRun() !== null, 'dijalankan apabila tandatangan berubah');
      t.ok(Env.get('MIGRATED_FOR'), 'tandatangan disimpan');
      t.eq(Migration.autoRun(), null, 'tidak dijalankan semula');
    }],
    ['Migrasi idempoten (dijalankan semula tanpa duplikat)', function (t) {
      const before = CategoryRepository.base().count();
      const r = Migration.run({});
      t.eq(r.applied.length, 0);
      t.eq(SeedData.categories(), 0);
      Database.resetRequestCache();
      t.eq(CategoryRepository.base().count(), before);
      t.eq(Migration.run({ dryRun: true }).pending.length, 0);
    }]
  ]
};

const TestSuiteAuth = {
  name: 'Auth',
  tests: [
    ['Daftar → token sah, peranan USER, tiada hash dalam USERS', function (t) {
      const u = TestHelpers.user('daftar');
      t.ok(SecurityUtils.isTokenFormat(u.token));
      t.eq(u.user.role, ROLES.USER);
      t.ok(u.ctx && u.ctx.userId === u.user.id);
      const raw = JSON.stringify(Database.sheet('USERS').getRange(1, 1, Database.sheet('USERS').getLastRow(), 11).getValues());
      t.ok(raw.indexOf('pbkdf2') < 0, 'hash tidak dalam USERS');
      t.ok(raw.indexOf('Rahsia123') < 0, 'tiada plaintext');
    }],
    ['Mass assignment: role dalam payload diabaikan', function (t) {
      const em = TestHelpers.email('mass');
      const d = TestAssert.apiOk(api({ action: 'auth.register', payload: { fullName: 'Cuba Naik', email: em, password: 'Rahsia123', role: 'SUPER_ADMIN' } }));
      t.eq(d.user.role, ROLES.USER);
    }],
    ['Email berganda ditolak', function (t) {
      const u = TestHelpers.user('dup');
      TestAssert.apiFail(api({ action: 'auth.register', payload: { fullName: 'Dua', email: u.email.toUpperCase(), password: 'Rahsia123' } }), ERROR_CODES.CONFLICT);
    }],
    ['Log masuk berjaya / gagal (mesej generik)', function (t) {
      const u = TestHelpers.user('login');
      TestAssert.apiOk(api({ action: 'auth.login', payload: { email: u.email, password: 'Rahsia123' } }));
      const bad = TestAssert.apiFail(api({ action: 'auth.login', payload: { email: u.email, password: 'Salah1234' } }), ERROR_CODES.UNAUTHENTICATED);
      const none = TestAssert.apiFail(api({ action: 'auth.login', payload: { email: 'tiada@test.local', password: 'Salah1234' } }), ERROR_CODES.UNAUTHENTICATED);
      t.eq(bad.message, none.message, 'tiada enumerasi akaun');
    }],
    ['Kunci akaun selepas 5 cubaan gagal', function (t) {
      const u = TestHelpers.user('lockout');
      for (let i = 0; i < CONFIG.LOGIN_MAX_FAILS; i++) api({ action: 'auth.login', payload: { email: u.email, password: 'Salah1234' } });
      TestAssert.apiFail(api({ action: 'auth.login', payload: { email: u.email, password: 'Rahsia123' } }), ERROR_CODES.RATE_LIMITED);
    }],
    ['Log keluar membatalkan token', function (t) {
      const u = TestHelpers.user('logout');
      TestAssert.apiOk(TestHelpers.call(u.token, 'auth.me'));
      TestAssert.apiOk(TestHelpers.call(u.token, 'auth.logout'));
      TestAssert.apiFail(TestHelpers.call(u.token, 'auth.me'), ERROR_CODES.UNAUTHENTICATED);
    }],
    ['Sekat pengguna → semua sesi tamat serta-merta', function (t) {
      const u = TestHelpers.user('blockme');
      const adm = TestHelpers.admin(ROLES.ADMIN);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.user.status', { userId: u.user.id, status: 'BLOCKED' }));
      TestAssert.apiFail(TestHelpers.call(u.token, 'auth.me'), ERROR_CODES.UNAUTHENTICATED);
      TestAssert.apiFail(api({ action: 'auth.login', payload: { email: u.email, password: 'Rahsia123' } }), ERROR_CODES.FORBIDDEN);
      Database.resetRequestCache();
      const live = SessionRepository.base().find(function (s) { return s.user_id === u.user.id && !s.revoked_at; });
      t.eq(live.length, 0, 'sesi dibatalkan dalam SESSIONS');
    }],
    ['Bootstrap SUPER_ADMIN melalui Script Property', function (t) {
      const d = TestAssert.apiOk(api({ action: 'auth.register', payload: { fullName: 'Super Admin', email: 'super@test.local', password: 'Rahsia123' } }));
      t.eq(d.user.role, ROLES.SUPER_ADMIN);
    }],
    ['Tukar kata laluan menamatkan sesi lain', function (t) {
      const u = TestHelpers.user('chpw');
      const second = TestAssert.apiOk(api({ action: 'auth.login', payload: { email: u.email, password: 'Rahsia123' } })).token;
      TestAssert.apiFail(TestHelpers.call(u.token, 'auth.changePassword', { currentPassword: 'Salah1234', newPassword: 'Baharu456' }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiOk(TestHelpers.call(u.token, 'auth.changePassword', { currentPassword: 'Rahsia123', newPassword: 'Baharu456' }));
      TestAssert.apiOk(TestHelpers.call(u.token, 'auth.me'));
      TestAssert.apiFail(TestHelpers.call(second, 'auth.me'), ERROR_CODES.UNAUTHENTICATED);
    }],
    ['Set semula kata laluan dengan kod email', function (t, sandbox) {
      const u = TestHelpers.user('reset');
      const r1 = TestAssert.apiOk(api({ action: 'auth.requestReset', payload: { email: u.email } }));
      const r2 = TestAssert.apiOk(api({ action: 'auth.requestReset', payload: { email: 'tiada@test.local' } }));
      t.eq(r1.message, r2.message, 'anti-enumerasi');
      const mail = globalThis.__mails ? globalThis.__mails[globalThis.__mails.length - 1] : null;
      t.ok(mail && mail.to === u.email, 'email dihantar');
      const code = mail.htmlBody.match(/<b>(\d{6})<\/b>/)[1];
      TestAssert.apiFail(api({ action: 'auth.resetPassword', payload: { email: u.email, code: code === '000000' ? '111111' : '000000', newPassword: 'Baharu789' } }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiOk(api({ action: 'auth.resetPassword', payload: { email: u.email, code: code, newPassword: 'Baharu789' } }));
      TestAssert.apiFail(TestHelpers.call(u.token, 'auth.me'), ERROR_CODES.UNAUTHENTICATED);
      TestAssert.apiOk(api({ action: 'auth.login', payload: { email: u.email, password: 'Baharu789' } }));
      TestAssert.apiFail(api({ action: 'auth.resetPassword', payload: { email: u.email, code: code, newPassword: 'Lagi1234' } }), ERROR_CODES.VALIDATION_ERROR, 'kod sekali guna');
    }, { nodeOnly: true }]
  ]
};

const TestSuitePush = {
  name: 'Kategori & Notifikasi telefon',
  tests: [
    ['Kategori: kategori tidak aktif ditolak; satu kategori aktif → dipilih automatik', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('cat');
      const a = TestHelpers.admin(ROLES.ADMIN);
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Tanpa kategori' }));
      t.eq(d.labels.kategori, 'Umum');
      const c2 = TestAssert.apiOk(TestHelpers.call(a.token, 'admin.category.create', { nameMs: 'Kedua ' + Date.now(), icon: 'star' }));
      TestAssert.apiOk(TestHelpers.call(a.token, 'admin.category.update', { id: c2.id, status: 'INACTIVE' }));
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'X', kategori: c2.id }), ERROR_CODES.VALIDATION_ERROR);
      const last = CategoryRepository.active();
      if (last.length === 1) TestAssert.apiFail(TestHelpers.call(a.token, 'admin.category.update', { id: last[0].category_id, status: 'INACTIVE' }), ERROR_CODES.VALIDATION_ERROR);
      TestFixtures.uninstall();
    }],
    ['Push: hurai JSON akaun servis dengan toleransi tampal', function (t) {
      const sa = globalThis.__testServiceAccount;
      t.ok(PushService.parseServiceAccount(sa), 'JSON biasa');
      t.ok(PushService.parseServiceAccount('\uFEFF  ' + sa + '\n'), 'BOM & ruang');
      t.ok(PushService.parseServiceAccount(JSON.stringify(sa)), 'dibalut petikan');
      t.ok(PushService.parseServiceAccount(Utilities.base64Encode(sa)), 'base64');
      t.ok(PushService.parseServiceAccount(sa.replace(/"/g, '\u201C')) === null || true, 'petikan pintar tidak melontar');
      t.eq(PushService.parseServiceAccount(sa.slice(0, 500)), null, 'terpotong → null');
      t.eq(PushService.parseServiceAccount('{"a":1}'), null, 'bukan akaun servis → null');
      const d = PushService.diagnose(sa.slice(0, 500));
      t.ok(d.length === 500 && d.hasPrivateKey && !d.hasEndKey && JSON.stringify(d).indexOf('PRIVATE') < 0, 'diagnostik tanpa rahsia');
    }, { nodeOnly: true }],
    ['Push: daftar/buang token, had peranti, pindah milik', function (t) {
      const a = TestHelpers.user('pusha');
      const b = TestHelpers.user('pushb');
      const tok = function (n) { return 'fcmTok' + n + '_' + 'x'.repeat(40); };
      TestAssert.apiFail(TestHelpers.call(a.token, 'push.register', { token: 'bad token!' }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiFail(api({ action: 'push.register', payload: { token: tok(0) } }), ERROR_CODES.UNAUTHENTICATED);
      for (let i = 1; i <= 7; i++) TestAssert.apiOk(TestHelpers.call(a.token, 'push.register', { token: tok(i), platform: 'ANDROID' }));
      t.eq(PushTokenRepository.activeByUser(a.user.id).length, PushService.MAX_TOKENS_PER_USER, 'had peranti');
      // Peranti yang sama kini digunakan oleh pengguna B → token dipindah milik
      TestAssert.apiOk(TestHelpers.call(b.token, 'push.register', { token: tok(7) }));
      t.ok(PushTokenRepository.activeByUser(a.user.id).every(function (x) { return x.token !== tok(7); }));
      t.eq(PushTokenRepository.activeByUser(b.user.id).length, 1);
      // A tidak boleh membuang token B
      TestAssert.apiOk(TestHelpers.call(a.token, 'push.unregister', { token: tok(7) }));
      t.eq(PushTokenRepository.activeByUser(b.user.id).length, 1);
      TestAssert.apiOk(TestHelpers.call(b.token, 'push.unregister', { token: tok(7) }));
      t.eq(PushTokenRepository.activeByUser(b.user.id).length, 0);
      t.eq(TestAssert.apiOk(TestHelpers.call(b.token, 'push.status')).devices, 0);
    }, { nodeOnly: true }],
    ['Push: tanpa konfigurasi FCM → senyap; dengan konfigurasi → hantar FCM v1 & batal token tidak sah', function (t) {
      const st = globalThis.__mockState;
      TestFixtures.install();
      const owner = TestHelpers.user('pusho');
      const adm = TestHelpers.admin(ROLES.ADMIN);
      TestAssert.apiOk(TestHelpers.call(owner.token, 'push.register', { token: 'okToken_' + 'a'.repeat(40) }));
      TestAssert.apiOk(TestHelpers.call(owner.token, 'push.register', { token: 'deadToken_' + 'b'.repeat(40) }));
      const rec = TestAssert.apiOk(TestHelpers.call(owner.token, 'crud.create', { module: 'tiket', tajuk: 'Aircond bocor' }));
      const status = function (s) { return TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tiket', id: rec.id, status: s })); };
      Env.set('FCM_SERVICE_ACCOUNT', '');
      t.eq(TestAssert.apiOk(api({ action: 'public.config' })).PUSH_ENABLED, false);
      const before = st.fetches.length;
      status('SELESAI');
      t.eq(st.fetches.length, before, 'tiada panggilan rangkaian tanpa konfigurasi');

      Env.set('FCM_SERVICE_ACCOUNT', globalThis.__testServiceAccount);
      Env.set('PUBLIC_BASE_URL', 'https://contoh.github.io/');
      CacheService.getScriptCache().remove(PushService.TOKEN_CACHE_KEY);
      st.fetchHandler = function (url, params) {
        if (/oauth2/.test(url)) return { code: 200, body: { access_token: 'ya29.test', expires_in: 3599 } };
        return JSON.parse(params.payload).message.token.indexOf('deadToken') === 0
          ? { code: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }
          : { code: 200, body: { name: 'projects/app-test/messages/1' } };
      };
      try {
        t.eq(TestAssert.apiOk(api({ action: 'public.config' })).PUSH_ENABLED, true);
        const start = st.fetches.length;
        status('BARU');
        const calls = st.fetches.slice(start);
        const oauth = calls.filter(function (c) { return /oauth2/.test(c.url); })[0];
        t.ok(oauth && globalThis.__verifyJwt(oauth.params.payload.assertion), 'JWT RS256 sah');
        const sends = calls.filter(function (c) { return /fcm\.googleapis\.com\/v1\/projects\/app-test\/messages:send/.test(c.url); });
        t.eq(sends.length, 2, 'dihantar ke 2 peranti');
        const msg = JSON.parse(sends[0].params.payload).message;
        t.ok(/Baharu/.test(msg.notification.title) && /Baharu/.test(msg.notification.body), 'tajuk: ' + msg.notification.title);
        t.eq(msg.webpush.fcm_options.link, 'https://contoh.github.io/#/tiket/' + rec.id, 'pautan terus ke rekod');
        t.ok(/^[1-9][0-9]*$/.test(msg.data.badge), 'bilangan belum dibaca untuk lencana ikon: ' + msg.data.badge);
        t.eq(msg.webpush.notification.tag, 'RECORD_STATUS:' + rec.id, 'tag unik setiap rekod (notifikasi bertindan)');
        t.eq(msg.webpush.notification.badge, 'https://contoh.github.io/icons/badge-72.png');
        t.eq(sends[0].params.headers.Authorization, 'Bearer ya29.test');
        t.eq(PushTokenRepository.activeByUser(owner.user.id).length, 1, 'token UNREGISTERED dibatalkan');
        // Token akses dicache — tiada permintaan OAuth kedua
        const s2 = st.fetches.length;
        PushService.sendToUser(owner.user.id, { title: 'x', body: 'y', type: 'TEST' });
        t.eq(st.fetches.slice(s2).filter(function (c) { return /oauth2/.test(c.url); }).length, 0);
        // FCM ralat 500 → tidak melontar, permintaan asal tetap berjaya
        st.fetchHandler = function (url) { return /oauth2/.test(url) ? { code: 200, body: { access_token: 'ya29.t', expires_in: 3599 } } : { code: 500, body: 'oops' }; };
        status('SELESAI');
      } finally {
        TestFixtures.uninstall();
        st.fetchHandler = null;
        Env.set('FCM_SERVICE_ACCOUNT', '');
        Env.set('PUBLIC_BASE_URL', '');
      }
    }, { nodeOnly: true }]
  ]
};

const TestSuiteAdmin = {
  name: 'Admin & API',
  tests: [
    ['Tindakan tidak dikenali / payload rosak', function (t) {
      TestAssert.apiFail(api({ action: 'drop.tables' }), ERROR_CODES.BAD_REQUEST);
      TestAssert.apiFail(api({ action: 'public.config', payload: [1, 2] }), ERROR_CODES.BAD_REQUEST);
      TestAssert.apiFail(api(null), ERROR_CODES.BAD_REQUEST);
      TestAssert.apiFail(api({ action: 'constructor' }), ERROR_CODES.BAD_REQUEST);
    }],
    ['Tanpa token → UNAUTHENTICATED; token palsu → UNAUTHENTICATED', function (t) {
      TestAssert.apiFail(api({ action: 'crud.summary' }), ERROR_CODES.UNAUTHENTICATED);
      TestAssert.apiFail(api({ action: 'crud.summary', token: 'A'.repeat(43) }), ERROR_CODES.UNAUTHENTICATED);
    }],
    ['RBAC: USER tidak boleh akses admin; ADMIN tidak boleh akses SUPER_ADMIN', function (t) {
      const u = TestHelpers.user('rbac');
      const a = TestHelpers.admin(ROLES.ADMIN);
      TestAssert.apiFail(TestHelpers.call(u.token, 'admin.stats'), ERROR_CODES.FORBIDDEN);
      TestAssert.apiFail(TestHelpers.call(u.token, 'admin.users'), ERROR_CODES.FORBIDDEN);
      TestAssert.apiOk(TestHelpers.call(a.token, 'admin.stats'));
      TestAssert.apiFail(TestHelpers.call(a.token, 'admin.health'), ERROR_CODES.FORBIDDEN);
      TestAssert.apiFail(TestHelpers.call(a.token, 'admin.user.role', { userId: u.user.id, role: 'ADMIN' }), ERROR_CODES.FORBIDDEN);
    }],
    ['Peningkatan keistimewaan: ADMIN tidak boleh sekat ADMIN lain / diri sendiri', function (t) {
      const a1 = TestHelpers.admin(ROLES.ADMIN);
      const a2 = TestHelpers.admin(ROLES.ADMIN);
      TestAssert.apiFail(TestHelpers.call(a1.token, 'admin.user.status', { userId: a2.user.id, status: 'BLOCKED' }), ERROR_CODES.FORBIDDEN);
      TestAssert.apiFail(TestHelpers.call(a1.token, 'admin.user.status', { userId: a1.user.id, status: 'INACTIVE' }), ERROR_CODES.FORBIDDEN);
    }],
    ['SUPER_ADMIN tukar peranan; tidak boleh turunkan SUPER_ADMIN terakhir', function (t) {
      const s = TestHelpers.admin(ROLES.SUPER_ADMIN);
      const u = TestHelpers.user('promote');
      TestAssert.apiOk(TestHelpers.call(s.token, 'admin.user.role', { userId: u.user.id, role: 'ADMIN' }));
      TestAssert.apiFail(TestHelpers.call(u.token, 'auth.me'), ERROR_CODES.UNAUTHENTICATED); // dipaksa log masuk semula
      TestAssert.apiFail(TestHelpers.call(s.token, 'admin.user.role', { userId: s.user.id, role: 'USER' }), ERROR_CODES.FORBIDDEN);
    }],
    ['Tetapan: ADMIN tidak boleh ubah tetapan kritikal', function (t) {
      const a = TestHelpers.admin(ROLES.ADMIN);
      TestAssert.apiOk(TestHelpers.call(a.token, 'admin.settings.update', { changes: { SYSTEM_TAGLINE: 'Slogan ujian' } }));
      TestAssert.apiFail(TestHelpers.call(a.token, 'admin.settings.update', { changes: { MAINTENANCE_MODE: true } }), ERROR_CODES.FORBIDDEN);
      TestAssert.apiFail(TestHelpers.call(a.token, 'admin.settings.update', { changes: { NOT_A_KEY: 1 } }), ERROR_CODES.VALIDATION_ERROR);
    }],
    ['Mod penyelenggaraan: pengguna disekat, admin dibenarkan', function (t) {
      const s = TestHelpers.admin(ROLES.SUPER_ADMIN);
      const u = TestHelpers.user('maint');
      TestAssert.apiOk(TestHelpers.call(s.token, 'admin.settings.update', { changes: { MAINTENANCE_MODE: true } }));
      try {
        TestAssert.apiFail(TestHelpers.call(u.token, 'crud.summary'), ERROR_CODES.MAINTENANCE);
        TestAssert.apiOk(TestHelpers.call(s.token, 'admin.stats'));
        TestAssert.apiOk(api({ action: 'public.config' }));
      } finally {
        TestAssert.apiOk(TestHelpers.call(s.token, 'admin.settings.update', { changes: { MAINTENANCE_MODE: false } }));
      }
    }],
    ['Ralat dalaman disembunyikan + errorId direkod', function (t) {
      const table = Router.table();
      table['test.boom'] = { role: ROLES.PUBLIC, fn: function () { null.x(); } };
      try {
        const res = TestAssert.apiFail(api({ action: 'test.boom' }), ERROR_CODES.INTERNAL_ERROR);
        t.eq(res.message, ErrorHandler.GENERIC_MESSAGE);
        t.ok(/^E-\d{12}-[0-9A-F]{6}$/.test(res.meta.errorId), res.meta.errorId);
        t.ok(JSON.stringify(res).indexOf('Cannot read') < 0 && JSON.stringify(res).indexOf('stack') < 0, 'tiada stack trace');
        Database.resetRequestCache();
        t.eq(SystemLogRepository.recent(1)[0].error_id, res.meta.errorId);
      } finally {
        delete table['test.boom'];
      }
    }],
    ['Audit merekod tindakan admin', function (t) {
      const a = TestHelpers.admin(ROLES.ADMIN);
      TestAssert.apiOk(TestHelpers.call(a.token, 'admin.category.create', { nameMs: 'Kategori Ujian ' + Date.now(), icon: 'star' }));
      const logs = TestAssert.apiOk(TestHelpers.call(a.token, 'admin.audit', { action: 'CATEGORY_CREATED' }));
      t.ok(logs.items.length >= 1);
      t.eq(logs.items[0].userId, a.user.id);
      const all = JSON.stringify(Database.sheet('AUDIT_LOGS').getRange(1, 1, Database.sheet('AUDIT_LOGS').getLastRow(), 10).getValues());
      t.ok(all.indexOf('Rahsia123') < 0, 'tiada kata laluan dalam audit');
    }],
    ['Admin: statistik, laporan, hebahan', function (t) {
      const s = TestHelpers.admin(ROLES.SUPER_ADMIN);
      const st = TestAssert.apiOk(TestHelpers.call(s.token, 'admin.stats'));
      t.ok(st.kpi.totalUsers > 0 && st.charts.activity.length === 14 && Array.isArray(st.modules));
      const b = TestAssert.apiOk(TestHelpers.call(s.token, 'admin.broadcast', { title: 'Makluman', message: 'Selamat menggunakan sistem.' }));
      t.ok(b.sent > 0);
      const h = TestAssert.apiOk(TestHelpers.call(s.token, 'admin.health'));
      t.ok(h.database.ok, 'pangkalan data sihat');
    }],
    ['doGet menghidangkan halaman (meta tag dibenarkan, anti-clickjacking lalai)', function (t) {
      const out = doGet({ parameter: { c: 'abc<script>' } });
      t.eq(out.xframe, 'DEFAULT', 'tidak boleh dibenam secara lalai');
      t.ok(out.meta.viewport && out.title.indexOf(CONFIG.APP_NAME) === 0);
      const ok = doGet({ parameter: { c: 'K2QCST5Z' } });
      t.ok(ok && ok.meta, 'kod sah diterima');
    }, { nodeOnly: true }],
    ['doPost: API JSON untuk frontend statik (sama dengan api())', function (t) {
      const post = function (body) {
        const out = doPost({ postData: { contents: body, type: 'text/plain' } });
        t.eq(out.getMimeType(), ContentService.MimeType.JSON);
        return JSON.parse(out.getContent());
      };
      const cfg = post(JSON.stringify({ action: 'public.config', payload: {} }));
      t.ok(cfg.success && cfg.data, 'public.config berjaya');
      const bad = post('{bukan json');
      t.eq(bad.success, false); t.eq(bad.code, 'BAD_REQUEST');
      const unknown = post(JSON.stringify({ action: 'tiada.tindakan' }));
      t.eq(unknown.success, false);
      const empty = JSON.parse(doPost({}).getContent());
      t.eq(empty.code, 'BAD_REQUEST');
      const denied = post(JSON.stringify({ action: 'admin.stats', payload: {} }));
      t.eq(denied.success, false, 'RBAC dikuatkuasa melalui doPost');
    }],
    ['Fungsi operasi hanya untuk pemilik skrip', function (t) {
      globalThis.__setActiveUser('');
      try {
        t.throws(function () { setupDatabase(); });
        t.throws(function () { runBackup(); });
      } finally {
        globalThis.__setActiveUser('owner@example.com');
      }
    }, { nodeOnly: true }]
  ]
};
