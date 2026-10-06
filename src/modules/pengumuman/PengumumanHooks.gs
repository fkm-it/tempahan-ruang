/**
 * @file PengumumanHooks.gs
 * Contoh hook: pengumuman yang telah tamat tempoh disembunyikan daripada pengguna (admin masih nampak),
 * dan pengumuman baharu dihebahkan kepada semua pengguna aktif (notifikasi dalam app + telefon).
 */
const PengumumanHooks = {
  visible: function (row) {
    return !row.tarikh_tamat || row.tarikh_tamat >= DateUtils.dayKey(new Date());
  },

  afterCreate: function (row, ctx) {
    UserRepository.all().forEach(function (u) {
      if (u.status === USER_STATUS.ACTIVE && u.user_id !== ctx.userId) {
        NotificationService.notify(u.user_id, NOTIF_TYPE.BROADCAST, (row.penting ? '⚠ ' : '') + row.tajuk,
          StringUtils.truncate(row.isi, 200), row.id, '#/pengumuman/' + row.id);
      }
    });
  }
};
