/**
 * @file ResponseUtils.gs
 * Format respons seragam + kelas ralat aplikasi.
 *
 * Respons berjaya: { success:true,  data, message, code:'OK', meta }
 * Respons gagal:   { success:false, data:null, message, code, meta }
 */

/**
 * Ralat yang dijangka (validation, auth, dsb). Mesejnya SELAMAT dipaparkan kepada pengguna.
 * Ralat lain (TypeError, ralat Sheets) dianggap INTERNAL dan disembunyikan.
 */
class AppError extends Error {
  /**
   * @param {string} code  salah satu ERROR_CODES
   * @param {string} message mesej mesra pengguna (Bahasa Melayu)
   * @param {Object=} details butiran tambahan selamat (cth. ralat medan)
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details || null;
  }
}

/** Pembina ralat biasa — supaya mesej konsisten di seluruh sistem. */
const Errors = {
  validation: function (message, fields) {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, message || 'Sila semak maklumat yang dimasukkan.', fields ? { fields: fields } : null);
  },
  badRequest: function (message) {
    return new AppError(ERROR_CODES.BAD_REQUEST, message || 'Permintaan tidak sah.');
  },
  unauthenticated: function () {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, 'Sesi anda telah tamat. Sila log masuk semula.');
  },
  forbidden: function (message) {
    return new AppError(ERROR_CODES.FORBIDDEN, message || 'Anda tidak mempunyai kebenaran untuk tindakan ini.');
  },
  notFound: function (what) {
    return new AppError(ERROR_CODES.NOT_FOUND, (what || 'Rekod') + ' tidak dijumpai.');
  },
  conflict: function (message) {
    return new AppError(ERROR_CODES.CONFLICT, message || 'Rekod telah wujud.');
  },
  rateLimited: function () {
    return new AppError(ERROR_CODES.RATE_LIMITED, 'Terlalu banyak cubaan. Sila cuba sebentar lagi.');
  },
  maintenance: function () {
    return new AppError(ERROR_CODES.MAINTENANCE, 'Sistem sedang diselenggara. Sila cuba sebentar lagi.');
  }
};

const ApiResponse = {
  ok: function (data, message, meta) {
    return {
      success: true,
      data: data === undefined ? null : data,
      message: message || '',
      code: 'OK',
      meta: meta || {}
    };
  },
  fail: function (code, message, meta) {
    return {
      success: false,
      data: null,
      message: message || 'Permintaan tidak dapat diproses.',
      code: code || ERROR_CODES.INTERNAL_ERROR,
      meta: meta || {}
    };
  }
};
