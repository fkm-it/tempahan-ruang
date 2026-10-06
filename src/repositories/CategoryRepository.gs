/**
 * @file CategoryRepository.gs
 * Kategori jarang berubah tetapi kerap dibaca → CacheService.
 */
const CategoryRepository = {
  CACHE_KEY: 'categories',

  base: function () { return Repo.of('CATEGORIES'); },

  all: function () {
    return AppCache.remember(CategoryRepository.CACHE_KEY, CONFIG.CACHE_TTL.CATEGORIES, function () {
      return CategoryRepository.base().all().slice().sort(function (a, b) {
        return a.sort_order - b.sort_order || a.name_ms.localeCompare(b.name_ms);
      });
    });
  },

  active: function () {
    return CategoryRepository.all().filter(function (c) { return c.status === CATEGORY_STATUS.ACTIVE; });
  },

  findById: function (id) {
    const list = CategoryRepository.all();
    for (let i = 0; i < list.length; i++) if (list[i].category_id === id) return list[i];
    return null;
  },

  /** Peta id → kategori. */
  map: function () {
    const m = {};
    CategoryRepository.all().forEach(function (c) { m[c.category_id] = c; });
    return m;
  },

  insert: function (row) {
    const r = CategoryRepository.base().insert(row);
    AppCache.remove(CategoryRepository.CACHE_KEY);
    return r;
  },

  insertMany: function (rows) {
    const r = CategoryRepository.base().insertMany(rows);
    AppCache.remove(CategoryRepository.CACHE_KEY);
    return r;
  },

  update: function (id, patch) {
    patch.updated_at = DateUtils.nowIso();
    const r = CategoryRepository.base().update(id, patch);
    AppCache.remove(CategoryRepository.CACHE_KEY);
    return r;
  }
};
