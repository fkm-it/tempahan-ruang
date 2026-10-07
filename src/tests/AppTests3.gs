/**
 * @file AppTests3.gs
 * v1.4: makluman admin (app + telefon + emel), kawalan peralihan status, peringatan admin tempahan tertunggak,
 * PIC pembantu operasi (lulus + tugaskan, emel, wa.me, pautan pengesahan tanpa log masuk), log kerja.
 */
const AppFixtures3 = {
  pembantu: function (extra) {
    AppFixtures.seq++;
    const row = LegacyImport.base('PO', Object.assign({
      nama: 'Pembantu ' + AppFixtures.seq, no_telefon: '012-345 67' + String(10 + (AppFixtures.seq % 89)), emel: 'po' + AppFixtures.seq + '@test.local',
      jawatan: 'Pembantu Operasi', aktif: true, catatan: ''
    }, extra || {}));
    Repo.of('PEMBANTU').insert(row);
    return row;
  },
  mailsTo: function (to) { return globalThis.__mails.filter(function (m) { return m.to === to; }); },
  /** Tempahan MENUNGGU melalui borang awam. @return {Object} baris */
  pending: function (room, d, mula, tamat) {
    const staf = AppFixtures.staf();
    const r = TestAssert.apiOk(AppFixtures.pub({ noStaf: staf.no_staf, ruang: room.id, tarikh: d, masaMula: mula || '09:00', masaTamat: tamat || '10:00', tujuan: 'Seminar PIC' }));
    return AppFixtures.rowByRef(r.refNo);
  },
  withBase: function (fn) {
    Env.set('PUBLIC_BASE_URL', 'https://contoh.github.io/app/');
    try { return fn(); } finally { Env.set('PUBLIC_BASE_URL', ''); }
  },
  /** id & k daripada pautan PIC. */
  linkParts: function (url) {
    const m = /#\/tugas\?id=([^&]+)&k=([0-9a-f]+)/.exec(decodeURIComponent(url));
    return m ? { id: m[1], k: m[2] } : null;
  }
};

