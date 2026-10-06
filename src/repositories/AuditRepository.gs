/**
 * @file AuditRepository.gs
 * Log audit (jejak tindakan) dan log sistem (ralat teknikal).
 */
const AuditRepository = {
  base: function () { return Repo.of('AUDIT_LOGS'); },

  all: function () { return AuditRepository.base().all(); },

  insert: function (row) { return AuditRepository.base().insert(row); }
};

const SystemLogRepository = {
  base: function () { return Repo.of('SYSTEM_LOGS'); },

  add: function (level, errorId, action, message, context) {
    return SystemLogRepository.base().insert({
      log_id: IdUtils.generate('S'),
      level: level,
      error_id: errorId || '',
      action: action || '',
      message: message || '',
      context: context || '',
      created_at: DateUtils.nowIso()
    });
  },

  recent: function (limit) {
    const rows = SystemLogRepository.base().all();
    return rows.slice(Math.max(0, rows.length - (limit || 50))).reverse();
  },

  /** Kekalkan N baris terkini sahaja. */
  prune: function (maxRows) {
    const rows = SystemLogRepository.base().all();
    if (rows.length <= maxRows) return 0;
    const cutoff = {};
    rows.slice(0, rows.length - maxRows).forEach(function (r) { cutoff[r.log_id] = true; });
    return SystemLogRepository.base().deleteWhere(function (r) { return cutoff[r.log_id]; });
  }
};
