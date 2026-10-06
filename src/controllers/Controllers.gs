/**
 * @file Controllers.gs
 * Pengawal NIPIS: terima (payload, ctx) → panggil service → pulang data.
 * Tiada logik perniagaan, tiada akses Sheets di sini. Kebenaran (RBAC) dikuatkuasa oleh Router
 * SEBELUM pengawal dipanggil; semakan pemilikan (IDOR) dibuat dalam service.
 */

const PublicController = {
  config: function () { return SettingsService.publicConfig(); },
  /** Satu panggilan semasa app dibuka (config + metadata modul) — kurang eksekusi Apps Script = lebih pantas. */
  bootstrap: function () { return { config: SettingsService.publicConfig(), modules: CrudEngine.meta() }; },
  categories: function () { return CategoryService.listActive(); },
  feedback: function (p, ctx) { return FeedbackService.submit(ctx, p); }
};

const AuthController = {
  register: function (p, ctx) { return AuthService.register(p, ctx); },
  login: function (p, ctx) { return AuthService.login(p, ctx); },
  logout: function (p, ctx) { return AuthService.logout(ctx); },
  me: function (p, ctx) {
    return { user: UserService.me(ctx), unreadNotifications: NotificationService.unreadCount(ctx.userId) };
  },
  changePassword: function (p, ctx) { return AuthService.changePassword(ctx, p); },
  requestReset: function (p, ctx) { return AuthService.requestPasswordReset(p, ctx, false); },
  resetPassword: function (p, ctx) { return AuthService.resetPassword(p, ctx); }
};

const UserController = {
  updateProfile: function (p, ctx) { return UserService.updateProfile(ctx, p); },
  dashboard: function (p, ctx) { return CrudEngine.summary(ctx); }
};

const CrudController = {
  meta: function () { return CrudEngine.meta(); },
  publicForm: function (p) { return CrudEngine.publicForm(p); },
  publicCreate: function (p, ctx) { return CrudEngine.publicCreate(ctx, p); },
  summary: function (p, ctx) { return CrudEngine.summary(ctx); },
  list: function (p, ctx) { return CrudEngine.list(ctx, p); },
  exportRows: function (p, ctx) { return CrudEngine.exportRows(ctx, p); },
  read: function (p, ctx) { return CrudEngine.read(ctx, p); },
  create: function (p, ctx) { return CrudEngine.create(ctx, p); },
  update: function (p, ctx) { return CrudEngine.update(ctx, p); },
  remove: function (p, ctx) { return CrudEngine.remove(ctx, p); },
  restore: function (p, ctx) { return CrudEngine.restore(ctx, p); },
  setStatus: function (p, ctx) { return CrudEngine.setStatus(ctx, p); },
  attachment: function (p, ctx) { return CrudEngine.attachment(ctx, p); },
  refOptions: function (p, ctx) { return CrudEngine.refOptionsFor(ctx, p); }
};

const PushController = {
  status: function (p, ctx) { return PushService.status(ctx); },
  register: function (p, ctx) { return PushService.register(ctx, p); },
  unregister: function (p, ctx) { return PushService.unregister(ctx, p); },
  test: function (p, ctx) { return PushService.test(ctx); }
};

const NotificationController = {
  list: function (p, ctx) { return NotificationService.list(ctx, p); },
  markRead: function (p, ctx) { return NotificationService.markRead(ctx, p); },
  markAllRead: function (p, ctx) { return NotificationService.markAllRead(ctx); }
};

const AdminController = {
  stats: function () { return DashboardService.adminStats(); },

  users: function (p) { return UserService.list(p); },
  userStatus: function (p, ctx) { return UserService.setStatus(ctx, p); },
  userRole: function (p, ctx) { return UserService.setRole(ctx, p); },
  userRevokeSessions: function (p, ctx) { return UserService.revokeSessions(ctx, p); },
  userSendReset: function (p, ctx) { return UserService.sendReset(ctx, p); },
  userCreate: function (p, ctx) { return UserService.createByAdmin(ctx, p); },
  userUnlock: function (p, ctx) { return UserService.unlock(ctx, p); },

  categories: function () { return CategoryService.listAll(); },
  categoryCreate: function (p, ctx) { return CategoryService.create(ctx, p); },
  categoryUpdate: function (p, ctx) { return CategoryService.update(ctx, p); },

  broadcast: function (p, ctx) { return NotificationService.broadcast(ctx, p); },
  broadcastHistory: function () { return NotificationService.broadcastHistory(); },

  audit: function (p) { return AuditService.list(p); },

  feedback: function (p) { return FeedbackService.list(p); },
  feedbackStatus: function (p, ctx) { return FeedbackService.setStatus(ctx, p); },

  settings: function (p, ctx) { return SettingsService.listForAdmin(ctx.role); },
  settingsUpdate: function (p, ctx) { return SettingsService.update(ctx, p && p.changes); },

  health: function () { return HealthService.check(); },
  backup: function (p, ctx) { return BackupService.run(ctx); },
  migrationStatus: function () { return Migration.status(); },
  systemLogs: function () {
    return SystemLogRepository.recent(50).map(function (l) {
      return { errorId: l.error_id, level: l.level, action: l.action, message: l.message, createdAt: l.created_at };
    });
  }
};
