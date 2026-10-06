/**
 * @file SystemService.gs
 * Kesihatan sistem, sandaran (backup), penyelenggaraan berjadual, maklum balas.
 */
const HealthService = {
  check: function () {
    const result = { checkedAt: DateUtils.nowIso() };

    // Pangkalan data
    try {
      const sheets = SheetManager.health();
      const bad = sheets.filter(function (s) { return !s.exists || !s.headersOk; });
      result.database = { ok: bad.length === 0, sheets: sheets, name: Database.open().getName() };
    } catch (e) {
      result.database = { ok: false, error: e instanceof AppError ? e.message : 'Tidak dapat membuka spreadsheet.' };
    }

    result.drive = DriveService.health();

    // Skrip
    let mailQuota = null;
    try { mailQuota = MailApp.getRemainingDailyQuota(); } catch (e) { mailQuota = null; }
    let triggers = [];
    try { triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) { triggers = []; }
    result.script = {
      ok: true,
      version: CONFIG.VERSION,
      commit: typeof DEPLOY_INFO !== 'undefined' ? DEPLOY_INFO.commit : '',
      builtAt: typeof DEPLOY_INFO !== 'undefined' ? DEPLOY_INFO.builtAt : '',
      publicBaseUrl: PushService.baseUrl(),
      environment: Env.name(),
      timezone: DateUtils.tz(),
      mailQuotaRemaining: mailQuota,
      triggers: triggers,
      maintenanceTriggerInstalled: triggers.indexOf('dailyMaintenance') >= 0,
      pbkdf2Iterations: SecurityUtils.iterations(),
      iframeEmbed: Env.bool('ALLOW_IFRAME_EMBED', false),
      migrations: Migration.status()
    };

    const lastBackup = Env.get('LAST_BACKUP_AT');
    result.backup = { ok: !!lastBackup && (Date.now() - new Date(lastBackup).getTime()) < 3 * 86400000, lastBackupAt: lastBackup || '' };

    const errs = (function () { try { return SystemLogRepository.recent(10); } catch (e) { return []; } })();
    result.lastError = errs.length ? { errorId: errs[0].error_id, message: errs[0].message, action: errs[0].action, createdAt: errs[0].created_at } : null;
    result.recentErrors = errs.map(function (l) { return { errorId: l.error_id, message: l.message, action: l.action, createdAt: l.created_at }; });
    return result;
  }
};

const BackupService = {
  /** Salin keseluruhan spreadsheet ke "<APP_NAME> Backup/YYYY". Simpan N salinan terkini. */
  run: function (ctx) {
    const folderId = Env.get('BACKUP_FOLDER_ID');
    if (!folderId) throw new AppError(ERROR_CODES.CONFIG_ERROR, 'Folder backup belum dikonfigurasi.');
    const root = DriveApp.getFolderById(folderId);
    const year = Utilities.formatDate(new Date(), DateUtils.tz(), 'yyyy');
    const folder = DriveService.child(root, year);
    const name = CONFIG.APP_SLUG + '_Backup_' + Utilities.formatDate(new Date(), DateUtils.tz(), 'yyyyMMdd_HHmm');
    const ssId = Database.open().getId();
    const copy = DriveApp.getFileById(ssId).makeCopy(name, folder);
    try { copy.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* polisi domain */ }
    Env.set('LAST_BACKUP_AT', DateUtils.nowIso());
    const pruned = BackupService.prune(folder);
    AuditService.log(ctx || { role: 'SYSTEM' }, AUDIT_ACTIONS.BACKUP_CREATED, 'DATABASE', copy.getId(), name + (pruned ? ' · ' + pruned + ' salinan lama dibuang' : ''));
    return { fileId: copy.getId(), name: name, pruned: pruned, createdAt: Env.get('LAST_BACKUP_AT') };
  },

  prune: function (folder) {
    const files = [];
    const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (it.hasNext()) {
      const f = it.next();
      if (f.getName().indexOf(CONFIG.APP_SLUG + '_Backup_') === 0) files.push(f);
    }
    files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
    let n = 0;
    files.slice(CONFIG.BACKUP_RETENTION).forEach(function (f) { f.setTrashed(true); n++; });
    return n;
  }
};

const MaintenanceService = {
  /** Dijalankan oleh pencetus harian. */
  daily: function () {
    const out = {};
    out.sessionsPurged = SessionRepository.purgeExpired();
    out.systemLogsPruned = SystemLogRepository.prune(CONFIG.SYSTEM_LOG_MAX_ROWS);
    try { out.modules = CrudEngine.maintenance(); } catch (e) { out.modulesError = String(e && e.message); }
    try { out.pushTokensPurged = PushTokenRepository.purgeRevoked(); } catch (e) { out.pushTokensPurged = 0; }
    try {
      out.backup = BackupService.run(null);
    } catch (e) {
      out.backupError = String(e && e.message);
      ErrorHandler.record(e, { action: 'dailyMaintenance.backup' });
    }
    AppLogger.info('Penyelenggaraan harian selesai', out);
    return out;
  }
};

const FeedbackService = {
  submit: function (ctx, payload) {
    const data = Validator.validate(payload, {
      name: { type: 'string', required: true, min: 2, max: CONFIG.NAME_MAX, label: 'Nama' },
      email: { type: 'email', required: true, label: 'Email' },
      message: { type: 'text', required: true, min: 10, max: CONFIG.FEEDBACK_MAX, label: 'Mesej' },
      website: { type: 'string', max: 200 } // honeypot
    });
    if (data.website) return { submitted: true };
    SecurityService.rateLimit('public.feedback.global', 'all');
    SecurityService.rateLimit('public.feedback', data.email);
    const now = DateUtils.nowIso();
    FeedbackRepository.insert({
      feedback_id: IdUtils.generate('B'),
      user_id: (ctx && ctx.userId) || '',
      name: data.name,
      email: data.email,
      message: data.message,
      status: FEEDBACK_STATUS.NEW,
      created_at: now,
      updated_at: now
    });
    return { submitted: true };
  },

  list: function (filters) {
    const f = Validator.validate(filters, { status: { type: 'enum', values: Object.keys(FEEDBACK_STATUS) } });
    const rows = FeedbackRepository.all().filter(function (r) { return !f.status || r.status === f.status; }).slice().reverse();
    const page = Validator.paginate(rows, Validator.paging(filters, 20));
    page.items = page.items.map(function (r) {
      return { id: r.feedback_id, name: r.name, email: r.email, message: r.message, status: r.status, createdAt: r.created_at };
    });
    return page;
  },

  setStatus: function (ctx, payload) {
    const data = Validator.validate(payload, {
      id: { type: 'id', prefix: 'B', required: true, label: 'Maklum balas' },
      status: { type: 'enum', values: Object.keys(FEEDBACK_STATUS), required: true, label: 'Status' }
    });
    if (!FeedbackRepository.findById(data.id)) throw Errors.notFound('Maklum balas');
    FeedbackRepository.update(data.id, { status: data.status });
    AuditService.log(ctx, AUDIT_ACTIONS.FEEDBACK_UPDATED, 'FEEDBACK', data.id, data.status);
    return { id: data.id, status: data.status };
  }
};
