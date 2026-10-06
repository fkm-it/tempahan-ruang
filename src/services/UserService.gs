/**
 * @file UserService.gs
 * Profil pengguna + pengurusan pengguna oleh admin.
 */
const UserService = {
  cacheKey: function (id) { return 'user:' + id; },

  /** Pengguna mengikut ID (CacheService 5 minit). */
  getCached: function (userId) {
    if (!userId) return null;
    const memo = Database.cacheGet('user:' + userId);
    if (memo) return memo;
    const u = AppCache.remember(UserService.cacheKey(userId), CONFIG.CACHE_TTL.USER, function () {
      return UserRepository.findById(userId);
    });
    return u ? Database.cacheSet('user:' + userId, u) : null;
  },

  invalidate: function (userId) {
    AppCache.remove(UserService.cacheKey(userId));
    Database.invalidate('user:' + userId);
  },

  me: function (ctx) {
    return UserModel.toSelf(ctx.user);
  },

  updateProfile: function (ctx, payload) {
    const data = Validator.validate(payload, {
      fullName: { type: 'string', required: true, min: 3, max: CONFIG.NAME_MAX, label: 'Nama penuh' },
      phone: { type: 'phone', label: 'No. telefon' }
    });
    const updated = UserRepository.update(ctx.userId, { full_name: data.fullName, phone: data.phone || '' });
    UserService.invalidate(ctx.userId);
    AuditService.log(ctx, AUDIT_ACTIONS.PROFILE_UPDATED, 'USER', ctx.userId, '');
    return UserModel.toSelf(updated);
  },

  /** Senarai pengguna untuk admin. */
  list: function (filters) {
    const f = Validator.validate(filters, {
      q: { type: 'string', max: 80 },
      role: { type: 'enum', values: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN] },
      status: { type: 'enum', values: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE, USER_STATUS.BLOCKED] },
      sort: { type: 'enum', values: ['NEWEST', 'OLDEST', 'NAME', 'LAST_LOGIN'], default: 'NEWEST' }
    });
    const q = (f.q || '').toLowerCase();
    let rows = UserRepository.all().filter(function (u) {
      if (f.role && u.role !== f.role) return false;
      if (f.status && u.status !== f.status) return false;
      if (q && (u.full_name + ' ' + u.email + ' ' + u.phone + ' ' + u.user_id).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    const sorters = {
      NEWEST: function (a, b) { return a.created_at < b.created_at ? 1 : -1; },
      OLDEST: function (a, b) { return a.created_at > b.created_at ? 1 : -1; },
      NAME: function (a, b) { return a.full_name.localeCompare(b.full_name); },
      LAST_LOGIN: function (a, b) { return (a.last_login_at || '') < (b.last_login_at || '') ? 1 : -1; }
    };
    rows = rows.slice().sort(sorters[f.sort]);
    const recordCounts = CrudEngine.countByOwner();
    const page = Validator.paginate(rows, Validator.paging(filters, 20));
    page.items = page.items.map(function (u) {
      const dto = UserModel.toAdmin(u);
      dto.recordCount = recordCounts[u.user_id] || 0;
      dto.locked = UserService.isLocked(u.email);
      return dto;
    });
    return page;
  },

  /** Peraturan: tidak boleh ubah diri sendiri; ADMIN tidak boleh ubah ADMIN/SUPER_ADMIN. */
  assertCanManage: function (ctx, target) {
    if (!target) throw Errors.notFound('Pengguna');
    if (target.user_id === ctx.userId) throw Errors.forbidden('Anda tidak boleh mengubah akaun anda sendiri di sini.');
    if (ROLE_LEVEL[target.role] >= ROLE_LEVEL[ctx.role]) throw Errors.forbidden('Anda tidak boleh mengurus pengguna dengan peranan setara atau lebih tinggi.');
  },

  setStatus: function (ctx, payload) {
    const data = Validator.validate(payload, {
      userId: { type: 'id', prefix: 'U', required: true, label: 'Pengguna' },
      status: { type: 'enum', values: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE, USER_STATUS.BLOCKED], required: true, label: 'Status' },
      reason: { type: 'string', max: 200 }
    });
    const target = UserRepository.findById(data.userId);
    UserService.assertCanManage(ctx, target);
    if (target.status === data.status) return UserModel.toAdmin(target);
    const updated = UserRepository.update(target.user_id, { status: data.status });
    UserService.invalidate(target.user_id);
    let revoked = 0;
    if (data.status !== USER_STATUS.ACTIVE) revoked = AuthService.revokeAllForUser(target.user_id);
    const action = data.status === USER_STATUS.BLOCKED ? AUDIT_ACTIONS.USER_BLOCKED
      : data.status === USER_STATUS.ACTIVE ? AUDIT_ACTIONS.USER_ACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED;
    AuditService.log(ctx, action, 'USER', target.user_id,
      target.status + ' → ' + data.status + (data.reason ? ' · ' + data.reason : '') + (revoked ? ' · ' + revoked + ' sesi ditamatkan' : ''));
    if (data.status === USER_STATUS.ACTIVE) {
      NotificationService.notify(target.user_id, NOTIF_TYPE.ACCOUNT, 'Akaun diaktifkan', 'Akaun anda kini aktif semula.', '');
    }
    return UserModel.toAdmin(updated);
  },

  /** Tukar peranan — SUPER_ADMIN sahaja (dikuatkuasa di Router). Mesti kekal ≥1 SUPER_ADMIN aktif. */
  setRole: function (ctx, payload) {
    const data = Validator.validate(payload, {
      userId: { type: 'id', prefix: 'U', required: true, label: 'Pengguna' },
      role: { type: 'enum', values: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], required: true, label: 'Peranan' }
    });
    const target = UserRepository.findById(data.userId);
    if (!target) throw Errors.notFound('Pengguna');
    if (target.user_id === ctx.userId) throw Errors.forbidden('Anda tidak boleh menukar peranan anda sendiri.');
    if (target.role === data.role) return UserModel.toAdmin(target);
    if (target.role === ROLES.SUPER_ADMIN && UserRepository.countByRole(ROLES.SUPER_ADMIN) <= 1) {
      throw Errors.forbidden('Sistem memerlukan sekurang-kurangnya seorang SUPER_ADMIN.');
    }
    const updated = UserRepository.update(target.user_id, { role: data.role });
    UserService.invalidate(target.user_id);
    // Paksa log masuk semula supaya keistimewaan baharu/lama berkuat kuasa bersih
    AuthService.revokeAllForUser(target.user_id);
    AuditService.log(ctx, AUDIT_ACTIONS.USER_ROLE_CHANGED, 'USER', target.user_id, target.role + ' → ' + data.role);
    return UserModel.toAdmin(updated);
  },

  revokeSessions: function (ctx, payload) {
    const data = Validator.validate(payload, { userId: { type: 'id', prefix: 'U', required: true, label: 'Pengguna' } });
    const target = UserRepository.findById(data.userId);
    UserService.assertCanManage(ctx, target);
    const n = AuthService.revokeAllForUser(target.user_id);
    AuditService.log(ctx, AUDIT_ACTIONS.USER_SESSIONS_REVOKED, 'USER', target.user_id, n + ' sesi');
    return { revoked: n };
  },

  lockKey: function (email) { return 'loginfail:' + SecurityUtils.shortHash(StringUtils.normalizeEmail(email)); },

  /** Akaun dikunci sementara kerana terlalu banyak cubaan log masuk gagal? */
  isLocked: function (email) {
    const f = AppCache.get(UserService.lockKey(email));
    return !!(f && f.n >= CONFIG.LOGIN_MAX_FAILS);
  },

  /**
   * SUPER_ADMIN mencipta akaun (cth. apabila pendaftaran ditutup). Tiada kata laluan ditetapkan oleh pentadbir:
   * pengguna menerima kod set kata laluan melalui email (aliran "Lupa kata laluan").
   */
  createByAdmin: function (ctx, payload) {
    const data = Validator.validate(payload, {
      fullName: { type: 'string', required: true, min: 3, max: CONFIG.NAME_MAX, label: 'Nama penuh' },
      email: { type: 'email', required: true, label: 'Email' },
      role: { type: 'enum', values: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN], required: true, label: 'Peranan' }
    });
    SecurityService.rateLimit('auth.register.global', 'all');
    const user = Database.withLock(function () {
      UserRepository.base().invalidate();
      if (UserRepository.findByEmail(data.email)) throw Errors.conflict('Email ini telah didaftarkan.');
      return UserRepository.create({ email: data.email, full_name: data.fullName, phone: '', role: data.role });
    });
    AuditService.log(ctx, AUDIT_ACTIONS.USER_CREATED, 'USER', user.user_id, StringUtils.maskEmail(user.email) + ' · ' + data.role);
    const name = SettingsService.get('SYSTEM_NAME');
    NotificationService.email(user.email, 'Akaun anda telah dicipta', [
      'Salam ' + user.full_name + ',',
      'Akaun ' + (data.role === ROLES.USER ? 'pengguna' : 'pentadbir') + ' ' + name + ' telah dicipta untuk anda oleh ' + ((ctx.user && ctx.user.full_name) || 'pentadbir') + '.',
      'Kod untuk menetapkan kata laluan dihantar dalam email berasingan. Buka halaman "Lupa kata laluan", masukkan email ini dan kod tersebut. Jika kod telah luput, minta kod baharu di halaman yang sama.'
    ], { path: '#/lupa-kata-laluan' });
    AuthService.requestPasswordReset({ email: user.email }, ctx, true);
    return UserModel.toAdmin(user);
  },

  /** Buka kunci log masuk (selepas terlalu banyak cubaan gagal). */
  unlock: function (ctx, payload) {
    const data = Validator.validate(payload, { userId: { type: 'id', prefix: 'U', required: true, label: 'Pengguna' } });
    const target = UserRepository.findById(data.userId);
    UserService.assertCanManage(ctx, target);
    AppCache.remove(UserService.lockKey(target.email));
    AuditService.log(ctx, AUDIT_ACTIONS.USER_UNLOCKED, 'USER', target.user_id, StringUtils.maskEmail(target.email));
    return { unlocked: true };
  },

  /** Admin mencetuskan email set semula — admin tidak pernah melihat/menetapkan kata laluan. */
  sendReset: function (ctx, payload) {
    const data = Validator.validate(payload, { userId: { type: 'id', prefix: 'U', required: true, label: 'Pengguna' } });
    const target = UserRepository.findById(data.userId);
    UserService.assertCanManage(ctx, target);
    return AuthService.requestPasswordReset({ email: target.email }, ctx, true);
  }
};
