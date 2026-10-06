/**
 * @file SettingsRepository.gs
 * Tetapan key-value. Dicache (CacheService) kerana dibaca pada hampir setiap permintaan.
 */
const SettingsRepository = {
  CACHE_KEY: 'settings',

  base: function () { return Repo.of('SETTINGS'); },

  /** @return {Object<string,string>} */
  map: function () {
    const memo = Database.cacheGet('settings:map');
    if (memo) return memo;
    const m = AppCache.remember(SettingsRepository.CACHE_KEY, CONFIG.CACHE_TTL.SETTINGS, function () {
      const out = {};
      SettingsRepository.base().all().forEach(function (r) { out[r.setting_key] = r.setting_value; });
      return out;
    });
    return Database.cacheSet('settings:map', m);
  },

  rows: function () { return SettingsRepository.base().all(); },

  /** Upsert berkelompok. @param {Object<string,string>} values */
  setMany: function (values, updatedBy, descriptions) {
    const repo = SettingsRepository.base();
    const now = DateUtils.nowIso();
    Database.withLock(function () {
      repo.invalidate();
      const existing = {};
      repo.all().forEach(function (r) { existing[r.setting_key] = true; });
      const patch = {};
      const inserts = [];
      Object.keys(values).forEach(function (k) {
        const row = { setting_value: String(values[k]), updated_by: updatedBy || 'SYSTEM', updated_at: now };
        if (existing[k]) patch[k] = row;
        else inserts.push(Object.assign({ setting_key: k, description: (descriptions && descriptions[k]) || '' }, row));
      });
      repo.updateMany(patch);
      repo.insertMany(inserts);
    });
    AppCache.remove(SettingsRepository.CACHE_KEY);
    Database.invalidate('settings:map');
  }
};
