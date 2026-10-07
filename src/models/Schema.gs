/**
 * @file Schema.gs
 * SATU sumber kebenaran untuk struktur setiap sheet.
 * SheetManager mencipta header daripada sini; RepositoryBase menukar jenis data berdasarkan `types`.
 *
 * Semua sel disimpan sebagai TEKS (format '@') — elak Sheets menukar ISO date/nombor telefon secara automatik.
 * Jenis: 'bool' | 'int' | (lalai) string.
 */
const SCHEMA = Object.freeze({
  USERS: {
    sheet: 'USERS', id: 'user_id', prefix: 'U',
    columns: ['user_id', 'email', 'full_name', 'phone', 'photo_url', 'role', 'status', 'auth_provider',
      'created_at', 'updated_at', 'last_login_at'],
    types: {}
  },
  /** Dipisahkan daripada USERS supaya hash tidak terdedah jika USERS dikongsi. Sheet ini disembunyi & dilindungi. */
  CREDENTIALS: {
    sheet: 'CREDENTIALS', id: 'user_id', hidden: true, protect: true,
    columns: ['user_id', 'password_hash', 'updated_at'],
    types: {}
  },
  /** session_id = SHA-256(token). Token mentah TIDAK pernah disimpan. */
  SESSIONS: {
    sheet: 'SESSIONS', id: 'session_id', hidden: true, protect: true,
    columns: ['session_id', 'user_id', 'expires_at', 'created_at', 'user_agent_hash', 'revoked_at'],
    types: {}
  },
  CATEGORIES: {
    sheet: 'CATEGORIES', id: 'category_id', prefix: 'C',
    columns: ['category_id', 'name_ms', 'name_en', 'description', 'icon', 'sort_order', 'status', 'created_at', 'updated_at'],
    types: { sort_order: 'int' }
  },
  /** Lampiran untuk SEMUA modul (module + record_id). Fail sebenar di Drive peribadi. */
  ATTACHMENTS: {
    sheet: 'ATTACHMENTS', id: 'attachment_id', prefix: 'A',
    columns: ['attachment_id', 'module', 'record_id', 'field', 'uploader_user_id', 'drive_file_id', 'filename', 'mime_type', 'size_bytes', 'status', 'created_at'],
    types: { size_bytes: 'int' }
  },
  /** Token peranti FCM untuk notifikasi telefon. Dilindungi — token ialah alamat penghantaran. */
  PUSH_TOKENS: {
    sheet: 'PUSH_TOKENS', id: 'token_id', prefix: 'K', hidden: true, protect: true,
    columns: ['token_id', 'user_id', 'token', 'platform', 'user_agent', 'status', 'created_at', 'last_seen_at'],
    types: {}
  },
  NOTIFICATIONS: {
    sheet: 'NOTIFICATIONS', id: 'notification_id', prefix: 'N',
    columns: ['notification_id', 'user_id', 'type', 'title', 'message', 'reference_id', 'is_read', 'created_at'],
    types: { is_read: 'bool' }
  },
  AUDIT_LOGS: {
    sheet: 'AUDIT_LOGS', id: 'log_id', prefix: 'L',
    columns: ['log_id', 'user_id', 'role', 'action', 'module', 'reference_id', 'description', 'ip_hash', 'user_agent', 'created_at'],
    types: {}
  },
  SETTINGS: {
    sheet: 'SETTINGS', id: 'setting_key',
    columns: ['setting_key', 'setting_value', 'description', 'updated_by', 'updated_at'],
    types: {}
  },
  SYSTEM_LOGS: {
    sheet: 'SYSTEM_LOGS', id: 'log_id', prefix: 'S',
    columns: ['log_id', 'level', 'error_id', 'action', 'message', 'context', 'created_at'],
    types: {}
  },
  FEEDBACK: {
    sheet: 'FEEDBACK', id: 'feedback_id', prefix: 'B',
    columns: ['feedback_id', 'user_id', 'name', 'email', 'message', 'status', 'created_at', 'updated_at'],
    types: {}
  },
  MIGRATIONS: {
    sheet: 'MIGRATIONS', id: 'migration_id',
    columns: ['migration_id', 'description', 'applied_at', 'applied_by'],
    types: {}
  },

  // ===================================================================== MODUL
  // Blok di bawah DIJANA oleh `npm run gen` daripada modules/*.json — jangan sunting dengan tangan.
  // @generator:schema:start
  TEMPAHAN: {
    sheet: 'TEMPAHAN', id: 'id', prefix: 'TP', module: 'tempahan',
    columns: ['id', 'ref_no', 'owner_user_id', 'owner_name', 'jenis_pemohon', 'no_staf', 'nama', 'emel', 'no_telefon', 'ruang', 'tarikh', 'tarikh_tamat', 'masa_mula', 'masa_tamat', 'bilangan_peserta', 'tujuan', 'peringatan_dihantar', 'bahasa', 'peringatan_jam_dihantar', 'peringatan_pagi_dihantar', 'peringatan_admin_dihantar', 'status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'],
    types: {'bilangan_peserta': 'int'}
  },
  TUGASAN: {
    sheet: 'TUGASAN', id: 'id', prefix: 'TG', module: 'tugasan',
    columns: ['id', 'ref_no', 'owner_user_id', 'owner_name', 'tajuk', 'jenis', 'pembantu', 'ruang', 'tarikh', 'tarikh_tamat', 'masa', 'arahan', 'tempahan', 'ditugaskan_oleh', 'disahkan_pada', 'disahkan_oleh', 'catatan_pic', 'emel_dihantar', 'peringatan_dihantar', 'kod', 'status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'],
    types: {}
  },
  RUANG: {
    sheet: 'RUANG', id: 'id', prefix: 'RU', module: 'ruang',
    columns: ['id', 'ref_no', 'owner_user_id', 'owner_name', 'nama', 'blok', 'jenis', 'aras', 'kod_ruang', 'kapasiti', 'pic', 'emel_pic', 'pembantu', 'aktif', 'catatan', 'status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'],
    types: {'kapasiti': 'int', 'aktif': 'bool'}
  },
  PEMBANTU: {
    sheet: 'PEMBANTU', id: 'id', prefix: 'PO', module: 'pembantu',
    columns: ['id', 'ref_no', 'owner_user_id', 'owner_name', 'nama', 'no_telefon', 'emel', 'jawatan', 'aktif', 'catatan', 'status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'],
    types: {'aktif': 'bool'}
  },
  STAF: {
    sheet: 'STAF', id: 'id', prefix: 'SF', module: 'staf',
    columns: ['id', 'ref_no', 'owner_user_id', 'owner_name', 'no_staf', 'nama', 'emel', 'aktif', 'status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'],
    types: {'aktif': 'bool'}
  },
  // @generator:schema:end
});

/**
 * Carian skema (SCHEMA + skema tambahan semasa runtime — digunakan oleh ujian untuk modul fixture).
 * Diselesaikan semasa panggilan, jadi tiada kebergantungan susunan muat.
 */
const SchemaRegistry = {
  extra: {},
  get: function (key) { return SCHEMA[key] || SchemaRegistry.extra[key]; }
};
