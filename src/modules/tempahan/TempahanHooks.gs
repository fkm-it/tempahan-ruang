/**
 * @file TempahanHooks.gs
 * Peraturan domain tempahan ruang FKM.
 *
 * Aliran: pemohon (staf atau pelajar, tanpa akaun) isi borang awam → MENUNGGU → admin DILULUSKAN / DITOLAK
 *         → SELESAI (automatik selepas tarikh tamat). Pemohon boleh DIBATALKAN sendiri melalui "Semak tempahan".
 * Peraturan:
 *   - No. Staf mesti wujud & aktif dalam modul Staf (nama & emel diambil dari situ — tidak boleh dipalsukan).
 *   - Tiada pertindihan masa pada ruang yang sama dengan tempahan MENUNGGU/DILULUSKAN (disemak semula semasa lulus).
 *   - Masa dalam waktu operasi, mula < tamat; tarikh tidak lepas (kecuali admin); maksimum 14 hari berturut.
 *   - Bilangan peserta ≤ kapasiti ruang.
 * Tempahan berbilang hari = slot masa yang SAMA setiap hari dari `tarikh` hingga `tarikhTamat`.
 * Peralihan status dikawal (modules/tempahan.json → transitions): DIBATALKAN & SELESAI ialah status akhir;
 * DITOLAK boleh dibuka semula (→ MENUNGGU) jika slot masih kosong.
 * Kelulusan boleh menugaskan PIC (pembantu operasi) untuk membuka ruang — lihat TugasanHooks.
 */
