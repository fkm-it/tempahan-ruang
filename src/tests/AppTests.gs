/**
 * @file AppTests.gs
 * Ujian domain Sistem Tempahan Ruang (modul sebenar dalam modules/*.json).
 * Dalam Apps Script: runTestsPart5. Dalam Node: npm test.
 */
const AppTests = {
  suites: function () { return [TestSuiteTempahan]; }
};

const AppFixtures = {
  seq: 0,
  day: function (n) { return TempahanHooks.addDaysKey(TempahanHooks.today(), n); },

  room: function (extra) {
    AppFixtures.seq++;
    const row = LegacyImport.base('RU', Object.assign({
      nama: 'Bilik Ujian ' + AppFixtures.seq, blok: 'E07', jenis: 'Bilik Kuliah', aras: '1', kod_ruang: 'E07-' + AppFixtures.seq,
      kapasiti: 40, pic: 'Encik PIC', emel_pic: 'pic' + AppFixtures.seq + '@test.local', aktif: true, catatan: ''
    }, extra || {}));
    Repo.of('RUANG').insert(row);
    return row;
  },

  /** Staf baharu dengan No. Staf unik. */
  staf: function (extra) {
    AppFixtures.seq++;
    const no = String(70000 + AppFixtures.seq);
    const row = LegacyImport.base('SF', Object.assign({ no_staf: no, nama: 'Staf Ujian ' + no, emel: 'staf' + no + '@test.local', aktif: true }, extra || {}));
    Repo.of('STAF').insert(row);
    return row;
  },

  /** Tempahan terus ke repository (data sedia ada / import). */
  booking: function (extra) {
    const row = LegacyImport.base('TP', Object.assign({
      ref_no: 'TP-UJI-' + (++AppFixtures.seq), owner_name: 'X', no_staf: '1', nama: 'X', emel: 'x@test.local', no_telefon: '0123456789',
      ruang: '', tarikh: AppFixtures.day(3), tarikh_tamat: AppFixtures.day(3), masa_mula: '09:00', masa_tamat: '10:00',
      bilangan_peserta: 0, tujuan: 'Sedia ada', peringatan_dihantar: '', status: 'MENUNGGU'
    }, extra || {}));
    Repo.of('TEMPAHAN').insert(row);
    return row;
  },

  pub: function (payload) {
    return api({ action: 'crud.publicCreate', payload: Object.assign({
      module: 'tempahan', formToken: SecurityUtils.signFormToken('crud:tempahan', Date.now() - 5000), noTelefon: '012-3456789', tujuan: 'Kuliah ujian'
    }, payload) });
  },

  rowByRef: function (ref) { return Repo.of('TEMPAHAN').findOne(function (r) { return r.ref_no === ref; }); },

  emailOn: function (adm) { TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { NOTIFY_EMAIL_ENABLED: true } })); }
};

