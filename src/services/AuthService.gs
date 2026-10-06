/**
 * @file AuthService.gs
 * Pendaftaran, log masuk, sesi, log keluar, tukar & set semula kata laluan.
 *
 * Reka bentuk sesi:
 *  - Token rawak 256-bit dipulangkan kepada klien SEKALI sahaja.
 *  - Server simpan SHA-256(token) sahaja (SESSIONS) + cache 6 jam untuk semakan pantas.
 *  - Token dihantar dalam payload google.script.run (bukan cookie) → tiada vektor CSRF klasik.
 *  - Sekat/nyahaktif pengguna → semua sesi dibatalkan serta-merta.
 */
const AuthService = {
  sessionCacheKey: function (sessionId) { return 'sess:' + sessionId; },

  /** Cipta sesi baharu. @return {{token:string, expiresAt:string}} */
  createSession: function (user, remember, userAgent) {
    const token = SecurityUtils.randomToken();
    const sessionId = SecurityUtils.sha256Hex(token);
    const expires = remember
      ? DateUtils.addDays(new Date(), CONFIG.SESSION_REMEMBER_DAYS)
      : DateUtils.addMinutes(new Date(), CONFIG.SESSION_TTL_HOURS * 60);
    SessionRepository.create(sessionId, user.user_id, expires.toISOString(), SecurityUtils.shortHash(userAgent));
    AppCache.put(AuthService.sessionCacheKey(sessionId), { userId: user.user_id, exp: expires.getTime() }, CONFIG.SESSION_CACHE_SECONDS);
    return { token: token, expiresAt: expires.toISOString() };
  },

  /**
   * Selesaikan token → konteks pengguna. Pulang null jika tidak sah.
   * @return {{userId:string, role:string, user:Object, sessionId:string}|null}
   */
  resolveSession: function (token) {
    if (!SecurityUtils.isTokenFormat(token)) return null;
    const sessionId = SecurityUtils.sha256Hex(token);
    const ck = AuthService.sessionCacheKey(sessionId);
    let s = AppCache.get(ck);
    if (!s) {
      const row = SessionRepository.findValid(sessionId);
      if (!row) return null;
      s = { userId: row.user_id, exp: new Date(row.expires_at).getTime() };
      AppCache.put(ck, s, CONFIG.SESSION_CACHE_SECONDS);
    }
    if (s.revoked || s.exp <= Date.now()) return null;
    const user = UserService.getCached(s.userId);
    if (!user || user.status !== USER_STATUS.ACTIVE) return null;
    return { userId: user.user_id, role: user.role, user: user, sessionId: sessionId };
  },

  /** Batalkan sesi (sheet + cache). Cache ditanda 'revoked' supaya pembatalan berkuat kuasa serta-merta. */
  revokeSessions: function (sessionIds) {
    sessionIds.forEach(function (id) {
      AppCache.put(AuthService.sessionCacheKey(id), { revoked: true, exp: 0 }, CONFIG.SESSION_CACHE_SECONDS);
    });
  },

  revokeAllForUser: function (userId, exceptSessionId) {
    const ids = SessionRepository.revokeAllForUser(userId, exceptSessionId);
    AuthService.revokeSessions(ids);
    return ids.length;
  },

  register: function (payload, ctx) {
    const settings = SettingsService.all();
    const data = Validator.validate(payload, {
      fullName: { type: 'string', required: true, min: 3, max: CONFIG.NAME_MAX, label: 'Nama penuh' },
      email: { type: 'email', required: true, label: 'Email' },
      phone: { type: 'phone', label: 'No. telefon' },
      password: { type: 'string', required: true, raw: true, label: 'Kata laluan' },
      remember: { type: 'boolean', default: false }
    });
    // Pendaftaran ditutup → hanya email BOOTSTRAP_SUPER_ADMIN_EMAIL (sebelum Super Admin pertama wujud) dibenarkan
    const boot = StringUtils.normalizeEmail(Env.get('BOOTSTRAP_SUPER_ADMIN_EMAIL'));
    if (!settings.ALLOW_REGISTRATION && !(boot && boot === data.email && UserRepository.countByRole(ROLES.SUPER_ADMIN) === 0)) {
      throw Errors.forbidden('Pendaftaran baharu ditutup buat masa ini.');
    }
    Validator.password(data.password, data.email);
    SecurityService.rateLimit('auth.register.global', 'all');
    SecurityService.rateLimit('auth.register', data.email);

    // Hash di LUAR kunci (operasi berat), semak keunikan DI DALAM kunci.
    const hash = SecurityUtils.hashPassword(data.password);
    const bootstrap = StringUtils.normalizeEmail(Env.get('BOOTSTRAP_SUPER_ADMIN_EMAIL'));
    const user = Database.withLock(function () {
      UserRepository.base().invalidate();
      if (UserRepository.findByEmail(data.email)) throw Errors.conflict('Email ini telah didaftarkan. Sila log masuk.');
      const isBootstrap = bootstrap && bootstrap === data.email && UserRepository.countByRole(ROLES.SUPER_ADMIN) === 0;
      const u = UserRepository.create({
        email: data.email,
        full_name: data.fullName,
        phone: data.phone || '',
        role: isBootstrap ? ROLES.SUPER_ADMIN : ROLES.USER
      });
      CredentialRepository.setHash(u.user_id, hash);
      return u;
    });

    NotificationService.notify(user.user_id, NOTIF_TYPE.WELCOME, 'Selamat datang ke ' + SettingsService.get('SYSTEM_NAME'),
      'Akaun anda telah sedia. Hidupkan notifikasi telefon di Profil untuk dimaklumkan serta-merta.', '');
    const actorCtx = { userId: user.user_id, role: user.role, userAgent: ctx && ctx.userAgent };
    AuditService.log(actorCtx, AUDIT_ACTIONS.USER_REGISTERED, 'AUTH', user.user_id, 'Pendaftaran ' + StringUtils.maskEmail(user.email));
    const session = AuthService.createSession(user, data.remember, ctx && ctx.userAgent);
    return { token: session.token, expiresAt: session.expiresAt, user: UserModel.toSelf(user) };
  },

  login: function (payload, ctx) {
    const data = Validator.validate(payload, {
      email: { type: 'email', required: true, label: 'Email' },
      password: { type: 'string', required: true, raw: true, max: CONFIG.PASSWORD_MAX_LENGTH, label: 'Kata laluan' },
      remember: { type: 'boolean', default: false }
    });
    SecurityService.rateLimit('auth.login.global', 'all');
    SecurityService.rateLimit('auth.login', data.email);

    const lockKey = 'loginfail:' + SecurityUtils.shortHash(data.email);
    const fails = AppCache.get(lockKey) || { n: 0 };
    if (fails.n >= CONFIG.LOGIN_MAX_FAILS) {
      throw new AppError(ERROR_CODES.RATE_LIMITED, 'Akaun dikunci sementara kerana terlalu banyak cubaan. Cuba lagi dalam ' + CONFIG.LOGIN_LOCK_MINUTES + ' minit.');
    }

    const user = UserRepository.findByEmail(data.email);
    const check = SecurityUtils.verifyPassword(data.password, user ? CredentialRepository.getHash(user.user_id) : '');
    if (!user || !check.valid) {
      AppCache.put(lockKey, { n: fails.n + 1 }, CONFIG.LOGIN_LOCK_MINUTES * 60);
      AuditService.log({ userId: user ? user.user_id : '', role: ROLES.PUBLIC, userAgent: ctx && ctx.userAgent },
        AUDIT_ACTIONS.LOGIN_FAILED, 'AUTH', '', 'Cubaan gagal untuk ' + StringUtils.maskEmail(data.email));
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Email atau kata laluan tidak sah.');
    }
    if (user.status === USER_STATUS.BLOCKED) throw Errors.forbidden('Akaun anda telah disekat. Sila hubungi pentadbir.');
    if (user.status !== USER_STATUS.ACTIVE) throw Errors.forbidden('Akaun anda tidak aktif. Sila hubungi pentadbir.');
    if (SettingsService.get('MAINTENANCE_MODE') && !SecurityService.hasRole(user.role, ROLES.ADMIN)) throw Errors.maintenance();

    AppCache.remove(lockKey);
    if (check.needsRehash) CredentialRepository.setHash(user.user_id, SecurityUtils.hashPassword(data.password));
    const updated = UserRepository.update(user.user_id, { last_login_at: DateUtils.nowIso() });
    UserService.invalidate(user.user_id);
    const isAdmin = SecurityService.hasRole(user.role, ROLES.ADMIN);
    AuditService.log({ userId: user.user_id, role: user.role, userAgent: ctx && ctx.userAgent },
      isAdmin ? AUDIT_ACTIONS.ADMIN_LOGIN : AUDIT_ACTIONS.USER_LOGIN, 'AUTH', user.user_id, '');
    const session = AuthService.createSession(updated, data.remember, ctx && ctx.userAgent);
    return { token: session.token, expiresAt: session.expiresAt, user: UserModel.toSelf(updated) };
  },

  logout: function (ctx) {
    if (ctx && ctx.sessionId) {
      SessionRepository.revoke(ctx.sessionId);
      AuthService.revokeSessions([ctx.sessionId]);
      AuditService.log(ctx, AUDIT_ACTIONS.USER_LOGOUT, 'AUTH', ctx.userId, '');
    }
    return { loggedOut: true };
  },

  changePassword: function (ctx, payload) {
    const data = Validator.validate(payload, {
      currentPassword: { type: 'string', required: true, raw: true, max: CONFIG.PASSWORD_MAX_LENGTH, label: 'Kata laluan semasa' },
      newPassword: { type: 'string', required: true, raw: true, label: 'Kata laluan baharu' },
      logoutOthers: { type: 'boolean', default: true }
    });
    SecurityService.rateLimit('auth.login', ctx.user.email);
    const check = SecurityUtils.verifyPassword(data.currentPassword, CredentialRepository.getHash(ctx.userId));
    if (!check.valid) throw Errors.validation('Kata laluan semasa tidak betul.', { currentPassword: 'Kata laluan semasa tidak betul.' });
    Validator.password(data.newPassword, ctx.user.email);
    if (data.newPassword === data.currentPassword) throw Errors.validation('Kata laluan baharu mesti berbeza.');
    CredentialRepository.setHash(ctx.userId, SecurityUtils.hashPassword(data.newPassword));
    const revoked = data.logoutOthers ? AuthService.revokeAllForUser(ctx.userId, ctx.sessionId) : 0;
    NotificationService.notify(ctx.userId, NOTIF_TYPE.SECURITY, 'Kata laluan ditukar',
      'Kata laluan akaun anda telah ditukar. Jika bukan anda, sila hubungi pentadbir segera.', '');
    AuditService.log(ctx, AUDIT_ACTIONS.PASSWORD_CHANGED, 'AUTH', ctx.userId, revoked ? revoked + ' sesi lain ditamatkan' : '');
    return { changed: true, sessionsRevoked: revoked };
  },

  resetCacheKey: function (email) { return 'reset:' + SecurityUtils.shortHash(email); },

  /**
   * Hantar kod set semula (6 digit, 15 minit) ke email.
   * Respons SENTIASA sama — tidak mendedahkan sama ada email wujud (anti-enumerasi).
   */
  requestPasswordReset: function (payload, ctx, initiatedByAdmin) {
    const data = Validator.validate(payload, { email: { type: 'email', required: true, label: 'Email' } });
    if (!initiatedByAdmin) SecurityService.rateLimit('auth.requestReset', data.email);
    const user = UserRepository.findByEmail(data.email);
    if (user && user.status === USER_STATUS.ACTIVE) {
      const code = IdUtils.numericCode(6);
      AppCache.put(AuthService.resetCacheKey(data.email), {
        hash: SecurityUtils.hmacHex(code, Env.secret('FORM_SECRET')), attempts: 0
      }, CONFIG.RESET_CODE_TTL_MINUTES * 60);
      try {
        const name = SettingsService.get('SYSTEM_NAME');
        MailApp.sendEmail({
          to: user.email,
          subject: name + ' — Kod set semula kata laluan',
          htmlBody: '<p>Assalamualaikum ' + StringUtils.escapeHtml(user.full_name) + ',</p>' +
            '<p>Kod set semula kata laluan anda ialah:</p><p style="font-size:24px;letter-spacing:4px"><b>' + code + '</b></p>' +
            '<p>Kod ini sah selama ' + CONFIG.RESET_CODE_TTL_MINUTES + ' minit. Jika anda tidak meminta, abaikan email ini.</p>',
          name: name
        });
      } catch (e) {
        AppLogger.error('Gagal hantar email reset', { error: String(e) });
      }
      AuditService.log(initiatedByAdmin ? ctx : { userId: user.user_id, role: user.role, userAgent: ctx && ctx.userAgent },
        AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED, 'AUTH', user.user_id, initiatedByAdmin ? 'Dimulakan oleh pentadbir' : '');
    }
    return { message: 'Jika email tersebut berdaftar, kod set semula telah dihantar.' };
  },

  resetPassword: function (payload, ctx) {
    const data = Validator.validate(payload, {
      email: { type: 'email', required: true, label: 'Email' },
      code: { type: 'string', required: true, pattern: /^\d{6}$/, label: 'Kod' },
      newPassword: { type: 'string', required: true, raw: true, label: 'Kata laluan baharu' }
    });
    SecurityService.rateLimit('auth.resetPassword', data.email);
    const key = AuthService.resetCacheKey(data.email);
    const entry = AppCache.get(key);
    const invalid = new AppError(ERROR_CODES.VALIDATION_ERROR, 'Kod tidak sah atau telah tamat tempoh.');
    if (!entry) throw invalid;
    if (entry.attempts >= CONFIG.RESET_MAX_ATTEMPTS) { AppCache.remove(key); throw invalid; }
    const ok = SecurityUtils.constantTimeEquals(SecurityUtils.hmacHex(data.code, Env.secret('FORM_SECRET')), entry.hash);
    if (!ok) {
      entry.attempts += 1;
      AppCache.put(key, entry, CONFIG.RESET_CODE_TTL_MINUTES * 60);
      throw invalid;
    }
    const user = UserRepository.findByEmail(data.email);
    if (!user || user.status !== USER_STATUS.ACTIVE) throw invalid;
    Validator.password(data.newPassword, user.email);
    CredentialRepository.setHash(user.user_id, SecurityUtils.hashPassword(data.newPassword));
    AppCache.remove(key);
    AuthService.revokeAllForUser(user.user_id);
    NotificationService.notify(user.user_id, NOTIF_TYPE.SECURITY, 'Kata laluan ditetapkan semula',
      'Kata laluan anda telah ditetapkan semula dan semua sesi lama ditamatkan.', '');
    AuditService.log({ userId: user.user_id, role: user.role, userAgent: ctx && ctx.userAgent }, AUDIT_ACTIONS.PASSWORD_RESET, 'AUTH', user.user_id, '');
    return { reset: true };
  }
};
