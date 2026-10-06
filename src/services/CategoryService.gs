/**
 * @file CategoryService.gs
 */
const CategoryService = {
  schema: function (partial) {
    return {
      nameMs: { type: 'string', required: !partial, min: 2, max: 40, label: 'Nama (BM)' },
      nameEn: { type: 'string', max: 40, label: 'Nama (EN)' },
      description: { type: 'string', max: 200, label: 'Penerangan' },
      icon: { type: 'string', enum: CATEGORY_ICONS, default: 'star', label: 'Ikon' },
      sortOrder: { type: 'int', min: 0, max: 999, default: 100, label: 'Susunan' }
    };
  },

  listActive: function () {
    return CategoryRepository.active().map(CategoryModel.toDTO);
  },

  listAll: function () {
    const counts = CrudEngine.countByCategory();
    return {
      items: CategoryRepository.all().map(function (c) {
        const dto = CategoryModel.toDTO(c);
        dto.recordCount = counts[c.category_id] || 0;
        return dto;
      }),
      icons: CATEGORY_ICONS
    };
  },

  assertUniqueName: function (name, exceptId) {
    const n = name.toLowerCase();
    const dup = CategoryRepository.all().some(function (c) { return c.name_ms.toLowerCase() === n && c.category_id !== exceptId; });
    if (dup) throw Errors.conflict('Nama kategori telah wujud.');
  },

  create: function (ctx, payload) {
    const data = Validator.validate(payload, CategoryService.schema(false));
    CategoryService.assertUniqueName(data.nameMs);
    const now = DateUtils.nowIso();
    const row = CategoryRepository.insert({
      category_id: IdUtils.generate('C'),
      name_ms: data.nameMs,
      name_en: data.nameEn || '',
      description: data.description || '',
      icon: data.icon,
      sort_order: data.sortOrder,
      status: CATEGORY_STATUS.ACTIVE,
      created_at: now,
      updated_at: now
    });
    AuditService.log(ctx, AUDIT_ACTIONS.CATEGORY_CREATED, 'CATEGORY', row.category_id, row.name_ms);
    return CategoryModel.toDTO(row);
  },

  update: function (ctx, payload) {
    const schema = CategoryService.schema(true);
    delete schema.icon.default;
    delete schema.sortOrder.default;
    schema.id = { type: 'id', prefix: 'C', required: true, label: 'Kategori' };
    schema.status = { type: 'enum', values: [CATEGORY_STATUS.ACTIVE, CATEGORY_STATUS.INACTIVE], label: 'Status' };
    const data = Validator.validate(payload, schema);
    const cat = CategoryRepository.findById(data.id);
    if (!cat) throw Errors.notFound('Kategori');
    const patch = {};
    if (data.nameMs) { CategoryService.assertUniqueName(data.nameMs, cat.category_id); patch.name_ms = data.nameMs; }
    if (payload.nameEn !== undefined) patch.name_en = data.nameEn || '';
    if (payload.description !== undefined) patch.description = data.description || '';
    if (data.icon) patch.icon = data.icon;
    if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder;
    if (data.status) {
      if (data.status === CATEGORY_STATUS.INACTIVE && cat.status === CATEGORY_STATUS.ACTIVE && CategoryRepository.active().length <= 1) {
        throw Errors.validation('Sekurang-kurangnya satu kategori mesti aktif.');
      }
      patch.status = data.status;
    }
    const updated = CategoryRepository.update(cat.category_id, patch);
    AuditService.log(ctx, AUDIT_ACTIONS.CATEGORY_UPDATED, 'CATEGORY', cat.category_id, Object.keys(patch).join(', '));
    return CategoryModel.toDTO(updated);
  }
};
