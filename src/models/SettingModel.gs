/**
 * @file SettingModel.gs
 * Definisi tetapan runtime. `minRole` = peranan minimum untuk MENGUBAH tetapan.
 * Tetapan kritikal keselamatan hanya boleh diubah SUPER_ADMIN.
 * `public: true` → didedahkan kepada frontend (tiada rahsia di sini).
 */
const SETTINGS_DEFS = Object.freeze({
  SYSTEM_NAME: { type: 'string', max: 60, minRole: 'ADMIN', public: true, description: 'Nama sistem', default: 'Sistem Tempahan Ruang & Fasiliti FKM' }, // @init:appName
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
  ADMIN_EMAIL: { type: 'string', default: '', max: 254, minRole: 'SUPER_ADMIN', public: false, description: 'Email pentadbir untuk maklum balas & amaran' },
  PERINGATAN_JAM: { type: 'int', default: 2, min: 0, max: 12, minRole: 'ADMIN', public: false, description: 'Tempahan: emel peringatan berapa jam sebelum slot bermula setiap hari (0 = tutup). Peringatan sehari sebelum tetap dihantar.' },
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
    return { type: def.type === 'text' ? 'text' : 'string', max: def.max, label: key };
  }
};
