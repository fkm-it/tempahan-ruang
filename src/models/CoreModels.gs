/**
 * @file CoreModels.gs
 * DTO teras (kategori, notifikasi, audit). Model rekod modul dijana oleh CrudEngine.toDTO.
 */
const CategoryModel = {
  toDTO: function (c) {
    return {
      id: c.category_id,
      nameMs: c.name_ms,
      nameEn: c.name_en,
      description: c.description,
      icon: c.icon,
      sortOrder: c.sort_order,
      status: c.status
    };
  }
};

const NotificationModel = {
  toDTO: function (n) {
    return {
      id: n.notification_id,
      type: n.type,
      title: n.title,
      message: n.message,
      referenceId: n.reference_id,
      isRead: n.is_read,
      createdAt: n.created_at
    };
  }
};

const AuditModel = {
  toDTO: function (l, usersById) {
    const u = usersById && usersById[l.user_id];
    return {
      id: l.log_id,
      userId: l.user_id,
      userName: u ? u.full_name : (l.user_id ? l.user_id : 'Sistem / Awam'),
      role: l.role,
      action: l.action,
      module: l.module,
      referenceId: l.reference_id,
      description: l.description,
      createdAt: l.created_at
    };
  }
};
