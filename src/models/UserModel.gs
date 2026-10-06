/**
 * @file UserModel.gs
 * DTO pengguna. Hash kata laluan tidak pernah berada dalam objek USERS.
 */
const UserModel = {
  /** Untuk pengguna sendiri. */
  toSelf: function (u) {
    if (!u) return null;
    return {
      id: u.user_id,
      email: u.email,
      fullName: u.full_name,
      phone: u.phone,
      initials: StringUtils.initials(u.full_name),
      role: u.role,
      status: u.status,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at
    };
  },

  /** Untuk senarai admin. */
  toAdmin: function (u) {
    const dto = UserModel.toSelf(u);
    dto.authProvider = u.auth_provider;
    dto.updatedAt = u.updated_at;
    return dto;
  },

  /** Minimum untuk paparan awam (cth. nama pemilik pautan). */
  toPublic: function (u) {
    return u ? { fullName: u.full_name, initials: StringUtils.initials(u.full_name) } : null;
  }
};
