/**
 * @file TempahanHooks.gs
 * Peraturan domain tempahan ruang FKM.
 *
 * Aliran: pemohon (staf, tanpa akaun) isi borang awam → MENUNGGU → admin DILULUSKAN / DITOLAK
 *         → SELESAI (automatik selepas tarikh tamat). Pemohon boleh DIBATALKAN sendiri melalui "Semak tempahan".
 * Peraturan:
 *   - No. Staf mesti wujud & aktif dalam modul Staf (nama & emel diambil dari situ — tidak boleh dipalsukan).
 *   - Tiada pertindihan masa pada ruang yang sama dengan tempahan MENUNGGU/DILULUSKAN (disemak semula semasa lulus).
 *   - Masa dalam waktu operasi, mula < tamat; tarikh tidak lepas (kecuali admin); maksimum 14 hari berturut.
 *   - Bilangan peserta ≤ kapasiti ruang.
 * Tempahan berbilang hari = slot masa yang SAMA setiap hari dari `tarikh` hingga `tarikhTamat`.
 */
const TempahanHooks = {
  /** Status yang "memegang" slot (menghalang tempahan lain). */
  HOLDING: ['MENUNGGU', 'DILULUSKAN'],
  /** Status yang dipaparkan dalam kalendar. */
  SHOWN: ['MENUNGGU', 'DILULUSKAN', 'SELESAI'],
  JAM_MULA: '07:00',
  JAM_TAMAT: '23:00',
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

    if (data.noStaf !== undefined) {
      const staf = StafHooks.findByNo(data.noStaf);
      if (!staf || staf.aktif === false) {
        throw Errors.validation('No. Staf tidak dijumpai dalam senarai staf FKM. Sila semak semula atau hubungi pentadbir.', { noStaf: 'No. Staf tidak dijumpai.' });
      }
    }

    const slot = {
      ruang: has('ruang') ? data.ruang : (cur ? cur.ruang : ''),
      tarikh: has('tarikh') ? data.tarikh : (cur ? cur.tarikh : ''),
      masaMula: has('masaMula') ? data.masaMula : (cur ? cur.masa_mula : ''),
      masaTamat: has('masaTamat') ? data.masaTamat : (cur ? cur.masa_tamat : '')
    };
    // Tarikh tamat kosong → sehari sahaja (sepadan dengan beforeSave)
    slot.tarikhTamat = has('tarikhTamat') ? data.tarikhTamat : (has('tarikh') || !cur ? slot.tarikh : TempahanHooks.endDate(cur));
    if (!slot.tarikh || !slot.masaMula || !slot.masaTamat || !slot.ruang) return; // medan wajib disemak oleh enjin

    if (slot.masaMula < TempahanHooks.JAM_MULA || slot.masaTamat > TempahanHooks.JAM_TAMAT) {
      throw Errors.validation('Masa tempahan mesti antara ' + TempahanHooks.JAM_MULA + ' dan ' + TempahanHooks.JAM_TAMAT + '.',
        slot.masaMula < TempahanHooks.JAM_MULA ? { masaMula: 'Paling awal ' + TempahanHooks.JAM_MULA + '.' } : { masaTamat: 'Paling lewat ' + TempahanHooks.JAM_TAMAT + '.' });
    }
    if (slot.masaTamat <= slot.masaMula) throw Errors.validation('Masa tamat mesti selepas masa mula.', { masaTamat: 'Mesti selepas masa mula.' });
    if (slot.tarikhTamat < slot.tarikh) throw Errors.validation('Tarikh tamat tidak boleh sebelum tarikh mula.', { tarikhTamat: 'Sebelum tarikh mula.' });
    if (TempahanHooks.daysBetween(slot.tarikh, slot.tarikhTamat) >= TempahanHooks.MAX_HARI) {
      throw Errors.validation('Tempahan maksimum ' + TempahanHooks.MAX_HARI + ' hari berturut-turut.', { tarikhTamat: 'Maksimum ' + TempahanHooks.MAX_HARI + ' hari.' });
    }

    const slotChanged = !cur || ['ruang', 'tarikh', 'tarikhTamat', 'masaMula', 'masaTamat'].some(function (k) {
      return slot[k] !== TempahanHooks.slotOf(cur)[k];
    });

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

  beforeSave: function (row, info) {
    if (row.no_staf !== undefined && row.no_staf !== '') {
      const staf = StafHooks.findByNo(row.no_staf);
      row.no_staf = StafHooks.norm(row.no_staf);
      if (staf) {
        row.nama = staf.nama;
        row.emel = staf.emel;
        if (info.mode !== 'update') row.owner_name = staf.nama;
      }
    }
    if (info.mode !== 'update') {
      if (!row.tarikh_tamat) row.tarikh_tamat = row.tarikh;
      row.bahasa = info.ctx && info.ctx.lang === 'en' ? 'en' : 'ms'; // bahasa emel kepada pemohon
      return;
    }
    const cur = info.current;
    if (row.tarikh_tamat === '' || (row.tarikh !== undefined && row.tarikh_tamat === undefined)) row.tarikh_tamat = row.tarikh || cur.tarikh;
    const changed = ['ruang', 'tarikh', 'tarikh_tamat', 'masa_mula'].some(function (c) { return row[c] !== undefined && row[c] !== cur[c]; });
    if (changed) row.peringatan_dihantar = '';
  },

  /** Semak semula semasa lulus: tidak boleh bertindih dengan tempahan lain yang SUDAH diluluskan. */
  beforeStatus: function (row, newStatus) {
    if (newStatus !== 'DILULUSKAN') return;
    const slot = TempahanHooks.slotOf(row);
    const c = TempahanHooks.findConflict(slot, row.id, ['DILULUSKAN']);
    if (c) throw Errors.conflict('Tidak boleh lulus: bertindih dengan ' + c.ref_no + ' (' + TempahanHooks.fmtDate(c.tarikh > slot.tarikh ? c.tarikh : slot.tarikh) + ', ' + c.masa_mula + '–' + c.masa_tamat + ') yang telah diluluskan.');
  },

  afterCreate: function (row) {
    const en = row.bahasa === 'en';
    TempahanHooks.mail(row.emel, (en ? 'Application received: ' : 'Permohonan diterima: ') + row.ref_no, [
      (en ? 'Dear ' : 'Salam ') + row.nama + ',',
      en ? 'Your booking application has been received and is awaiting approval.' : 'Permohonan tempahan anda telah diterima dan sedang menunggu kelulusan.'
    ].concat(TempahanHooks.details(row), [
      en ? 'To check the status or cancel, use the Reference No. above with your Staff No.' : 'Untuk menyemak status atau membatalkan, gunakan No. Rujukan di atas bersama No. Staf anda.'
    ]), row);
  },

  afterStatus: function (row, prev) { TempahanHooks.notifyStatus(row, prev); },

  toDTO: function (dto, row) {
    const parts = [dto.labels && dto.labels.ruang, TempahanHooks.dateText(row), row.masa_mula && row.masa_mula + '–' + row.masa_tamat];
    dto.subtitle = parts.filter(Boolean).join(' · ');
    dto.statusChangedBy = row.status_changed_by || '';
    return dto;
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
    const out = { peringatanJam: 0 };
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
      dari: dari, hingga: hingga, hariIni: today, jam: { mula: TempahanHooks.JAM_MULA, tamat: TempahanHooks.JAM_TAMAT },
      maxHari: TempahanHooks.MAX_HARI, admin: admin, ruang: ruang, tempahan: tempahan, sekarang: TempahanHooks.nowHM()
    };
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
    AuditService.log({ role: ROLES.PUBLIC }, AUDIT_ACTIONS.RECORD_STATUS, 'TEMPAHAN', row.id, prev + ' → DIBATALKAN · oleh pemohon');
    NotificationService.notifyAdmins(NOTIF_TYPE.RECORD_STATUS, 'Tempahan dibatalkan: ' + row.ref_no,
      row.nama + ' membatalkan tempahan ' + TempahanHooks.ruangText(row) + ' (' + TempahanHooks.dateText(row) + ').', row.id, '#/admin/tempahan/' + row.id);
    TempahanHooks.notifyStatus(updated, prev);
    return TempahanHooks.publicView(updated);
  },

  routes: {
    'tempahan.jadual': { role: 'PUBLIC', fn: function (payload, ctx) { return TempahanHooks.jadual(payload, ctx); } },
    'tempahan.semak': { role: 'PUBLIC', fn: function (payload) { return TempahanHooks.semak(payload); } },
    'tempahan.batal': { role: 'PUBLIC', fn: function (payload) { return TempahanHooks.batal(payload); } }
  }
};
