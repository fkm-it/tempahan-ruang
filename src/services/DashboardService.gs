/**
 * @file DashboardService.gs
 * KPI & carta papan pemuka admin (dicache 2 minit). Statistik per modul datang daripada CrudEngine.adminStats.
 */
const DashboardService = {
  adminStats: function () {
    return AppCache.remember('stats:admin', CONFIG.CACHE_TTL.ADMIN_STATS, DashboardService.computeAdminStats);
  },

  computeAdminStats: function () {
    const users = UserRepository.all();
    const activeCutoff = DateUtils.addDays(new Date(), -30).toISOString();
    const days = DateUtils.lastNDays(14);

    const regMonths = DateUtils.lastNMonths(6);
    const regs = DashboardService.zeroMap(regMonths);
    users.forEach(function (u) {
      const mk = DateUtils.monthKey(u.created_at);
      if (regs[mk] !== undefined) regs[mk]++;
    });

    const activity = DashboardService.zeroMap(days);
    const logs = AuditRepository.all();
    logs.forEach(function (l) {
      const dk = DateUtils.dayKey(l.created_at);
      if (activity[dk] !== undefined) activity[dk]++;
    });
    const usersById = {};
    users.forEach(function (u) { usersById[u.user_id] = u; });
    const modules = CrudEngine.adminStats(days);

    return {
      kpi: {
        totalUsers: users.length,
        activeUsers: users.filter(function (u) { return u.status === USER_STATUS.ACTIVE && u.last_login_at && u.last_login_at >= activeCutoff; }).length,
        totalRecords: modules.reduce(function (n, m) { return n + m.total; }, 0),
        recordsToday: modules.reduce(function (n, m) { return n + m.today; }, 0),
        recordsMonth: modules.reduce(function (n, m) { return n + m.month; }, 0),
        newFeedback: FeedbackRepository.all().filter(function (f) { return f.status === FEEDBACK_STATUS.NEW; }).length
      },
      modules: modules,
      charts: {
        registrations: DashboardService.series(regs),
        activity: DashboardService.series(activity)
      },
      recentActivity: logs.slice(-10).reverse().map(function (l) { return AuditModel.toDTO(l, usersById); }),
      generatedAt: DateUtils.nowIso()
    };
  },

  zeroMap: function (keys) {
    const m = {};
    keys.forEach(function (k) { m[k] = 0; });
    return m;
  },

  series: function (map) {
    return Object.keys(map).map(function (k) { return { label: k, value: map[k] }; });
  }
};
