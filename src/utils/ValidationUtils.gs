/**
 * @file ValidationUtils.gs
 * Pengesah berasaskan skema. Medan yang tidak diisytiharkan DIBUANG
 * (lindungi daripada mass-assignment, cth. pengguna cuba hantar role:'ADMIN').
 *
 * Contoh:
 *   const clean = Validator.validate(payload, {
 *     email:    { type: 'email', required: true, label: 'Email' },
 *     password: { type: 'string', required: true, min: 8, max: 128, raw: true }
 *   });
 */
const Validator = {
  EMAIL_RE: /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/,
  PHONE_RE: /^\+?[0-9][0-9\s-]{6,18}$/,
  DATE_RE: /^\d{4}-\d{2}-\d{2}$/,

  /**
   * @param {Object} input
   * @param {Object<string, Object>} schema
   * @return {Object} nilai bersih
   * @throws {AppError} VALIDATION_ERROR dengan { fields: { medan: mesej } }
   */
  validate: function (input, schema) {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const out = {};
    const errors = {};

    Object.keys(schema).forEach(function (key) {
      const rule = schema[key];
      const label = rule.label || key;
      let value = src[key];
      const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

      if (empty) {
        if (rule.required) errors[key] = label + ' diperlukan.';
        else if (rule.default !== undefined) out[key] = rule.default;
        return;
      }

      try {
        out[key] = Validator.coerce(value, rule, label);
      } catch (e) {
        errors[key] = e.message;
      }
    });

    if (Object.keys(errors).length) {
      const first = errors[Object.keys(errors)[0]];
      throw Errors.validation(first, errors);
    }
    return out;
  },

  coerce: function (value, rule, label) {
    switch (rule.type) {
      case 'string':
      case 'text': {
        if (typeof value !== 'string' && typeof value !== 'number') throw new Error(label + ' tidak sah.');
        let s = rule.raw ? String(value) : StringUtils.clean(value);
        if (!rule.raw) s = StringUtils.stripTags(s);
        if (rule.type === 'string' && !rule.raw) s = s.replace(/\s+/g, ' ');
        if (rule.min && s.length < rule.min) throw new Error(label + ' mesti sekurang-kurangnya ' + rule.min + ' aksara.');
        if (rule.max && s.length > rule.max) throw new Error(label + ' tidak boleh melebihi ' + rule.max + ' aksara.');
        if (rule.pattern && !rule.pattern.test(s)) throw new Error(label + ' tidak sah.');
        if (rule.enum && rule.enum.indexOf(s) < 0) throw new Error(label + ' tidak sah.');
        return s;
      }
      case 'email': {
        const e = StringUtils.normalizeEmail(value);
        if (e.length > 254 || !Validator.EMAIL_RE.test(e)) throw new Error('Alamat email tidak sah.');
        return e;
      }
      case 'phone': {
        const p = StringUtils.singleLine(value);
        if (!Validator.PHONE_RE.test(p)) throw new Error('Nombor telefon tidak sah.');
        return p;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === 1 || value === '1') return true;
        if (value === 'false' || value === 0 || value === '0') return false;
        throw new Error(label + ' tidak sah.');
      case 'int': {
        const n = typeof value === 'number' ? value : parseInt(String(value), 10);
        if (!isFinite(n) || Math.floor(n) !== n) throw new Error(label + ' mesti nombor bulat.');
        if (rule.min !== undefined && n < rule.min) throw new Error(label + ' minimum ' + rule.min + '.');
        if (rule.max !== undefined && n > rule.max) throw new Error(label + ' maksimum ' + rule.max + '.');
        return n;
      }
      case 'number': {
        const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
        if (!isFinite(n)) throw new Error(label + ' mesti nombor.');
        if (rule.min !== undefined && n < rule.min) throw new Error(label + ' minimum ' + rule.min + '.');
        if (rule.max !== undefined && n > rule.max) throw new Error(label + ' maksimum ' + rule.max + '.');
        return rule.decimals !== undefined ? Number(n.toFixed(rule.decimals)) : n;
      }
      case 'time': {
        const v = String(value).trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(label + ' tidak sah (HH:MM).');
        return v;
      }
      case 'enum': {
        const v = rule.caseSensitive ? String(value).trim() : String(value).trim().toUpperCase();
        if (rule.values.indexOf(v) < 0) throw new Error(label + ' tidak sah.');
        return v;
      }
      case 'id': {
        const v = String(value).trim();
        if (!IdUtils.isValid(v, rule.prefix)) throw new Error(label + ' tidak sah.');
        return v;
      }
      case 'date': {
        const v = String(value).trim();
        if (!Validator.DATE_RE.test(v) || isNaN(new Date(v + 'T00:00:00Z').getTime())) throw new Error(label + ' tidak sah.');
        return v;
      }
      case 'array': {
        if (!Array.isArray(value)) throw new Error(label + ' tidak sah.');
        if (rule.max !== undefined && value.length > rule.max) throw new Error(label + ': maksimum ' + rule.max + ' item.');
        return value;
      }
      default:
        throw new Error('Jenis validasi tidak dikenali: ' + rule.type);
    }
  },

  /**
   * Nombor WhatsApp → format antarabangsa digit sahaja (untuk wa.me).
   * Lalai Malaysia: 012-345 6789 → 60123456789. @return {string} '' jika kosong
   */
  waPhone: function (value, field) {
    let p = String(value === undefined || value === null ? '' : value).replace(/[\s().-]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '60' + p.slice(1);
    if (!/^[1-9][0-9]{9,14}$/.test(p)) throw Errors.validation('Nombor WhatsApp tidak sah.', (function () { const o = {}; o[field || 'phone'] = 'Nombor WhatsApp tidak sah. Contoh: 012-345 6789'; return o; })());
    return p;
  },

  /** Polisi kata laluan: 8–128 aksara, ada huruf & nombor, bukan email sendiri. */
  password: function (password, email) {
    const p = String(password || '');
    const errs = [];
    if (p.length < CONFIG.PASSWORD_MIN_LENGTH) errs.push('Kata laluan mesti sekurang-kurangnya ' + CONFIG.PASSWORD_MIN_LENGTH + ' aksara.');
    else if (p.length > CONFIG.PASSWORD_MAX_LENGTH) errs.push('Kata laluan terlalu panjang.');
    else if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) errs.push('Kata laluan mesti mengandungi huruf dan nombor.');
    else if (email && p.toLowerCase() === String(email).toLowerCase()) errs.push('Kata laluan tidak boleh sama dengan email.');
    if (errs.length) throw Errors.validation(errs[0], { password: errs[0] });
    return p;
  },

  /** Pagination selamat. */
  paging: function (input, defaultSize) {
    const page = Math.max(1, parseInt(input && input.page, 10) || 1);
    const size = Math.min(CONFIG.MAX_PAGE_SIZE, Math.max(1, parseInt(input && input.pageSize, 10) || defaultSize || CONFIG.DEFAULT_PAGE_SIZE));
    return { page: page, pageSize: size };
  },

  /** Potong senarai mengikut halaman + meta. */
  paginate: function (items, paging) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / paging.pageSize));
    const page = Math.min(paging.page, totalPages);
    const start = (page - 1) * paging.pageSize;
    return {
      items: items.slice(start, start + paging.pageSize),
      meta: { page: page, pageSize: paging.pageSize, total: total, totalPages: totalPages }
    };
  }
};
