/**
 * @file DriveService.gs
 * Storan lampiran dalam Google Drive.
 *
 * Struktur:  <APP_NAME> / Attachments / YYYY / MM / <recordId>__<nama fail>
 * Keselamatan: fail & folder PERIBADI (pemilik skrip sahaja). Pengguna mengakses lampiran
 * melalui CrudEngine.attachment() selepas semakan akses — tiada pautan Drive awam.
 */
const DriveService = {
  folderOverride: null, // untuk ujian

  attachmentRoot: function () {
    if (DriveService.folderOverride) return DriveService.folderOverride;
    const id = Env.get('ATTACHMENT_FOLDER_ID');
    if (!id) throw new AppError(ERROR_CODES.CONFIG_ERROR, 'Folder lampiran belum dikonfigurasi.', { missing: 'ATTACHMENT_FOLDER_ID' });
    return DriveApp.getFolderById(id);
  },

  /** Dapatkan/cipta subfolder mengikut nama (idempoten). */
  child: function (parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  },

  /** Folder YYYY/MM untuk tarikh semasa (ID dicache 6 jam). */
  monthFolder: function () {
    const now = new Date();
    const y = Utilities.formatDate(now, DateUtils.tz(), 'yyyy');
    const m = Utilities.formatDate(now, DateUtils.tz(), 'MM');
    const ck = 'folder:' + y + '-' + m;
    const cachedId = DriveService.folderOverride ? null : AppCache.get(ck);
    if (cachedId) {
      try { return DriveApp.getFolderById(cachedId); } catch (e) { AppCache.remove(ck); }
    }
    const folder = DriveService.child(DriveService.child(DriveService.attachmentRoot(), y), m);
    if (!DriveService.folderOverride) AppCache.put(ck, folder.getId(), CONFIG.CACHE_TTL.FOLDER);
    return folder;
  },

  /**
   * @param {{filename:string, mimeType:string, bytes:number[]}} file telah disahkan SecurityService
   * @return {{id:string, size:number}}
   */
  upload: function (file, recordId) {
    const blob = Utilities.newBlob(file.bytes, file.mimeType, recordId + '__' + file.filename);
    const created = DriveService.monthFolder().createFile(blob);
    try {
      created.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    } catch (e) {
      // Sesetengah polisi domain menghalang setSharing; fail kekal mengikut lalai folder (peribadi).
      AppLogger.warn('setSharing gagal', { error: String(e) });
    }
    created.setDescription(CONFIG.APP_NAME + ' · ' + recordId);
    return { id: created.getId(), size: created.getSize() };
  },

  /** Baca fail sebagai base64 (dengan had saiz). */
  readBase64: function (fileId) {
    const file = DriveApp.getFileById(fileId);
    const maxBytes = (SettingsService.get('MAX_ATTACHMENT_MB') + 1) * 1024 * 1024;
    if (file.getSize() > maxBytes) throw Errors.validation('Fail terlalu besar untuk dipaparkan.');
    return Utilities.base64Encode(file.getBlob().getBytes());
  },

  trash: function (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { AppLogger.warn('Gagal buang fail', { error: String(e) }); }
  },

  /** Cipta/semak struktur folder (setupDatabase). @return {{root:string, attachments:string, backup:string}} */
  ensureFolders: function () {
    let root = Env.get('DRIVE_ROOT_FOLDER_ID') ? DriveService.safeFolder(Env.get('DRIVE_ROOT_FOLDER_ID')) : null;
    if (!root) {
      root = DriveApp.createFolder(CONFIG.APP_NAME);
      Env.set('DRIVE_ROOT_FOLDER_ID', root.getId());
    }
    let att = Env.get('ATTACHMENT_FOLDER_ID') ? DriveService.safeFolder(Env.get('ATTACHMENT_FOLDER_ID')) : null;
    if (!att) {
      att = DriveService.child(root, 'Attachments');
      Env.set('ATTACHMENT_FOLDER_ID', att.getId());
    }
    let backup = Env.get('BACKUP_FOLDER_ID') ? DriveService.safeFolder(Env.get('BACKUP_FOLDER_ID')) : null;
    if (!backup) {
      backup = DriveApp.createFolder(CONFIG.APP_NAME + ' Backup');
      Env.set('BACKUP_FOLDER_ID', backup.getId());
    }
    [root, att, backup].forEach(function (f) {
      try { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* polisi domain */ }
    });
    return { root: root.getId(), attachments: att.getId(), backup: backup.getId() };
  },

  safeFolder: function (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { return null; }
  },

  health: function () {
    try {
      const f = DriveService.attachmentRoot();
      const access = f.getSharingAccess();
      return { ok: true, folderName: f.getName(), sharing: String(access), isPrivate: String(access) === String(DriveApp.Access.PRIVATE) };
    } catch (e) {
      return { ok: false, error: e instanceof AppError ? e.message : 'Folder tidak boleh diakses.' };
    }
  }
};