const TestSuiteAliranV14 = {
  name: 'Domain: Aliran v1.4 (makluman, status, PIC)',
  tests: [
    ['Permohonan baharu: admin dimaklumkan dalam app, telefon (melalui pekerja) & emel dengan butiran lengkap', function (t) {
      const adm = TestHelpers.admin();
      AppFixtures.emailOn(adm);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { ADMIN_EMAIL: 'unitit@test.local' } }));
      TestAssert.apiOk(TestHelpers.call(adm.token, 'push.register', { token: 'adminPhone_' + 'e'.repeat(40) }));
      const room = AppFixtures.room({ nama: 'Dewan Makluman' });
      const queued = [];
      PushService.testOutbox = { queue: function (kind, payload) { queued.push({ kind: kind, payload: payload }); } };
      let row;
      try {
        withEnv_({ PUSH_RELAY: '1' }, function () { row = AppFixtures3.pending(room, AppFixtures.day(4)); });
      } finally { PushService.testOutbox = null; }
      const n = NotificationRepository.byUser(adm.user.id).filter(function (x) { return x.reference_id === row.id; })[0];
      t.ok(n, 'notifikasi dalam app');
      t.ok(/Dewan Makluman/.test(n.message) && /09:00–10:00/.test(n.message) && /Staf/.test(n.message), 'mesej bermaklumat: ' + n.message);
      const mine = queued.filter(function (q) { return q.payload.tokens.some(function (x) { return x.token.indexOf('adminPhone_') === 0; }); })[0];
      t.ok(mine, 'push telefon dibaris gilir untuk admin');
      t.eq(mine.payload.msg.path, '#/admin/tempahan/' + row.id, 'tekan notifikasi → terus ke tempahan');
      const mail = AppFixtures3.mailsTo('unitit@test.local').filter(function (m) { return m.subject.indexOf(row.ref_no) >= 0; })[0];
      t.ok(mail && /Dewan Makluman/.test(mail.htmlBody) && /Pemohon:/.test(mail.htmlBody), 'emel ADMIN_EMAIL lengkap');
    }],

    ['Peralihan status: DIBATALKAN & SELESAI akhir; DITOLAK boleh dibuka semula jika slot kosong; pilihan sah dalam DTO', function (t) {
      const adm = TestHelpers.admin();
      const room = AppFixtures.room();
      const d = AppFixtures.day(5);
      const a = AppFixtures3.pending(room, d);
      const st = function (id, s) { return TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: id, status: s }); };
      const dto = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.get', { module: 'tempahan', id: a.id }));
      t.eq(dto.nextStatuses.join(','), 'DILULUSKAN,DITOLAK,DIBATALKAN');
      TestAssert.apiFail(st(a.id, 'SELESAI'), ERROR_CODES.CONFLICT);
      TestAssert.apiOk(st(a.id, 'DITOLAK'));
      t.eq(TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.get', { module: 'tempahan', id: a.id })).nextStatuses.join(','), 'MENUNGGU');
      TestAssert.apiFail(st(a.id, 'DILULUSKAN'), ERROR_CODES.CONFLICT);
      /* Slot diambil orang lain semasa ditolak → tidak boleh dibuka semula */
      const b = AppFixtures3.pending(room, d);
      const reopen = TestAssert.apiFail(st(a.id, 'MENUNGGU'), ERROR_CODES.CONFLICT);
      t.ok(reopen.message.indexOf(b.ref_no) >= 0, 'nyatakan tempahan yang memegang slot');
      TestAssert.apiOk(st(b.id, 'DIBATALKAN'));
      TestAssert.apiOk(st(a.id, 'MENUNGGU'));
      TestAssert.apiOk(st(a.id, 'DILULUSKAN'));
      TestAssert.apiFail(st(b.id, 'MENUNGGU'), ERROR_CODES.CONFLICT);
      t.eq(TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.get', { module: 'tempahan', id: b.id })).nextStatuses.length, 0, 'DIBATALKAN status akhir');
      /* Catatan sahaja (status sama) dibenarkan */
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: a.id, status: 'DILULUSKAN', note: 'Bawa kad akses.' }));
    }],

    ['Peringatan admin: permohonan lama / segera dihimpun sekali sehari; tetapan 0 = tutup', function (t) {
      const adm = TestHelpers.admin();
      AppFixtures.emailOn(adm);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { ADMIN_EMAIL: 'ringkasan@test.local' } }));
      const room = AppFixtures.room({ nama: 'Bilik Tertunggak' });
      const lama = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(10), tarikh_tamat: AppFixtures.day(10), created_at: new Date(Date.now() - 30 * 3600000).toISOString(), state: 'ACTIVE' });
      const segera = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(1), tarikh_tamat: AppFixtures.day(1), masa_mula: '11:00', masa_tamat: '12:00', created_at: new Date().toISOString(), state: 'ACTIVE' });
      const baru = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(9), tarikh_tamat: AppFixtures.day(9), masa_mula: '13:00', masa_tamat: '14:00', created_at: new Date().toISOString(), state: 'ACTIVE' });
      AppFixtures2.withSettings({ WAKTU_MULA: '00:00', WAKTU_TAMAT: '23:59', PERINGATAN_ADMIN_JAM: '0' }, function () {
        t.eq(TempahanHooks.adminReminders(), 0, 'ditutup');
      });
      AppFixtures2.withSettings({ WAKTU_MULA: '00:00', WAKTU_TAMAT: '23:59', PERINGATAN_ADMIN_JAM: '24' }, function () {
        const before = AppFixtures3.mailsTo('ringkasan@test.local').length;
        const n = TempahanHooks.adminReminders();
        t.ok(n >= 2, 'sekurang-kurangnya 2 dalam ringkasan: ' + n);
        t.eq(AppFixtures.rowByRef(lama.ref_no).peringatan_admin_dihantar, TempahanHooks.today());
        t.eq(AppFixtures.rowByRef(segera.ref_no).peringatan_admin_dihantar, TempahanHooks.today());
        t.eq(AppFixtures.rowByRef(baru.ref_no).peringatan_admin_dihantar, '', 'baru & tarikh jauh: belum perlu');
        const mail = AppFixtures3.mailsTo('ringkasan@test.local').slice(before).filter(function (m) { return m.htmlBody.indexOf(segera.ref_no) >= 0; })[0];
        t.ok(mail && /SEGERA/.test(mail.htmlBody) && mail.htmlBody.indexOf(lama.ref_no) >= 0, 'emel ringkasan');
        const notif = NotificationRepository.byUser(adm.user.id).filter(function (x) { return /menunggu kelulusan/.test(x.title); });
        t.ok(notif.length >= 1, 'notifikasi app/telefon');
        t.eq(TempahanHooks.adminReminders(), 0, 'sekali sehari sahaja');
      });
      AppFixtures2.withSettings({ WAKTU_MULA: '00:00', WAKTU_TAMAT: '00:01', PERINGATAN_ADMIN_JAM: '24' }, function () {
        Repo.of('TEMPAHAN').update(baru.id, { created_at: new Date(Date.now() - 48 * 3600000).toISOString() });
        if (TempahanHooks.nowHM() >= '00:01') t.eq(TempahanHooks.adminReminders(), 0, 'di luar waktu operasi: tidak dihantar');
      });
    }],

    ['Pembantu operasi: nombor WhatsApp disahkan; hanya yang aktif boleh dipilih', function (t) {
      const adm = TestHelpers.admin();
      const bad = TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.create', { module: 'pembantu', nama: 'Abu', noTelefon: '123' }), ERROR_CODES.VALIDATION_ERROR);
      t.ok(bad.meta && bad.meta.fields && bad.meta.fields.noTelefon, 'nombor tidak sah ditolak');
      const p = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.create', { module: 'pembantu', nama: 'Abu Bakar', noTelefon: '013-222 3344', emel: 'abu@test.local' }));
      t.eq(p.values.jawatan, 'Pembantu Operasi');
      const off = AppFixtures3.pembantu({ aktif: false });
      const opts = CrudEngine.refOptions({ ref: 'pembantu' }).map(function (o) { return o.value; });
      t.ok(opts.indexOf(p.id) >= 0 && opts.indexOf(off.id) < 0, 'tidak aktif tidak disenaraikan');
      const room = AppFixtures.room();
      TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.update', { module: 'ruang', id: room.id, pembantu: off.id }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.update', { module: 'ruang', id: room.id, pembantu: p.id }));
    }],

    ['Lulus + tugaskan PIC: cadangan ikut ruang, tugasan direkod, emel PIC, butang wa.me dengan pautan pengesahan', function (t) {
      AppFixtures3.withBase(function () {
        const adm = TestHelpers.admin();
        AppFixtures.emailOn(adm);
        const pic = AppFixtures3.pembantu({ nama: 'Kamal', no_telefon: '019-876 5432' });
        const room = AppFixtures.room({ nama: 'DK Lulus', pembantu: pic.id });
        const row = AppFixtures3.pending(room, AppFixtures.day(6), '14:00', '16:00');
        const info = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.tugasan', { id: row.id }));
        t.eq(info.cadangan, pic.id, 'PIC lalai daripada ruang');
        t.eq(info.bolehTugas, false, 'belum diluluskan');
        TestAssert.apiFail(TestHelpers.call(adm.token, 'tempahan.tugaskan', { id: row.id, pembantu: pic.id }), ERROR_CODES.CONFLICT);
        TestAssert.apiFail(TestHelpers.call(adm.token, 'tempahan.lulus', { id: row.id, pembantu: 'PO-0000000000000000' }), ERROR_CODES.VALIDATION_ERROR);
        t.eq(AppFixtures.rowByRef(row.ref_no).status, 'MENUNGGU', 'PIC tidak sah → tidak diluluskan');
        const before = AppFixtures3.mailsTo(pic.emel).length;
        const r = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.lulus', { id: row.id, note: 'OK', pembantu: pic.id, arahan: 'Hidupkan projektor.' }));
        t.eq(r.status, 'DILULUSKAN');
        t.eq(AppFixtures.rowByRef(row.ref_no).status, 'DILULUSKAN');
        const tg = r.tugasan;
        t.ok(tg && tg.status === 'DITUGASKAN' && /^TG-\d{4}-\d{4}$/.test(tg.refNo), 'tugasan dicipta');
        t.eq(tg.values.tarikh, row.tarikh);
        t.eq(tg.values.masa, '14:00');
        t.eq(tg.values.kod, undefined, 'kod pautan tidak didedahkan');
        t.ok(/^https:\/\/wa\.me\/60198765432\?text=/.test(tg.waUrl), 'wa.me: ' + tg.waUrl.slice(0, 40));
        const text = decodeURIComponent(tg.waUrl.split('?text=')[1]);
        t.ok(/Kamal/.test(text) && /DK Lulus/.test(text) && text.indexOf(row.ref_no) >= 0 && /Hidupkan projektor/.test(text), 'mesej WhatsApp lengkap');
        t.ok(AppFixtures3.linkParts(tg.waUrl), 'pautan pengesahan dalam mesej');
        const mails = AppFixtures3.mailsTo(pic.emel).slice(before);
        t.eq(mails.length, 1, 'emel PIC');
        t.ok(/Tugasan baharu/.test(mails[0].subject) && /https:\/\/contoh\.github\.io\/app\/#\/tugas\?id=/.test(mails[0].htmlBody), 'emel dengan butang pengesahan');
        const tgRow = Repo.of('TUGASAN').findById(tg.id);
        t.ok(tgRow.emel_dihantar, 'masa emel direkod');
        t.eq(tgRow.ditugaskan_oleh, adm.user.fullName || tgRow.ditugaskan_oleh, 'ditugaskan oleh admin');
        const list = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.tugasan', { id: row.id }));
        t.eq(list.items.length, 1);
        t.eq(list.bolehTugas, true);
        /* Log kerja: senarai generik modul tugasan, tapis ikut PIC */
        const log = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.list', { module: 'tugasan', filters: { pembantu: pic.id } }));
        t.ok(log.items.some(function (x) { return x.id === tg.id; }), 'dalam log kerja');
        /* Lulus semula dengan PIC sama → tiada tugasan pendua */
        TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.lulus', { id: row.id, pembantu: pic.id }));
        t.eq(TugasanHooks.forTempahan(adm.ctx, row.id).length, 1, 'tiada pendua');
        /* Pengguna biasa tidak boleh */
        const u = TestHelpers.user('biasa');
        TestAssert.apiFail(TestHelpers.call(u.token, 'tempahan.tugaskan', { id: row.id, pembantu: pic.id }), ERROR_CODES.FORBIDDEN);
        t.eq(TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tugasan' })).items.length, 0, 'pengguna biasa tidak nampak log kerja');
        TestAssert.apiFail(TestHelpers.call(u.token, 'crud.get', { module: 'tugasan', id: tg.id }), ERROR_CODES.NOT_FOUND);
      });
    }],

    ['Pautan PIC: kunci salah ditolak; "Sudah selesai" → SELESAI + admin dimaklumkan; idempoten', function (t) {
      AppFixtures3.withBase(function () {
        const adm = TestHelpers.admin();
        const pic = AppFixtures3.pembantu({ nama: 'Rahim' });
        const room = AppFixtures.room({ nama: 'Makmal Pautan' });
        const row = AppFixtures3.pending(room, AppFixtures.day(7));
        const tg = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.lulus', { id: row.id, pembantu: pic.id })).tugasan;
        const lk = AppFixtures3.linkParts(tg.pautan);
        TestAssert.apiFail(api({ action: 'tugasan.lihat', payload: { id: lk.id, k: 'f'.repeat(32) } }), ERROR_CODES.NOT_FOUND);
        TestAssert.apiFail(api({ action: 'tugasan.lihat', payload: { id: lk.id } }), ERROR_CODES.VALIDATION_ERROR);
        const v = TestAssert.apiOk(api({ action: 'tugasan.lihat', payload: lk }));
        t.eq(v.pic, 'Rahim');
        t.eq(v.ruang, 'Makmal Pautan');
        t.eq(v.status, 'DITUGASKAN');
        t.eq(v.tempahan.refNo, row.ref_no);
        const done = TestAssert.apiOk(api({ action: 'tugasan.selesai', payload: Object.assign({ catatan: 'Pintu dibuka 8:40. <b>ok</b>' }, lk) }));
        t.eq(done.status, 'SELESAI');
        const saved = Repo.of('TUGASAN').findById(lk.id);
        t.ok(saved.disahkan_pada && /Rahim/.test(saved.disahkan_oleh), 'pengesahan direkod');
        t.eq(saved.catatan_pic, 'Pintu dibuka 8:40. ok', 'catatan dibersihkan');
        t.ok(NotificationRepository.byUser(adm.user.id).some(function (x) { return x.reference_id === lk.id && /Tugasan selesai/.test(x.title); }), 'admin dimaklumkan');
        t.eq(TestAssert.apiOk(api({ action: 'tugasan.selesai', payload: lk })).status, 'SELESAI', 'idempoten');
        /* Pautan luput selepas tempoh */
        Repo.of('TUGASAN').update(lk.id, { tarikh: AppFixtures.day(-20), tarikh_tamat: AppFixtures.day(-20) });
        TestAssert.apiFail(api({ action: 'tugasan.lihat', payload: lk }), ERROR_CODES.NOT_FOUND);
      });
    }],

    ['Tukar PIC, sunting & batal tempahan: tugasan dibatalkan/dikemas kini dan PIC diemel; pautan lama tidak sah', function (t) {
      AppFixtures3.withBase(function () {
        const adm = TestHelpers.admin();
        AppFixtures.emailOn(adm);
        const p1 = AppFixtures3.pembantu();
        const p2 = AppFixtures3.pembantu();
        const room = AppFixtures.room();
        const row = AppFixtures3.pending(room, AppFixtures.day(8));
        const t1 = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.lulus', { id: row.id, pembantu: p1.id })).tugasan;
        const b1 = AppFixtures3.mailsTo(p1.emel).length;
        const t2 = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.tugaskan', { id: row.id, pembantu: p2.id, hantarEmel: false }));
        t.eq(Repo.of('TUGASAN').findById(t1.id).status, 'DIBATALKAN', 'PIC lama dibatalkan');
        t.ok(/DIBATALKAN/.test(AppFixtures3.mailsTo(p1.emel).slice(b1)[0].subject), 'PIC lama diemel');
        t.eq(AppFixtures3.mailsTo(p2.emel).length, 0, 'hantarEmel: false');
        /* Sunting tarikh tempahan → tugasan dikemas kini, pautan lama tidak sah */
        const oldLink = AppFixtures3.linkParts(t2.pautan);
        const nd = AppFixtures.day(9);
        TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.update', { module: 'tempahan', id: row.id, tarikh: nd, tarikhTamat: '' }));
        const t2r = Repo.of('TUGASAN').findById(t2.id);
        t.eq(t2r.tarikh, nd, 'tarikh tugasan disegerakkan');
        t.ok(/DIKEMAS KINI/.test(AppFixtures3.mailsTo(p2.emel).slice(-1)[0].subject), 'PIC diemel kemas kini');
        TestAssert.apiFail(api({ action: 'tugasan.lihat', payload: oldLink }), ERROR_CODES.NOT_FOUND);
        /* Pemohon membatalkan → tugasan dibatalkan */
        const b2 = AppFixtures3.mailsTo(p2.emel).length;
        const staf = Repo.of('TEMPAHAN').findById(row.id);
        TestAssert.apiOk(api({ action: 'tempahan.batal', payload: { refNo: staf.ref_no, noStaf: staf.no_staf, emel: staf.emel } }));
        t.eq(Repo.of('TUGASAN').findById(t2.id).status, 'DIBATALKAN', 'tugasan dibatalkan bersama tempahan');
        t.ok(/DIBATALKAN/.test(AppFixtures3.mailsTo(p2.emel).slice(b2)[0].subject), 'PIC dimaklumkan pembatalan');
        TestAssert.apiFail(api({ action: 'tugasan.selesai', payload: AppFixtures3.linkParts(TugasanHooks.pautan(Repo.of('TUGASAN').findById(t2.id))) }), ERROR_CODES.CONFLICT);
        /* Admin membatalkan tempahan diluluskan → tugasan dibatalkan */
        const row2 = AppFixtures3.pending(room, AppFixtures.day(11));
        const t3 = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.lulus', { id: row2.id, pembantu: p1.id })).tugasan;
        TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: row2.id, status: 'DIBATALKAN', note: 'Program ditangguh' }));
        t.eq(Repo.of('TUGASAN').findById(t3.id).status, 'DIBATALKAN');
        /* Tempah bagi pihak dengan PIC */
        const staf2 = AppFixtures.staf();
        const bp = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.bagiPihak', { noStaf: staf2.no_staf, noTelefon: '0123456789', ruang: room.id, tarikh: AppFixtures.day(12), masaMula: '09:00', masaTamat: '10:00', tujuan: 'Bagi pihak', pembantu: p2.id, hantarEmel: false }));
        t.ok(bp.tugasan && /^https:\/\/wa\.me\//.test(bp.tugasan.waUrl), 'bagi pihak + PIC');
      });
    }],

    ['Peringatan pagi PIC: tugasan hari ini, sekali sahaja', function (t) {
      const adm = TestHelpers.admin();
      AppFixtures.emailOn(adm);
      const pic = AppFixtures3.pembantu();
      const tg = LegacyImport.base('TG', {
        ref_no: 'TG-UJI-' + (++AppFixtures.seq), tajuk: 'Buka ruang', jenis: 'BUKA', pembantu: pic.id, ruang: '', tarikh: TempahanHooks.today(), tarikh_tamat: TempahanHooks.today(),
        masa: '', arahan: '', tempahan: '', kod: 'abc', peringatan_dihantar: '', status: 'DITUGASKAN'
      });
      Repo.of('TUGASAN').insert(tg);
      const hourNow = Number(TempahanHooks.nowHM().slice(0, 2));
      if (hourNow < 1) return;
      AppFixtures2.withSettings({ PERINGATAN_PAGI: '1' }, function () {
        const before = AppFixtures3.mailsTo(pic.emel).length;
        t.ok(TugasanHooks.hourly().peringatanPic >= 1);
        t.eq(AppFixtures3.mailsTo(pic.emel).length, before + 1);
        t.ok(/Peringatan tugasan/.test(AppFixtures3.mailsTo(pic.emel).slice(-1)[0].subject));
        TugasanHooks.hourly();
        t.eq(AppFixtures3.mailsTo(pic.emel).length, before + 1, 'sekali sehari');
      });
    }]
  ]
};
