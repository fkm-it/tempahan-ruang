/**
 * @file SettingModel.gs
 * Definisi tetapan runtime. `minRole` = peranan minimum untuk MENGUBAH tetapan.
 * Tetapan kritikal keselamatan hanya boleh diubah SUPER_ADMIN.
 * `public: true` → didedahkan kepada frontend (tiada rahsia di sini).
 */
const SETTINGS_DEFS = Object.freeze({
  SYSTEM_NAME: { type: 'string', max: 60, minRole: 'ADMIN', public: true, description: 'Nama sistem', default: 'D’Ruang @FKM' }, // @init:appName
  SYSTEM_TAGLINE: { type: 'string', max: 120, minRole: 'ADMIN', public: true, description: 'Slogan', default: 'Tempah ruang kuliah, makmal dan studio FKM dengan mudah' }, // @init:tagline
  LANDING_MESSAGE: { type: 'text', default: 'Semak kekosongan ruang dan hantar permohonan tempahan secara dalam talian. Keputusan dimaklumkan melalui emel.', max: 400, minRole: 'ADMIN', public: true, description: 'Mesej halaman utama' },
  ORG_NAME: { type: 'string', default: 'Fakulti Kejuruteraan Mekanikal, UTM', max: 120, minRole: 'ADMIN', public: true, description: 'Nama organisasi (footer)' },
  ALLOW_REGISTRATION: { type: 'bool', default: false, minRole: 'SUPER_ADMIN', public: true, description: 'Benarkan pendaftaran baharu' },
  ALLOW_PUBLIC_SUBMISSION: { type: 'bool', default: true, minRole: 'SUPER_ADMIN', public: true, description: 'Benarkan orang awam menghantar borang awam (modul yang membenarkannya)' },
  MAINTENANCE_MODE: { type: 'bool', default: false, minRole: 'SUPER_ADMIN', public: true, description: 'Mod penyelenggaraan (hanya admin boleh akses)' },
  MAX_ATTACHMENT_MB: { type: 'int', default: 5, min: 1, max: 20, minRole: 'SUPER_ADMIN', public: true, description: 'Saiz maksimum setiap lampiran (MB)' },
  ALLOWED_MIME_TYPES: {
    type: 'string', default: 'image/jpeg,image/png,image/webp,application/pdf',
    max: 400, minRole: 'SUPER_ADMIN', public: true, description: 'Jenis fail dibenarkan (dipisah koma)'
  },
  DEFAULT_PAGE_SIZE: { type: 'int', default: 20, min: 5, max: 100, minRole: 'ADMIN', public: true, description: 'Saiz halaman senarai' },
  NOTIFY_EMAIL_ENABLED: { type: 'bool', default: true, minRole: 'ADMIN', public: false, description: 'Hantar email untuk notifikasi rekod (rekod baharu kepada admin, perubahan status kepada pemilik)' },
  ADMIN_EMAIL: { type: 'string', default: '', max: 500, minRole: 'ADMIN', public: false, description: 'Email pentadbir (boleh beberapa, dipisah koma) — menerima notifikasi rekod baharu, maklum balas & amaran' },
  PERINGATAN_JAM: { type: 'int', default: 2, min: 0, max: 12, minRole: 'ADMIN', public: false, hidden: true, description: 'Tempahan: emel peringatan berapa jam sebelum slot bermula setiap hari (0 = tutup). Peringatan sehari sebelum tetap dihantar.' },
  /* Tempahan: waktu operasi & tarikh tutup — diurus melalui panel "Tetapan tempahan" (hidden = tidak dipapar dalam skrin Tetapan umum) */
  WAKTU_MULA: { type: 'string', default: '08:00', max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, minRole: 'ADMIN', public: true, hidden: true, description: 'Tempahan: waktu operasi mula (HH:MM)' },
  WAKTU_TAMAT: { type: 'string', default: '18:00', max: 5, pattern: /^([01]\d|2[0-4]):[0-5]\d$/, minRole: 'ADMIN', public: true, hidden: true, description: 'Tempahan: waktu operasi tamat (HH:MM)' },
  HARI_OPERASI: { type: 'string', default: '1,2,3,4,5', max: 20, pattern: /^[0-6](,[0-6]){0,6}$/, minRole: 'ADMIN', public: true, hidden: true, description: 'Tempahan: hari operasi untuk borang awam (0 = Ahad … 6 = Sabtu)' },
  TARIKH_TUTUP: {
    type: 'text', max: 8000, minRole: 'ADMIN', public: true, hidden: true, description: 'Tempahan: tarikh tutup (cuti umum, cuti semester) — senarai JSON [{t, n}]',
    default: '[{"t":"2026-07-21","n":"Hari Hol Almarhum Sultan Iskandar"},{"t":"2026-08-25","n":"Hari Keputeraan Nabi Muhammad S.A.W. (Maulidur Rasul)"},' +
      '{"t":"2026-08-31","n":"Hari Kebangsaan"},{"t":"2026-09-16","n":"Hari Malaysia"},{"t":"2026-11-18","n":"Hari Deepavali"},{"t":"2026-12-25","n":"Hari Krismas"}]',
    check: function (v) {
      let list;
      try { list = JSON.parse(v || '[]'); } catch (e) { return 'Senarai tarikh tutup tidak sah.'; }
      if (!Array.isArray(list) || list.length > 200) return 'Senarai tarikh tutup tidak sah (maksimum 200).';
      for (let i = 0; i < list.length; i++) {
        const x = list[i];
        if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.t)) || String(x.n || '').length > 80) return 'Tarikh tutup tidak sah: ' + JSON.stringify(x).slice(0, 60);
      }
      return '';
    }
  },
  PELAJAR_DIBENARKAN: { type: 'bool', default: true, minRole: 'ADMIN', public: true, hidden: true, description: 'Tempahan: pelajar boleh memohon melalui borang awam' },
  PERINGATAN_ADMIN_JAM: { type: 'int', default: 24, min: 0, max: 168, minRole: 'ADMIN', public: false, hidden: true, description: 'Tempahan: ingatkan admin tentang permohonan yang menunggu lebih daripada N jam (0 = tutup)' },
  PERINGATAN_PAGI: { type: 'int', default: 7, min: 0, max: 12, minRole: 'ADMIN', public: false, hidden: true, description: 'Tempahan: emel peringatan pada pagi hari tempahan, pada jam ini (0 = tutup)' },
  /* Logo sistem — diurus melalui panel "Logo sistem" (Tetapan). Kosong = logo asal (icons/logo.png). */
  LOGO: { type: 'text', default: '', max: 45000, minRole: 'ADMIN', public: false, hidden: true, description: 'Logo sistem (data URL PNG/WebP/JPEG)' },
  LOGO_VER: { type: 'string', default: '', max: 20, minRole: 'ADMIN', public: true, hidden: true, description: 'Versi logo (berubah setiap kali logo ditukar)' },
  PAPAN_TUNJUK_TUJUAN: { type: 'bool', default: true, minRole: 'ADMIN', public: false, description: 'Tempahan: papar tujuan tempahan yang diluluskan pada Papan Paparan awam (nama pemohon tidak pernah dipaparkan)' }
});

const SettingModel = {
  /** Tukar nilai string sheet kepada jenis sebenar. */
  parse: function (def, raw) {
    if (raw === undefined || raw === null || raw === '') return def.default;
    if (def.type === 'bool') return String(raw).toUpperCase() === 'TRUE';
    if (def.type === 'int') {
      const n = parseInt(raw, 10);
      return isFinite(n) ? n : def.default;
    }
    return String(raw);
  },

  serialize: function (def, value) {
    if (def.type === 'bool') return value ? 'TRUE' : 'FALSE';
    return String(value);
  },

  /** Peraturan Validator untuk satu tetapan. */
  rule: function (key, def) {
    if (def.type === 'bool') return { type: 'boolean', label: key };
    if (def.type === 'int') return { type: 'int', min: def.min, max: def.max, label: key };
    return { type: def.type === 'text' ? 'text' : 'string', max: def.max, pattern: def.pattern, label: key };
  }
};
