/**
 * @file Router.gs
 * Satu-satunya pintu masuk API: api(request) di Code.gs → Router.dispatch().
 *
 * Setiap laluan MENGISYTIHARKAN peranan minimum. Router menguatkuasa:
 *   1. bentuk permintaan & saiz
 *   2. pengesahan sesi (token)
 *   3. RBAC
 *   4. mod penyelenggaraan
 *   5. pengendalian ralat seragam (tiada stack trace kepada pengguna)
 */
const Router = {
  routes: null,

  table: function () {
    if (Router.routes) return Router.routes;
    const P = ROLES.PUBLIC, U = ROLES.USER, A = ROLES.ADMIN, S = ROLES.SUPER_ADMIN;
    // allowInMaintenance: laluan yang tetap dibenarkan semasa mod penyelenggaraan
    Router.routes = {
      'public.config': { role: P, fn: PublicController.config, allowInMaintenance: true },
      'public.bootstrap': { role: P, fn: PublicController.bootstrap, allowInMaintenance: true },
      'public.logo': { role: P, fn: PublicController.logo, allowInMaintenance: true },
      'public.categories': { role: P, fn: PublicController.categories },
      'public.feedback': { role: P, fn: PublicController.feedback },

      'auth.register': { role: P, fn: AuthController.register },
      'auth.login': { role: P, fn: AuthController.login, allowInMaintenance: true },
      'auth.logout': { role: U, fn: AuthController.logout, allowInMaintenance: true },
      'auth.me': { role: U, fn: AuthController.me, allowInMaintenance: true },
      'auth.changePassword': { role: U, fn: AuthController.changePassword },
      'auth.requestReset': { role: P, fn: AuthController.requestReset },
      'auth.resetPassword': { role: P, fn: AuthController.resetPassword },

      'user.updateProfile': { role: U, fn: UserController.updateProfile },
      'user.dashboard': { role: U, fn: UserController.dashboard },

      // Modul (enjin CRUD generik — lihat modules/CrudEngine.gs). Kebenaran per modul disemak dalam enjin.
      'crud.meta': { role: P, fn: CrudController.meta, allowInMaintenance: true },
      'crud.publicForm': { role: P, fn: CrudController.publicForm },
      'crud.publicCreate': { role: P, fn: CrudController.publicCreate },
      'crud.summary': { role: U, fn: CrudController.summary },
      'crud.list': { role: U, fn: CrudController.list },
      'crud.export': { role: U, fn: CrudController.exportRows },
      'crud.get': { role: U, fn: CrudController.read },
      'crud.create': { role: U, fn: CrudController.create },
      'crud.update': { role: U, fn: CrudController.update },
      'crud.delete': { role: U, fn: CrudController.remove },
      'crud.restore': { role: A, fn: CrudController.restore },
      'crud.setStatus': { role: U, fn: CrudController.setStatus },
      'crud.attachment': { role: U, fn: CrudController.attachment },
      'crud.refOptions': { role: U, fn: CrudController.refOptions },

      'push.status': { role: U, fn: PushController.status, allowInMaintenance: true },
      'push.register': { role: U, fn: PushController.register, allowInMaintenance: true },
      'push.unregister': { role: U, fn: PushController.unregister, allowInMaintenance: true },
      'push.test': { role: U, fn: PushController.test },

      'notification.list': { role: U, fn: NotificationController.list },
      'notification.markRead': { role: U, fn: NotificationController.markRead },
      'notification.markAllRead': { role: U, fn: NotificationController.markAllRead },

      'admin.stats': { role: A, fn: AdminController.stats, allowInMaintenance: true },
      'admin.users': { role: A, fn: AdminController.users, allowInMaintenance: true },
      'admin.user.status': { role: A, fn: AdminController.userStatus, allowInMaintenance: true },
      'admin.user.role': { role: S, fn: AdminController.userRole, allowInMaintenance: true },
      'admin.user.revokeSessions': { role: A, fn: AdminController.userRevokeSessions, allowInMaintenance: true },
      'admin.user.sendReset': { role: A, fn: AdminController.userSendReset, allowInMaintenance: true },
      'admin.user.create': { role: S, fn: AdminController.userCreate, allowInMaintenance: true },
      'admin.user.unlock': { role: A, fn: AdminController.userUnlock, allowInMaintenance: true },
      'admin.categories': { role: A, fn: AdminController.categories, allowInMaintenance: true },
      'admin.category.create': { role: A, fn: AdminController.categoryCreate, allowInMaintenance: true },
      'admin.category.update': { role: A, fn: AdminController.categoryUpdate, allowInMaintenance: true },
      'admin.broadcast': { role: A, fn: AdminController.broadcast, allowInMaintenance: true },
      'admin.broadcastHistory': { role: A, fn: AdminController.broadcastHistory, allowInMaintenance: true },
      'admin.audit': { role: A, fn: AdminController.audit, allowInMaintenance: true },
      'admin.feedback': { role: A, fn: AdminController.feedback, allowInMaintenance: true },
      'admin.feedback.status': { role: A, fn: AdminController.feedbackStatus, allowInMaintenance: true },
      'admin.settings': { role: A, fn: AdminController.settings, allowInMaintenance: true },
      'admin.logo': { role: A, fn: AdminController.logoSave, allowInMaintenance: true },
      'admin.settings.update': { role: A, fn: AdminController.settingsUpdate, allowInMaintenance: true }, // per-kunci disemak dalam service

      'admin.health': { role: S, fn: AdminController.health, allowInMaintenance: true },
      'admin.backup': { role: S, fn: AdminController.backup, allowInMaintenance: true },
      'admin.migrations': { role: S, fn: AdminController.migrationStatus, allowInMaintenance: true },
      'admin.systemLogs': { role: S, fn: AdminController.systemLogs, allowInMaintenance: true }
    };
    Router.addModuleRoutes(Router.routes);
    return Router.routes;
  },

  /**
   * Laluan khusus modul daripada hooks: `<Name>Hooks.routes = { '<key>.nama': { role: 'PUBLIC', fn: function (payload, ctx) {…} } }`.
   * Nama mesti berawalan key modul (ruang nama) dan tidak boleh menindih laluan teras.
   */
  addModuleRoutes: function (table) {
    CrudEngine.modules().forEach(function (def) {
      const routes = CrudEngine.hooks(def).routes || {};
      Object.keys(routes).forEach(function (name) {
        const r = routes[name];
        if (name.indexOf(def.key + '.') !== 0) throw new Error('Laluan modul mesti berawalan "' + def.key + '.": ' + name);
        if (Object.prototype.hasOwnProperty.call(table, name)) throw new Error('Laluan berganda: ' + name);
        if (!r || typeof r.fn !== 'function' || ROLE_LEVEL[r.role] === undefined) throw new Error('Laluan tidak sah: ' + name);
        table[name] = { role: r.role, fn: r.fn, allowInMaintenance: !!r.allowInMaintenance };
      });
    });
  },

  /**
   * @param {{action:string, payload?:Object, token?:string, meta?:{userAgent?:string, lang?:string, rid?:string}}} request
   * @return {Object} ApiResponse
   */
  dispatch: function (request) {
    /*
     * Idempotensi: klien menghantar meta.rid unik bagi setiap tindakan (sama untuk setiap cubaan semula).
     * Google kadangkala gagal menghantar jawapan walaupun skrip telah siap (cth. HTTP 404 pada URL echo),
     * jadi klien mencuba semula — permintaan berulang mendapat jawapan asal, tindakan tidak dijalankan dua kali.
     */
    const rid = request && request.meta && typeof request.meta.rid === 'string' && /^[A-Za-z0-9_-]{12,64}$/.test(request.meta.rid) ? request.meta.rid : '';
    if (!rid) return Router.run(request);
    const key = 'rid:' + rid;
    let hit = AppCache.get(key);
    for (let i = 0; hit && hit.pending && i < 40; i++) { Utilities.sleep(500); hit = AppCache.get(key); } // cubaan asal masih berjalan
    if (hit && hit.res) return hit.res;
    if (hit && hit.pending) return ApiResponse.fail(ERROR_CODES.BUSY, 'Permintaan anda sedang diproses. Sila tunggu sebentar.');
    AppCache.put(key, { pending: true }, 120);
    const res = Router.run(request);
    AppCache.put(key, { res: res }, 600);
    return res;
  },

  run: function (request) {
    const started = Date.now();
    let action = '';
    try {
      Database.resetRequestCache();
      if (!request || typeof request !== 'object') throw Errors.badRequest();
      try { Migration.autoRun(); } catch (e) { ErrorHandler.record(e, { action: 'migration.autoRun' }); }
      action = String(request.action || '');
      const route = Object.prototype.hasOwnProperty.call(Router.table(), action) ? Router.table()[action] : null;
      if (!route) throw Errors.badRequest('Tindakan tidak dikenali.');

      const payload = request.payload === undefined || request.payload === null ? {} : request.payload;
      if (typeof payload !== 'object' || Array.isArray(payload)) throw Errors.badRequest();
      if (JSON.stringify(payload).length > CONFIG.MAX_REQUEST_CHARS) throw Errors.validation('Permintaan terlalu besar.');

      const userAgent = request.meta && typeof request.meta.userAgent === 'string' ? request.meta.userAgent.slice(0, 200) : '';
      const lang = request.meta && request.meta.lang === 'en' ? 'en' : 'ms'; // bahasa antara muka peminta (mesej & email)
      let ctx = { userId: '', role: ROLES.PUBLIC, user: null, sessionId: '', userAgent: userAgent, lang: lang };
      if (request.token) {
        const resolved = AuthService.resolveSession(String(request.token));
        if (resolved) ctx = Object.assign(ctx, resolved);
        else if (route.role !== ROLES.PUBLIC) throw Errors.unauthenticated();
      }

      SecurityService.requireRole(ctx, route.role);

      if (!route.allowInMaintenance && SettingsService.get('MAINTENANCE_MODE') && !SecurityService.hasRole(ctx.role, ROLES.ADMIN)) {
        throw Errors.maintenance();
      }

      const data = route.fn(payload, ctx);
      const res = ApiResponse.ok(data);
      res.meta.ms = Date.now() - started;
      return res;
    } catch (e) {
      const res = ErrorHandler.handle(e, { action: action });
      res.meta.ms = Date.now() - started;
      return res;
    }
  }
};
