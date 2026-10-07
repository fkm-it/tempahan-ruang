/**
 * @file TestWorker.gs
 * Mod Supabase (WorkerService): proksi klien lama, mod pemindahan, kitaran pekerja (email + ack), pemindahan data.
 * Semua ujian nodeOnly — mengubah Script Properties & memerlukan UrlFetchApp tiruan.
 */
/** Jalankan fn dengan tindihan Env tambahan, kemudian pulihkan tindihan asal. */
function withEnv_(extra, fn) {
  const prev = Env.currentOverrides();
  Env.useOverrides(Object.assign({}, prev || {}, extra));
  try { return fn(); } finally { Env.useOverrides(prev); }
}

const TestSuiteWorker = {
  name: 'Pekerja Supabase',
  tests: [
    ['Mod biasa: API dilayan sendiri; mod pemindahan: ditolak sementara', function (t) {
      t.eq(WorkerService.state(), '');
      TestAssert.apiOk(api({ action: 'public.config' }));
      withEnv_({ SUPABASE_ACTIVE: 'migrating' }, function () {
        const r = api({ action: 'public.config' });
        t.eq(r.success, false);
        t.eq(r.code, ERROR_CODES.MAINTENANCE);
      });
    }, { nodeOnly: true }],
    ['Supabase aktif: klien lama diproksi; permintaan daripada pelayan Supabase tidak diproksi semula; penyelenggaraan GAS dilangkau', function (t) {
      const st = globalThis.__mockState;
      const seen = [];
      st.fetchHandler = function (url, params) { seen.push({ url: url, body: JSON.parse(params.payload) }); return { code: 200, body: { success: true, data: { dariSupabase: true }, code: 'OK', meta: {} } }; };
      try {
        withEnv_({ SUPABASE_ACTIVE: '1', SUPABASE_API_URL: 'https://abc.supabase.co/functions/v1/api' }, function () {
        const r = api({ action: 'public.config', meta: { rid: 'x' } });
        t.ok(r.success && r.data.dariSupabase, 'diproksi');
        t.eq(seen[0].url, 'https://abc.supabase.co/functions/v1/api');
        t.eq(seen[0].body.action, 'public.config');
        const own = api({ action: 'public.config', meta: { via: 'edge' } });
        t.eq(own.code, ERROR_CODES.MAINTENANCE, 'via edge selepas pemindahan → ditolak (Google Sheets tidak lagi dilayan)');
        t.ok(dailyMaintenance({ triggerUid: 't' }).skipped, 'harian dilangkau');
        t.ok(hourlyMaintenance({ triggerUid: 't' }).skipped, 'setiap jam dilangkau');
        });
      } finally { st.fetchHandler = null; }
    }, { nodeOnly: true }],
    ['Kitaran pekerja: email dihantar dengan MailApp & keputusan dihantar balik (ack); tandatangan HMAC', function (t) {
      const st = globalThis.__mockState;
      const calls = [];
      st.fetchHandler = function (url, params) {
        const b = JSON.parse(params.payload);
        calls.push(b);
        if (b.action === 'system.tick') return { code: 200, body: { success: true, data: { maintenance: {}, mails: [
          { id: '1', kind: 'mail', payload: { to: 'a@test.local', subject: 'S1', htmlBody: '<p>x</p>' } },
          { id: '2', kind: 'mail', payload: {} }
        ] } } };
        return { code: 200, body: { success: true, data: {} } };
      };
      const before = st.mails.length;
      try {
        withEnv_({ SUPABASE_ACTIVE: '1', SUPABASE_API_URL: 'https://abc.supabase.co/functions/v1/api', AUTH_PEPPER: 'pepper-ujian' }, function () {
        const out = WorkerService.tick();
        t.eq(out.sent + out.failed, 2);
        t.ok(st.mails.length > before, 'MailApp dipanggil');
        const ack = calls.filter(function (c) { return c.action === 'system.ack'; })[0];
        t.ok(ack && ack.payload.results.length === 2 && ack.payload.results[0].ok === true, 'ack');
        const c0 = calls[0];
        t.eq(c0.worker, SecurityUtils.bytesToHex(Utilities.computeHmacSha256Signature(
          'druang-worker-v2|' + c0.ts + '|system.tick|' + SecurityUtils.sha256Hex(JSON.stringify(c0.payload)), 'pepper-ujian')), 'tandatangan terikat pada ts, tindakan & kandungan');
        t.ok(Math.abs(Date.now() - c0.ts) < 60000, 'ts semasa');
        });
      } finally { st.fetchHandler = null; }
    }, { nodeOnly: true }],
    ['Push melalui Supabase: pelayan membaris gilir; pekerja hantar FCM, laporkan status & token mati', function (t) {
      const st = globalThis.__mockState;
      const u = TestHelpers.user('relay');
      TestAssert.apiOk(TestHelpers.call(u.token, 'push.register', { token: 'liveTok_' + 'c'.repeat(40) }));
      TestAssert.apiOk(TestHelpers.call(u.token, 'push.register', { token: 'deadTok_' + 'd'.repeat(40) }));
      /* 1) Sisi pelayan Supabase: tiada akaun servis; PUSH_RELAY menentukan status; mesej dibaris gilir */
      const queued = [];
      PushService.testOutbox = { queue: function (kind, payload) { queued.push({ kind: kind, payload: payload }); } };
      try {
        withEnv_({ FCM_SERVICE_ACCOUNT: '', PUSH_RELAY: '' }, function () {
          t.eq(PushService.enabled(), false, 'tiada pekerja FCM → tidak aktif');
          t.eq(PushService.sendToUser(u.user.id, { title: 'A', body: 'B' }), 0);
        });
        withEnv_({ FCM_SERVICE_ACCOUNT: '', PUSH_RELAY: '1' }, function () {
          t.eq(PushService.enabled(), true, 'pekerja melaporkan FCM → aktif');
          t.eq(TestAssert.apiOk(api({ action: 'public.config' })).PUSH_ENABLED, true, 'butang notifikasi telefon dipaparkan');
          const before = st.fetches.length;
          t.eq(PushService.sendToUser(u.user.id, { title: 'Tempahan baharu', body: 'X', path: '#/admin/tempahan/1' }), 2, 'dibaris gilir untuk 2 peranti');
          t.eq(st.fetches.length, before, 'tiada panggilan rangkaian di pelayan');
        });
      } finally { PushService.testOutbox = null; }
      t.eq(queued.length, 1);
      t.eq(queued[0].kind, 'push');
      t.eq(queued[0].payload.tokens.length, 2);
      t.eq(queued[0].payload.msg.title, 'Tempahan baharu');
      const deadId = queued[0].payload.tokens.filter(function (x) { return x.token.indexOf('deadTok') === 0; })[0].id;

      /* 2) Sisi pekerja Apps Script: tuntut item push → FCM; ack membawa token mati; status FCM dilaporkan */
      const calls = [];
      st.fetchHandler = function (url, params) {
        if (/oauth2/.test(url)) return { code: 200, body: { access_token: 'ya29.relay', expires_in: 3599 } };
        if (/fcm\.googleapis/.test(url)) {
          return JSON.parse(params.payload).message.token.indexOf('deadTok') === 0 ? { code: 404, body: { error: { details: [{ errorCode: 'UNREGISTERED' }] } } } : { code: 200, body: { name: 'm/1' } };
        }
        const b = JSON.parse(params.payload);
        calls.push(b);
        if (b.action === 'system.tick') return { code: 200, body: { success: true, data: { maintenance: {}, mails: [{ id: '9', kind: 'push', payload: queued[0].payload }] } } };
        return { code: 200, body: { success: true, data: {} } };
      };
      CacheService.getScriptCache().remove(PushService.TOKEN_CACHE_KEY);
      try {
        withEnv_({ SUPABASE_ACTIVE: '1', SUPABASE_API_URL: 'https://abc.supabase.co/functions/v1/api', AUTH_PEPPER: 'pepper-ujian', FCM_SERVICE_ACCOUNT: globalThis.__testServiceAccount }, function () {
          const out = WorkerService.tick();
          t.eq(out.pushed, 1, 'satu peranti berjaya');
        });
      } finally { st.fetchHandler = null; }
      t.eq(calls[0].payload.pushRelay, true, 'pekerja melaporkan FCM dikonfigurasi');
      const ack = calls.filter(function (c) { return c.action === 'system.ack'; })[0];
      t.ok(ack.payload.results[0].ok, 'ack ok');
      t.eq(ack.payload.results[0].revoke.join(','), deadId, 'token mati dilaporkan untuk dibatalkan');
      /* 3) Pelayan: batalkan token mati & simpan status relay */
      t.eq(PushService.revokeTokens([deadId, 'bukan-id']), 1);
      t.eq(PushTokenRepository.activeByUser(u.user.id).length, 1);
      const props = PropertiesService.getScriptProperties();
      try {
        t.eq(PushService.setRelay(true), true);
        t.eq(props.getProperty('PUSH_RELAY'), '1');
        t.eq(PushService.setRelay(true), false, 'tiada perubahan');
        t.eq(PushService.setRelay(false), true);
        t.eq(PushService.enabled(), false);
      } finally { props.deleteProperty('PUSH_RELAY'); Env.reset(); }
    }, { nodeOnly: true }],
    ['Web Push VAPID di pelayan Supabase: langganan disahkan; wp1_ → outbox webpush, token FCM → pekerja (jika relay)', function (t) {
      const sub = function (endpoint) {
        return 'wp1_' + Utilities.base64EncodeWebSafe(JSON.stringify({ endpoint: endpoint, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'a'.repeat(22) } })).replace(/=+$/, '');
      };
      t.ok(PushService.parseWebPush(sub('https://fcm.googleapis.com/fcm/send/abc')), 'Chrome/Android');
      t.ok(PushService.parseWebPush(sub('https://web.push.apple.com/QAbc')), 'Safari/iPhone');
      t.eq(PushService.parseWebPush(sub('https://evil.example.com/x')), null, 'hos luar ditolak');
      t.eq(PushService.parseWebPush(sub('https://fcm.googleapis.com.evil.com/x')), null, 'hos menyamar ditolak');
      t.eq(PushService.parseWebPush('wp1_rosak'), null);
      const u = TestHelpers.user('vapid');
      TestAssert.apiFail(TestHelpers.call(u.token, 'push.register', { token: sub('https://evil.example.com/x') }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiOk(TestHelpers.call(u.token, 'push.register', { token: sub('https://fcm.googleapis.com/fcm/send/' + 'q'.repeat(20)), platform: 'ANDROID' }));
      TestAssert.apiOk(TestHelpers.call(u.token, 'push.register', { token: 'oldFcmTok_' + 'f'.repeat(40) }));
      const queued = [];
      PushService.testOutbox = { queue: function (kind, payload) { queued.push({ kind: kind, payload: payload }); } };
      PushService.testVapid = 'BTestVapidPublicKey';
      try {
        withEnv_({ PUSH_RELAY: '', PUBLIC_BASE_URL: 'https://contoh.github.io/app/' }, function () {
          t.eq(PushService.enabled(), true, 'VAPID sahaja sudah mencukupi (tanpa Firebase)');
          const cfg = TestAssert.apiOk(api({ action: 'public.config' }));
          t.eq(cfg.VAPID_PUBLIC_KEY, 'BTestVapidPublicKey');
          t.eq(PushService.sendToUser(u.user.id, { title: 'Tempahan baharu', body: 'X', path: '#/admin/tempahan/1', type: 'RECORD_CREATED', ref: 'TP-1', badge: 3 }), 1, 'FCM tidak dihantar tanpa relay');
        });
        withEnv_({ PUSH_RELAY: '1' }, function () { t.eq(PushService.sendToUser(u.user.id, { title: 'T', body: 'B' }), 2, 'dengan relay: webpush + FCM'); });
      } finally { PushService.testOutbox = null; PushService.testVapid = null; }
      const w = queued.filter(function (q) { return q.kind === 'webpush'; });
      t.eq(w.length, 2);
      t.eq(w[0].payload.msg.wp, 1);
      t.eq(w[0].payload.msg.url, 'https://contoh.github.io/app/#/admin/tempahan/1', 'pautan penuh');
      t.eq(w[0].payload.msg.tag, 'RECORD_CREATED:TP-1', 'tag unik setiap rekod');
      t.eq(w[0].payload.msg.badge, '3');
      t.ok(/^K-/.test(w[0].payload.id) && w[0].payload.token.indexOf('wp1_') === 0);
      t.eq(queued.filter(function (q) { return q.kind === 'push'; }).length, 1, 'FCM lama → pekerja');
    }, { nodeOnly: true }],
    ['Pemindahan: semua sheet + Script Properties dihantar; gagal → kembali ke mod biasa', function (t) {
      const st = globalThis.__mockState;
      let sent = null;
      let okReply = false;
      st.fetchHandler = function (url, params) {
        const b = JSON.parse(params.payload);
        if (b.action === 'system.import') {
          sent = b.payload;
          t.ok(WorkerService.verifyImport(b.payload.nonce).ok, 'nonce disahkan semasa import');
          t.ok(!WorkerService.verifyImport('x'.repeat(43)).ok, 'nonce lain ditolak');
          return { code: 200, body: okReply ? { success: true, data: { sheets: 3, rows: 9, props: 2 } } : { success: false, code: 'FORBIDDEN', message: 'Import ditutup.' } }; }
        if (b.action === 'system.status') return { code: 200, body: okReply ? { success: true, data: {} } : { success: false, code: 'FORBIDDEN', message: 'Tandatangan pekerja tidak sah.' } };
        return { code: 200, body: { success: true, data: { maintenance: {}, mails: [] } } };
      };
      const props = PropertiesService.getScriptProperties();
      Env.set('SUPABASE_API_URL', 'https://abc.supabase.co/functions/v1/api');
      try {
        let threw = false;
        try { WorkerService.migrate(); } catch (e) { threw = true; }
        t.ok(threw, 'import ditolak → ralat');
        t.eq(WorkerService.state(), '', 'kembali ke mod biasa');
        t.ok(sent && sent.sheets.some(function (s) { return s.name === 'USERS' && s.header[0] === 'user_id'; }), 'sheet USERS dihantar');
        t.ok(sent.props.AUTH_PEPPER, 'AUTH_PEPPER dihantar');
        t.ok(!WorkerService.verifyImport(sent.nonce).ok, 'nonce tidak sah selepas mod biasa dipulihkan');
        okReply = true;
        const r = WorkerService.migrate();
        t.eq(r.rows, 9);
        t.eq(WorkerService.state(), '1');
        t.ok(!PropertiesService.getScriptProperties().getProperty('SUPABASE_IMPORT_NONCE'), 'nonce dibuang');
        let blocked = null;
        try { Database.withLock(function () { return 1; }); } catch (e) { blocked = e; }
        t.ok(blocked && blocked.code === ERROR_CODES.MAINTENANCE, 'tulisan ke Google Sheets ditolak selepas pemindahan');
        t.ok(ScriptApp.getProjectTriggers().some(function (x) { return x.getHandlerFunction() === 'workerTick'; }), 'pencetus workerTick');
      } finally {
        props.deleteProperty('SUPABASE_ACTIVE');
        props.deleteProperty('SUPABASE_API_URL');
        Env.reset();
        st.fetchHandler = null;
      }
    }, { nodeOnly: true }],
    ['Pemindahan: jawapan import hilang tetapi import berjaya → pulih (tidak kembali ke Google Sheets)', function (t) {
      const st = globalThis.__mockState;
      st.fetchHandler = function (url, params) {
        const b = JSON.parse(params.payload);
        if (b.action === 'system.import') return { code: 502, body: '<html>Bad gateway</html>' };
        if (b.action === 'system.status') return { code: 200, body: { success: true, data: { pending: 0 } } };
        return { code: 200, body: { success: true, data: { maintenance: {}, mails: [] } } };
      };
      Env.set('SUPABASE_API_URL', 'https://abc.supabase.co/functions/v1/api');
      const props = PropertiesService.getScriptProperties();
      try {
        const r = WorkerService.migrate();
        t.ok(r.recovered, 'dipulihkan');
        t.eq(WorkerService.state(), '1');
      } finally {
        props.deleteProperty('SUPABASE_ACTIVE');
        props.deleteProperty('SUPABASE_API_URL');
        props.deleteProperty('SUPABASE_IMPORT_NONCE');
        Env.reset();
        st.fetchHandler = null;
      }
    }, { nodeOnly: true }]
  ]
};

