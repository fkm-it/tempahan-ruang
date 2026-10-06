/**
 * @file CrudEngine.gs
 * Enjin modul generik: SATU pelaksanaan CRUD + aliran status + lampiran + notifikasi + borang awam
 * untuk SEMUA modul yang ditakrif dalam modules/*.json (dijana ke src/modules/<key>/<Name>Module.gs).
 *
 * Kenapa enjin, bukan kod per modul:
 *   - Keselamatan (RBAC, IDOR, validasi, mass-assignment, XSS, formula injection) dikuatkuasa di SATU tempat dan diuji sekali.
 *   - Modul baharu = fail JSON → `npm run gen` → siap (backend + frontend + menu + migrasi).
 *   - Logik khusus domain masuk melalui HOOKS (<Name>Hooks.gs) — tidak menyentuh enjin.
 *
 * Hooks yang disokong (semua pilihan):
 *   validate(data, info)            → lontar Errors.validation/conflict untuk peraturan perniagaan (cth. tempahan bertindih)
 *   beforeSave(row, info)           → ubah baris sebelum disimpan (info.mode = 'create' | 'update' | 'public')
 *   afterCreate(row, ctx)           → kesan sampingan selepas rekod dicipta
 *   afterStatus(row, prevStatus, ctx) → kesan sampingan selepas status berubah
 *   toDTO(dto, row, ctx)            → tambah/ubah medan yang dihantar ke frontend
 *   visible(row, ctx)               → false untuk sembunyikan rekod daripada senarai bukan-admin (cth. pengumuman tamat)
 *   maintenance()                   → kerja harian (cth. auto-tutup rekod lama); pulangkan ringkasan
 *   info = { ctx, mode, current }
 */
