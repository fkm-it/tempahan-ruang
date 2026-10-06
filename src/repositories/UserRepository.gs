/**
 * @file UserRepository.gs
 * Akses data pengguna, kelayakan (hash kata laluan) dan sesi.
 */
const UserRepository = {
  base: function () { return Repo.of('USERS'); },

  findById: function (id) { return UserRepository.base().findById(id); },

  findByEmail: function (email) {
    const e = StringUtils.normalizeEmail(email);
    return UserRepository.base().findOne(function (u) { return u.email === e; });
  },

  all: function () { return UserRepository.base().all(); },

  create: function (data) {
    const now = DateUtils.nowIso();
    return UserRepository.base().insert({
      user_id: IdUtils.generate('U'),
      email: data.email,
      full_name: data.full_name,
      phone: data.phone || '',
      photo_url: '',
      role: data.role || ROLES.USER,
      status: USER_STATUS.ACTIVE,
      auth_provider: data.auth_provider || 'PASSWORD',
      created_at: now,
      updated_at: now,
      last_login_at: ''
    });
  },

  update: function (id, patch) {
    patch.updated_at = DateUtils.nowIso();
    return UserRepository.base().update(id, patch);
  },

  countByRole: function (role) {
    return UserRepository.base().find(function (u) { return u.role === role && u.status === USER_STATUS.ACTIVE; }).length;
  }
};

const CredentialRepository = {
  base: function () { return Repo.of('CREDENTIALS'); },

  getHash: function (userId) {
    const c = CredentialRepository.base().findById(userId);
    return c ? c.password_hash : '';
  },

  /** Upsert hash kata laluan. */
  setHash: function (userId, hash) {
    const repo = CredentialRepository.base();
    return Database.withLock(function () {
      if (repo.locateRow(userId) > 0) {
        return repo.update(userId, { password_hash: hash, updated_at: DateUtils.nowIso() });
      }
      return repo.insert({ user_id: userId, password_hash: hash, updated_at: DateUtils.nowIso() });
    });
  }
};

const SessionRepository = {
  base: function () { return Repo.of('SESSIONS'); },

  create: function (sessionId, userId, expiresAt, userAgentHash) {
    return SessionRepository.base().insert({
      session_id: sessionId,
      user_id: userId,
      expires_at: expiresAt,
      created_at: DateUtils.nowIso(),
      user_agent_hash: userAgentHash || '',
      revoked_at: ''
    });
  },

  findValid: function (sessionId) {
    const s = SessionRepository.base().findById(sessionId);
    if (!s || s.revoked_at) return null;
    if (new Date(s.expires_at).getTime() <= Date.now()) return null;
    return s;
  },

  revoke: function (sessionId) {
    try {
      SessionRepository.base().update(sessionId, { revoked_at: DateUtils.nowIso() });
    } catch (e) {
      if (!(e instanceof AppError && e.code === ERROR_CODES.NOT_FOUND)) throw e;
    }
  },

  /** Batalkan semua sesi aktif pengguna. @return {string[]} session_id yang dibatalkan */
  revokeAllForUser: function (userId, exceptSessionId) {
    const now = DateUtils.nowIso();
    const active = SessionRepository.base().find(function (s) {
      return s.user_id === userId && !s.revoked_at && s.session_id !== exceptSessionId;
    });
    const patch = {};
    active.forEach(function (s) { patch[s.session_id] = { revoked_at: now }; });
    SessionRepository.base().updateMany(patch);
    return active.map(function (s) { return s.session_id; });
  },

  /** Buang sesi tamat tempoh/dibatalkan lebih 1 hari. */
  purgeExpired: function () {
    const cutoff = Date.now() - 86400000;
    return SessionRepository.base().deleteWhere(function (s) {
      const exp = new Date(s.expires_at).getTime();
      const rev = s.revoked_at ? new Date(s.revoked_at).getTime() : 0;
      return exp < cutoff || (rev && rev < cutoff);
    });
  }
};
