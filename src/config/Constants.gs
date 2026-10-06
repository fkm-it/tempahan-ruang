/**
 * @file Constants.gs
 * Enum dan pemalar sistem. TIADA logik di sini.
 *
 * Nota GAS: semua fail .gs berkongsi satu global scope. Fail ini tidak
 * merujuk fail lain semasa dimuatkan, jadi susunan muat (load order) tidak penting.
 */

const ROLES = Object.freeze({
  PUBLIC: 'PUBLIC',
  USER: 'USER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN'
});

/** Hierarki peranan — nombor lebih tinggi = akses lebih luas. */
const ROLE_LEVEL = Object.freeze({ PUBLIC: 0, USER: 1, ADMIN: 2, SUPER_ADMIN: 3 });

const USER_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', BLOCKED: 'BLOCKED' });

/** Status rekod modul — kitaran hayat teknikal (status perniagaan ditakrif per modul dalam modules/*.json). */
const RECORD_STATE = Object.freeze({ ACTIVE: 'ACTIVE', DELETED: 'DELETED' });

const CATEGORY_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' });

const FEEDBACK_STATUS = Object.freeze({ NEW: 'NEW', REVIEWED: 'REVIEWED', CLOSED: 'CLOSED' });

const NOTIF_TYPE = Object.freeze({
  WELCOME: 'WELCOME',
  RECORD_CREATED: 'RECORD_CREATED',
  RECORD_STATUS: 'RECORD_STATUS',
  BROADCAST: 'BROADCAST',
  SECURITY: 'SECURITY',
  ACCOUNT: 'ACCOUNT'
});

/** Ikon kategori yang dibenarkan (whitelist — elak input ikon sewenang-wenang). */
const CATEGORY_ICONS = Object.freeze([
  'grid', 'star', 'heart', 'home', 'book', 'briefcase', 'users', 'calendar', 'settings', 'shield', 'inbox', 'list'
]);

const AUDIT_ACTIONS = Object.freeze({
  USER_REGISTERED: 'USER_REGISTERED',
  USER_LOGIN: 'USER_LOGIN',
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  RECORD_CREATED: 'RECORD_CREATED',
  RECORD_UPDATED: 'RECORD_UPDATED',
  RECORD_STATUS: 'RECORD_STATUS',
  RECORD_DELETED: 'RECORD_DELETED',
  USER_BLOCKED: 'USER_BLOCKED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_SESSIONS_REVOKED: 'USER_SESSIONS_REVOKED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  NOTIFICATION_BROADCAST: 'NOTIFICATION_BROADCAST',
  EXPORT_GENERATED: 'EXPORT_GENERATED',
  REPORT_GENERATED: 'REPORT_GENERATED',
  FEEDBACK_UPDATED: 'FEEDBACK_UPDATED',
  BACKUP_CREATED: 'BACKUP_CREATED',
  MIGRATION_APPLIED: 'MIGRATION_APPLIED'
});

const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  MAINTENANCE: 'MAINTENANCE',
  BUSY: 'BUSY',
  CONFIG_ERROR: 'CONFIG_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
});

/** Nama sheet dalam spreadsheet utama. */
const SHEETS = Object.freeze({
  USERS: 'USERS',
  CREDENTIALS: 'CREDENTIALS',
  SESSIONS: 'SESSIONS',
  CATEGORIES: 'CATEGORIES',
  ATTACHMENTS: 'ATTACHMENTS',
  PUSH_TOKENS: 'PUSH_TOKENS',
  NOTIFICATIONS: 'NOTIFICATIONS',
  AUDIT_LOGS: 'AUDIT_LOGS',
  SETTINGS: 'SETTINGS',
  SYSTEM_LOGS: 'SYSTEM_LOGS',
  FEEDBACK: 'FEEDBACK',
  MIGRATIONS: 'MIGRATIONS'
});

/** Magic bytes untuk pengesahan jenis fail sebenar (bukan sekadar MIME yang dihantar klien). */
const FILE_SIGNATURES = Object.freeze({
  'image/jpeg': { exts: ['jpg', 'jpeg'] },
  'image/png': { exts: ['png'] },
  'image/webp': { exts: ['webp'] },
  'application/pdf': { exts: ['pdf'] },
  'audio/mpeg': { exts: ['mp3'] },
  'audio/mp4': { exts: ['m4a', 'mp4'] },
  'audio/x-m4a': { exts: ['m4a'] },
  'audio/ogg': { exts: ['ogg', 'oga'] },
  'audio/wav': { exts: ['wav'] }
});