const TempahanHooks = {
  /** Status yang "memegang" slot (menghalang tempahan lain). */
  HOLDING: ['MENUNGGU', 'DILULUSKAN'],
  /** Status yang dipaparkan dalam kalendar. */
  SHOWN: ['MENUNGGU', 'DILULUSKAN', 'SELESAI'],
  /** Kategori pemohon: STAF (disemak dengan senarai staf), PELAJAR (No. Matrik + emel UTM), LUAR (admin sahaja). */
  JENIS: ['STAF', 'PELAJAR', 'LUAR'],
  /** Domain emel pelajar yang diterima (borang awam). */
  DOMAIN_PELAJAR: /(^|\.)utm\.my$/i,
  MAX_HARI: 14,
  MAX_HARI_KE_DEPAN: 365,
  MAX_JULAT_JADUAL: 42,

  // ================================================================== Pembantu tarikh (kunci 'yyyy-MM-dd')

  today: function () { return DateUtils.dayKey(new Date()); },
  nowHM: function () { return Utilities.formatDate(new Date(), DateUtils.tz(), 'HH:mm'); },
  addDaysKey: function (key, n) {
    const d = new Date(key + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },
  daysBetween: function (a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); },
  fmtDate: function (key) { const p = String(key || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(key || ''); },
  endDate: function (row) { return row.tarikh_tamat || row.tarikh; },
  dateText: function (row) {
    const e = TempahanHooks.endDate(row);
    return e && e !== row.tarikh ? TempahanHooks.fmtDate(row.tarikh) + ' – ' + TempahanHooks.fmtDate(e) : TempahanHooks.fmtDate(row.tarikh);
  },

  // ================================================================== Waktu operasi & tarikh tutup (Tetapan tempahan)

  /** @return {{mula:string, tamat:string, hari:number[], tutup:{t:string,n:string}[]}} */
  waktu: function () {
    let tutup = [];
    try { tutup = JSON.parse(SettingsService.get('TARIKH_TUTUP') || '[]'); } catch (e) { tutup = []; }
    if (!Array.isArray(tutup)) tutup = [];
    const hari = String(SettingsService.get('HARI_OPERASI') || '').split(',').filter(function (x) { return /^[0-6]$/.test(x); }).map(Number);
    return {
      mula: SettingsService.get('WAKTU_MULA') || '08:00',
      tamat: SettingsService.get('WAKTU_TAMAT') || '18:00',
      hari: hari.length ? hari : [1, 2, 3, 4, 5],
      tutup: tutup.filter(function (x) { return x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.t)); }).map(function (x) { return { t: String(x.t), n: String(x.n || '') }; })
    };
  },

  dow: function (key) { return new Date(key + 'T00:00:00Z').getUTCDay(); },
  HARI_MS: ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'],
  hariText: function (hari) { return hari.map(function (d) { return TempahanHooks.HARI_MS[d]; }).join(', '); },

  /** Hari pertama dalam julat yang ditutup (cuti) atau bukan hari operasi; null jika semua dibuka. */
  closedDay: function (dari, hingga, w, admin) {
    const tutup = {};
    w.tutup.forEach(function (x) { tutup[x.t] = x.n || 'Tarikh tutup'; });
    for (let d = dari, i = 0; d <= hingga && i < 400; d = TempahanHooks.addDaysKey(d, 1), i++) {
      if (tutup[d]) return { tarikh: d, sebab: tutup[d], cuti: true };
      if (!admin && w.hari.indexOf(TempahanHooks.dow(d)) < 0) return { tarikh: d, sebab: TempahanHooks.HARI_MS[TempahanHooks.dow(d)], cuti: false };
    }
    return null;
  },

  // ================================================================== Slot & pertindihan

  slotOf: function (row) {
    return { ruang: row.ruang, tarikh: row.tarikh, tarikhTamat: TempahanHooks.endDate(row), masaMula: row.masa_mula, masaTamat: row.masa_tamat };
  },

  /** Dua slot bertindih jika ruang sama, julat tarikh bersilang DAN julat masa bersilang (hujung tidak dikira). */
  overlaps: function (a, b) {
    return a.ruang === b.ruang && a.tarikh <= b.tarikhTamat && b.tarikh <= a.tarikhTamat && a.masaMula < b.masaTamat && b.masaMula < a.masaTamat;
  },

  /** Tempahan aktif pertama yang bertindih dengan slot (kecuali excludeId). */
  findConflict: function (slot, excludeId, statuses) {
    const st = statuses || TempahanHooks.HOLDING;
    return Repo.of('TEMPAHAN').findOne(function (r) {
      return r.state === RECORD_STATE.ACTIVE && r.id !== excludeId && st.indexOf(r.status) >= 0 && TempahanHooks.overlaps(slot, TempahanHooks.slotOf(r));
    });
  },

  conflictMessage: function (c, slot, admin) {
    const day = c.tarikh > slot.tarikh ? c.tarikh : slot.tarikh;
    return 'Ruang ini sudah ditempah pada ' + TempahanHooks.fmtDate(day) + ', ' + c.masa_mula + '–' + c.masa_tamat +
      (admin ? ' (' + c.ref_no + ', ' + (c.status === 'DILULUSKAN' ? 'diluluskan' : 'menunggu') + ')' : '') + '. Sila pilih masa atau ruang lain.';
  },

  ruangOf: function (rowOrId) {
    const id = typeof rowOrId === 'string' ? rowOrId : rowOrId && rowOrId.ruang;
    return id ? Repo.of('RUANG').findById(id) : null;
  },

  ruangText: function (row) {
    const r = TempahanHooks.ruangOf(row);
    return r ? r.nama + (r.blok && r.nama.indexOf('(' + r.blok + ')') < 0 ? ' (' + r.blok + ')' : '') : '-';
  },

  // ================================================================== Hooks enjin

  validate: function (data, info) {
    const admin = CrudEngine.isAdmin(info.ctx);
    const cur = info.current;
    const has = function (k) { return data[k] !== undefined && data[k] !== ''; };

    TempahanHooks.validatePemohon(data, cur, admin);

    const slot = {
      ruang: has('ruang') ? data.ruang : (cur ? cur.ruang : ''),
      tarikh: has('tarikh') ? data.tarikh : (cur ? cur.tarikh : ''),
      masaMula: has('masaMula') ? data.masaMula : (cur ? cur.masa_mula : ''),
      masaTamat: has('masaTamat') ? data.masaTamat : (cur ? cur.masa_tamat : '')
    };
    // Tarikh tamat kosong → sehari sahaja (sepadan dengan beforeSave)
    slot.tarikhTamat = has('tarikhTamat') ? data.tarikhTamat : (has('tarikh') || !cur ? slot.tarikh : TempahanHooks.endDate(cur));
    if (!slot.tarikh || !slot.masaMula || !slot.masaTamat || !slot.ruang) return; // medan wajib disemak oleh enjin

    const w = TempahanHooks.waktu();
    if (slot.masaMula < w.mula || slot.masaTamat > w.tamat) {
      throw Errors.validation('Masa tempahan mesti antara ' + w.mula + ' dan ' + w.tamat + '.',
        slot.masaMula < w.mula ? { masaMula: 'Paling awal ' + w.mula + '.' } : { masaTamat: 'Paling lewat ' + w.tamat + '.' });
    }
    if (slot.masaTamat <= slot.masaMula) throw Errors.validation('Masa tamat mesti selepas masa mula.', { masaTamat: 'Mesti selepas masa mula.' });
    if (slot.tarikhTamat < slot.tarikh) throw Errors.validation('Tarikh tamat tidak boleh sebelum tarikh mula.', { tarikhTamat: 'Sebelum tarikh mula.' });
    if (TempahanHooks.daysBetween(slot.tarikh, slot.tarikhTamat) >= TempahanHooks.MAX_HARI) {
      throw Errors.validation('Tempahan maksimum ' + TempahanHooks.MAX_HARI + ' hari berturut-turut.', { tarikhTamat: 'Maksimum ' + TempahanHooks.MAX_HARI + ' hari.' });
    }

    const slotChanged = !cur || ['ruang', 'tarikh', 'tarikhTamat', 'masaMula', 'masaTamat'].some(function (k) {
      return slot[k] !== TempahanHooks.slotOf(cur)[k];
    });

    if (slotChanged) {
      /* Cuti/tarikh tutup: semua pemohon. Hari bukan operasi (cth. Sabtu/Ahad): borang awam sahaja — admin dibenarkan. */
      const closed = TempahanHooks.closedDay(slot.tarikh, slot.tarikhTamat, w, admin);
      if (closed) {
        throw Errors.validation(closed.cuti
          ? 'Fakulti ditutup pada ' + TempahanHooks.fmtDate(closed.tarikh) + ' (' + closed.sebab + ').'
          : 'Tempahan hanya dibuka pada hari ' + TempahanHooks.hariText(w.hari) + '. ' + TempahanHooks.fmtDate(closed.tarikh) + ' ialah hari ' + closed.sebab + '.',
        { tarikh: closed.cuti ? 'Tarikh ditutup.' : 'Bukan hari operasi.' });
      }
    }

    if (!admin && slotChanged) {
      const today = TempahanHooks.today();
      if (slot.tarikh < today) throw Errors.validation('Tarikh tempahan telah berlalu.', { tarikh: 'Tarikh telah berlalu.' });
      if (slot.tarikh === today && slot.masaMula <= TempahanHooks.nowHM()) throw Errors.validation('Masa mula telah berlalu.', { masaMula: 'Masa telah berlalu.' });
      if (TempahanHooks.daysBetween(today, slot.tarikh) > TempahanHooks.MAX_HARI_KE_DEPAN) {
        throw Errors.validation('Tempahan hanya dibuka sehingga ' + TempahanHooks.MAX_HARI_KE_DEPAN + ' hari ke hadapan.', { tarikh: 'Terlalu jauh ke hadapan.' });
      }
    }

    const ruang = TempahanHooks.ruangOf(slot.ruang);
    const peserta = data.bilanganPeserta !== undefined ? data.bilanganPeserta : (cur ? cur.bilangan_peserta : 0);
    const kapasiti = ruang ? parseInt(ruang.kapasiti, 10) || 0 : 0;
    if (peserta && kapasiti > 0 && peserta > kapasiti) {
      throw Errors.validation('Bilangan peserta melebihi kapasiti ruang (' + kapasiti + ' orang).', { bilanganPeserta: 'Maksimum ' + kapasiti + '.' });
    }

    const holding = !cur || TempahanHooks.HOLDING.indexOf(cur.status) >= 0;
    if (slotChanged && holding) {
      const c = TempahanHooks.findConflict(slot, cur ? cur.id : '');
      if (c) throw Errors.conflict(TempahanHooks.conflictMessage(c, slot, admin));
    }
  },

  jenisOf: function (data, cur) {
    const j = data.jenisPemohon !== undefined && data.jenisPemohon !== '' ? data.jenisPemohon : (cur && cur.jenis_pemohon) || 'STAF';
    return TempahanHooks.JENIS.indexOf(j) >= 0 ? j : 'STAF';
  },

  /**
   * STAF: No. Staf mesti dalam senarai staf aktif (nama & emel diambil dari situ).
   * PELAJAR: No. Matrik + nama + emel (borang awam: emel UTM sahaja; boleh ditutup melalui tetapan).
   * LUAR: pentadbir sahaja (nama & emel wajib).
   */
  validatePemohon: function (data, cur, admin) {
    const jenis = TempahanHooks.jenisOf(data, cur);
    const val = function (k, col) { return data[k] !== undefined ? data[k] : (cur ? cur[col] : ''); };
    if (jenis === 'LUAR' && !admin) throw Errors.validation('Kategori pemohon tidak sah.', { jenisPemohon: 'Tidak dibenarkan.' });
    if (jenis === 'PELAJAR' && !admin && !SettingsService.get('PELAJAR_DIBENARKAN')) {
      throw Errors.validation('Tempahan oleh pelajar tidak dibuka buat masa ini. Sila hubungi pentadbir atau minta penyelia membuat tempahan.', { jenisPemohon: 'Tidak dibuka.' });
    }
    if (jenis === 'STAF') {
      if (data.noStaf !== undefined || data.jenisPemohon !== undefined || !cur) {
        const staf = StafHooks.findByNo(val('noStaf', 'no_staf'));
        if (!staf || staf.aktif === false) {
          throw Errors.validation('No. Staf tidak dijumpai dalam senarai staf FKM. Sila semak semula atau hubungi pentadbir.', { noStaf: 'No. Staf tidak dijumpai.' });
        }
      }
      return;
    }
    const errors = {};
    const no = StafHooks.norm(val('noStaf', 'no_staf'));
    if (jenis === 'PELAJAR' && !/^[A-Z0-9\-\/]{4,20}$/.test(no)) errors.noStaf = 'No. Matrik diperlukan.';
    if (String(val('nama', 'nama') || '').trim().length < 3) errors.nama = 'Nama diperlukan.';
    const emel = String(val('emel', 'emel') || '');
    if (!emel) errors.emel = 'Emel diperlukan.';
    else if (jenis === 'PELAJAR' && !admin && !TempahanHooks.DOMAIN_PELAJAR.test(emel.split('@')[1] || '')) errors.emel = 'Guna emel UTM (…utm.my).';
    if (Object.keys(errors).length) throw Errors.validation(errors[Object.keys(errors)[0]], errors);
  },

  beforeSave: function (row, info) {
    const cur = info.current;
    const jenis = row.jenis_pemohon || (cur && cur.jenis_pemohon) || 'STAF';
    if (info.mode !== 'update' && !row.jenis_pemohon) row.jenis_pemohon = 'STAF';
    if (row.no_staf !== undefined && row.no_staf !== '') row.no_staf = StafHooks.norm(row.no_staf);
    if (jenis === 'STAF' && row.no_staf !== undefined && row.no_staf !== '') {
      const staf = StafHooks.findByNo(row.no_staf);
      if (staf) {
        row.nama = staf.nama;
        row.emel = staf.emel;
      }
    }
    if (info.mode !== 'update' && row.nama) row.owner_name = row.nama;
    if (info.mode !== 'update') {
      if (!row.tarikh_tamat) row.tarikh_tamat = row.tarikh;
      row.bahasa = info.ctx && info.ctx.lang === 'en' ? 'en' : 'ms'; // bahasa emel kepada pemohon
      return;
    }
    if (row.tarikh_tamat === '' || (row.tarikh !== undefined && row.tarikh_tamat === undefined)) row.tarikh_tamat = row.tarikh || cur.tarikh;
    const changed = ['ruang', 'tarikh', 'tarikh_tamat', 'masa_mula'].some(function (c) { return row[c] !== undefined && row[c] !== cur[c]; });
    if (changed) { row.peringatan_dihantar = ''; row.peringatan_jam_dihantar = ''; row.peringatan_pagi_dihantar = ''; }
  },

  /** Semak semula semasa lulus (vs tempahan DILULUSKAN) dan semasa buka semula (vs tempahan aktif). */
  beforeStatus: function (row, newStatus) {
    if (newStatus === 'MENUNGGU') {
      const c0 = TempahanHooks.findConflict(TempahanHooks.slotOf(row), row.id);
      if (c0) throw Errors.conflict('Tidak boleh dibuka semula: slot ini kini dipegang oleh ' + c0.ref_no + ' (' + c0.masa_mula + '–' + c0.masa_tamat + ').');
      return;
    }
    if (newStatus !== 'DILULUSKAN') return;
    const slot = TempahanHooks.slotOf(row);
    const c = TempahanHooks.findConflict(slot, row.id, ['DILULUSKAN']);
    if (c) throw Errors.conflict('Tidak boleh lulus: bertindih dengan ' + c.ref_no + ' (' + TempahanHooks.fmtDate(c.tarikh > slot.tarikh ? c.tarikh : slot.tarikh) + ', ' + c.masa_mula + '–' + c.masa_tamat + ') yang telah diluluskan.');
  },

  afterCreate: function (row, ctx) {
    if (ctx && ctx.tpBagiPihak) return; /* tempahan bagi pihak: emel kelulusan (jika dipilih) dihantar selepas lulus */
    const en = row.bahasa === 'en';
    TempahanHooks.mail(row.emel, (en ? 'Application received: ' : 'Permohonan diterima: ') + row.ref_no, [
      (en ? 'Dear ' : 'Salam ') + row.nama + ',',
      en ? 'Your booking application has been received and is awaiting approval.' : 'Permohonan tempahan anda telah diterima dan sedang menunggu kelulusan.'
    ].concat(TempahanHooks.details(row), [
      en ? 'To check the status or cancel, use the Reference No. above with your Staff/Matric No.' : 'Untuk menyemak status atau membatalkan, gunakan No. Rujukan di atas bersama No. Staf / No. Matrik anda.'
    ]), row);
  },

  afterStatus: function (row, prev, ctx) {
    if (prev === 'DILULUSKAN' && row.status !== 'SELESAI') TugasanHooks.cancelFor(row, 'Tempahan ' + row.ref_no + ' ' + CrudEngine.statusLabel(CrudEngine.get('tempahan'), row.status).toLowerCase() + '.');
    if (ctx && ctx.tpTanpaEmel) return;
    TempahanHooks.notifyStatus(row, prev);
  },

  /** Tempahan disunting: segerakkan tugasan PIC yang aktif (tarikh / masa / ruang). */
  afterUpdate: function (row) { TugasanHooks.syncFor(row); },

  /** Tempahan dipadam: batalkan tugasan PIC yang aktif. */
  afterRemove: function (row) { TugasanHooks.cancelFor(row, 'Tempahan ' + row.ref_no + ' dipadam.'); },

  /** Notifikasi admin (app + telefon + emel ADMIN_EMAIL) bagi permohonan baharu: cukup untuk membuat keputusan dari telefon. */
  createdMessage: function (row) {
    const jenis = row.jenis_pemohon === 'PELAJAR' ? 'Pelajar' : row.jenis_pemohon === 'LUAR' ? 'Pihak luar' : 'Staf';
    const bm = Object.assign({}, row, { bahasa: 'ms' });
    return {
      message: (row.nama || 'Pemohon') + ' (' + jenis + ') · ' + TempahanHooks.ruangText(row) + ' · ' + TempahanHooks.dateText(row) + ', ' + row.masa_mula + '–' + row.masa_tamat +
        ' · ' + StringUtils.truncate(String(row.tujuan || ''), 80),
      lines: ['Permohonan tempahan baharu menunggu kelulusan:'].concat(TempahanHooks.details(bm), [
        'Pemohon: ' + (row.nama || '-') + ' (' + jenis + (row.no_staf ? ', ' + row.no_staf : '') + ')' + (row.no_telefon ? ' · ' + row.no_telefon : ''),
        row.bilangan_peserta ? 'Bilangan peserta: ' + row.bilangan_peserta : ''
      ]).filter(Boolean)
    };
  },

  toDTO: function (dto, row) {
    const parts = [dto.labels && dto.labels.ruang, TempahanHooks.dateText(row), row.masa_mula && row.masa_mula + '–' + row.masa_tamat];
    dto.subtitle = parts.filter(Boolean).join(' · ');
    dto.statusChangedBy = row.status_changed_by || '';
    return dto;
  },

  /** Tandakan SELESAI tempahan diluluskan yang telah berlalu (tiada emel). Dipanggil harian & butang "Jalankan sekarang". */
  autoSelesai: function () {
    const today = TempahanHooks.today();
    const now = DateUtils.nowIso();
    const patch = {};
    Repo.of('TEMPAHAN').all().forEach(function (r) {
      if (r.state === RECORD_STATE.ACTIVE && r.status === 'DILULUSKAN' && TempahanHooks.endDate(r) < today) {
        patch[r.id] = { status: 'SELESAI', status_changed_at: now, status_changed_by: 'Sistem', updated_at: now };
      }
    });
    const n = Object.keys(patch).length;
    if (n) { Repo.of('TEMPAHAN').updateMany(patch); AppCache.remove('stats:admin'); }
    return n;
  },

  /** Harian: tutup tempahan lepas, batal permohonan luput, hantar peringatan H-1. */
  maintenance: function () {
    const today = TempahanHooks.today();
    const esok = TempahanHooks.addDaysKey(today, 1);
    const now = DateUtils.nowIso();
    const repo = Repo.of('TEMPAHAN');
    const patch = {};
    const expired = [];
    const out = { selesai: 0, luput: 0, peringatan: 0 };
    repo.all().forEach(function (r) {
      if (r.state !== RECORD_STATE.ACTIVE) return;
      if (r.status === 'DILULUSKAN' && TempahanHooks.endDate(r) < today) {
        patch[r.id] = { status: 'SELESAI', status_changed_at: now, status_changed_by: 'Sistem', updated_at: now };
        out.selesai++;
      } else if (r.status === 'MENUNGGU' && r.tarikh < today) {
        patch[r.id] = { status: 'DIBATALKAN', status_note: 'Dibatalkan automatik: permohonan tidak diproses sebelum tarikh tempahan.', status_changed_at: now, status_changed_by: 'Sistem', updated_at: now };
        expired.push(r);
        out.luput++;
      } else if (r.status === 'DILULUSKAN' && r.tarikh === esok && !r.peringatan_dihantar) {
        if (TempahanHooks.sendReminder(r)) { patch[r.id] = { peringatan_dihantar: now }; out.peringatan++; }
      }
    });
    if (Object.keys(patch).length) repo.updateMany(patch);
    expired.forEach(function (r) { TempahanHooks.notifyStatus(Object.assign({}, r, patch[r.id]), 'MENUNGGU'); });
    if (out.selesai || out.luput) AppCache.remove('stats:admin');
    return out;
  },

  // ================================================================== Email (BM / EN ikut bahasa pemohon)

  /** Teks ikut bahasa baris. */
  L: function (row, ms, en) { return row && row.bahasa === 'en' ? en : ms; },

  details: function (row) {
    const L = function (ms, en) { return TempahanHooks.L(row, ms, en); };
    return [
      L('No. rujukan: ', 'Reference No.: ') + row.ref_no,
      L('Ruang: ', 'Room: ') + TempahanHooks.ruangText(row),
      L('Tarikh: ', 'Date: ') + TempahanHooks.dateText(row),
      L('Masa: ', 'Time: ') + row.masa_mula + ' – ' + row.masa_tamat,
      L('Tujuan: ', 'Purpose: ') + StringUtils.truncate(String(row.tujuan || ''), 200)
    ];
  },

  semakPath: function (row) { return '#/semak?ref=' + encodeURIComponent(row.ref_no || ''); },

  mail: function (to, subject, lines, row) {
    if (!to) return false;
    return NotificationService.email(to, subject, lines, { path: TempahanHooks.semakPath(row), lang: row && row.bahasa === 'en' ? 'en' : 'ms' });
  },

  /** Email pemohon (dan PIC ruang bila berkaitan) selepas status berubah. */
  notifyStatus: function (row, prev) {
    const L = function (ms, en) { return TempahanHooks.L(row, ms, en); };
    const salam = L('Salam ', 'Dear ') + (row.nama || '') + ',';
    const note = row.status_note ? String(row.status_note) : '';
    if (row.status === 'DILULUSKAN') {
      TempahanHooks.mail(row.emel, L('Tempahan diluluskan: ', 'Booking approved: ') + row.ref_no, [salam, L('Tempahan anda telah DILULUSKAN.', 'Your booking has been APPROVED.')]
        .concat(TempahanHooks.details(row), note ? [L('Catatan: ', 'Note: ') + note] : [],
          [L('Slip tempahan boleh dicetak melalui butang di bawah. Peringatan akan dihantar sebelum tarikh tempahan.', 'You can print the booking slip using the button below. Reminders will be sent before the booking date.')]), row);
      TempahanHooks.mailPic(row, 'Tempahan diluluskan untuk ruang anda', 'Tempahan berikut telah diluluskan:');
    } else if (row.status === 'DITOLAK') {
      TempahanHooks.mail(row.emel, L('Tempahan ditolak: ', 'Booking not approved: ') + row.ref_no, [salam, L('Harap maaf, tempahan anda TIDAK DILULUSKAN.', 'We regret that your booking was NOT APPROVED.')]
        .concat(TempahanHooks.details(row), [L('Sebab: ', 'Reason: ') + (note || '-')]), row);
    } else if (row.status === 'DIBATALKAN') {
      TempahanHooks.mail(row.emel, L('Tempahan dibatalkan: ', 'Booking cancelled: ') + row.ref_no, [salam, L('Tempahan anda telah DIBATALKAN.', 'Your booking has been CANCELLED.')]
        .concat(TempahanHooks.details(row), note ? [L('Catatan: ', 'Note: ') + note] : []), row);
      if (prev === 'DILULUSKAN') TempahanHooks.mailPic(row, 'Tempahan dibatalkan', 'Tempahan yang telah diluluskan berikut DIBATALKAN:');
    }
  },

  /** PIC ruang ialah staf FKM: email dalam BM. */
  mailPic: function (row, subject, intro) {
    const ruang = TempahanHooks.ruangOf(row);
    if (!ruang || !ruang.emel_pic) return false;
    const bm = Object.assign({}, row, { bahasa: 'ms' });
    return NotificationService.email(ruang.emel_pic, subject + ': ' + ruang.nama, [
      'Salam ' + (ruang.pic || 'PIC') + ',', intro
    ].concat(TempahanHooks.details(bm), ['Pemohon: ' + row.nama + (row.no_telefon ? ' · ' + row.no_telefon : '')]),
    { path: '#/jadual?mode=ruang&ruang=' + encodeURIComponent(ruang.id) + '&tarikh=' + row.tarikh });
  },

  sendReminder: function (row) {
    const L = function (ms, en) { return TempahanHooks.L(row, ms, en); };
    return TempahanHooks.mail(row.emel, L('Peringatan tempahan esok: ', 'Reminder, booking tomorrow: ') + TempahanHooks.ruangText(row), [
      L('Salam ', 'Dear ') + row.nama + ',',
      L('Peringatan: anda mempunyai tempahan ruang yang telah diluluskan bermula esok.', 'Reminder: you have an approved room booking starting tomorrow.')
    ].concat(TempahanHooks.details(row), [L('Jika tidak lagi diperlukan, sila batalkan supaya ruang boleh digunakan oleh orang lain.', 'If it is no longer needed, please cancel it so others can use the room.')]), row);
  },

  /** Peringatan beberapa jam sebelum slot bermula (setiap hari bagi tempahan berbilang hari). */
  sendHourReminder: function (row, today) {
    const L = function (ms, en) { return TempahanHooks.L(row, ms, en); };
    return TempahanHooks.mail(row.emel, L('Peringatan: tempahan hari ini ', 'Reminder: booking today at ') + row.masa_mula + ' · ' + TempahanHooks.ruangText(row), [
      L('Salam ', 'Dear ') + row.nama + ',',
      L('Tempahan anda bermula hari ini (' + TempahanHooks.fmtDate(today) + ') pada ' + row.masa_mula + '.', 'Your booking starts today (' + TempahanHooks.fmtDate(today) + ') at ' + row.masa_mula + '.')
    ].concat(TempahanHooks.details(row)), row);
  },

  /** Setiap jam: peringatan N jam sebelum masa mula (tetapan PERINGATAN_JAM; 0 = tutup). */
  hourly: function () {
    const hours = Number(SettingsService.get('PERINGATAN_JAM')) || 0;
    const out = { peringatanJam: 0, peringatanPagi: TempahanHooks.morningReminders(), peringatanAdmin: TempahanHooks.adminReminders() };
    if (hours <= 0) return out;
    const today = TempahanHooks.today();
    const nowMin = TempahanHooks.toMin(TempahanHooks.nowHM());
    const repo = Repo.of('TEMPAHAN');
    const patch = {};
    repo.all().forEach(function (r) {
      if (r.state !== RECORD_STATE.ACTIVE || r.status !== 'DILULUSKAN') return;
      if (r.tarikh > today || TempahanHooks.endDate(r) < today || r.peringatan_jam_dihantar === today) return;
      const until = TempahanHooks.toMin(r.masa_mula) - nowMin;
      if (until <= 0 || until > hours * 60) return;
      if (TempahanHooks.sendHourReminder(r, today)) { patch[r.id] = { peringatan_jam_dihantar: today }; out.peringatanJam++; }
    });
    if (Object.keys(patch).length) repo.updateMany(patch);
    return out;
  },

  /** Peringatan pagi hari tempahan (tetapan PERINGATAN_PAGI = jam, 0 = tutup) — dihantar pada/selepas jam itu, sekali sehari. */
  morningReminders: function () {
    const jam = Number(SettingsService.get('PERINGATAN_PAGI')) || 0;
    if (jam <= 0) return 0;
    const nowH = Number(TempahanHooks.nowHM().slice(0, 2));
    if (nowH < jam) return 0;
    const today = TempahanHooks.today();
    const nowHm = TempahanHooks.nowHM();
    const repo = Repo.of('TEMPAHAN');
    const patch = {};
    repo.all().forEach(function (r) {
      if (r.state !== RECORD_STATE.ACTIVE || r.status !== 'DILULUSKAN') return;
      if (r.tarikh > today || TempahanHooks.endDate(r) < today || r.peringatan_pagi_dihantar === today) return;
      if (r.masa_mula <= nowHm) return; /* sudah bermula: tiada gunanya peringatan */
      if (TempahanHooks.sendHourReminder(r, today)) patch[r.id] = { peringatan_pagi_dihantar: today, peringatan_jam_dihantar: today };
    });
    const n = Object.keys(patch).length;
    if (n) repo.updateMany(patch);
    return n;
  },

  /**
   * Setiap jam (dalam waktu operasi): ingatkan admin tentang permohonan MENUNGGU yang sudah lama (≥ PERINGATAN_ADMIN_JAM jam)
   * atau yang tarikhnya hari ini / esok. Satu ringkasan (app + telefon + emel ADMIN_EMAIL); setiap tempahan sekali sehari.
   * @return {number} bilangan tempahan dalam ringkasan
   */
  adminReminders: function () {
    const jam = Number(SettingsService.get('PERINGATAN_ADMIN_JAM'));
    if (!(jam > 0)) return 0;
    const w = TempahanHooks.waktu();
    const nowHm = TempahanHooks.nowHM();
    if (nowHm < w.mula || nowHm >= w.tamat) return 0;
    const today = TempahanHooks.today();
    const esok = TempahanHooks.addDaysKey(today, 1);
    const cutoff = new Date(Date.now() - jam * 3600000).toISOString();
    const repo = Repo.of('TEMPAHAN');
    const list = repo.all().filter(function (r) {
      if (r.state !== RECORD_STATE.ACTIVE || r.status !== 'MENUNGGU' || r.peringatan_admin_dihantar === today) return false;
      return r.tarikh <= esok || String(r.created_at) <= cutoff;
    }).sort(function (a, b) { return a.tarikh < b.tarikh ? -1 : a.tarikh > b.tarikh ? 1 : (a.masa_mula < b.masa_mula ? -1 : 1); });
    if (!list.length) return 0;
    const urgent = list.filter(function (r) { return r.tarikh <= esok; }).length;
    const title = list.length + ' tempahan menunggu kelulusan' + (urgent ? ' (' + urgent + ' untuk hari ini/esok)' : '');
    const lines = list.slice(0, 15).map(function (r) {
      return r.ref_no + ' · ' + TempahanHooks.ruangText(r) + ' · ' + TempahanHooks.dateText(r) + ' ' + r.masa_mula + ' · ' + (r.nama || '') + (r.tarikh <= esok ? ' · SEGERA' : '');
    });
    NotificationService.notifyAdmins(NOTIF_TYPE.RECORD_CREATED, title, lines.slice(0, 3).join(' | ') + (list.length > 3 ? ' …' : ''), '', '#/admin/tempahan?status=MENUNGGU');
    const adminEmail = SettingsService.get('ADMIN_EMAIL');
    if (adminEmail) {
      NotificationService.email(adminEmail, title, ['Permohonan berikut masih menunggu tindakan:'].concat(lines, list.length > 15 ? ['… dan ' + (list.length - 15) + ' lagi.'] : [],
        ['Permohonan yang tidak diproses sebelum tarikhnya akan dibatalkan secara automatik.']), { path: '#/admin/tempahan?status=MENUNGGU' });
    }
    const patch = {};
    list.forEach(function (r) { patch[r.id] = { peringatan_admin_dihantar: today }; });
    repo.updateMany(patch);
    return list.length;
  },

  toMin: function (hm) { const p = String(hm || '0:0').split(':'); return Number(p[0]) * 60 + Number(p[1]); },

  // ================================================================== Laluan awam (kalendar, semak, batal)

  findForApplicant: function (refNo, noStaf) {
    const ref = String(refNo || '').trim().toUpperCase();
    const n = StafHooks.norm(noStaf);
    const row = ref && n ? Repo.of('TEMPAHAN').findOne(function (r) {
      return r.state === RECORD_STATE.ACTIVE && String(r.ref_no).toUpperCase() === ref && StafHooks.norm(r.no_staf) === n;
    }) : null;
    if (!row) throw Errors.notFound('Tempahan dengan No. Rujukan dan No. Staf ini');
    return row;
  },

  maskEmail: function (e) {
    const s = String(e || '');
    const at = s.indexOf('@');
    if (at < 1) return '';
    return s.charAt(0) + '***' + s.slice(at);
  },

  canCancel: function (row) {
    return TempahanHooks.HOLDING.indexOf(row.status) >= 0 && TempahanHooks.endDate(row) >= TempahanHooks.today();
  },

  /** Paparan untuk pemohon (sudah disahkan dengan No. Rujukan + No. Staf). */
  publicView: function (row) {
    const def = CrudEngine.get('tempahan');
    const ruang = TempahanHooks.ruangOf(row);
    return {
      refNo: row.ref_no, nama: row.nama, emel: TempahanHooks.maskEmail(row.emel),
      ruang: ruang ? ruang.nama : '', ruangBlok: ruang ? ruang.blok : '',
      tarikh: row.tarikh, tarikhTamat: TempahanHooks.endDate(row), masaMula: row.masa_mula, masaTamat: row.masa_tamat,
      bilanganPeserta: parseInt(row.bilangan_peserta, 10) || 0, tujuan: row.tujuan,
      status: row.status, statusLabel: CrudEngine.statusLabel(def, row.status), statusNote: row.status_note || '',
      createdAt: row.created_at, bolehBatal: TempahanHooks.canCancel(row),
      ruangAras: ruang ? ruang.aras : '', ruangKod: ruang ? ruang.kod_ruang : '', ruangPic: ruang ? ruang.pic : '',
      noStaf: row.no_staf, noTelefon: row.no_telefon, bahasa: row.bahasa === 'en' ? 'en' : 'ms',
      statusOleh: row.status_changed_by || '', statusPada: row.status_changed_at || ''
    };
  },

  refRule: function () { return { type: 'string', required: true, max: 30, label: 'No. rujukan' }; },
  stafRule: function () { return { type: 'string', required: true, max: 20, label: 'No. Staf' }; },

  jadual: function (payload, ctx) {
    SecurityService.rateLimit('tempahan.jadual.global', 'all');
    const p = Validator.validate(payload, {
      dari: { type: 'date', label: 'Dari' },
      hingga: { type: 'date', label: 'Hingga' },
      ruang: { type: 'string', max: 40, pattern: /^[A-Z]{1,3}-[0-9A-F]{16}$/, label: 'Ruang' },
      papan: { type: 'boolean', default: false }
    });
    const showPurpose = p.papan && SettingsService.get('PAPAN_TUNJUK_TUJUAN');
    const today = TempahanHooks.today();
    const dari = p.dari || today;
    const hingga = p.hingga || dari;
    if (hingga < dari) throw Errors.validation('Julat tarikh tidak sah.');
    if (TempahanHooks.daysBetween(dari, hingga) >= TempahanHooks.MAX_JULAT_JADUAL) throw Errors.validation('Julat maksimum ' + TempahanHooks.MAX_JULAT_JADUAL + ' hari.');
    const admin = CrudEngine.isAdmin(ctx);
    /* Dicache (kalendar & papan dibuka ramai serentak); dibatalkan serta-merta bila TEMPAHAN/RUANG ditulis */
    const w = TempahanHooks.waktu();
    const out = AppCache.rememberFor(['TEMPAHAN', 'RUANG', 'SETTINGS'], 'jadual:' + [dari, hingga, p.ruang || '', admin ? 1 : 0, showPurpose ? 1 : 0].join('|'), 300, function () {
      const ruangDef = CrudEngine.get('ruang');
      const ruang = Repo.of('RUANG').all()
        .filter(function (r) { return CrudEngine.isSelectable(ruangDef, r); })
        .map(function (r) {
          return { id: r.id, nama: r.nama, blok: r.blok, jenis: r.jenis, aras: r.aras, kodRuang: r.kod_ruang, kapasiti: parseInt(r.kapasiti, 10) || 0, pic: r.pic };
        })
        .sort(function (a, b) { return (a.blok + ' ' + a.nama).localeCompare(b.blok + ' ' + b.nama, 'ms', { numeric: true }); });
      const tempahan = Repo.of('TEMPAHAN').all().filter(function (r) {
        return r.state === RECORD_STATE.ACTIVE && TempahanHooks.SHOWN.indexOf(r.status) >= 0 && (!p.ruang || r.ruang === p.ruang) &&
          r.tarikh <= hingga && TempahanHooks.endDate(r) >= dari;
      }).map(function (r) {
        const o = { ruang: r.ruang, tarikh: r.tarikh, tarikhTamat: TempahanHooks.endDate(r), masaMula: r.masa_mula, masaTamat: r.masa_tamat, status: r.status };
        if (admin) Object.assign(o, { id: r.id, refNo: r.ref_no, nama: r.nama, tujuan: r.tujuan, bilanganPeserta: parseInt(r.bilangan_peserta, 10) || 0 });
        else if (showPurpose && r.status !== 'MENUNGGU') o.tujuan = r.tujuan; // Papan Paparan: tujuan sahaja, tiada nama
        return o;
      });
      return {
        dari: dari, hingga: hingga, maxHari: TempahanHooks.MAX_HARI, admin: admin, ruang: ruang, tempahan: tempahan,
        jam: { mula: w.mula, tamat: w.tamat }, hariOperasi: w.hari,
        tutup: w.tutup.filter(function (x) { return x.t >= dari && x.t <= hingga; })
      };
    });
    return Object.assign({}, out, { hariIni: today, sekarang: TempahanHooks.nowHM() });
  },

  semak: function (payload) {
    const p = Validator.validate(payload, { refNo: TempahanHooks.refRule(), noStaf: TempahanHooks.stafRule() });
    SecurityService.rateLimit('tempahan.semak.global', 'all');
    SecurityService.rateLimit('tempahan.semak', p.refNo.toUpperCase());
    return TempahanHooks.publicView(TempahanHooks.findForApplicant(p.refNo, p.noStaf));
  },

  batal: function (payload) {
    const p = Validator.validate(payload, {
      refNo: TempahanHooks.refRule(), noStaf: TempahanHooks.stafRule(),
      emel: { type: 'email', required: true, label: 'Emel' },
      sebab: { type: 'text', max: 300, label: 'Sebab' }
    });
    SecurityService.rateLimit('tempahan.semak.global', 'all');
    SecurityService.rateLimit('tempahan.batal', p.refNo.toUpperCase());
    const row = TempahanHooks.findForApplicant(p.refNo, p.noStaf);
    if (StringUtils.normalizeEmail(row.emel) !== p.emel) throw Errors.notFound('Tempahan dengan No. Rujukan dan No. Staf ini');
    if (!TempahanHooks.canCancel(row)) throw Errors.conflict('Tempahan ini tidak boleh dibatalkan lagi.');
    const prev = row.status;
    const now = DateUtils.nowIso();
    const updated = Repo.of('TEMPAHAN').update(row.id, {
      status: 'DIBATALKAN', status_note: 'Dibatalkan oleh pemohon' + (p.sebab ? ': ' + p.sebab : '.'),
      status_changed_at: now, status_changed_by: 'Pemohon', updated_at: now
    });
    AppCache.remove('stats:admin');
    if (prev === 'DILULUSKAN') TugasanHooks.cancelFor(updated, 'Tempahan ' + row.ref_no + ' dibatalkan oleh pemohon.');
    AuditService.log({ role: ROLES.PUBLIC }, AUDIT_ACTIONS.RECORD_STATUS, 'TEMPAHAN', row.id, prev + ' → DIBATALKAN · oleh pemohon');
    NotificationService.notifyAdmins(NOTIF_TYPE.RECORD_STATUS, 'Tempahan dibatalkan: ' + row.ref_no,
      row.nama + ' membatalkan tempahan ' + TempahanHooks.ruangText(row) + ' (' + TempahanHooks.dateText(row) + ').', row.id, '#/admin/tempahan/' + row.id);
    TempahanHooks.notifyStatus(updated, prev);
    return TempahanHooks.publicView(updated);
  },

  // ================================================================== Ciri tambahan (daripada sistem lama)

  /** Borang awam: nama & emel (bertopeng) staf daripada No. Staf — untuk paparan isi-automatik. */
  stafInfo: function (payload) {
    const p = Validator.validate(payload, { noStaf: TempahanHooks.stafRule() });
    SecurityService.rateLimit('tempahan.staf.global', 'all');
    SecurityService.rateLimit('tempahan.staf', StafHooks.norm(p.noStaf));
    const s = StafHooks.findByNo(p.noStaf);
    if (!s || s.aktif === false) throw Errors.notFound('No. Staf');
    return { nama: s.nama, emel: TempahanHooks.maskEmail(s.emel) };
  },

  /**
   * "Cari slot untuk saya": ruang yang muat (kapasiti) dan kosong selama `tempoh` minit, setiap hari operasi dalam julat.
   * Ruang disusun ikut kapasiti paling hampir (elak dewan besar untuk kumpulan kecil).
   */
  cariSlot: function (payload) {
    SecurityService.rateLimit('tempahan.jadual.global', 'all');
    const p = Validator.validate(payload, {
      peserta: { type: 'int', min: 1, max: 2000, label: 'Bilangan peserta' },
      tempoh: { type: 'int', min: 30, max: 720, required: true, label: 'Tempoh' },
      masa: { type: 'string', max: 10, pattern: /^(any|pagi|petang)$/, label: 'Masa' },
      dari: { type: 'date', required: true, label: 'Dari' },
      hingga: { type: 'date', label: 'Hingga' }
    });
    const today = TempahanHooks.today();
    const dari = p.dari < today ? today : p.dari;
    const hingga = p.hingga && p.hingga >= dari ? p.hingga : dari;
    if (TempahanHooks.daysBetween(dari, hingga) >= TempahanHooks.MAX_HARI) throw Errors.validation('Julat carian maksimum ' + TempahanHooks.MAX_HARI + ' hari.');
    const w = TempahanHooks.waktu();
    const toMin = TempahanHooks.toMin;
    const hm = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
    let win = [toMin(w.mula), toMin(w.tamat)];
    if (p.masa === 'pagi') win = [win[0], Math.min(win[1], 13 * 60)];
    if (p.masa === 'petang') win = [Math.max(win[0], 13 * 60), win[1]];
    const ruangDef = CrudEngine.get('ruang');
    const rooms = Repo.of('RUANG').all().filter(function (r) {
      const k = parseInt(r.kapasiti, 10) || 0;
      return CrudEngine.isSelectable(ruangDef, r) && (!p.peserta || !k || k >= p.peserta);
    }).sort(function (a, b) {
      return ((parseInt(a.kapasiti, 10) || 99999) - (parseInt(b.kapasiti, 10) || 99999)) || String(a.nama).localeCompare(String(b.nama), 'ms', { numeric: true });
    });
    const booked = {};
    Repo.of('TEMPAHAN').all().forEach(function (r) {
      if (r.state !== RECORD_STATE.ACTIVE || TempahanHooks.HOLDING.indexOf(r.status) < 0) return;
      if (r.tarikh > hingga || TempahanHooks.endDate(r) < dari) return;
      (booked[r.ruang] = booked[r.ruang] || []).push(r);
    });
    const nowMin = toMin(TempahanHooks.nowHM());
    const hari = [];
    for (let d = dari; d <= hingga; d = TempahanHooks.addDaysKey(d, 1)) {
      const closed = TempahanHooks.closedDay(d, d, w, false);
      if (closed) { hari.push({ tarikh: d, tutup: closed.cuti ? closed.sebab : 'Bukan hari operasi', ruang: [] }); continue; }
      let start = win[0];
      if (d === today) start = Math.max(start, Math.ceil((nowMin + 1) / 30) * 30);
      const found = [];
      rooms.forEach(function (r) {
        if (start + p.tempoh > win[1]) return;
        const busy = (booked[r.id] || []).filter(function (b) { return b.tarikh <= d && TempahanHooks.endDate(b) >= d; })
          .map(function (b) { return [toMin(b.masa_mula), toMin(b.masa_tamat)]; }).sort(function (a, b) { return a[0] - b[0]; });
        const gaps = [];
        let cur = start;
        busy.forEach(function (x) {
          if (x[0] - cur >= p.tempoh) gaps.push([cur, x[0]]);
          cur = Math.max(cur, x[1]);
        });
        if (win[1] - cur >= p.tempoh) gaps.push([cur, win[1]]);
        const okGaps = gaps.filter(function (g) { return g[1] > g[0] && g[0] >= start; });
        if (!okGaps.length) return;
        found.push({
          ruang: r.id, nama: r.nama, blok: r.blok, aras: r.aras, jenis: r.jenis, kapasiti: parseInt(r.kapasiti, 10) || 0,
          mula: hm(okGaps[0][0]), tamat: hm(okGaps[0][0] + p.tempoh),
          kosong: okGaps.map(function (g) { return { mula: hm(g[0]), tamat: hm(g[1]) }; })
        });
      });
      hari.push({ tarikh: d, jumlah: found.length, ruang: found.slice(0, 12) });
    }
    return { dari: dari, hingga: hingga, tempoh: p.tempoh, jam: { mula: w.mula, tamat: w.tamat }, hari: hari };
  },

  /** "Tempahan saya": semua tempahan pemohon — No. Staf/Matrik DAN emel mesti sepadan (tiada kebocoran: tiada padanan = senarai kosong). */
  saya: function (payload) {
    const p = Validator.validate(payload, { noStaf: TempahanHooks.stafRule(), emel: { type: 'email', required: true, label: 'Emel' } });
    SecurityService.rateLimit('tempahan.semak.global', 'all');
    SecurityService.rateLimit('tempahan.semak', 'saya:' + StafHooks.norm(p.noStaf));
    const n = StafHooks.norm(p.noStaf);
    const rows = Repo.of('TEMPAHAN').all().filter(function (r) {
      return r.state === RECORD_STATE.ACTIVE && StafHooks.norm(r.no_staf) === n && StringUtils.normalizeEmail(r.emel) === p.emel;
    }).sort(function (a, b) { return a.tarikh < b.tarikh ? 1 : a.tarikh > b.tarikh ? -1 : (a.created_at < b.created_at ? 1 : -1); });
    return { items: rows.slice(0, 50).map(TempahanHooks.publicView), jumlah: rows.length };
  },

  jamOf: function (r) {
    const mins = Math.max(0, TempahanHooks.toMin(r.masa_tamat) - TempahanHooks.toMin(r.masa_mula));
    return (mins / 60) * (TempahanHooks.daysBetween(r.tarikh, TempahanHooks.endDate(r)) + 1);
  },

  /** Papan pemuka analitik (admin). Metrik penggunaan tidak mengira tempahan DITOLAK / DIBATALKAN. */
  analitik: function (payload) {
    const p = Validator.validate(payload, { bulan: { type: 'string', max: 7, pattern: /^\d{4}-\d{2}$/, label: 'Bulan' } });
    const def = CrudEngine.get('tempahan');
    const all = Repo.of('TEMPAHAN').all().filter(function (r) { return r.state === RECORD_STATE.ACTIVE && r.tarikh; });
    const USED = function (r) { return r.status !== 'DITOLAK' && r.status !== 'DIBATALKAN'; };
    const sel = all.filter(function (r) { return !p.bulan || String(r.tarikh).slice(0, 7) === p.bulan; });
    const by = function (list, keyFn) {
      const m = {};
      list.forEach(function (r) { const k = keyFn(r); if (k) m[k] = (m[k] || 0) + 1; });
      return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; }).sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label); });
    };
    const count = function (st) { return sel.filter(function (r) { return r.status === st; }).length; };
    const used = sel.filter(USED);
    const jam = used.reduce(function (a, r) { return a + TempahanHooks.jamOf(r); }, 0);
    const ruangMap = {};
    Repo.of('RUANG').all().forEach(function (r) { ruangMap[r.id] = r; });
    /* Trend 6 bulan berakhir pada bulan dipilih (atau bulan semasa) */
    const end = p.bulan || TempahanHooks.today().slice(0, 7);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(end + '-01T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    return {
      tapisan: p.bulan || '',
      bulan: Array.from(new Set(all.map(function (r) { return String(r.tarikh).slice(0, 7); }))).sort().reverse(),
      kpi: {
        jumlah: sel.length, menunggu: count('MENUNGGU'), diluluskan: count('DILULUSKAN'), ditolak: count('DITOLAK'),
        dibatalkan: count('DIBATALKAN'), selesai: count('SELESAI'),
        jam: Math.round(jam * 10) / 10, purataJam: used.length ? Math.round((jam / used.length) * 10) / 10 : 0
      },
      status: def.statuses.map(function (s) { return { value: s.value, label: s.label, tone: s.tone, count: count(s.value) }; }),
      trend: months.map(function (m) { return { label: m, value: all.filter(function (r) { return USED(r) && String(r.tarikh).slice(0, 7) === m; }).length }; }),
      ruang: by(used, function (r) { return ruangMap[r.ruang] ? TempahanHooks.ruangText(r) : ''; }).slice(0, 8),
      blok: by(used, function (r) { return ruangMap[r.ruang] ? ruangMap[r.ruang].blok || '-' : ''; }),
      pemohon: by(used, function (r) { return r.jenis_pemohon === 'PELAJAR' ? 'Pelajar' : r.jenis_pemohon === 'LUAR' ? 'Pihak luar' : 'Staf'; })
    };
  },

  /** Admin: tempah bagi pihak pemohon (staf / pelajar / pihak luar) → terus DILULUSKAN. Hari bukan operasi dibenarkan; cuti & waktu operasi tetap disemak. */
  bagiPihak: function (payload, ctx) {
    const body = Object.assign({}, payload || {}, { module: 'tempahan' });
    const hantarEmel = body.hantarEmel !== false;
    delete body.hantarEmel;
    const c = Object.assign({}, ctx, { tpBagiPihak: true, tpTanpaEmel: !hantarEmel });
    const dto = CrudEngine.create(c, body);
    const done = CrudEngine.setStatus(c, { module: 'tempahan', id: dto.id, status: 'DILULUSKAN', note: 'Ditempah oleh pentadbir bagi pihak pemohon.' });
    const out = { id: dto.id, refNo: dto.refNo, status: done.status };
    if (payload && payload.pembantu) {
      const tg = TugasanHooks.assign(ctx, Repo.of('TEMPAHAN').findById(dto.id), { pembantu: payload.pembantu });
      out.tugasan = { id: tg.id, refNo: tg.refNo, waUrl: tg.waUrl || '', pic: tg.labels.pembantu || '' };
    }
    return out;
  },

  // ================================================================== Kelulusan & PIC (pembantu operasi)

  /** Baris tempahan untuk tindakan admin (NOT_FOUND seragam). */
  adminRow: function (id) {
    const row = Repo.of('TEMPAHAN').findById(String(id || ''));
    if (!row || row.state !== RECORD_STATE.ACTIVE) throw Errors.notFound('Tempahan');
    return row;
  },

  picRule: function () { return { type: 'string', max: 40, pattern: /^PO-[0-9A-F]{16}$/, label: 'PIC' }; },

  /** Admin: lulus + (pilihan) tugaskan PIC dalam satu tindakan — direka untuk telefon. */
  lulus: function (payload, ctx) {
    const p = Validator.validate(payload, {
      id: { type: 'string', required: true, max: 40, pattern: /^TP-[0-9A-F]{16}$/, label: 'Tempahan' },
      note: { type: 'text', max: 500, label: 'Catatan' },
      pembantu: TempahanHooks.picRule(),
      arahan: { type: 'text', max: 500, label: 'Arahan' },
      hantarEmel: { type: 'boolean', default: true }
    });
    const row = TempahanHooks.adminRow(p.id);
    /* Semak PIC dahulu supaya tempahan tidak diluluskan dengan PIC yang tidak sah */
    if (p.pembantu) {
      const pic = Repo.of('PEMBANTU').findById(p.pembantu);
      if (!pic || !CrudEngine.isSelectable(CrudEngine.get('pembantu'), pic)) throw Errors.validation('Pilih pembantu operasi yang aktif.', { pembantu: 'Tidak sah.' });
    }
    const dto = row.status === 'DILULUSKAN' ? CrudEngine.toDTO(CrudEngine.get('tempahan'), row, ctx)
      : CrudEngine.setStatus(ctx, { module: 'tempahan', id: row.id, status: 'DILULUSKAN', note: p.note || '' });
    const out = { id: dto.id, refNo: dto.refNo, status: dto.status, tugasan: null };
    if (p.pembantu) out.tugasan = TugasanHooks.assign(ctx, Repo.of('TEMPAHAN').findById(row.id), { pembantu: p.pembantu, arahan: p.arahan, hantarEmel: p.hantarEmel });
    return out;
  },

  /** Admin: tugaskan / tukar PIC bagi tempahan yang telah diluluskan. */
  tugaskan: function (payload, ctx) {
    const p = Validator.validate(payload, {
      id: { type: 'string', required: true, max: 40, pattern: /^TP-[0-9A-F]{16}$/, label: 'Tempahan' },
      pembantu: Object.assign(TempahanHooks.picRule(), { required: true }),
      jenis: { type: 'enum', values: Object.keys(TugasanHooks.JENIS), default: 'BUKA', label: 'Jenis' },
      arahan: { type: 'text', max: 500, label: 'Arahan' },
      hantarEmel: { type: 'boolean', default: true }
    });
    const row = TempahanHooks.adminRow(p.id);
    if (row.status !== 'DILULUSKAN') throw Errors.conflict('PIC hanya boleh ditugaskan bagi tempahan yang telah diluluskan.');
    if (TempahanHooks.endDate(row) < TempahanHooks.today()) throw Errors.conflict('Tarikh tempahan telah berlalu.');
    return TugasanHooks.assign(ctx, row, p);
  },

  /** Admin: tugasan bagi tempahan + cadangan PIC (pembantu ruang) + senarai pembantu aktif. */
  tugasanList: function (payload, ctx) {
    const p = Validator.validate(payload, { id: { type: 'string', required: true, max: 40, pattern: /^TP-[0-9A-F]{16}$/, label: 'Tempahan' } });
    const row = TempahanHooks.adminRow(p.id);
    const ruang = TempahanHooks.ruangOf(row);
    const pilihan = CrudEngine.refOptions({ ref: 'pembantu' });
    const cadangan = ruang && ruang.pembantu && pilihan.some(function (o) { return o.value === ruang.pembantu; }) ? ruang.pembantu : '';
    return { items: TugasanHooks.forTempahan(ctx, row.id), cadangan: cadangan, pembantu: pilihan, status: row.status, bolehTugas: row.status === 'DILULUSKAN' && TempahanHooks.endDate(row) >= TempahanHooks.today() };
  },

  selesaiKini: function () { return { selesai: TempahanHooks.autoSelesai() }; },

  tetapan: function () {
    const w = TempahanHooks.waktu();
    const g = function (k) { return SettingsService.get(k); };
    return {
      waktuMula: w.mula, waktuTamat: w.tamat, hari: w.hari, tutup: w.tutup.slice().sort(function (a, b) { return a.t < b.t ? -1 : 1; }),
      pelajar: !!g('PELAJAR_DIBENARKAN'), peringatanJam: g('PERINGATAN_JAM'), peringatanPagi: g('PERINGATAN_PAGI'), peringatanAdmin: g('PERINGATAN_ADMIN_JAM'),
      emelAdmin: g('ADMIN_EMAIL') || '', emelAktif: !!g('NOTIFY_EMAIL_ENABLED'), papanTujuan: !!g('PAPAN_TUNJUK_TUJUAN')
    };
  },

  tetapanSimpan: function (payload, ctx) {
    const p = payload || {};
    const ch = {};
    if (p.waktuMula !== undefined) ch.WAKTU_MULA = String(p.waktuMula);
    if (p.waktuTamat !== undefined) ch.WAKTU_TAMAT = String(p.waktuTamat);
    const mula = ch.WAKTU_MULA || SettingsService.get('WAKTU_MULA');
    const tamat = ch.WAKTU_TAMAT || SettingsService.get('WAKTU_TAMAT');
    if ((ch.WAKTU_MULA || ch.WAKTU_TAMAT) && !(mula < tamat)) throw Errors.validation('Waktu tamat mesti selepas waktu mula.', { waktuTamat: 'Mesti selepas waktu mula.' });
    if (p.hari !== undefined) {
      const hari = (Array.isArray(p.hari) ? p.hari : []).map(Number).filter(function (d, i, a) { return d >= 0 && d <= 6 && Math.floor(d) === d && a.indexOf(d) === i; }).sort();
      if (!hari.length) throw Errors.validation('Pilih sekurang-kurangnya satu hari operasi.', { hari: 'Wajib.' });
      ch.HARI_OPERASI = hari.join(',');
    }
    if (p.tutup !== undefined) {
      const seen = {};
      const list = (Array.isArray(p.tutup) ? p.tutup : []).map(function (x) {
        return { t: String(x && x.t || ''), n: StringUtils.truncate(StringUtils.singleLine(StringUtils.stripTags(String(x && x.n || ''))), 80) };
      }).filter(function (x) { if (seen[x.t]) return false; seen[x.t] = true; return true; }).sort(function (a, b) { return a.t < b.t ? -1 : 1; });
      ch.TARIKH_TUTUP = JSON.stringify(list);
    }
    if (p.pelajar !== undefined) ch.PELAJAR_DIBENARKAN = !!p.pelajar;
    if (p.peringatanJam !== undefined) ch.PERINGATAN_JAM = p.peringatanJam;
    if (p.peringatanPagi !== undefined) ch.PERINGATAN_PAGI = p.peringatanPagi;
    if (p.peringatanAdmin !== undefined) ch.PERINGATAN_ADMIN_JAM = p.peringatanAdmin;
    if (p.emelAdmin !== undefined) ch.ADMIN_EMAIL = String(p.emelAdmin).split(',').map(function (e) { return e.trim(); }).filter(Boolean).join(', ');
    if (p.emelAktif !== undefined) ch.NOTIFY_EMAIL_ENABLED = !!p.emelAktif;
    if (p.papanTujuan !== undefined) ch.PAPAN_TUNJUK_TUJUAN = !!p.papanTujuan;
    SettingsService.update(ctx, ch);
    return TempahanHooks.tetapan();
  },

  routes: {
    'tempahan.staf': { role: 'PUBLIC', fn: function (payload) { return TempahanHooks.stafInfo(payload); } },
    'tempahan.cariSlot': { role: 'PUBLIC', fn: function (payload) { return TempahanHooks.cariSlot(payload); } },
    'tempahan.saya': { role: 'PUBLIC', fn: function (payload) { return TempahanHooks.saya(payload); } },
    'tempahan.analitik': { role: 'ADMIN', fn: function (payload) { return TempahanHooks.analitik(payload); } },
    'tempahan.bagiPihak': { role: 'ADMIN', fn: function (payload, ctx) { return TempahanHooks.bagiPihak(payload, ctx); } },
    'tempahan.selesaiKini': { role: 'ADMIN', fn: function () { return TempahanHooks.selesaiKini(); } },
    'tempahan.lulus': { role: 'ADMIN', fn: function (payload, ctx) { return TempahanHooks.lulus(payload, ctx); } },
    'tempahan.tugaskan': { role: 'ADMIN', fn: function (payload, ctx) { return TempahanHooks.tugaskan(payload, ctx); } },
    'tempahan.tugasan': { role: 'ADMIN', fn: function (payload, ctx) { return TempahanHooks.tugasanList(payload, ctx); } },
    'tempahan.tetapan': { role: 'ADMIN', fn: function () { return TempahanHooks.tetapan(); } },
    'tempahan.tetapanSimpan': { role: 'ADMIN', fn: function (payload, ctx) { return TempahanHooks.tetapanSimpan(payload, ctx); } },
    'tempahan.jadual': { role: 'PUBLIC', fn: function (payload, ctx) { return TempahanHooks.jadual(payload, ctx); } },
    'tempahan.semak': { role: 'PUBLIC', fn: function (payload) { return TempahanHooks.semak(payload); } },
    'tempahan.batal': { role: 'PUBLIC', fn: function (payload) { return TempahanHooks.batal(payload); } }
  }
};
