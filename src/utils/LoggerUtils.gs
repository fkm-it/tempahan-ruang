/**
 * @file LoggerUtils.gs
 * Developer log (console → Cloud Logging) + pengendali ralat global.
 * Maklumat sensitif DIREDAKSI sebelum log.
 */
const AppLogger = {
  SENSITIVE_KEY_RE: /pass|token|secret|pepper|hash|code|base64|data|authorization/i,

  /** Salin objek dengan medan sensitif diganti '[REDACTED]'. */
  redact: function (obj, depth) {
    depth = depth || 0;
    if (obj === null || obj === undefined || depth > 3) return obj;
    if (typeof obj === 'string') return obj.length > 300 ? obj.slice(0, 300) + '…' : obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.slice(0, 10).map(function (v) { return AppLogger.redact(v, depth + 1); });
    const out = {};
    Object.keys(obj).forEach(function (k) {
      out[k] = AppLogger.SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : AppLogger.redact(obj[k], depth + 1);
    });
    return out;
  },

  info: function (message, context) {
    console.log(JSON.stringify({ level: 'INFO', message: message, context: AppLogger.redact(context) }));
  },
  warn: function (message, context) {
    console.warn(JSON.stringify({ level: 'WARN', message: message, context: AppLogger.redact(context) }));
  },
  error: function (message, context) {
    console.error(JSON.stringify({ level: 'ERROR', message: message, context: AppLogger.redact(context) }));
  }
};

const ErrorHandler = {
  GENERIC_MESSAGE: 'Maaf, berlaku masalah. Sila cuba semula.',

  /**
   * Tukar sebarang ralat kepada respons API selamat.
   * AppError → mesej asal (selamat). Ralat lain → mesej generik + errorId untuk admin.
   */
  handle: function (error, context) {
    if (error instanceof AppError) {
      const meta = {};
      if (error.details && error.details.fields) meta.fields = error.details.fields;
      if (error.code === ERROR_CODES.CONFIG_ERROR) {
        const errorId = ErrorHandler.record(error, context);
        meta.errorId = errorId;
      }
      return ApiResponse.fail(error.code, error.message, meta);
    }
    const id = ErrorHandler.record(error, context);
    return ApiResponse.fail(ERROR_CODES.INTERNAL_ERROR, ErrorHandler.GENERIC_MESSAGE, { errorId: id });
  },

  /** Rekod ke console + SYSTEM_LOGS. Tidak pernah melontar. */
  record: function (error, context) {
    const errorId = IdUtils.errorId();
    const safeCtx = AppLogger.redact(context || {});
    AppLogger.error(String(error && error.message), { errorId: errorId, stack: error && error.stack, context: safeCtx });
    try {
      SystemLogRepository.add('ERROR', errorId, (context && context.action) || '', String(error && error.message || error).slice(0, 500),
        JSON.stringify({ stack: String(error && error.stack || '').slice(0, 1500), context: safeCtx }).slice(0, 4000));
    } catch (e) {
      console.error('Gagal menulis SYSTEM_LOGS: ' + e);
    }
    return errorId;
  }
};
