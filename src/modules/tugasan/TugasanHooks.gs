/**
 * @file TugasanHooks.gs
 * Log kerja pembantu operasi: tugasan membuka / menyediakan ruang.
 *
 * Aliran: admin meluluskan tempahan → pilih PIC (lalai: pembantu ruang) → tugasan DITUGASKAN
 *         → PIC menerima emel (automatik) + WhatsApp (admin tekan butang wa.me)
 *         → PIC tekan pautan "Sudah dibuka" (tanpa log masuk) → SELESAI, admin dimaklumkan.
 * Tempahan dibatalkan → tugasan DITUGASKAN dibatalkan & PIC diemel.
 *
 * Pautan PIC: #/tugas?id=<id>&k=<kunci>, kunci = HMAC(FORM_SECRET, 'tugasan|id|kod') — `kod` rawak per tugasan
 * (tidak didedahkan dalam DTO). Pentadbir boleh menjana semula pautan bila-bila masa; pautan tidak boleh diteka.
 */
const TugasanHooks = {
  JENIS: { BUKA: 'Buka ruang', TUTUP: 'Tutup / kunci ruang', SEDIA: 'Sediakan ruang / peralatan', LAIN: 'Tugasan' },
  /** Pautan PIC sah sehingga N hari selepas tarikh tamat tugasan. */
  PAUTAN_HARI: 7,

  // ================================================================== Pembantu

  pembantuOf: function (row) { return row && row.pembantu ? Repo.of('PEMBANTU').findById(row.pembantu) : null; },
  ruangText: function (row) {
    const r = row && row.ruang ? Repo.of('RUANG').findById(row.ruang) : null;
    return r ? r.nama + (r.blok && r.nama.indexOf('(' + r.blok + ')') < 0 ? ' (' + r.blok + ')' : '') : '';
  },
  tempahanOf: function (row) { return row && row.tempahan ? Repo.of('TEMPAHAN').findById(row.tempahan) : null; },
  endDate: function (row) { return row.tarikh_tamat || row.tarikh; },
  dateText: function (row) {
    const f = TempahanHooks.fmtDate;
    const e = TugasanHooks.endDate(row);
    return e && e !== row.tarikh ? f(row.tarikh) + ' – ' + f(e) + ' (setiap hari)' : f(row.tarikh);
  },

  // ================================================================== Pautan & WhatsApp

  key: function (row) { return SecurityUtils.hmacHex('tugasan|' + row.id + '|' + (row.kod || ''), Env.secret('FORM_SECRET')).slice(0, 32); },

  pautanPath: function (row) { return '#/tugas?id=' + encodeURIComponent(row.id) + '&k=' + TugasanHooks.key(row); },

  /** URL penuh pautan PIC ('' jika URL awam belum ditetapkan). */
  pautan: function (row) {
    const base = PushService.baseUrl();
    return base ? base + TugasanHooks.pautanPath(row) : '';
  },

  /** Teks ringkas tugasan (emel & WhatsApp). */
  lines: function (row) {
    const tp = TugasanHooks.tempahanOf(row);
    const out = [
      'Tugasan: ' + (TugasanHooks.JENIS[row.jenis] || 'Tugasan') + (row.ruang ? ' — ' + TugasanHooks.ruangText(row) : ''),
      'Tarikh: ' + TugasanHooks.dateText(row) + (row.masa ? ', sebelum jam ' + row.masa : '')
    ];
    if (tp) {
      out.push('Tempahan: ' + tp.ref_no + ' (' + tp.masa_mula + '–' + tp.masa_tamat + ')');
      out.push('Aktiviti: ' + StringUtils.truncate(String(tp.tujuan || ''), 120));
      out.push('Pemohon: ' + (tp.nama || '-') + (tp.no_telefon ? ' · ' + tp.no_telefon : ''));
    }
    if (row.arahan) out.push('Arahan: ' + StringUtils.truncate(String(row.arahan), 300));
    return out;
  },

  /** Pautan wa.me dengan mesej siap ditulis ('' jika tiada nombor sah). */
  waUrl: function (row) {
    const p = TugasanHooks.pembantuOf(row);
    let phone = '';
    try { phone = p ? Validator.waPhone(p.no_telefon) : ''; } catch (e) { phone = ''; }
    if (!phone) return '';
    const link = TugasanHooks.pautan(row);
    const text = ['Salam ' + (p.nama || '') + ',', ''].concat(TugasanHooks.lines(row), link ? ['', 'Sila tekan pautan ini selepas selesai:', link] : [], ['', '— ' + SettingsService.get('SYSTEM_NAME')]).join('\n');
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  },

  emailPic: function (row, kind) {
    const p = TugasanHooks.pembantuOf(row);
    if (!p || !p.emel) return false;
    const batal = kind === 'batal';
    const subject = (batal ? 'Tugasan DIBATALKAN: ' : kind === 'kemaskini' ? 'Tugasan DIKEMAS KINI: ' : kind === 'pagi' ? 'Peringatan tugasan hari ini: ' : 'Tugasan baharu: ') + (TugasanHooks.JENIS[row.jenis] || 'Tugasan') + (row.ruang ? ' — ' + TugasanHooks.ruangText(row) : '') + ' (' + TempahanHooks.fmtDate(row.tarikh) + ')';
    const lines = ['Salam ' + (p.nama || '') + ',',
      batal ? 'Tugasan berikut telah DIBATALKAN. Tiada tindakan diperlukan.' : kind === 'pagi' ? 'Peringatan: anda mempunyai tugasan hari ini.' :
        kind === 'kemaskini' ? 'Tarikh / masa / ruang tugasan anda telah DIKEMAS KINI. Butiran terkini:' : 'Anda telah ditugaskan untuk tugasan berikut.']
      .concat(TugasanHooks.lines(row), batal ? [] : ['Selepas selesai, tekan butang di bawah dan pilih "Sudah selesai".']);
    return NotificationService.email(p.emel, subject, lines, batal ? { path: '#/' } : { path: TugasanHooks.pautanPath(row) });
  },

  // ================================================================== Hooks enjin

  validate: function (data, info) {
    const cur = info.current;
    const tarikh = data.tarikh !== undefined && data.tarikh !== '' ? data.tarikh : (cur ? cur.tarikh : '');
    const tamat = data.tarikhTamat !== undefined && data.tarikhTamat !== '' ? data.tarikhTamat : (data.tarikh !== undefined || !cur ? tarikh : TugasanHooks.endDate(cur));
    if (tarikh && tamat && tamat < tarikh) throw Errors.validation('Tarikh tamat tidak boleh sebelum tarikh mula.', { tarikhTamat: 'Sebelum tarikh mula.' });
  },

  beforeSave: function (row, info) {
    const ctx = info.ctx || {};
    if (info.mode !== 'update') {
      row.kod = SecurityUtils.randomToken().slice(0, 32);
      if (!row.tarikh_tamat) row.tarikh_tamat = row.tarikh;
      if (!row.jenis) row.jenis = 'BUKA';
      if (ctx.tgTempahan) row.tempahan = ctx.tgTempahan;
      row.ditugaskan_oleh = (ctx.user && ctx.user.full_name) || '';
    } else if (row.tarikh_tamat === '' || (row.tarikh !== undefined && row.tarikh_tamat === undefined)) {
      row.tarikh_tamat = row.tarikh || info.current.tarikh;
    }
    const merged = Object.assign({}, info.current || {}, row);
    if (!merged.tajuk) row.tajuk = (TugasanHooks.JENIS[merged.jenis] || 'Tugasan') + (merged.ruang ? ' — ' + TugasanHooks.ruangText(merged) : '');
    /* PIC atau tarikh bertukar → pautan lama tidak lagi sah, peringatan dihantar semula */
    if (info.mode === 'update' && ((row.pembantu !== undefined && row.pembantu !== info.current.pembantu) || (row.tarikh !== undefined && row.tarikh !== info.current.tarikh))) {
      row.kod = SecurityUtils.randomToken().slice(0, 32);
      row.peringatan_dihantar = '';
    }
  },

  afterCreate: function (row, ctx) {
    if (ctx && ctx.tgTanpaEmel) return;
    if (TugasanHooks.emailPic(row, 'baru')) Repo.of('TUGASAN').update(row.id, { emel_dihantar: DateUtils.nowIso() });
  },

  afterStatus: function (row, prev, ctx) {
    if (row.status === 'DIBATALKAN' && prev === 'DITUGASKAN' && !(ctx && ctx.tgTanpaEmel)) TugasanHooks.emailPic(row, 'batal');
    if (row.status === 'SELESAI' && !row.disahkan_pada) {
      Repo.of('TUGASAN').update(row.id, { disahkan_pada: DateUtils.nowIso(), disahkan_oleh: 'Admin: ' + ((ctx && ctx.user && ctx.user.full_name) || '') });
    }
    if (row.status === 'DITUGASKAN' && prev !== 'DITUGASKAN') Repo.of('TUGASAN').update(row.id, { disahkan_pada: '', disahkan_oleh: '', catatan_pic: '' });
  },

  toDTO: function (dto, row, ctx) {
    delete dto.values.kod;
    const tp = TugasanHooks.tempahanOf(row);
    if (tp) dto.labels.tempahan = tp.ref_no + ' · ' + StringUtils.truncate(String(tp.tujuan || ''), 60);
    dto.subtitle = [dto.labels.pembantu, TugasanHooks.dateText(row), row.masa ? 'sebelum ' + row.masa : ''].filter(Boolean).join(' · ');
    if (CrudEngine.isAdmin(ctx) && row.status === 'DITUGASKAN') {
      dto.waUrl = TugasanHooks.waUrl(row);
      dto.pautan = TugasanHooks.pautan(row);
      dto.pautanPath = TugasanHooks.pautanPath(row);
      const p = TugasanHooks.pembantuOf(row);
      dto.picEmel = p ? p.emel || '' : '';
    }
    return dto;
  },

  // ================================================================== Dipanggil oleh TempahanHooks

  /**
   * Tugaskan PIC bagi tempahan yang diluluskan. Satu tugasan aktif (DITUGASKAN) setiap jenis bagi satu tempahan:
   * tugasan lama jenis sama dibatalkan (PIC lama diemel) — "tukar PIC".
   * @return {Object} DTO tugasan (dengan waUrl)
   */
  assign: function (ctx, tp, opts) {
    const o = opts || {};
    const jenis = TugasanHooks.JENIS[o.jenis] ? o.jenis : 'BUKA';
    const p = Repo.of('PEMBANTU').findById(String(o.pembantu || ''));
    if (!p || !CrudEngine.isSelectable(CrudEngine.get('pembantu'), p)) throw Errors.validation('Pilih pembantu operasi yang aktif.', { pembantu: 'Tidak sah.' });
    const lama = Repo.of('TUGASAN').find(function (r) { return r.state === RECORD_STATE.ACTIVE && r.tempahan === tp.id && r.status === 'DITUGASKAN' && r.jenis === jenis; });
    lama.forEach(function (r) {
      if (r.pembantu === p.id) return;
      CrudEngine.setStatus(ctx, { module: 'tugasan', id: r.id, status: 'DIBATALKAN', note: 'Diganti dengan PIC lain.' });
    });
    const same = lama.filter(function (r) { return r.pembantu === p.id; })[0];
    if (same) return CrudEngine.toDTO(CrudEngine.get('tugasan'), Repo.of('TUGASAN').findById(same.id), ctx);
    const c = Object.assign({}, ctx, { tgTempahan: tp.id, tgTanpaEmel: o.hantarEmel === false });
    return CrudEngine.create(c, {
      module: 'tugasan', jenis: jenis, pembantu: p.id, ruang: tp.ruang, tarikh: tp.tarikh, tarikhTamat: TempahanHooks.endDate(tp),
      masa: tp.masa_mula, arahan: String(o.arahan || '').slice(0, 500)
    });
  },

  /** Tugasan aktif bagi tempahan (admin). */
  forTempahan: function (ctx, tempahanId) {
    const def = CrudEngine.get('tugasan');
    return Repo.of('TUGASAN').find(function (r) { return r.state === RECORD_STATE.ACTIVE && r.tempahan === tempahanId; })
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })
      .map(function (r) { return CrudEngine.toDTO(def, r, ctx); });
  },

  /** Tempahan dibatalkan / tidak lagi diluluskan → batalkan tugasan yang belum selesai (PIC diemel). */
  cancelFor: function (tp, sebab) {
    const now = DateUtils.nowIso();
    let n = 0;
    Repo.of('TUGASAN').find(function (r) { return r.state === RECORD_STATE.ACTIVE && r.tempahan === tp.id && r.status === 'DITUGASKAN'; }).forEach(function (r) {
      const u = Repo.of('TUGASAN').update(r.id, { status: 'DIBATALKAN', status_note: sebab || 'Tempahan dibatalkan.', status_changed_at: now, status_changed_by: 'Sistem', updated_at: now });
      TugasanHooks.emailPic(u || r, 'batal');
      n++;
    });
    return n;
  },

  /** Tempahan yang ditugaskan disunting (ruang/tarikh/masa) → kemas kini tugasan aktif, pautan baharu, emel PIC. */
  syncFor: function (tp) {
    let n = 0;
    Repo.of('TUGASAN').find(function (r) { return r.state === RECORD_STATE.ACTIVE && r.tempahan === tp.id && r.status === 'DITUGASKAN'; }).forEach(function (r) {
      const patch = { ruang: tp.ruang, tarikh: tp.tarikh, tarikh_tamat: TempahanHooks.endDate(tp), masa: tp.masa_mula };
      if (!Object.keys(patch).some(function (k) { return String(patch[k] || '') !== String(r[k] || ''); })) return;
      patch.kod = SecurityUtils.randomToken().slice(0, 32);
      patch.peringatan_dihantar = '';
      patch.tajuk = (TugasanHooks.JENIS[r.jenis] || 'Tugasan') + (tp.ruang ? ' — ' + TugasanHooks.ruangText({ ruang: tp.ruang }) : '');
      patch.updated_at = DateUtils.nowIso();
      const u = Repo.of('TUGASAN').update(r.id, patch);
      TugasanHooks.emailPic(u, 'kemaskini');
      n++;
    });
    return n;
  },

  // ================================================================== Laluan awam PIC (pautan tanpa log masuk)

  /** Tugasan daripada id + kunci; NOT_FOUND seragam jika tidak sah atau luput. */
  fromLink: function (payload) {
    const p = Validator.validate(payload, {
      id: { type: 'string', required: true, max: 40, pattern: /^TG-[0-9A-F]{16}$/, label: 'Tugasan' },
      k: { type: 'string', required: true, max: 64, pattern: /^[0-9a-f]{32}$/, label: 'Kunci' }
    });
    SecurityService.rateLimit('tugasan.pautan.global', 'all');
    SecurityService.rateLimit('tugasan.pautan', p.id);
    const row = Repo.of('TUGASAN').findById(p.id);
    const ok = row && row.state === RECORD_STATE.ACTIVE && row.kod && SecurityUtils.constantTimeEquals(p.k, TugasanHooks.key(row)) &&
      TempahanHooks.daysBetween(TugasanHooks.endDate(row), TempahanHooks.today()) <= TugasanHooks.PAUTAN_HARI;
    if (!ok) throw Errors.notFound('Tugasan');
    return row;
  },

  publicView: function (row) {
    const tp = TugasanHooks.tempahanOf(row);
    const p = TugasanHooks.pembantuOf(row);
    const r = row.ruang ? Repo.of('RUANG').findById(row.ruang) : null;
    return {
      refNo: row.ref_no, jenis: row.jenis, jenisLabel: TugasanHooks.JENIS[row.jenis] || 'Tugasan', pic: p ? p.nama : '',
      ruang: r ? r.nama : '', blok: r ? r.blok : '', aras: r ? r.aras : '', kodRuang: r ? r.kod_ruang : '',
      tarikh: row.tarikh, tarikhTamat: TugasanHooks.endDate(row), masa: row.masa, arahan: row.arahan || '',
      tempahan: tp ? { refNo: tp.ref_no, masaMula: tp.masa_mula, masaTamat: tp.masa_tamat, tujuan: tp.tujuan, nama: tp.nama, noTelefon: tp.no_telefon, peserta: parseInt(tp.bilangan_peserta, 10) || 0 } : null,
      status: row.status, statusLabel: CrudEngine.statusLabel(CrudEngine.get('tugasan'), row.status),
      disahkanPada: row.disahkan_pada || '', catatanPic: row.catatan_pic || ''
    };
  },

  lihat: function (payload) { return TugasanHooks.publicView(TugasanHooks.fromLink(payload)); },

  /** PIC mengesahkan tugasan selesai (idempoten). */
  selesai: function (payload) {
    const row = TugasanHooks.fromLink(payload);
    const extra = Validator.validate(payload, { catatan: { type: 'text', max: 300, label: 'Catatan' } });
    if (row.status === 'SELESAI') return TugasanHooks.publicView(row);
    if (row.status !== 'DITUGASKAN') throw Errors.conflict('Tugasan ini telah dibatalkan. Tiada tindakan diperlukan.');
    const p = TugasanHooks.pembantuOf(row);
    const now = DateUtils.nowIso();
    const updated = Repo.of('TUGASAN').update(row.id, {
      status: 'SELESAI', status_changed_at: now, status_changed_by: 'PIC: ' + (p ? p.nama : ''), updated_at: now,
      disahkan_pada: now, disahkan_oleh: 'PIC: ' + (p ? p.nama : ''), catatan_pic: StringUtils.singleLine(StringUtils.stripTags(extra.catatan || ''))
    });
    AppCache.remove('stats:admin');
    AuditService.log({ role: ROLES.PUBLIC }, AUDIT_ACTIONS.RECORD_STATUS, 'TUGASAN', row.id, 'DITUGASKAN → SELESAI · disahkan oleh PIC melalui pautan');
    NotificationService.notifyAdmins(NOTIF_TYPE.RECORD_STATUS, 'Tugasan selesai: ' + (TugasanHooks.JENIS[row.jenis] || 'Tugasan') + (row.ruang ? ' ' + TugasanHooks.ruangText(row) : ''),
      (p ? p.nama : 'PIC') + ' telah mengesahkan ' + row.ref_no + (extra.catatan ? ' · ' + StringUtils.truncate(extra.catatan, 120) : '') + '.', row.id, '#/admin/log-kerja/' + row.id);
    return TugasanHooks.publicView(updated);
  },

  // ================================================================== Berkala

  /** Setiap jam: emel peringatan pagi kepada PIC bagi tugasan hari ini (tetapan PERINGATAN_PAGI, sekali sehari). */
  hourly: function () {
    const jam = Number(SettingsService.get('PERINGATAN_PAGI')) || 0;
    if (jam <= 0 || Number(TempahanHooks.nowHM().slice(0, 2)) < jam) return { peringatanPic: 0 };
    const today = TempahanHooks.today();
    const nowHm = TempahanHooks.nowHM();
    const patch = {};
    Repo.of('TUGASAN').all().forEach(function (r) {
      if (r.state !== RECORD_STATE.ACTIVE || r.status !== 'DITUGASKAN' || r.peringatan_dihantar === today) return;
      if (r.tarikh > today || TugasanHooks.endDate(r) < today || (r.masa && r.masa <= nowHm)) return;
      if (TugasanHooks.emailPic(r, 'pagi')) patch[r.id] = { peringatan_dihantar: today };
    });
    const n = Object.keys(patch).length;
    if (n) Repo.of('TUGASAN').updateMany(patch);
    return { peringatanPic: n };
  },

  routes: {
    'tugasan.lihat': { role: 'PUBLIC', fn: function (payload) { return TugasanHooks.lihat(payload); } },
    'tugasan.selesai': { role: 'PUBLIC', fn: function (payload) { return TugasanHooks.selesai(payload); } }
  }
};