const TestSuiteTempahan = {
  name: 'Domain: Tempahan Ruang',
  tests: [
    ['Staf: No. Staf dinormalkan & unik', function (t) {
      const adm = TestHelpers.admin();
      const no = String(91000 + Math.floor(Math.random() * 900));
      const s = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.create', { module: 'staf', noStaf: ' ' + no + '.0', nama: 'Ali Abu', emel: 'ALI' + no + '@utm.my' }));
      t.eq(s.values.noStaf, no);
      t.eq(s.values.emel, 'ali' + no + '@utm.my');
      TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.create', { module: 'staf', noStaf: no, nama: 'Pendua', emel: 'dua@utm.my' }), ERROR_CODES.CONFLICT);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.update', { module: 'staf', id: s.id, nama: 'Ali Abu Bakar', noStaf: no }));
    }],

    ['Borang awam: nama & emel diambil daripada senarai staf, bukan input', function (t) {
      const room = AppFixtures.room();
      const staf = AppFixtures.staf();
      const r = TestAssert.apiOk(AppFixtures.pub({ noStaf: ' ' + staf.no_staf + '.0 ', nama: 'Palsu', emel: 'palsu@luar.com', ruang: room.id, tarikh: AppFixtures.day(2), masaMula: '09:00', masaTamat: '11:00', bilanganPeserta: 20 }));
      t.ok(/^TP-\d{4}-\d{4}$/.test(r.refNo), 'format no. rujukan');
      const row = AppFixtures.rowByRef(r.refNo);
      t.eq(row.nama, staf.nama);
      t.eq(row.emel, staf.emel);
      t.eq(row.no_staf, staf.no_staf);
      t.eq(row.owner_name, staf.nama);
      t.eq(row.tarikh_tamat, row.tarikh, 'sehari → tarikh tamat = tarikh');
      t.eq(row.status, 'MENUNGGU');
      const tidak = AppFixtures.staf({ aktif: false });
      const e1 = TestAssert.apiFail(AppFixtures.pub({ noStaf: '00000', ruang: room.id, tarikh: AppFixtures.day(3), masaMula: '09:00', masaTamat: '10:00' }), ERROR_CODES.VALIDATION_ERROR);
      t.ok(/No\. Staf/.test(e1.message));
      TestAssert.apiFail(AppFixtures.pub({ noStaf: tidak.no_staf, ruang: room.id, tarikh: AppFixtures.day(3), masaMula: '09:00', masaTamat: '10:00' }), ERROR_CODES.VALIDATION_ERROR);
    }],

    ['Peraturan masa, tarikh, tempoh & kapasiti', function (t) {
      const room = AppFixtures.room({ kapasiti: 30 });
      const tutup = AppFixtures.room({ aktif: false });
      const staf = AppFixtures.staf();
      const base = { noStaf: staf.no_staf, ruang: room.id, tarikh: AppFixtures.day(4), masaMula: '09:00', masaTamat: '10:00' };
      const fail = function (extra, field) {
        const res = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, base, extra)), ERROR_CODES.VALIDATION_ERROR);
        if (field) t.ok(res.data === null && JSON.stringify(res).indexOf(field) >= 0, 'medan ralat ' + field + ': ' + JSON.stringify(res));
      };
      fail({ tarikh: AppFixtures.day(-1) }, 'tarikh');
      fail({ masaMula: '11:00', masaTamat: '10:00' }, 'masaTamat');
      fail({ masaMula: '06:30' }, 'masaMula');
      fail({ masaTamat: '23:30' }, 'masaTamat');
      fail({ tarikhTamat: AppFixtures.day(3) }, 'tarikhTamat');
      fail({ tarikhTamat: AppFixtures.day(4 + 14) }, 'tarikhTamat');
      fail({ bilanganPeserta: 31 }, 'bilanganPeserta');
      fail({ ruang: tutup.id }, 'ruang');
      const ok = TestAssert.apiOk(AppFixtures.pub(Object.assign({}, base, { tarikhTamat: AppFixtures.day(4 + 13), bilanganPeserta: 30 })));
      t.eq(AppFixtures.rowByRef(ok.refNo).tarikh_tamat, AppFixtures.day(17), '14 hari dibenarkan');
    }],

    ['Pertindihan masa ditolak; hujung bersentuh dibenarkan', function (t) {
      const room = AppFixtures.room();
      const lain = AppFixtures.room();
      const s1 = AppFixtures.staf();
      const s2 = AppFixtures.staf();
      const a = TestAssert.apiOk(AppFixtures.pub({ noStaf: s1.no_staf, ruang: room.id, tarikh: AppFixtures.day(5), tarikhTamat: AppFixtures.day(7), masaMula: '09:00', masaTamat: '11:00' }));
      const c = TestAssert.apiFail(AppFixtures.pub({ noStaf: s2.no_staf, ruang: room.id, tarikh: AppFixtures.day(6), masaMula: '10:00', masaTamat: '12:00' }), ERROR_CODES.CONFLICT);
      t.ok(c.message.indexOf(a.refNo) < 0, 'no. rujukan orang lain tidak didedahkan kepada awam');
      TestAssert.apiOk(AppFixtures.pub({ noStaf: s2.no_staf, ruang: room.id, tarikh: AppFixtures.day(6), masaMula: '11:00', masaTamat: '12:00' }));
      TestAssert.apiOk(AppFixtures.pub({ noStaf: s2.no_staf, ruang: lain.id, tarikh: AppFixtures.day(6), masaMula: '10:00', masaTamat: '12:00' }));
      TestAssert.apiOk(AppFixtures.pub({ noStaf: s2.no_staf, ruang: room.id, tarikh: AppFixtures.day(8), masaMula: '10:00', masaTamat: '12:00' }));
      // Selepas ditolak, slot bebas semula
      const adm = TestHelpers.admin();
      const rowA = AppFixtures.rowByRef(a.refNo);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: rowA.id, status: 'DITOLAK', note: 'Ruang digunakan untuk peperiksaan' }));
      TestAssert.apiOk(AppFixtures.pub({ noStaf: s2.no_staf, ruang: room.id, tarikh: AppFixtures.day(6), masaMula: '09:00', masaTamat: '10:00' }));
      // Admin melihat no. rujukan dalam mesej pertindihan
      const c2 = TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.create', { module: 'tempahan', noStaf: s1.no_staf, noTelefon: '0123456789', ruang: room.id, tarikh: AppFixtures.day(8), masaMula: '11:00', masaTamat: '11:30', tujuan: 'Admin' }), ERROR_CODES.CONFLICT);
      t.ok(/TP-/.test(c2.message), 'admin nampak rujukan');
    }],

    ['Lulus disemak semula terhadap tempahan diluluskan; sunting admin', function (t) {
      const adm = TestHelpers.admin();
      const room = AppFixtures.room();
      const x = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(9), tarikh_tamat: AppFixtures.day(9), masa_mula: '09:00', masa_tamat: '12:00' });
      const y = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(9), tarikh_tamat: AppFixtures.day(9), masa_mula: '11:00', masa_tamat: '13:00' });
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: x.id, status: 'DILULUSKAN' }));
      const e = TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: y.id, status: 'DILULUSKAN' }), ERROR_CODES.CONFLICT);
      t.ok(e.message.indexOf(x.ref_no) >= 0);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: y.id, status: 'DITOLAK', note: 'Bertindih' }));
      // Admin ubah masa: peringatan diset semula; tarikh lepas dibenarkan untuk admin
      Repo.of('TEMPAHAN').update(x.id, { peringatan_dihantar: DateUtils.nowIso() });
      const u = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.update', { module: 'tempahan', id: x.id, tarikh: AppFixtures.day(10), tarikhTamat: '' }));
      t.eq(u.values.tarikhTamat, AppFixtures.day(10), 'tarikh tamat ikut tarikh baharu');
      Database.resetRequestCache();
      t.eq(Repo.of('TEMPAHAN').findById(x.id).peringatan_dihantar, '');
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.update', { module: 'tempahan', id: x.id, tarikh: AppFixtures.day(-2), tarikhTamat: AppFixtures.day(-2) }));
    }],

    ['Semak & batal oleh pemohon (No. Rujukan + No. Staf + emel)', function (t) {
      const room = AppFixtures.room();
      const staf = AppFixtures.staf();
      const r = TestAssert.apiOk(AppFixtures.pub({ noStaf: staf.no_staf, ruang: room.id, tarikh: AppFixtures.day(11), masaMula: '14:00', masaTamat: '16:00', tujuan: 'Bengkel' }));
      TestAssert.apiFail(api({ action: 'tempahan.semak', payload: { refNo: r.refNo, noStaf: '99999' } }), ERROR_CODES.NOT_FOUND);
      const v = TestAssert.apiOk(api({ action: 'tempahan.semak', payload: { refNo: r.refNo.toLowerCase(), noStaf: staf.no_staf + '.0' } }));
      t.eq(v.ruang, room.nama);
      t.eq(v.status, 'MENUNGGU');
      t.ok(v.bolehBatal);
      t.ok(v.emel.indexOf('***@') === 1 && v.emel !== staf.emel, 'emel disamarkan');
      TestAssert.apiFail(api({ action: 'tempahan.batal', payload: { refNo: r.refNo, noStaf: staf.no_staf, emel: 'salah@test.local' } }), ERROR_CODES.NOT_FOUND);
      const b = TestAssert.apiOk(api({ action: 'tempahan.batal', payload: { refNo: r.refNo, noStaf: staf.no_staf, emel: staf.emel.toUpperCase(), sebab: 'Program ditunda' } }));
      t.eq(b.status, 'DIBATALKAN');
      t.ok(/Program ditunda/.test(b.statusNote));
      t.ok(!b.bolehBatal);
      TestAssert.apiFail(api({ action: 'tempahan.batal', payload: { refNo: r.refNo, noStaf: staf.no_staf, emel: staf.emel } }), ERROR_CODES.CONFLICT);
      TestAssert.apiFail(api({ action: 'tempahan.semak', payload: { refNo: '', noStaf: '' } }), ERROR_CODES.VALIDATION_ERROR);
    }],

    ['Kalendar awam: tiada data peribadi; admin nampak butiran', function (t) {
      const room = AppFixtures.room({ nama: 'Dewan Jadual' });
      const tutup = AppFixtures.room({ nama: 'Bilik Tutup', aktif: false });
      AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(12), tarikh_tamat: AppFixtures.day(14), status: 'DILULUSKAN', nama: 'Rahsia Nama', tujuan: 'Rahsia Tujuan' });
      AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(13), tarikh_tamat: AppFixtures.day(13), status: 'DITOLAK' });
      const pub = TestAssert.apiOk(api({ action: 'tempahan.jadual', payload: { dari: AppFixtures.day(13), hingga: AppFixtures.day(13) } }));
      t.ok(pub.ruang.some(function (r) { return r.id === room.id; }));
      t.ok(!pub.ruang.some(function (r) { return r.id === tutup.id; }), 'ruang tidak aktif disembunyikan');
      const mine = pub.tempahan.filter(function (x) { return x.ruang === room.id; });
      t.eq(mine.length, 1, 'tempahan berbilang hari merentasi julat; ditolak tidak dipapar');
      t.ok(JSON.stringify(pub).indexOf('Rahsia') < 0, 'tiada nama/tujuan untuk awam');
      t.eq(pub.admin, false);
      const adm = TestHelpers.admin();
      const a = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.jadual', { dari: AppFixtures.day(13), ruang: room.id }));
      t.eq(a.tempahan[0].nama, 'Rahsia Nama');
      TestAssert.apiFail(api({ action: 'tempahan.jadual', payload: { dari: AppFixtures.day(0), hingga: AppFixtures.day(60) } }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiFail(api({ action: 'tempahan.jadual', payload: { ruang: '<script>' } }), ERROR_CODES.VALIDATION_ERROR);
    }],

    ['Penyelenggaraan harian: selesai, luput & peringatan H-1', function (t) {
      const adm = TestHelpers.admin();
      AppFixtures.emailOn(adm);
      const room = AppFixtures.room();
      const lepas = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(-3), tarikh_tamat: AppFixtures.day(-1), status: 'DILULUSKAN' });
      const masih = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(-1), tarikh_tamat: AppFixtures.day(1), status: 'DILULUSKAN', masa_mula: '15:00', masa_tamat: '16:00' });
      const luput = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(-1), tarikh_tamat: AppFixtures.day(-1), status: 'MENUNGGU', masa_mula: '17:00', masa_tamat: '18:00' });
      const esok = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(1), tarikh_tamat: AppFixtures.day(1), status: 'DILULUSKAN', masa_mula: '19:00', masa_tamat: '20:00', emel: 'esok@test.local' });
      const before = typeof __mails !== 'undefined' ? __mails.length : 0;
      const r1 = TempahanHooks.maintenance();
      t.ok(r1.selesai >= 1 && r1.luput >= 1 && r1.peringatan >= 1, JSON.stringify(r1));
      Database.resetRequestCache();
      const get = function (x) { return Repo.of('TEMPAHAN').findById(x.id); };
      t.eq(get(lepas).status, 'SELESAI');
      t.eq(get(masih).status, 'DILULUSKAN', 'berbilang hari belum tamat');
      t.eq(get(luput).status, 'DIBATALKAN');
      t.ok(!!get(esok).peringatan_dihantar);
      if (typeof __mails !== 'undefined') {
        t.eq(__mails.slice(before).filter(function (m) { return m.to === 'esok@test.local' && /Peringatan/.test(m.subject); }).length, 1);
      }
      const r2 = TempahanHooks.maintenance();
      t.eq(r2.peringatan, 0, 'peringatan tidak dihantar dua kali');
    }],

    ['Email: pengesahan kepada pemohon, keputusan kepada pemohon & PIC', function (t) {
      const adm = TestHelpers.admin();
      AppFixtures.emailOn(adm);
      const room = AppFixtures.room();
      const staf = AppFixtures.staf();
      const before = __mails.length;
      const r = TestAssert.apiOk(AppFixtures.pub({ noStaf: staf.no_staf, ruang: room.id, tarikh: AppFixtures.day(15), masaMula: '08:00', masaTamat: '10:00' }));
      const ack = __mails.slice(before).filter(function (m) { return m.to === staf.emel; });
      t.eq(ack.length, 1, 'email pengesahan');
      t.ok(ack[0].htmlBody.indexOf(r.refNo) >= 0 && ack[0].htmlBody.indexOf(room.nama) >= 0);
      const row = AppFixtures.rowByRef(r.refNo);
      const mid = __mails.length;
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: row.id, status: 'DILULUSKAN' }));
      const after = __mails.slice(mid);
      t.eq(after.filter(function (m) { return m.to === staf.emel && /diluluskan/i.test(m.subject); }).length, 1, 'pemohon dimaklumkan sekali');
      t.eq(after.filter(function (m) { return m.to === room.emel_pic; }).length, 1, 'PIC dimaklumkan');
      const mid2 = __mails.length;
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tempahan', id: row.id, status: 'DIBATALKAN', note: 'Kecemasan' }));
      t.ok(__mails.slice(mid2).some(function (m) { return m.to === room.emel_pic && /dibatalkan/i.test(m.subject); }), 'PIC dimaklumkan pembatalan');
    }, { nodeOnly: true }],

    ['Peringatan beberapa jam sebelum: sekali sehari, dalam tetingkap PERINGATAN_JAM', function (t) {
      const adm = TestHelpers.admin();
      AppFixtures.emailOn(adm);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { PERINGATAN_JAM: 2 } }));
      const room = AppFixtures.room();
      const now = TempahanHooks.toMin(TempahanHooks.nowHM());
      const hm = function (m) { m = Math.max(0, Math.min(23 * 60 + 59, m)); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
      const today = AppFixtures.day(0);
      const soon = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(-1), tarikh_tamat: AppFixtures.day(1), status: 'DILULUSKAN', masa_mula: hm(now + 60), masa_tamat: hm(now + 61), emel: 'jam@test.local' });
      const far = AppFixtures.booking({ ruang: room.id, tarikh: today, tarikh_tamat: today, status: 'DILULUSKAN', masa_mula: hm(now + 300), masa_tamat: hm(now + 301), emel: 'jauh@test.local' });
      const pending = AppFixtures.booking({ ruang: room.id, tarikh: today, tarikh_tamat: today, status: 'MENUNGGU', masa_mula: hm(now + 30), masa_tamat: hm(now + 31), emel: 'tunggu@test.local' });
      if (now + 61 > 23 * 60 + 59) return; /* lewat malam: tiada tetingkap untuk diuji */
      const before = typeof __mails !== 'undefined' ? __mails.length : 0;
      const r1 = TempahanHooks.hourly();
      t.ok(r1.peringatanJam >= 1, JSON.stringify(r1));
      Database.resetRequestCache();
      t.eq(Repo.of('TEMPAHAN').findById(soon.id).peringatan_jam_dihantar, today);
      t.eq(Repo.of('TEMPAHAN').findById(far.id).peringatan_jam_dihantar, '', 'di luar tetingkap');
      t.eq(Repo.of('TEMPAHAN').findById(pending.id).peringatan_jam_dihantar, '', 'belum diluluskan');
      if (typeof __mails !== 'undefined') t.eq(__mails.slice(before).filter(function (m) { return m.to === 'jam@test.local'; }).length, 1);
      t.eq(TempahanHooks.hourly().peringatanJam, 0, 'tidak berganda');
      TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { PERINGATAN_JAM: 0 } }));
      t.eq(TempahanHooks.hourly().peringatanJam, 0, '0 = tutup');
      t.ok(CrudEngine.hasHook('hourly'), 'pencetus setiap jam diperlukan');
    }],

    ['Bahasa Inggeris: bahasa pemohon disimpan & email dalam EN', function (t) {
      const adm = TestHelpers.admin();
      AppFixtures.emailOn(adm);
      const room = AppFixtures.room();
      const staf = AppFixtures.staf();
      const before = typeof __mails !== 'undefined' ? __mails.length : 0;
      const res = api({ action: 'crud.publicCreate', meta: { lang: 'en' }, payload: {
        module: 'tempahan', formToken: SecurityUtils.signFormToken('crud:tempahan', Date.now() - 5000), noTelefon: '012-3456789', tujuan: 'Workshop',
        noStaf: staf.no_staf, ruang: room.id, tarikh: AppFixtures.day(20), masaMula: '10:00', masaTamat: '11:00' } });
      const r = TestAssert.apiOk(res);
      const row = AppFixtures.rowByRef(r.refNo);
      t.eq(row.bahasa, 'en');
      const bm = TestAssert.apiOk(AppFixtures.pub({ noStaf: staf.no_staf, ruang: room.id, tarikh: AppFixtures.day(21), masaMula: '10:00', masaTamat: '11:00' }));
      t.eq(AppFixtures.rowByRef(bm.refNo).bahasa, 'ms', 'lalai BM');
      if (typeof __mails !== 'undefined') {
        const m = __mails.slice(before).filter(function (x) { return x.to === staf.emel && /Application received/.test(x.subject); });
        t.eq(m.length, 1, 'email pengesahan EN');
        t.ok(/Reference No\./.test(m[0].htmlBody) && /Automated email/.test(m[0].htmlBody));
      }
      const v = TestAssert.apiOk(api({ action: 'tempahan.semak', payload: { refNo: r.refNo, noStaf: staf.no_staf } }));
      t.eq(v.bahasa, 'en');
      t.eq(v.noStaf, staf.no_staf);
    }],

    ['Papan paparan: tujuan untuk tempahan diluluskan sahaja, tanpa nama; boleh ditutup', function (t) {
      const adm = TestHelpers.admin();
      const room = AppFixtures.room();
      AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(25), tarikh_tamat: AppFixtures.day(25), status: 'DILULUSKAN', nama: 'Nama Sulit', tujuan: 'Seminar Awam' });
      AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(25), tarikh_tamat: AppFixtures.day(25), status: 'MENUNGGU', masa_mula: '14:00', masa_tamat: '15:00', tujuan: 'Belum Lulus' });
      const p = TestAssert.apiOk(api({ action: 'tempahan.jadual', payload: { dari: AppFixtures.day(25), papan: true, ruang: room.id } }));
      const s = JSON.stringify(p);
      t.ok(s.indexOf('Seminar Awam') >= 0, 'tujuan diluluskan dipapar');
      t.ok(s.indexOf('Belum Lulus') < 0, 'tujuan menunggu disembunyikan');
      t.ok(s.indexOf('Nama Sulit') < 0, 'nama tidak pernah dipapar');
      t.ok(/^\d{2}:\d{2}$/.test(p.sekarang));
      const biasa = JSON.stringify(TestAssert.apiOk(api({ action: 'tempahan.jadual', payload: { dari: AppFixtures.day(25), ruang: room.id } })));
      t.ok(biasa.indexOf('Seminar Awam') < 0, 'kalendar biasa tanpa tujuan');
      TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { PAPAN_TUNJUK_TUJUAN: false } }));
      t.ok(JSON.stringify(TestAssert.apiOk(api({ action: 'tempahan.jadual', payload: { dari: AppFixtures.day(25), papan: true, ruang: room.id } }))).indexOf('Seminar Awam') < 0, 'tetapan ditutup');
      TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { PAPAN_TUNJUK_TUJUAN: true } }));
    }],

    ['Pencetus setiap jam dipasang automatik', function (t) {
      const before = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'hourlyMaintenance'; }).length;
      MaintenanceService.ensureTriggers();
      const after = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'hourlyMaintenance'; }).length;
      t.ok(after >= 1 && after <= Math.max(1, before), 'tepat satu, idempoten');
      MaintenanceService.ensureTriggers();
      t.eq(ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'hourlyMaintenance'; }).length, after);
    }, { nodeOnly: true }],

    ['Import data lama: pemetaan & idempoten', function (t) {
      const ss = SpreadsheetApp.create('LEGACY_TEST_' + Date.now());
      const put = function (name, rows) {
        const sh = ss.insertSheet(name);
        sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      };
      const suffix = String(Date.now()).slice(-5);
      const nama1 = 'Dewan Kuliah Lama ' + suffix + ' (E07)';
      put('Ruang', [
        ['Nama Ruang', 'Kapasiti', 'Lokasi', 'Status', 'PIC', 'Emel PIC'],
        [nama1, 150, 'Aras 1 · Dewan Kuliah · E07 · Kod: E07 - 01.02.01', 'Aktif', 'Pn. Siti', 'siti@utm.my'],
        ['Makmal Lama ' + suffix + ' (C24)', 30, 'Aras 2 · Makmal Komputer · C24 · Kod: C24 - 201', 'Aktif', '', '']
      ]);
      put('Staf', [
        ['No Pekerja', 'Nama', 'Emel'],
        ['8' + suffix, 'Staf Lama Satu', 'satu@utm.my'],
        ['8' + suffix + '.0', 'Pendua', 'dua@utm.my'],
        ['', 'Tiada No', 'x@utm.my']
      ]);
      put('Tempahan', [
        ['ID', 'Tarikh Mohon', 'Nama', 'No Staf', 'Ruang', 'Tarikh', 'Masa Mula', 'Masa Tamat', 'Tujuan', 'Status', 'Emel', 'Sebab Tolak', 'Peringatan Dihantar', 'No Telefon'],
        ['TP-L' + suffix + '-AAAA', '2026-07-09T03:13:00.000Z', 'Staf Lama Satu', Number('8' + suffix), nama1, '2026-07-09', '8:00', '10:00', 'exam', 'Selesai', 'SATU@utm.my', '', 'Ya', 139314611],
        ['TP-L' + suffix + '-BBBB', '2026-07-09T03:40:00.000Z', 'Staf Lama Satu', '8' + suffix, nama1, '11/07/2026', '2:30 PM', '4:30 PM', 'Mesyuarat', 'Ditolak', 'satu@utm.my', 'Ruang penuh', '', ''],
        ['TP-L' + suffix + '-CCCC', '2026-07-09T03:40:00.000Z', 'X', '1', 'Ruang Tiada', '2026-07-12', '8:00', '9:00', 'x', 'Diluluskan', 'x@utm.my', '', '', '']
      ]);
      const r1 = LegacyImport.run(ss);
      t.eq(r1.ruang.diimport, 2);
      t.eq(r1.staf.diimport, 1);
      t.eq(r1.staf.tidakSah, 1);
      t.eq(r1.tempahan.diimport, 2);
      t.eq(r1.tempahan.gagal.length, 1);
      Database.resetRequestCache();
      const ru = Repo.of('RUANG').findOne(function (r) { return r.nama === nama1; });
      t.eq(ru.blok, 'E07'); t.eq(ru.aras, '1'); t.eq(ru.jenis, 'Dewan Kuliah'); t.eq(ru.kod_ruang, 'E07 - 01.02.01'); t.eq(ru.kapasiti, 150); t.eq(ru.aktif, true); t.eq(ru.emel_pic, 'siti@utm.my');
      const a = AppFixtures.rowByRef('TP-L' + suffix + '-AAAA');
      t.eq(a.status, 'SELESAI'); t.eq(a.ruang, ru.id); t.eq(a.tarikh, '2026-07-09'); t.eq(a.masa_mula, '08:00'); t.eq(a.no_staf, '8' + suffix);
      t.eq(a.no_telefon, '0139314611'); t.eq(a.emel, 'satu@utm.my'); t.ok(!!a.peringatan_dihantar);
      const b = AppFixtures.rowByRef('TP-L' + suffix + '-BBBB');
      t.eq(b.status, 'DITOLAK'); t.eq(b.status_note, 'Ruang penuh'); t.eq(b.tarikh, '2026-07-11'); t.eq(b.masa_mula, '14:30'); t.eq(b.masa_tamat, '16:30');
      const r2 = LegacyImport.run(ss);
      t.eq(r2.ruang.diimport + r2.staf.diimport + r2.tempahan.diimport, 0, 'jalankan semula tidak menduakan');
      const v = TestAssert.apiOk(api({ action: 'tempahan.semak', payload: { refNo: 'TP-L' + suffix + '-AAAA', noStaf: '8' + suffix } }));
      t.eq(v.statusLabel, 'Selesai');
      try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) { /* mock */ }
    }]
  ]
};
