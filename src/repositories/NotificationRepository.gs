/**
 * @file NotificationRepository.gs
 */
const NotificationRepository = {
  base: function () { return Repo.of('NOTIFICATIONS'); },

  byUser: function (userId) {
    return NotificationRepository.base().find(function (n) { return n.user_id === userId; });
  },

  findById: function (id) { return NotificationRepository.base().findById(id); },

  insertMany: function (rows) { return NotificationRepository.base().insertMany(rows); },

  updateMany: function (patchById) { return NotificationRepository.base().updateMany(patchById); },

  update: function (id, patch) { return NotificationRepository.base().update(id, patch); }
};

const FeedbackRepository = {
  base: function () { return Repo.of('FEEDBACK'); },
  all: function () { return FeedbackRepository.base().all(); },
  findById: function (id) { return FeedbackRepository.base().findById(id); },
  insert: function (row) { return FeedbackRepository.base().insert(row); },
  update: function (id, patch) {
    patch.updated_at = DateUtils.nowIso();
    return FeedbackRepository.base().update(id, patch);
  }
};
