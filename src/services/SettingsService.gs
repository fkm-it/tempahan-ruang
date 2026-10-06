/**
 * @file SettingsService.gs
 * Tetapan runtime bertaip + kawalan peranan untuk perubahan.
 */
const SettingsService = {
  /** @return {Object} semua tetapan bertaip (default jika tiada dalam sheet). */
  all: function () {
    const raw = SettingsRepository.map();
    const out = {};
    Object.keys(SETTINGS_DEFS).forEach(function (k) {
      out[k] = SettingModel.parse(SETTINGS_DEFS[k], raw[k]);
    });
    return out;
  },

  get: function (key) {
    return SettingsService.all()[key];
  },

  allowedMimeTypes: function () {
    return String(SettingsService.get('ALLOWED_MIME_TYPES')).split(',')
      .map(function (s) { return s.trim().toLowerCase(); })
      .filter(function (m) { return FILE_SIGNATURES[m]; }); // hanya jenis yang ada pengesahan magic-bytes
  },

  /** Konfigurasi selamat untuk frontend. */
  publicConfig: function () {
    const s = SettingsService.all();
    const out = {};
    Object.keys(SETTINGS_DEFS).forEach(function (k) {
      if (SETTINGS_DEFS[k].public) out[k] = s[k];
    });
    out.ALLOWED_MIME_TYPES = SettingsService.allowedMimeTypes().join(',');
    out.VERSION = CONFIG.VERSION;
    out.ENV = Env.isProduction() ? '' : Env.name();
    out.PUSH_ENABLED = PushService.enabled();
    out.SHORT_NAME = CONFIG.SHORT_NAME;
    // Persediaan awal: pendaftaran Super Admin pertama dibenarkan walaupun ALLOW_REGISTRATION ditutup
    try { out.SETUP_PENDING = !!Env.get('BOOTSTRAP_SUPER_ADMIN_EMAIL') && UserRepository.countByRole(ROLES.SUPER_ADMIN) === 0; } catch (e) { out.SETUP_PENDING = false; }
    return out;
  },

  /** Untuk skrin Tetapan admin: nilai + metadata + sama ada boleh diubah oleh peranan semasa. */
  listForAdmin: function (role) {
    const s = SettingsService.all();
    const rows = {};
    SettingsRepository.rows().forEach(function (r) { rows[r.setting_key] = r; });
    return Object.keys(SETTINGS_DEFS).map(function (k) {
      const def = SETTINGS_DEFS[k];
      return {
        key: k,
        value: s[k],
        type: def.type,
        min: def.min,
        max: def.max,
        description: def.description,
        editable: ROLE_LEVEL[role] >= ROLE_LEVEL[def.minRole],
        requiredRole: def.minRole,
        updatedBy: rows[k] ? rows[k].updated_by : '',
        updatedAt: rows[k] ? rows[k].updated_at : ''
      };
    });
  },

  /**
   * Kemas kini tetapan. Kunci tidak dikenali ditolak; peranan disemak per kunci.
   * @param {Object} ctx konteks permintaan
   * @param {Object} changes { KEY: value }
   */
  update: function (ctx, changes) {
    if (!changes || typeof changes !== 'object') throw Errors.badRequest();
    const keys = Object.keys(changes);
    if (!keys.length) throw Errors.validation('Tiada perubahan.');
    const values = {};
    const errors = {};
    keys.forEach(function (k) {
      const def = SETTINGS_DEFS[k];
      if (!def) { errors[k] = 'Tetapan tidak dikenali.'; return; }
      if (ROLE_LEVEL[ctx.role] < ROLE_LEVEL[def.minRole]) { errors[k] = 'Memerlukan peranan ' + def.minRole + '.'; return; }
      try {
        const v = Validator.coerce(changes[k], SettingModel.rule(k, def), k);
        if (k === 'ADMIN_EMAIL' && v && !Validator.EMAIL_RE.test(v)) throw new Error('Email tidak sah.');
        values[k] = SettingModel.serialize(def, v);
      } catch (e) {
        errors[k] = e.message;
      }
    });
    if (Object.keys(errors).length) {
      const forbidden = Object.keys(errors).some(function (k) { return /Memerlukan peranan/.test(errors[k]); });
      if (forbidden) throw Errors.forbidden('Sesetengah tetapan memerlukan peranan SUPER_ADMIN.');
      throw Errors.validation(errors[Object.keys(errors)[0]], errors);
    }
    const descriptions = {};
    keys.forEach(function (k) { descriptions[k] = SETTINGS_DEFS[k].description; });
    SettingsRepository.setMany(values, ctx.userId, descriptions);
    AuditService.log(ctx, AUDIT_ACTIONS.SETTINGS_UPDATED, 'SETTINGS', '', 'Kunci: ' + keys.join(', '));
    return SettingsService.listForAdmin(ctx.role);
  }
};
