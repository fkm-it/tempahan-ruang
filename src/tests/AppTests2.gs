/**
 * @file AppTests2.gs
 * Ciri tempahan v1.3 (daripada sistem lama): waktu operasi & tarikh tutup, pemohon pelajar / pihak luar,
 * isi-automatik staf, cari slot, tempahan saya, analitik, tempah bagi pihak, auto-selesai, peringatan pagi, panel tetapan.
 */
const AppFixtures2 = {
  /** Jalankan fn dengan tetapan tertentu, kemudian pulihkan keadaan asas AppTests.BASE. */
  withSettings: function (changes, fn) {
    SettingsRepository.setMany(changes, 'TEST');
    try { return fn(); } finally { SettingsRepository.setMany(AppTests.BASE, 'TEST'); }
  },
  /** Tarikh pertama ≥ hari ini + minDays yang jatuh pada hari minggu `dow` (0 = Ahad). */
  nextDow: function (dow, minDays) {
    for (let i = minDays || 1; i < minDays + 14; i++) {
      const d = AppFixtures.day(i);
      if (TempahanHooks.dow(d) === dow) return d;
    }
    throw new Error('tiada tarikh');
  },
  fieldOf: function (res) { return (res.meta && res.meta.fields) || {}; }
};

const TestSuiteTempahanV2 = {
  name: 'Domain: Tempahan v1.3',
  tests: [
    ['Waktu operasi, hari operasi & tarikh tutup: borang awam vs pentadbir', function (t) {
      const adm = TestHelpers.admin();
      const room = AppFixtures.room();
      const staf = AppFixtures.staf();
      const isnin = AppFixtures2.nextDow(1, 3);
      const sabtu = AppFixtures2.nextDow(6, 3);
      const cuti = AppFixtures2.nextDow(3, 3);
      AppFixtures2.withSettings({ WAKTU_MULA: '08:00', WAKTU_TAMAT: '18:00', HARI_OPERASI: '1,2,3,4,5', TARIKH_TUTUP: JSON.stringify([{ t: cuti, n: 'Cuti Ujian' }]) }, function () {
        const base = { noStaf: staf.no_staf, ruang: room.id };
        const early = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, base, { tarikh: isnin, masaMula: '07:30', masaTamat: '09:00' })), ERROR_CODES.VALIDATION_ERROR);
        t.ok(AppFixtures2.fieldOf(early).masaMula, 'sebelum waktu operasi');
        const late = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, base, { tarikh: isnin, masaMula: '17:00', masaTamat: '18:30' })), ERROR_CODES.VALIDATION_ERROR);
        t.ok(AppFixtures2.fieldOf(late).masaTamat, 'selepas waktu operasi');
        const wk = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, base, { tarikh: sabtu, masaMula: '09:00', masaTamat: '10:00' })), ERROR_CODES.VALIDATION_ERROR);
        t.ok(/Sabtu/.test(wk.message) && AppFixtures2.fieldOf(wk).tarikh, 'hujung minggu ditolak untuk awam');
        const span = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, base, { tarikh: AppFixtures2.nextDow(5, 3), tarikhTamat: TempahanHooks.addDaysKey(AppFixtures2.nextDow(5, 3), 3), masaMula: '09:00', masaTamat: '10:00' })), ERROR_CODES.VALIDATION_ERROR);
        t.ok(AppFixtures2.fieldOf(span).tarikh, 'julat berbilang hari yang merentas hujung minggu ditolak');
        const hol = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, base, { tarikh: cuti, masaMula: '09:00', masaTamat: '10:00' })), ERROR_CODES.VALIDATION_ERROR);
        t.ok(/Cuti Ujian/.test(hol.message), 'tarikh tutup dinyatakan');
        TestAssert.apiOk(AppFixtures.pub(Object.assign({}, base, { tarikh: isnin, masaMula: '08:00', masaTamat: '18:00' })));
        /* Pentadbir: hujung minggu dibenarkan; cuti & waktu operasi tetap disemak */
        TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.create', { module: 'tempahan', noStaf: staf.no_staf, noTelefon: '0123456789', ruang: room.id, tarikh: sabtu, masaMula: '09:00', masaTamat: '10:00', tujuan: 'Program hujung minggu' }));
        TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.create', { module: 'tempahan', noStaf: staf.no_staf, noTelefon: '0123456789', ruang: room.id, tarikh: cuti, masaMula: '09:00', masaTamat: '10:00', tujuan: 'Pada hari cuti' }), ERROR_CODES.VALIDATION_ERROR);
        TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.create', { module: 'tempahan', noStaf: staf.no_staf, noTelefon: '0123456789', ruang: room.id, tarikh: sabtu, masaMula: '18:00', masaTamat: '19:00', tujuan: 'Lewat' }), ERROR_CODES.VALIDATION_ERROR);
        const j = TestAssert.apiOk(api({ action: 'tempahan.jadual', payload: { dari: isnin, hingga: TempahanHooks.addDaysKey(isnin, 6) } }));
        t.eq(j.jam.mula, '08:00');
        t.eq(j.hariOperasi.join(','), '1,2,3,4,5');
        t.ok(j.tutup.some(function (x) { return x.t === cuti && x.n === 'Cuti Ujian'; }), 'jadual menyenaraikan tarikh tutup');
      });
    }],

    ['Pemohon pelajar: No. Matrik + nama + emel UTM; boleh ditutup; pihak luar hanya pentadbir', function (t) {
      const room = AppFixtures.room();
      const d = AppFixtures.day(6);
      const p = { jenisPemohon: 'PELAJAR', noStaf: ' a21mj1234 ', nama: 'Ali bin Pelajar', emel: 'ali@graduate.utm.my', ruang: room.id, tarikh: d, masaMula: '09:00', masaTamat: '10:00' };
      const r = TestAssert.apiOk(AppFixtures.pub(p));
      const row = AppFixtures.rowByRef(r.refNo);
      t.eq(row.jenis_pemohon, 'PELAJAR');
      t.eq(row.no_staf, 'A21MJ1234');
      t.eq(row.nama, 'Ali bin Pelajar', 'nama pelajar dikekalkan');
      t.eq(row.status, 'MENUNGGU');
      const gmail = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, p, { emel: 'ali@gmail.com', masaMula: '11:00', masaTamat: '12:00' })), ERROR_CODES.VALIDATION_ERROR);
      t.ok(AppFixtures2.fieldOf(gmail).emel, 'emel bukan UTM ditolak');
      const noName = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, p, { nama: '', masaMula: '11:00', masaTamat: '12:00' })), ERROR_CODES.VALIDATION_ERROR);
      t.ok(AppFixtures2.fieldOf(noName).nama, 'nama wajib');
      const luar = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, p, { jenisPemohon: 'LUAR', masaMula: '11:00', masaTamat: '12:00' })), ERROR_CODES.VALIDATION_ERROR);
      t.ok(AppFixtures2.fieldOf(luar).jenisPemohon, 'pihak luar tidak dibenarkan di borang awam');
      AppFixtures2.withSettings({ PELAJAR_DIBENARKAN: 'FALSE' }, function () {
        const closed = TestAssert.apiFail(AppFixtures.pub(Object.assign({}, p, { masaMula: '11:00', masaTamat: '12:00' })), ERROR_CODES.VALIDATION_ERROR);
        t.ok(AppFixtures2.fieldOf(closed).jenisPemohon, 'tempahan pelajar ditutup');
        t.eq(TestAssert.apiOk(api({ action: 'public.config' })).PELAJAR_DIBENARKAN, false, 'tetapan awam');
      });
      /* Semak & batal menggunakan No. Matrik + emel */
      const v = TestAssert.apiOk(api({ action: 'tempahan.semak', payload: { token: AppFixtures.sesi({ noStaf: 'A21MJ1234', refNo: r.refNo }), refNo: r.refNo } }));
      t.eq(v.nama, 'Ali bin Pelajar');
    }],

    ['Isi-automatik staf: nama & emel bertopeng; No. Staf tidak wujud → NOT_FOUND', function (t) {
      const staf = AppFixtures.staf({ emel: 'aminah.ujian@utm.my' });
      const r = TestAssert.apiOk(api({ action: 'tempahan.staf', payload: { noStaf: staf.no_staf + '.0' } }));
      t.eq(r.nama, staf.nama);
      t.eq(r.emel, 'a***@utm.my', 'emel bertopeng');
      TestAssert.apiFail(api({ action: 'tempahan.staf', payload: { noStaf: '00000X' } }), ERROR_CODES.NOT_FOUND);
    }],

    ['Cari slot: tapis kapasiti, celah kosong cukup panjang, pagi/petang, hari tutup', function (t) {
      const big = AppFixtures.room({ kapasiti: 12, blok: 'SLOT' + AppFixtures.seq });
      const small = AppFixtures.room({ kapasiti: 5, blok: big.blok });
      const d = AppFixtures2.nextDow(2, 3);
      AppFixtures.booking({ ruang: big.id, tarikh: d, tarikh_tamat: d, masa_mula: '09:00', masa_tamat: '11:00', status: 'DILULUSKAN' });
      AppFixtures2.withSettings({ WAKTU_MULA: '08:00', WAKTU_TAMAT: '18:00' }, function () {
        const res = TestAssert.apiOk(api({ action: 'tempahan.cariSlot', payload: { peserta: 8, tempoh: 120, masa: 'pagi', dari: d } }));
        const day = res.hari[0];
        const mine = day.ruang.filter(function (x) { return x.blok === big.blok; });
        t.eq(mine.length, 1, 'bilik kecil (5) tidak muat 8 orang');
        t.eq(mine[0].ruang, big.id);
        t.eq(mine[0].mula, '11:00', 'celah 08:00–09:00 terlalu pendek untuk 2 jam');
        t.eq(mine[0].tamat, '13:00');
        const pm = TestAssert.apiOk(api({ action: 'tempahan.cariSlot', payload: { peserta: 3, tempoh: 60, masa: 'petang', dari: d } }));
        const both = pm.hari[0].ruang.filter(function (x) { return x.blok === big.blok; });
        t.ok(both.length === 2 && both.every(function (x) { return x.mula >= '13:00'; }), 'petang bermula 13:00');
        t.eq(both[0].ruang, small.id, 'kapasiti paling hampir didahulukan');
      });
      AppFixtures2.withSettings({ TARIKH_TUTUP: JSON.stringify([{ t: d, n: 'Tutup' }]) }, function () {
        const res = TestAssert.apiOk(api({ action: 'tempahan.cariSlot', payload: { tempoh: 60, dari: d } }));
        t.eq(res.hari[0].tutup, 'Tutup');
        t.eq(res.hari[0].ruang.length, 0);
      });
      TestAssert.apiFail(api({ action: 'tempahan.cariSlot', payload: { tempoh: 60, dari: d, hingga: TempahanHooks.addDaysKey(d, 20) } }), ERROR_CODES.VALIDATION_ERROR);
    }],

    ['Tempahan saya: No. Staf DAN emel mesti sepadan; tiada kebocoran', function (t) {
      const room = AppFixtures.room();
      const staf = AppFixtures.staf();
      const lain = AppFixtures.staf();
      TestAssert.apiOk(AppFixtures.pub({ noStaf: staf.no_staf, ruang: room.id, tarikh: AppFixtures.day(8), masaMula: '09:00', masaTamat: '10:00' }));
      TestAssert.apiOk(AppFixtures.pub({ noStaf: staf.no_staf, ruang: room.id, tarikh: AppFixtures.day(9), masaMula: '09:00', masaTamat: '10:00' }));
      TestAssert.apiOk(AppFixtures.pub({ noStaf: lain.no_staf, ruang: room.id, tarikh: AppFixtures.day(10), masaMula: '09:00', masaTamat: '10:00' }));
      TestAssert.apiFail(api({ action: 'tempahan.saya', payload: { noStaf: staf.no_staf, emel: staf.emel } }), ERROR_CODES.VALIDATION_ERROR);
      const mine = TestAssert.apiOk(api({ action: 'tempahan.saya', payload: { token: AppFixtures.sesi({ noStaf: staf.no_staf, emel: staf.emel.toUpperCase() }) } }));
      t.eq(mine.items.length, 2);
      t.ok(mine.items[0].tarikh >= mine.items[1].tarikh, 'terbaru dahulu');
      t.ok(mine.items.every(function (x) { return x.emel.indexOf('***') > 0; }), 'emel bertopeng');
      t.eq(TestAssert.apiOk(api({ action: 'tempahan.saya', payload: { token: AppFixtures.sesi({ noStaf: lain.no_staf, emel: lain.emel }) } })).items.length, 1, 'sesi lain → tempahan sendiri sahaja');
    }],

    ['Analitik: KPI, jam terkumpul (tanpa ditolak/dibatalkan), trend 6 bulan, ruang & blok', function (t) {
      const adm = TestHelpers.admin();
      const room = AppFixtures.room({ blok: 'ANL' });
      const d = AppFixtures.day(300);
      const bulan = d.slice(0, 7);
      const mk = function (mula, tamat, status, hari) {
        return AppFixtures.booking({ ruang: room.id, tarikh: d, tarikh_tamat: hari ? TempahanHooks.addDaysKey(d, hari) : d, masa_mula: mula, masa_tamat: tamat, status: status });
      };
      mk('08:00', '10:00', 'DILULUSKAN', 1); /* 2 jam × 2 hari */
      mk('10:00', '11:30', 'MENUNGGU');
      mk('12:00', '17:00', 'DITOLAK');
      const a = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.analitik', { bulan: bulan }));
      t.eq(a.tapisan, bulan);
      t.eq(a.kpi.jumlah, 3);
      t.eq(a.kpi.diluluskan, 1);
      t.eq(a.kpi.menunggu, 1);
      t.eq(a.kpi.ditolak, 1);
      t.eq(a.kpi.jam, 5.5, '4 + 1.5 jam');
      t.eq(a.kpi.purataJam, 2.8);
      t.eq(a.trend.length, 6);
      t.eq(a.trend[5].label, bulan);
      t.eq(a.trend[5].value, 2);
      t.eq(a.ruang[0].value, 2);
      t.eq(a.blok[0].label, 'ANL');
      t.ok(a.bulan.indexOf(bulan) >= 0, 'senarai bulan untuk penapis');
      TestAssert.apiFail(TestHelpers.call(TestHelpers.user('biasa').token, 'tempahan.analitik', {}), ERROR_CODES.FORBIDDEN);
    }],

    ['Tempah bagi pihak (pentadbir): pihak luar / hujung minggu, terus diluluskan, emel ikut pilihan', function (t) {
      const adm = TestHelpers.admin();
      const room = AppFixtures.room();
      const sabtu = AppFixtures2.nextDow(6, 3);
      const before = typeof __mails !== 'undefined' ? __mails.length : 0;
      const r = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.bagiPihak', {
        jenisPemohon: 'LUAR', nama: 'Syarikat ABC Sdn Bhd', emel: 'urusetia@abc.example', noTelefon: '0123456789',
        ruang: room.id, tarikh: sabtu, masaMula: '09:00', masaTamat: '12:00', tujuan: 'Hari terbuka FKM', hantarEmel: false
      }));
      t.eq(r.status, 'DILULUSKAN');
      const row = AppFixtures.rowByRef(r.refNo);
      t.eq(row.jenis_pemohon, 'LUAR');
      t.eq(row.nama, 'Syarikat ABC Sdn Bhd');
      if (typeof __mails !== 'undefined') {
        t.eq(__mails.slice(before).filter(function (m) { return m.to === 'urusetia@abc.example'; }).length, 0, 'tiada emel bila tidak dipilih');
        AppFixtures.emailOn(adm);
        const r2 = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.bagiPihak', {
          jenisPemohon: 'LUAR', nama: 'Syarikat ABC Sdn Bhd', emel: 'urusetia@abc.example', noTelefon: '0123456789',
          ruang: room.id, tarikh: sabtu, masaMula: '13:00', masaTamat: '14:00', tujuan: 'Sesi kedua', hantarEmel: true
        }));
        const sent = __mails.slice(before).filter(function (m) { return m.to === 'urusetia@abc.example'; });
        t.eq(sent.length, 1, 'hanya emel kelulusan (tiada "permohonan diterima")');
        t.ok(sent[0].subject.indexOf(r2.refNo) >= 0 && /diluluskan/i.test(sent[0].subject), 'emel kelulusan');
      }
      TestAssert.apiFail(TestHelpers.call(TestHelpers.user('biasa').token, 'tempahan.bagiPihak', { jenisPemohon: 'LUAR' }), ERROR_CODES.FORBIDDEN);
      const clash = TestHelpers.call(adm.token, 'tempahan.bagiPihak', { jenisPemohon: 'LUAR', nama: 'Lain', emel: 'lain@abc.example', noTelefon: '0123456789', ruang: room.id, tarikh: sabtu, masaMula: '10:00', masaTamat: '11:00', tujuan: 'Bertindih' });
      TestAssert.apiFail(clash, ERROR_CODES.CONFLICT);
    }],

    ['Auto-selesai "Jalankan sekarang": tempahan diluluskan yang lepas → SELESAI', function (t) {
      const adm = TestHelpers.admin();
      const room = AppFixtures.room();
      const old = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(-3), tarikh_tamat: AppFixtures.day(-2), status: 'DILULUSKAN' });
      const future = AppFixtures.booking({ ruang: room.id, tarikh: AppFixtures.day(2), tarikh_tamat: AppFixtures.day(2), status: 'DILULUSKAN' });
      const r = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.selesaiKini', {}));
      t.ok(r.selesai >= 1);
      Database.resetRequestCache();
      t.eq(Repo.of('TEMPAHAN').findById(old.id).status, 'SELESAI');
      t.eq(Repo.of('TEMPAHAN').findById(future.id).status, 'DILULUSKAN');
    }],

    ['Peringatan pagi: hari tempahan, sekali sahaja, hanya sebelum masa mula', function (t) {
      const nowHm = TempahanHooks.nowHM();
      const nowH = Number(nowHm.slice(0, 2));
      if (nowH < 1 || nowHm >= '22:00') return; /* tetingkap tidak sesuai pada jam ini */
      const room = AppFixtures.room();
      const start = ('0' + (nowH + 1)).slice(-2) + ':00';
      const end = ('0' + (nowH + 2)).slice(-2) + ':00';
      const today = TempahanHooks.today();
      const r = AppFixtures.booking({ ruang: room.id, tarikh: today, tarikh_tamat: today, masa_mula: start, masa_tamat: end, status: 'DILULUSKAN', emel: 'pagi@test.local' });
      AppFixtures.booking({ ruang: room.id, tarikh: today, tarikh_tamat: today, masa_mula: '00:00', masa_tamat: '00:30', status: 'DILULUSKAN', emel: 'lepas@test.local' });
      AppFixtures2.withSettings({ PERINGATAN_PAGI: String(nowH), NOTIFY_EMAIL_ENABLED: 'TRUE' }, function () {
        t.ok(TempahanHooks.morningReminders() >= 1);
        Database.resetRequestCache();
        t.eq(Repo.of('TEMPAHAN').findById(r.id).peringatan_pagi_dihantar, today);
        t.eq(TempahanHooks.morningReminders(), 0, 'tidak berulang');
      });
      AppFixtures2.withSettings({ PERINGATAN_PAGI: String(nowH + 1) }, function () {
        t.eq(TempahanHooks.morningReminders(), 0, 'belum tiba jamnya');
      });
    }],

    ['Panel tetapan tempahan: simpan & sah; tetapan tersembunyi tiada dalam skrin Tetapan umum', function (t) {
      const adm = TestHelpers.admin();
      TestAssert.apiFail(TestHelpers.call(adm.token, 'tempahan.tetapanSimpan', { waktuMula: '18:00', waktuTamat: '08:00' }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiFail(TestHelpers.call(adm.token, 'tempahan.tetapanSimpan', { hari: [] }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiFail(TestHelpers.call(adm.token, 'tempahan.tetapanSimpan', { waktuMula: '8 pagi' }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiFail(TestHelpers.call(adm.token, 'tempahan.tetapanSimpan', { emelAdmin: 'a@utm.my, bukan-emel' }), ERROR_CODES.VALIDATION_ERROR);
      try {
        const r = TestAssert.apiOk(TestHelpers.call(adm.token, 'tempahan.tetapanSimpan', {
          waktuMula: '08:30', waktuTamat: '17:30', hari: [5, 1, 1, 2], pelajar: false, peringatanPagi: 6, peringatanJam: 1,
          tutup: [{ t: '2027-02-01', n: 'Thaipusam <b>' }, { t: '2027-01-01', n: 'Tahun Baru' }, { t: '2027-01-01', n: 'Pendua' }],
          emelAdmin: 'a@utm.my,  b@utm.my'
        }));
        t.eq(r.waktuMula, '08:30');
        t.eq(r.hari.join(','), '1,2,5');
        t.eq(r.tutup.length, 2, 'pendua dibuang');
        t.eq(r.tutup[0].t, '2027-01-01', 'disusun');
        t.ok(r.tutup[1].n.indexOf('<') < 0, 'tag dibuang');
        t.eq(r.pelajar, false);
        t.eq(r.emelAdmin, 'a@utm.my, b@utm.my');
        const cfg = TestAssert.apiOk(api({ action: 'public.config' }));
        t.eq(cfg.WAKTU_MULA, '08:30');
        t.eq(cfg.HARI_OPERASI, '1,2,5');
        const generic = TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings', {}));
        const keys = (generic.settings || generic).map(function (x) { return x.key; });
        t.ok(keys.indexOf('TARIKH_TUTUP') < 0 && keys.indexOf('WAKTU_MULA') < 0, 'disembunyikan daripada skrin umum');
        t.ok(keys.indexOf('PAPAN_TUNJUK_TUJUAN') >= 0);
      } finally {
        SettingsRepository.setMany(AppTests.BASE, 'TEST');
      }
    }]
  ]
};
