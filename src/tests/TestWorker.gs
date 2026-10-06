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

