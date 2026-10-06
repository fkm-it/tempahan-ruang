/**
 * @file Environment.gs
 * Lapisan konfigurasi persekitaran (DEV / STAGING / PRODUCTION) melalui Script Properties.
 *
 * Kunci Script Properties:
 *   APP_ENV                      DEV | STAGING | PRODUCTION
 *   SPREADSHEET_ID               ID spreadsheet pangkalan data
 *   DRIVE_ROOT_FOLDER_ID         Folder "<APP_NAME>"
 *   ATTACHMENT_FOLDER_ID         Folder "<APP_NAME>/Attachments"
 *   BACKUP_FOLDER_ID             Folder "<APP_NAME> Backup"
 *   AUTH_PEPPER                  Rahsia untuk hash kata laluan (dijana automatik)
 *   FORM_SECRET                  Rahsia untuk token borang awam (dijana automatik)
 *   PBKDF2_ITERATIONS            (pilihan) bilangan lelaran hash
 *   ALLOW_IFRAME_EMBED           'true' hanya jika app dibenam dalam iframe (tidak perlu untuk versi web)
 *   PUBLIC_BASE_URL              (pilihan) URL versi web (GitHub Pages) untuk pautan dalam email & notifikasi
 *   ICON_URL                     (pilihan) URL https ikon PNG untuk favicon Web App
 *   BOOTSTRAP_SUPER_ADMIN_EMAIL  (pilihan) email yang akan menjadi SUPER_ADMIN semasa daftar
 *   FCM_SERVICE_ACCOUNT          (pilihan, RAHSIA) JSON akaun servis Firebase untuk notifikasi telefon
 *   LAST_BACKUP_AT               diurus sistem
 *   MIGRATED_FOR                 diurus sistem (tandatangan migrasi terakhir — lihat Migration.autoRun)
 *
 * Pertukaran persekitaran = tukar nilai property, bukan ubah kod.
 */
const Env = (function () {
  const VALID_ENVS = ['DEV', 'STAGING', 'PRODUCTION'];
  let cache = null;
  let overrides = null; // untuk ujian sahaja

  function store() {
    return PropertiesService.getScriptProperties();
  }

  function all() {
    if (!cache) cache = store().getProperties() || {};
    return cache;
  }

  function get(key, fallback) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
    const v = all()[key];
    return v === undefined || v === null || v === '' ? (fallback === undefined ? '' : fallback) : v;
  }

  function set(key, value) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
      overrides[key] = String(value);
      return;
    }
    store().setProperty(key, String(value));
    all()[key] = String(value);
  }

  function name() {
    const e = String(get('APP_ENV', 'DEV')).toUpperCase();
    return VALID_ENVS.indexOf(e) >= 0 ? e : 'DEV';
  }

  function isProduction() {
    return name() === 'PRODUCTION';
  }

  /** Dapatkan rahsia wajib. Gagal dengan jelas jika setupDatabase() belum dijalankan. */
  function secret(key) {
    const v = get(key);
    if (!v) throw new AppError(ERROR_CODES.CONFIG_ERROR, 'Konfigurasi sistem belum lengkap.', { missing: key });
    return v;
  }

  function bool(key, fallback) {
    const v = String(get(key, fallback ? 'true' : 'false')).toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  /** Untuk ujian: tindih nilai tanpa menyentuh Script Properties sebenar. */
  function useOverrides(map) {
    overrides = map ? Object.assign({}, map) : null;
  }

  function reset() {
    cache = null;
  }

  return { get: get, set: set, name: name, isProduction: isProduction, secret: secret, bool: bool, useOverrides: useOverrides, reset: reset };
})();
