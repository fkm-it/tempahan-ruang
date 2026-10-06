/**
 * @file AuditService.gs
 * Jejak audit untuk operasi sensitif. TIDAK pernah menyimpan kata laluan/token/kandungan peribadi.
 */
const AuditService = {
  /**
   * Rekod audit. Tidak melontar ralat (kegagalan audit tidak menggagalkan operasi utama,
   * tetapi direkod dalam console untuk siasatan).
   * @param {Object|null} ctx konteks permintaan (boleh null untuk sistem/awam)
   */
  log: function (ctx, action, module, referenceId, description) {
    try {
      AuditRepository.insert({
        log_id: IdUtils.generate('L'),
        user_id: (ctx && ctx.userId) || '',
        role: (ctx && ctx.role) || ROLES.PUBLIC,
        action: action,
        module: module || '',
        reference_id: referenceId || '',
        description: StringUtils.truncate(StringUtils.singleLine(description || ''), 300),
        ip_hash: '', // GAS tidak mendedahkan IP klien
        user_agent: StringUtils.truncate(StringUtils.singleLine((ctx && ctx.userAgent) || ''), 160),
        created_at: DateUtils.nowIso()
      });
    } catch (e) {
      AppLogger.error('Audit gagal', { action: action, error: String(e) });
    }
  },

  /** Senarai audit (terbaru dahulu) dengan penapis. */
  list: function (filters) {
    const f = Validator.validate(filters, {
      action: { type: 'string', max: 40 },
      module: { type: 'string', max: 30 },
      userId: { type: 'string', max: 20 },
      q: { type: 'string', max: 80 },
      from: { type: 'date' },
      to: { type: 'date' }
    });
    const q = (f.q || '').toLowerCase();
    const rows = AuditRepository.all().filter(function (l) {
      if (f.action && l.action !== f.action) return false;
      if (f.module && l.module !== f.module) return false;
      if (f.userId && l.user_id !== f.userId) return false;
      if ((f.from || f.to) && !DateUtils.inDayRange(l.created_at, f.from, f.to)) return false;
      if (q && (l.description + ' ' + l.reference_id + ' ' + l.action).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).reverse();
    const usersById = {};
    UserRepository.all().forEach(function (u) { usersById[u.user_id] = u; });
    const page = Validator.paginate(rows, Validator.paging(filters, 30));
    page.items = page.items.map(function (l) { return AuditModel.toDTO(l, usersById); });
    page.meta.actions = Object.keys(AUDIT_ACTIONS);
    return page;
  }
};
