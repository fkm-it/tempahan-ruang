/**
 * @file NotificationService.gs
 * Notifikasi dalam aplikasi + telefon (FCM) + email pilihan.
 */
const NotificationService = {
  build: function (userId, type, title, message, referenceId) {
    return {
      notification_id: IdUtils.generate('N'),
      user_id: userId,
      type: type,
      title: StringUtils.truncate(title, 120),
      message: StringUtils.truncate(message, 500),
      reference_id: referenceId || '',
      is_read: false,
      created_at: DateUtils.nowIso()
    };
  },

  /** Tidak melontar — notifikasi bukan laluan kritikal. */
  notify: function (userId, type, title, message, referenceId, path) {
    try {
      NotificationRepository.insertMany([NotificationService.build(userId, type, title, message, referenceId)]);
    } catch (e) {
      AppLogger.error('Notifikasi gagal', { type: type, error: String(e) });
    }
    // Notifikasi telefon (jika FCM dikonfigurasi & pengguna menghidupkannya). Tidak melontar.
    if (PushService.PUSH_TYPES.indexOf(type) >= 0) {
      let badge = '';
      try { badge = NotificationService.unreadCount(userId); } catch (e) { /* abaikan */ }
      PushService.sendToUser(userId, { title: title, body: message, type: type, ref: referenceId || '', path: path || '#/notifikasi', badge: badge });
    }
  },

  unreadCount: function (userId) {
    return NotificationRepository.byUser(userId).filter(function (n) { return !n.is_read; }).length;
  },

  list: function (ctx, filters) {
    const f = Validator.validate(filters, { unreadOnly: { type: 'boolean', default: false } });
    const rows = NotificationRepository.byUser(ctx.userId)
      .filter(function (n) { return !f.unreadOnly || !n.is_read; })
      .slice()
      .reverse();
    const page = Validator.paginate(rows, Validator.paging(filters, 20));
    page.items = page.items.map(NotificationModel.toDTO);
    page.meta.unread = NotificationService.unreadCount(ctx.userId);
    return page;
  },

  /** Pemilikan disemak — elak IDOR (tanda notifikasi pengguna lain). */
  markRead: function (ctx, payload) {
    const data = Validator.validate(payload, { id: { type: 'id', prefix: 'N', required: true, label: 'Notifikasi' } });
    const n = NotificationRepository.findById(data.id);
    if (!n || n.user_id !== ctx.userId) throw Errors.notFound('Notifikasi');
    if (!n.is_read) NotificationRepository.update(n.notification_id, { is_read: true });
    return { id: n.notification_id, unread: NotificationService.unreadCount(ctx.userId) };
  },

  markAllRead: function (ctx) {
    const patch = {};
    NotificationRepository.byUser(ctx.userId).forEach(function (n) {
      if (!n.is_read) patch[n.notification_id] = { is_read: true };
    });
    return { marked: NotificationRepository.updateMany(patch), unread: 0 };
  },

  /** Hebahan admin kepada semua pengguna aktif (sisipan berkelompok). */
  broadcast: function (ctx, payload) {
    const data = Validator.validate(payload, {
      title: { type: 'string', required: true, min: 3, max: 120, label: 'Tajuk' },
      message: { type: 'text', required: true, min: 5, max: 500, label: 'Mesej' },
      audience: { type: 'enum', values: ['ALL', 'USERS', 'ADMINS'], default: 'ALL', label: 'Sasaran' }
    });
    const users = UserRepository.all().filter(function (u) {
      if (u.status !== USER_STATUS.ACTIVE) return false;
      if (data.audience === 'USERS') return u.role === ROLES.USER;
      if (data.audience === 'ADMINS') return u.role !== ROLES.USER;
      return true;
    });
    const rows = users.map(function (u) { return NotificationService.build(u.user_id, NOTIF_TYPE.BROADCAST, data.title, data.message, ''); });
    NotificationRepository.insertMany(rows);
    AuditService.log(ctx, AUDIT_ACTIONS.NOTIFICATION_BROADCAST, 'NOTIFICATION', '', data.audience + ' · ' + rows.length + ' penerima · ' + data.title);
    return { sent: rows.length };
  },

  /** Senarai hebahan lepas (daripada audit). */
  broadcastHistory: function () {
    return AuditRepository.all()
      .filter(function (l) { return l.action === AUDIT_ACTIONS.NOTIFICATION_BROADCAST; })
      .slice(-20).reverse()
      .map(function (l) { return { description: l.description, createdAt: l.created_at, userId: l.user_id }; });
  },

  /** Notifikasi kepada semua ADMIN/SUPER_ADMIN aktif (cth. rekod baharu). */
  notifyAdmins: function (type, title, message, referenceId, path) {
    UserRepository.all().forEach(function (u) {
      if (u.status === USER_STATUS.ACTIVE && u.role !== ROLES.USER) NotificationService.notify(u.user_id, type, title, message, referenceId, path);
    });
  },

  /**
   * Email ringkas berjenama dengan butang ke app. Tidak melontar. @return {boolean}
   * Hanya dihantar jika tetapan NOTIFY_EMAIL_ENABLED dihidupkan (kecuali opts.force — cth. reset kata laluan).
   */
  email: function (to, subject, lines, opts) {
    const o = opts || {};
    try {
      if (!to || (!o.force && !SettingsService.get('NOTIFY_EMAIL_ENABLED'))) return false;
      if (MailApp.getRemainingDailyQuota() < 5) return false;
      const name = SettingsService.get('SYSTEM_NAME');
      const esc = StringUtils.escapeHtml;
      const base = PushService.baseUrl();
      const button = base ? '<p><a href="' + esc(base + (o.path || '#/notifikasi')) + '" style="display:inline-block;background:#4F46E5;color:#fff;' +
        'padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Buka ' + esc(name) + '</a></p>' : '';
      MailApp.sendEmail({
        to: to,
        subject: name + ' — ' + subject,
        htmlBody: (lines || []).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + button +
          '<p style="color:#888;font-size:12px">Email automatik daripada ' + esc(name) + '. Jangan balas email ini.</p>',
        name: name
      });
      return true;
    } catch (e) {
      AppLogger.warn('Email notifikasi gagal', { error: String(e) });
      return false;
    }
  }
};