const CrudEngine = {
  /** Lajur sistem yang ada pada setiap sheet modul (selain medan modul). */
  SYSTEM_COLUMNS_HEAD: ['id', 'ref_no', 'owner_user_id', 'owner_name'],
  SYSTEM_COLUMNS_TAIL: ['status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'],
  MAX_EXPORT: 2000,

  // ================================================================== Registry & metadata

  /** @return {Object[]} definisi modul (dari Registry.gs yang dijana). */
  modules: function () {
    if (CrudEngine.override) return CrudEngine.override; // ujian: modul fixture
    return typeof ModuleRegistry !== 'undefined' ? ModuleRegistry.list() : [];
  },

  /** Ujian sahaja: gantikan senarai modul. null = guna ModuleRegistry. */
  override: null,

  /** @return {Object} definisi modul — lontar BAD_REQUEST jika tidak wujud. */
  get: function (key) {
    const k = String(key || '');
    const list = CrudEngine.modules();
    for (let i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
    throw Errors.badRequest('Modul tidak dikenali.');
  },

  repo: function (def) { return Repo.of(def.sheet); },

  hooks: function (def) {
    try { return (def.hooks && def.hooks()) || {}; } catch (e) { return {}; }
  },

  isAdmin: function (ctx) { return !!ctx && SecurityService.hasRole(ctx.role, ROLES.ADMIN); },

  /** Metadata selamat untuk frontend (tiada rahsia dalam definisi modul). */
  meta: function () {
    return CrudEngine.modules().map(function (def) {
      return {
        key: def.key, name: def.name, label: def.label, labelPlural: def.labelPlural, description: def.description || '',
        icon: def.icon, path: def.path, prefix: def.prefix, sheet: def.sheet, nav: def.nav, access: def.access, statuses: def.statuses || [],
        statusRole: def.statusRole, titleField: def.titleField, subtitleField: def.subtitleField || '',
        publicForm: def.access.create === ROLES.PUBLIC ? (def.publicForm || {}) : null,
        fields: def.fields.map(function (f) {
          const o = Object.assign({}, f);
          delete o.column;
          return o;
        })
      };
    });
  },

  // ================================================================== Kebenaran

  canView: function (def, row, ctx) {
    if (!row || !ctx || !ctx.userId) return false;
    if (CrudEngine.isAdmin(ctx)) return true;
    if (row.state !== RECORD_STATE.ACTIVE) return false;
    if (def.access.list === 'ALL') return true;
    return row.owner_user_id === ctx.userId;
  },

  canEdit: function (def, row, ctx) {
    if (!row || row.state !== RECORD_STATE.ACTIVE) return false;
    if (CrudEngine.isAdmin(ctx)) return true;
    if (def.access.edit !== 'OWNER' || row.owner_user_id !== ctx.userId) return false;
    const allowed = def.access.ownerEditStatuses || [];
    return !allowed.length || allowed.indexOf(row.status) >= 0;
  },

  canDelete: function (def, row, ctx) {
    if (!row || row.state !== RECORD_STATE.ACTIVE) return false;
    if (CrudEngine.isAdmin(ctx)) return true;
    if (def.access.delete !== 'OWNER' || row.owner_user_id !== ctx.userId) return false;
    const allowed = def.access.ownerEditStatuses || [];
    return !allowed.length || allowed.indexOf(row.status) >= 0;
  },

  canSetStatus: function (def, row, ctx) {
    if (!(def.statuses && def.statuses.length) || !row || row.state !== RECORD_STATE.ACTIVE) return false;
    return SecurityService.hasRole(ctx.role, def.statusRole || ROLES.ADMIN);
  },

  /** Ambil rekod + semak akses. NOT_FOUND seragam (tidak dedahkan kewujudan rekod orang lain — IDOR). */
  requireViewable: function (def, id, ctx) {
    const row = CrudEngine.repo(def).findById(String(id || ''));
    if (!row || !CrudEngine.canView(def, row, ctx)) throw Errors.notFound(def.label);
    return row;
  },

  // ================================================================== Validasi

  /** Peraturan Validator bagi satu medan. */
  fieldRule: function (f, required) {
    const base = { label: f.label, required: !!required };
    switch (f.type) {
      case 'string': return Object.assign(base, { type: 'string', min: f.min, max: f.max || 200 });
      case 'text': return Object.assign(base, { type: 'text', min: f.min, max: f.max || 5000 });
      case 'email': return Object.assign(base, { type: 'email' });
      case 'phone': return Object.assign(base, { type: 'phone' });
      case 'int': return Object.assign(base, { type: 'int', min: f.min, max: f.max });
      case 'number': return Object.assign(base, { type: 'number', min: f.min, max: f.max, decimals: f.decimals });
      case 'date': return Object.assign(base, { type: 'date' });
      case 'time': return Object.assign(base, { type: 'time' });
      case 'bool': return Object.assign(base, { type: 'boolean' });
      case 'enum': return Object.assign(base, { type: 'enum', caseSensitive: true, values: (f.options || []).map(function (o) { return o.value; }) });
      case 'category': return Object.assign(base, { type: 'id', prefix: 'C' });
      case 'files': return Object.assign(base, { type: 'array', max: f.maxFiles || 3 });
      default: throw new Error('Jenis medan tidak disokong: ' + f.type);
    }
  },

  /** Medan yang boleh ditulis oleh peminta dalam mod tertentu. */
  writableFields: function (def, ctx, mode) {
    const admin = CrudEngine.isAdmin(ctx);
    return def.fields.filter(function (f) {
      if (f.readonly) return false;
      if (f.adminOnly && !admin) return false;
      if (mode === 'public' && (f.public === false || f.adminOnly)) return false;
      if (mode !== 'public' && f.publicOnly && !admin) return false; // cth. nama/email pengadu awam — pengguna log masuk sudah dikenali
      if (mode === 'update' && f.lockAfterCreate && !admin) return false;
      return true;
    });
  },

  /**
   * Sahkan payload → objek baris (lajur sheet) + fail untuk dimuat naik.
   * Medan tidak diisytihar dibuang (mass assignment). Pada kemas kini, medan pilihan boleh dikosongkan.
   * @return {{row:Object, files:Object[], data:Object}}
   */
  validate: function (def, payload, ctx, mode) {
    const fields = CrudEngine.writableFields(def, ctx, mode);
    const partial = mode === 'update';
    const schema = {};
    fields.forEach(function (f) {
      schema[f.key] = CrudEngine.fieldRule(f, f.required && f.type !== 'files' && !partial);
      if (!partial && f.default !== undefined && f.type !== 'files') schema[f.key].default = f.default;
    });
    const src = payload && typeof payload === 'object' ? payload : {};
    const data = Validator.validate(src, schema);
    const row = {};
    const files = [];
    const errors = {};
    fields.forEach(function (f) {
      const has = Object.prototype.hasOwnProperty.call(src, f.key);
      const empty = !has || src[f.key] === null || src[f.key] === '' || (typeof src[f.key] === 'string' && !src[f.key].trim());
      if (f.type === 'files') {
        (data[f.key] || []).forEach(function (file) { files.push({ field: f.key, file: file }); });
        return;
      }
      if (partial) {
        if (!has) return;
        if (empty) {
          if (f.required) { errors[f.key] = f.label + ' diperlukan.'; return; }
          row[f.column] = f.type === 'bool' ? false : '';
          return;
        }
      }
      if (data[f.key] === undefined) return;
      if (f.type === 'category') {
        const cat = CategoryRepository.findById(data[f.key]);
        if (!cat || cat.status !== CATEGORY_STATUS.ACTIVE) { errors[f.key] = f.label + ' tidak sah.'; return; }
      }
      row[f.column] = data[f.key];
    });
    // Medan kategori wajib tetapi tidak dipilih → kategori lalai (jika hanya satu kategori aktif, UI menyembunyikan pilihan)
    if (!partial) {
      fields.forEach(function (f) {
        if (f.type === 'category' && !row[f.column] && !errors[f.key]) {
          const active = CategoryRepository.active();
          if (active.length === 1 || f.required) {
            if (!active.length) errors[f.key] = 'Tiada kategori aktif. Hubungi pentadbir.';
            else if (active.length === 1) row[f.column] = active[0].category_id;
            else errors[f.key] = f.label + ' diperlukan.';
          }
        }
      });
    }
    if (Object.keys(errors).length) throw Errors.validation(errors[Object.keys(errors)[0]], errors);
    return { row: row, files: files, data: data };
  },

  // ================================================================== DTO

  /** Nilai sel → nilai frontend mengikut jenis medan. */
  outValue: function (f, v) {
    if (f.type === 'number') { const n = parseFloat(v); return isFinite(n) ? n : null; }
    if (f.type === 'int' || f.type === 'files') return typeof v === 'number' ? v : (parseInt(v, 10) || 0);
    if (f.type === 'bool') return !!v;
    return v === undefined || v === null ? '' : v;
  },

  statusLabel: function (def, value) {
    const s = (def.statuses || []).filter(function (x) { return x.value === value; })[0];
    return s ? s.label : value;
  },

  /**
   * @param {{categories?:Object, attachments?:Object[], users?:Object}} extras
   */
  toDTO: function (def, row, ctx, extras) {
    const x = extras || {};
    const admin = CrudEngine.isAdmin(ctx);
    const cats = x.categories || CategoryRepository.map();
    const values = {};
    const labels = {};
    def.fields.forEach(function (f) {
      if (f.adminOnly && !admin && !f.visibleToOwner) return;
      const v = CrudEngine.outValue(f, row[f.column]);
      values[f.key] = v;
      if (f.type === 'category') labels[f.key] = cats[v] ? cats[v].name_ms : '';
      if (f.type === 'enum') {
        const o = (f.options || []).filter(function (op) { return op.value === v; })[0];
        labels[f.key] = o ? o.label : v;
      }
    });
    const title = def.titleField ? String(values[def.titleField] || '') : '';
    const dto = {
      id: row.id,
      refNo: row.ref_no || row.id,
      module: def.key,
      title: title || row.ref_no || row.id,
      subtitle: def.subtitleField ? String(labels[def.subtitleField] || values[def.subtitleField] || '') : '',
      ownerId: admin ? row.owner_user_id : undefined,
      ownerName: row.owner_name || (row.owner_user_id ? '' : 'Orang awam'),
      isMine: !!ctx && row.owner_user_id === ctx.userId,
      status: row.status,
      statusLabel: CrudEngine.statusLabel(def, row.status),
      statusNote: row.status_note,
      statusChangedAt: row.status_changed_at,
      state: row.state,
      values: values,
      labels: labels,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canEdit: CrudEngine.canEdit(def, row, ctx),
      canDelete: CrudEngine.canDelete(def, row, ctx),
      canSetStatus: CrudEngine.canSetStatus(def, row, ctx)
    };
    if (x.attachments) {
      dto.attachments = x.attachments.map(function (a) {
        return { id: a.attachment_id, field: a.field, filename: a.filename, mimeType: a.mime_type, size: a.size_bytes };
      });
    }
    const h = CrudEngine.hooks(def);
    return h.toDTO ? (h.toDTO(dto, row, ctx) || dto) : dto;
  },

  // ================================================================== Pertanyaan

  /** Rekod yang boleh dilihat + penapis. @return {Object[]} baris mentah tersusun */
  query: function (def, ctx, filters) {
    const admin = CrudEngine.isAdmin(ctx);
    const statusValues = (def.statuses || []).map(function (s) { return s.value; });
    const f = Validator.validate(filters, {
      scope: { type: 'enum', values: ['MINE', 'ALL'], default: admin || def.access.list === 'ALL' ? 'ALL' : 'MINE' },
      q: { type: 'string', max: 100 },
      status: { type: 'enum', values: statusValues.length ? statusValues : ['-'], caseSensitive: true },
      from: { type: 'date' },
      to: { type: 'date' },
      deleted: { type: 'boolean', default: false },
      sort: { type: 'enum', values: ['NEWEST', 'OLDEST'], default: 'NEWEST' }
    });
    // Penapis medan (enum / kategori / bool yang ditanda filter:true)
    const fieldFilters = [];
    const raw = (filters && filters.filters && typeof filters.filters === 'object') ? filters.filters : {};
    def.fields.forEach(function (fd) {
      if (!fd.filter || raw[fd.key] === undefined || raw[fd.key] === '') return;
      if (fd.adminOnly && !admin) return;
      const v = Validator.coerce(raw[fd.key], CrudEngine.fieldRule(fd, false), fd.label);
      fieldFilters.push([fd.column, v]);
    });
    const searchCols = def.fields.filter(function (fd) { return fd.search && (!fd.adminOnly || admin); }).map(function (fd) { return fd.column; });
    const q = (f.q || '').toLowerCase();
    const me = ctx.userId;
    const h = CrudEngine.hooks(def);
    const rows = CrudEngine.repo(def).all().filter(function (r) {
      if (h.visible && !admin && h.visible(r, ctx) === false) return false;
      if (f.deleted && admin) { if (r.state !== RECORD_STATE.DELETED) return false; } else if (r.state !== RECORD_STATE.ACTIVE) return false;
      if (f.scope === 'MINE' || (!admin && def.access.list !== 'ALL')) { if (r.owner_user_id !== me) return false; }
      if (f.status && r.status !== f.status) return false;
      for (let i = 0; i < fieldFilters.length; i++) if (r[fieldFilters[i][0]] !== fieldFilters[i][1]) return false;
      if ((f.from || f.to) && !DateUtils.inDayRange(r.created_at, f.from, f.to)) return false;
      if (q) {
        const hay = [r.ref_no, r.owner_name].concat(searchCols.map(function (c) { return r[c]; })).join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    rows.sort(function (a, b) {
      return f.sort === 'OLDEST' ? (a.created_at > b.created_at ? 1 : -1) : (a.created_at < b.created_at ? 1 : -1);
    });
    return rows;
  },

  list: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    // Kiraan status dikira TANPA penapis status (untuk cip "Baharu (3) · Selesai (5)")
    const all = CrudEngine.query(def, ctx, Object.assign({}, payload, { status: '' }));
    const status = payload && payload.status ? String(payload.status) : '';
    if (status && !(def.statuses || []).some(function (s) { return s.value === status; })) throw Errors.validation('Status tidak sah.');
    const rows = status ? all.filter(function (r) { return r.status === status; }) : all;
    const page = Validator.paginate(rows, Validator.paging(payload, SettingsService.get('DEFAULT_PAGE_SIZE')));
    const cats = CategoryRepository.map();
    page.items = page.items.map(function (r) { return CrudEngine.toDTO(def, r, ctx, { categories: cats }); });
    const counts = {};
    all.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    page.meta.statusCounts = counts;
    page.meta.totalAll = all.length;
    return page;
  },

  /** Eksport CSV (baris sebagai tatasusunan) — had MAX_EXPORT. */
  exportRows: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    const admin = CrudEngine.isAdmin(ctx);
    const fields = def.fields.filter(function (f) { return f.type !== 'files' && (!f.adminOnly || admin); });
    const cats = CategoryRepository.map();
    const rows = CrudEngine.query(def, ctx, payload).slice(0, CrudEngine.MAX_EXPORT);
    const header = ['No. Rujukan'].concat(fields.map(function (f) { return f.label; }), ['Status', 'Pemilik', 'Dicipta']);
    const body = rows.map(function (r) {
      const dto = CrudEngine.toDTO(def, r, ctx, { categories: cats });
      return [dto.refNo].concat(fields.map(function (f) {
        const v = dto.values[f.key];
        if (dto.labels[f.key] !== undefined) return dto.labels[f.key];
        if (f.type === 'bool') return v ? 'Ya' : 'Tidak';
        return v === null || v === undefined ? '' : v;
      }), [dto.statusLabel || '', dto.ownerName || '', r.created_at]);
    });
    AuditService.log(ctx, AUDIT_ACTIONS.EXPORT_GENERATED, def.sheet, '', body.length + ' baris');
    return { filename: def.key + '-' + DateUtils.dayKey(new Date()) + '.csv', rows: [header].concat(body), truncated: rows.length >= CrudEngine.MAX_EXPORT };
  },

  read: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    const row = CrudEngine.requireViewable(def, payload && payload.id, ctx);
    const atts = AttachmentRepository.byRecord(def.key, row.id);
    return CrudEngine.toDTO(def, row, ctx, { attachments: atts });
  },

  // ================================================================== Tulis

  /** No. rujukan mesra manusia: refFormat cth. 'ADU-{YYYY}-{SEQ4}'. Mesti dipanggil DALAM kunci. */
  nextRefNo: function (def, id) {
    if (!def.refFormat) return id;
    const now = new Date();
    const yyyy = Utilities.formatDate(now, DateUtils.tz(), 'yyyy');
    const mm = Utilities.formatDate(now, DateUtils.tz(), 'MM');
    const prefix = def.refFormat.split('{SEQ')[0].replace('{YYYY}', yyyy).replace('{MM}', mm);
    const repo = CrudEngine.repo(def);
    repo.invalidate();
    let max = 0;
    repo.all().forEach(function (r) {
      if (r.ref_no && r.ref_no.indexOf(prefix) === 0) {
        const n = parseInt(r.ref_no.slice(prefix.length), 10);
        if (n > max) max = n;
      }
    });
    const m = def.refFormat.match(/\{SEQ(\d)\}/);
    const width = m ? Number(m[1]) : 4;
    return prefix + String(max + 1).padStart(width, '0');
  },

  /** Cipta (pengguna log masuk). */
  create: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    if (!SecurityService.hasRole(ctx.role, def.access.create === ROLES.PUBLIC ? ROLES.USER : def.access.create)) throw Errors.forbidden();
    SecurityService.rateLimit('crud.create', ctx.userId);
    const requestId = payload && payload.requestId;
    return SecurityService.idempotent('crud.create:' + def.key + ':' + ctx.userId, requestId, function () {
      return CrudEngine.insert(def, ctx, payload, 'create', { userId: ctx.userId, name: ctx.user ? ctx.user.full_name : '' });
    });
  },

  /** Laluan dalaman dikongsi oleh create & publicCreate. */
  insert: function (def, ctx, payload, mode, owner) {
    const v = CrudEngine.validate(def, payload, ctx, mode);
    const h = CrudEngine.hooks(def);
    if (h.validate) h.validate(v.data, { ctx: ctx, mode: mode, current: null });
    const uploads = v.files.map(function (x) { return { field: x.field, file: SecurityService.validateUpload(x.file) }; });
    const now = DateUtils.nowIso();
    const id = IdUtils.generate(def.prefix);
    const row = Object.assign({}, v.row, {
      id: id, ref_no: '', owner_user_id: owner.userId || '', owner_name: owner.name || '',
      status: def.defaultStatus || '', status_note: '', status_changed_at: '', status_changed_by: '',
      state: RECORD_STATE.ACTIVE, created_at: now, updated_at: now, deleted_at: ''
    });
    def.fields.forEach(function (f) {
      if (f.type === 'files') row[f.column] = uploads.filter(function (u) { return u.field === f.key; }).length;
      else if (row[f.column] === undefined) row[f.column] = f.type === 'bool' ? false : '';
    });
    if (h.beforeSave) h.beforeSave(row, { ctx: ctx, mode: mode, current: null });
    const saved = [];
    try {
      uploads.forEach(function (u) {
        const s = DriveService.upload(u.file, id);
        saved.push({
          attachment_id: IdUtils.generate('A'), module: def.key, record_id: id, field: u.field, uploader_user_id: owner.userId || '',
          drive_file_id: s.id, filename: u.file.filename, mime_type: u.file.mimeType, size_bytes: u.file.size, status: 'ACTIVE', created_at: now
        });
      });
      Database.withLock(function () {
        row.ref_no = CrudEngine.nextRefNo(def, id);
        CrudEngine.repo(def).insert(row);
        AttachmentRepository.insertMany(saved);
      });
    } catch (e) {
      saved.forEach(function (a) { DriveService.trash(a.drive_file_id); }); // pampasan: tiada fail yatim
      throw e;
    }
    AppCache.remove('stats:admin');
    AuditService.log(ctx && ctx.userId ? ctx : { role: ROLES.PUBLIC }, AUDIT_ACTIONS.RECORD_CREATED, def.sheet, id, row.ref_no + (mode === 'public' ? ' · borang awam' : ''));
    CrudEngine.notifyCreated(def, row);
    if (h.afterCreate) { try { h.afterCreate(row, ctx); } catch (e) { ErrorHandler.record(e, { action: def.key + '.afterCreate' }); } }
    return CrudEngine.toDTO(def, row, ctx && ctx.userId ? ctx : { role: ROLES.PUBLIC }, { attachments: saved });
  },

  update: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    const current = CrudEngine.requireViewable(def, payload && payload.id, ctx);
    if (!CrudEngine.canEdit(def, current, ctx)) throw Errors.forbidden('Rekod ini tidak boleh disunting lagi.');
    const v = CrudEngine.validate(def, payload, ctx, 'update');
    const h = CrudEngine.hooks(def);
    if (h.validate) h.validate(v.data, { ctx: ctx, mode: 'update', current: current });
    const removeIds = Array.isArray(payload.removeAttachmentIds) ? payload.removeAttachmentIds.map(String).slice(0, 20) : [];
    const existing = AttachmentRepository.byRecord(def.key, current.id);
    const removing = existing.filter(function (a) { return removeIds.indexOf(a.attachment_id) >= 0; });
    const uploads = v.files.map(function (x) { return { field: x.field, file: SecurityService.validateUpload(x.file) }; });
    // Had bilangan fail per medan selepas tambah/buang
    def.fields.forEach(function (f) {
      if (f.type !== 'files') return;
      const n = existing.filter(function (a) { return a.field === f.key && removing.indexOf(a) < 0; }).length + uploads.filter(function (u) { return u.field === f.key; }).length;
      if (n > (f.maxFiles || 3)) throw Errors.validation(f.label + ': maksimum ' + (f.maxFiles || 3) + ' fail.', (function () { const o = {}; o[f.key] = 'Terlalu banyak fail.'; return o; })());
      if (n === 0 && f.required) throw Errors.validation(f.label + ' diperlukan.', (function () { const o = {}; o[f.key] = f.label + ' diperlukan.'; return o; })());
      v.row[f.column] = n;
    });
    const patch = v.row;
    if (h.beforeSave) h.beforeSave(patch, { ctx: ctx, mode: 'update', current: current });
    const now = DateUtils.nowIso();
    const saved = [];
    let updated;
    try {
      uploads.forEach(function (u) {
        const s = DriveService.upload(u.file, current.id);
        saved.push({
          attachment_id: IdUtils.generate('A'), module: def.key, record_id: current.id, field: u.field, uploader_user_id: ctx.userId,
          drive_file_id: s.id, filename: u.file.filename, mime_type: u.file.mimeType, size_bytes: u.file.size, status: 'ACTIVE', created_at: now
        });
      });
      patch.updated_at = now;
      updated = Database.withLock(function () {
        AttachmentRepository.insertMany(saved);
        const p = {};
        removing.forEach(function (a) { p[a.attachment_id] = { status: 'DELETED' }; });
        AttachmentRepository.updateMany(p);
        return CrudEngine.repo(def).update(current.id, patch);
      });
    } catch (e) {
      saved.forEach(function (a) { DriveService.trash(a.drive_file_id); });
      throw e;
    }
    removing.forEach(function (a) { DriveService.trash(a.drive_file_id); });
    AuditService.log(ctx, AUDIT_ACTIONS.RECORD_UPDATED, def.sheet, current.id, Object.keys(patch).filter(function (k) { return k !== 'updated_at'; }).join(', '));
    return CrudEngine.toDTO(def, updated, ctx, { attachments: AttachmentRepository.byRecord(def.key, current.id) });
  },

  /** Padam lembut (soft delete). Admin boleh memulihkan melalui setState. */
  remove: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    const row = CrudEngine.requireViewable(def, payload && payload.id, ctx);
    if (!CrudEngine.canDelete(def, row, ctx)) throw Errors.forbidden('Rekod ini tidak boleh dipadam.');
    CrudEngine.repo(def).update(row.id, { state: RECORD_STATE.DELETED, deleted_at: DateUtils.nowIso(), updated_at: DateUtils.nowIso() });
    AppCache.remove('stats:admin');
    AuditService.log(ctx, AUDIT_ACTIONS.RECORD_DELETED, def.sheet, row.id, row.ref_no);
    return { deleted: true };
  },

  /** Admin: pulihkan rekod dipadam. */
  restore: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    if (!CrudEngine.isAdmin(ctx)) throw Errors.forbidden();
    const row = CrudEngine.requireViewable(def, payload && payload.id, ctx);
    const updated = CrudEngine.repo(def).update(row.id, { state: RECORD_STATE.ACTIVE, deleted_at: '', updated_at: DateUtils.nowIso() });
    AuditService.log(ctx, AUDIT_ACTIONS.RECORD_UPDATED, def.sheet, row.id, 'Dipulihkan');
    return CrudEngine.toDTO(def, updated, ctx);
  },

  /** Tukar status (aliran kerja) + maklumkan pemilik. */
  setStatus: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    const row = CrudEngine.requireViewable(def, payload && payload.id, ctx);
    if (!CrudEngine.canSetStatus(def, row, ctx)) throw Errors.forbidden();
    const data = Validator.validate(payload, {
      status: { type: 'enum', caseSensitive: true, values: def.statuses.map(function (s) { return s.value; }), required: true, label: 'Status' },
      note: { type: 'text', max: 500, label: 'Catatan' }
    });
    if (data.status === row.status && !data.note) return CrudEngine.toDTO(def, row, ctx);
    const prev = row.status;
    const now = DateUtils.nowIso();
    const updated = CrudEngine.repo(def).update(row.id, {
      status: data.status, status_note: data.note || '', status_changed_at: now,
      status_changed_by: (ctx.user && ctx.user.full_name) || ctx.userId, updated_at: now
    });
    AppCache.remove('stats:admin');
    AuditService.log(ctx, AUDIT_ACTIONS.RECORD_STATUS, def.sheet, row.id, prev + ' → ' + data.status + (data.note ? ' · ' + StringUtils.truncate(data.note, 80) : ''));
    if (prev !== data.status) CrudEngine.notifyStatus(def, updated, ctx);
    const h = CrudEngine.hooks(def);
    if (h.afterStatus) { try { h.afterStatus(updated, prev, ctx); } catch (e) { ErrorHandler.record(e, { action: def.key + '.afterStatus' }); } }
    return CrudEngine.toDTO(def, updated, ctx);
  },

  /** Muat turun lampiran selepas semakan akses rekod induk. */
  attachment: function (ctx, payload) {
    const data = Validator.validate(payload, { id: { type: 'id', prefix: 'A', required: true, label: 'Lampiran' } });
    SecurityService.rateLimit('attachment.get', ctx.userId);
    const att = AttachmentRepository.findById(data.id);
    if (!att || att.status !== 'ACTIVE') throw Errors.notFound('Lampiran');
    const def = CrudEngine.get(att.module);
    CrudEngine.requireViewable(def, att.record_id, ctx);
    return { id: att.attachment_id, filename: att.filename, mimeType: att.mime_type, data: DriveService.readBase64(att.drive_file_id) };
  },

  // ================================================================== Borang awam

  /** Metadata borang awam + token anti-bot (dimuat dari pelayan). */
  publicForm: function (payload) {
    const def = CrudEngine.get(payload && payload.module);
    if (def.access.create !== ROLES.PUBLIC) throw Errors.notFound('Borang');
    if (!SettingsService.get('ALLOW_PUBLIC_SUBMISSION')) throw Errors.forbidden('Borang awam ditutup buat sementara.');
    const meta = CrudEngine.meta().filter(function (m) { return m.key === def.key; })[0];
    meta.fields = meta.fields.filter(function (f) { return f.public !== false && !f.adminOnly && !f.readonly; });
    return { module: meta, formToken: SecurityUtils.signFormToken('crud:' + def.key) };
  },

  publicCreate: function (ctx, payload) {
    const def = CrudEngine.get(payload && payload.module);
    if (def.access.create !== ROLES.PUBLIC) throw Errors.notFound('Borang');
    if (!SettingsService.get('ALLOW_PUBLIC_SUBMISSION')) throw Errors.forbidden('Borang awam ditutup buat sementara.');
    const meta = Validator.validate(payload, {
      formToken: { type: 'string', required: true, max: 60, label: 'Token' },
      website: { type: 'string', max: 200 } // honeypot — mesti kosong
    });
    if (meta.website) return { submitted: true, refNo: '' }; // bot: "berjaya" palsu, tiada rekod
    if (!SecurityUtils.verifyFormToken('crud:' + def.key, meta.formToken)) {
      throw Errors.validation('Borang telah tamat tempoh atau dihantar terlalu cepat. Muat semula halaman dan cuba lagi.');
    }
    SecurityService.rateLimit('crud.publicCreate.global', 'all');
    SecurityService.rateLimit('crud.publicCreate', def.key + ':' + String((payload && payload[def.publicForm && def.publicForm.contactEmailField]) || 'anon'));
    const logged = ctx && ctx.userId;
    const nameField = def.publicForm && def.publicForm.nameField;
    const publicName = nameField && payload && typeof payload[nameField] === 'string' ? StringUtils.truncate(StringUtils.singleLine(StringUtils.stripTags(payload[nameField])), CONFIG.NAME_MAX) : '';
    const dto = CrudEngine.insert(def, logged ? ctx : { role: ROLES.PUBLIC }, payload, 'public',
      logged ? { userId: ctx.userId, name: ctx.user ? ctx.user.full_name : '' } : { userId: '', name: publicName ? publicName + ' (awam)' : '' });
    return { submitted: true, refNo: dto.refNo };
  },

  // ================================================================== Notifikasi

  notifyCreated: function (def, row) {
    const n = def.notify || {};
    const title = def.label + ' baharu: ' + (row.ref_no || row.id);
    const who = row.owner_name || 'Orang awam';
    const label = def.titleField ? StringUtils.truncate(row[CrudEngine.column(def, def.titleField)] || '', 80) : '';
    const message = who + ' menghantar ' + def.label.toLowerCase() + (label ? ' "' + label + '"' : '') + '.';
    const path = '#/admin' + def.path + '/' + row.id;
    if (n.adminsOnCreate) {
      NotificationService.notifyAdmins(NOTIF_TYPE.RECORD_CREATED, title, message, row.id, path);
      const adminEmail = SettingsService.get('ADMIN_EMAIL');
      if (adminEmail) NotificationService.email(adminEmail, title, [message], { path: path });
    }
  },

  notifyStatus: function (def, row, ctx) {
    const n = def.notify || {};
    if (!n.ownerOnStatus) return;
    const title = def.label + ' ' + (row.ref_no || row.id) + ': ' + CrudEngine.statusLabel(def, row.status);
    const message = 'Status dikemas kini kepada "' + CrudEngine.statusLabel(def, row.status) + '"' + (row.status_note ? '. Catatan: ' + StringUtils.truncate(row.status_note, 200) : '.');
    const path = '#' + def.path + '/' + row.id;
    if (row.owner_user_id && row.owner_user_id !== ctx.userId) {
      NotificationService.notify(row.owner_user_id, NOTIF_TYPE.RECORD_STATUS, title, message, row.id, path);
      const owner = UserRepository.findById(row.owner_user_id);
      if (owner) NotificationService.email(owner.email, title, ['Salam ' + owner.full_name + ',', message], { path: path });
    } else if (!row.owner_user_id && def.publicForm && def.publicForm.contactEmailField) {
      const email = row[CrudEngine.column(def, def.publicForm.contactEmailField)];
      if (email) NotificationService.email(email, title, [message, 'No. rujukan anda: ' + (row.ref_no || row.id)], { path: '#/' });
    }
  },

  column: function (def, key) {
    const f = def.fields.filter(function (x) { return x.key === key; })[0];
    return f ? f.column : key;
  },

  // ================================================================== Ringkasan & statistik

  /** Papan pemuka pengguna: kiraan per modul + rekod terkini. */
  summary: function (ctx) {
    const cats = CategoryRepository.map();
    const recent = [];
    const modules = CrudEngine.modules().filter(function (def) { return def.nav && def.nav.user !== false; }).map(function (def) {
      const rows = CrudEngine.query(def, ctx, { scope: def.access.list === 'ALL' ? 'ALL' : 'MINE' });
      const byStatus = {};
      rows.forEach(function (r) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
      rows.slice(0, 5).forEach(function (r) { recent.push(CrudEngine.toDTO(def, r, ctx, { categories: cats })); });
      return { key: def.key, label: def.labelPlural, icon: def.icon, path: def.path, total: rows.length, byStatus: byStatus };
    });
    recent.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return { modules: modules, recent: recent.slice(0, 6), unreadNotifications: NotificationService.unreadCount(ctx.userId) };
  },

  /** Statistik admin per modul (dipanggil oleh DashboardService — dicache di sana). */
  adminStats: function (days) {
    const today = DateUtils.dayKey(new Date());
    const month = DateUtils.monthKey(new Date());
    return CrudEngine.modules().map(function (def) {
      const rows = CrudEngine.repo(def).all().filter(function (r) { return r.state === RECORD_STATE.ACTIVE; });
      const byStatus = {};
      const byDay = {};
      days.forEach(function (d) { byDay[d] = 0; });
      rows.forEach(function (r) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        const dk = DateUtils.dayKey(r.created_at);
        if (byDay[dk] !== undefined) byDay[dk]++;
      });
      return {
        key: def.key, label: def.labelPlural, icon: def.icon, path: def.path,
        total: rows.length,
        today: rows.filter(function (r) { return DateUtils.dayKey(r.created_at) === today; }).length,
        month: rows.filter(function (r) { return DateUtils.monthKey(r.created_at) === month; }).length,
        byStatus: (def.statuses || []).map(function (s) { return { label: s.label, value: byStatus[s.value] || 0, status: s.value }; }),
        byDay: Object.keys(byDay).map(function (k) { return { label: k, value: byDay[k] }; })
      };
    });
  },

  countByOwner: function () {
    const out = {};
    CrudEngine.modules().forEach(function (def) {
      CrudEngine.repo(def).all().forEach(function (r) {
        if (r.state === RECORD_STATE.ACTIVE && r.owner_user_id) out[r.owner_user_id] = (out[r.owner_user_id] || 0) + 1;
      });
    });
    return out;
  },

  countByCategory: function () {
    const out = {};
    CrudEngine.modules().forEach(function (def) {
      const cols = def.fields.filter(function (f) { return f.type === 'category'; }).map(function (f) { return f.column; });
      if (!cols.length) return;
      CrudEngine.repo(def).all().forEach(function (r) {
        if (r.state !== RECORD_STATE.ACTIVE) return;
        cols.forEach(function (c) { if (r[c]) out[r[c]] = (out[r[c]] || 0) + 1; });
      });
    });
    return out;
  },

  /** Penyelenggaraan harian: hooks.maintenance() setiap modul. */
  maintenance: function () {
    const out = {};
    CrudEngine.modules().forEach(function (def) {
      const h = CrudEngine.hooks(def);
      if (!h.maintenance) return;
      try { out[def.key] = h.maintenance(); } catch (e) { out[def.key] = 'ralat'; ErrorHandler.record(e, { action: def.key + '.maintenance' }); }
    });
    return out;
  }
};

const AttachmentRepository = {
  base: function () { return Repo.of('ATTACHMENTS'); },
  findById: function (id) { return AttachmentRepository.base().findById(id); },
  byRecord: function (module, recordId) {
    return AttachmentRepository.base().find(function (a) { return a.module === module && a.record_id === recordId && a.status === 'ACTIVE'; });
  },
  insertMany: function (rows) { return AttachmentRepository.base().insertMany(rows); },
  updateMany: function (patch) { return AttachmentRepository.base().updateMany(patch); }
};
