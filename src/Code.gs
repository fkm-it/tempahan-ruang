/**
 * @file Code.gs
 * Titik masuk Web App + fungsi operasi (dijalankan dari editor Apps Script).
 *
 * KESELAMATAN PENTING:
 * google.script.run boleh memanggil MANA-MANA fungsi global yang tidak berakhir dengan "_".
 * Oleh itu:
 *   - Hanya `api` dan `include` direka untuk dipanggil oleh klien.
 *   - Semua fungsi operasi (setupDatabase, runBackup, dll.) dilindungi requireOwner_():
 *     hanya pemilik skrip yang menjalankannya dari editor akan lulus.
 *   - Semua logik lain berada dalam objek (tidak boleh dipanggil oleh google.script.run).
 */

/** Web App: hidangkan SPA. */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('frontend/index');
  // Nilai disuntik melalui <?= ?> (auto-escape).
  template.appName = CONFIG.APP_NAME;
  template.tagline = CONFIG.TAGLINE;
  template.version = CONFIG.VERSION;
  template.slug = CONFIG.APP_SLUG;
  const output = template.evaluate()
    .setTitle(CONFIG.APP_NAME + ' — ' + CONFIG.TAGLINE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes');
  // Nota: addMetaTag() hanya menerima: viewport, apple-mobile-web-app-capable,
  // mobile-web-app-capable, google-site-verification. Tag lain melontar ralat.
  const icon = Env.get('ICON_URL');
  if (icon && /^https:\/\//.test(icon)) output.setFaviconUrl(icon);
  // Benarkan dibenam HANYA jika PWA shell digunakan (lihat DEPLOYMENT.md §PWA). Lalai: DEFAULT (anti-clickjacking).
  if (Env.bool('ALLOW_IFRAME_EMBED', false)) output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
}

/** Sertakan fail HTML separa (CSS/JS/komponen) ke dalam templat. */
function include(path) {
  if (!/^frontend\/[a-z0-9/_-]+$/i.test(String(path))) throw new Error('Laluan tidak sah');
  return HtmlService.createHtmlOutputFromFile(path).getContent();
}

/**
 * API JSON melalui HTTP POST — untuk frontend statik (GitHub Pages / domain sendiri).
 *
 * Frontend menghantar `fetch(POST, Content-Type: text/plain, credentials: 'omit')`:
 *   - text/plain = "simple request" → tiada CORS preflight (Apps Script tidak menyokong OPTIONS).
 *   - Tiada cookie Google dihantar → tiada isu "Sorry, unable to open the file" untuk pelayar
 *     yang log masuk beberapa akaun Google, dan tiada risiko CSRF (pengesahan guna token dalam badan).
 * Logik sama sepenuhnya dengan google.script.run → api() (Router + RBAC + had kadar).
 */
function doPost(e) {
  let res;
  try {
    const body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!body) throw new Error('empty');
    if (body.length > CONFIG.MAX_REQUEST_CHARS + 4096) {
      res = ApiResponse.fail('VALIDATION_ERROR', 'Permintaan terlalu besar.');
    } else {
      res = Router.dispatch(JSON.parse(body));
    }
  } catch (err) {
    res = ApiResponse.fail('BAD_REQUEST', 'Permintaan tidak sah.');
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * SATU-SATUNYA titik masuk API untuk frontend.
 * @param {{action:string, payload?:Object, token?:string, meta?:Object}} request
 */
function api(request) {
  return Router.dispatch(request);
}

// ============================================================================
// Fungsi operasi — jalankan dari editor Apps Script (Run ▶).
// ============================================================================

/**
 * Persediaan kali pertama (idempoten):
 * cipta spreadsheet (jika tiada), folder Drive, rahsia, sheet, header, kategori & tetapan lalai.
 */
function setupDatabase() {
  requireOwner_();
  const report = {};
  if (!Env.get('SPREADSHEET_ID')) {
    const ss = SpreadsheetApp.create(CONFIG.APP_NAME + ' — Database');
    Env.set('SPREADSHEET_ID', ss.getId());
    report.spreadsheetCreated = ss.getUrl();
  }
  if (!Env.get('AUTH_PEPPER')) { Env.set('AUTH_PEPPER', SecurityUtils.randomToken()); report.pepperGenerated = true; }
  if (!Env.get('FORM_SECRET')) { Env.set('FORM_SECRET', SecurityUtils.randomToken()); report.formSecretGenerated = true; }
  if (!Env.get('APP_ENV')) Env.set('APP_ENV', 'DEV');
  report.folders = DriveService.ensureFolders();
  // Pindahkan spreadsheet ke folder root projek
  try {
    const file = DriveApp.getFileById(Env.get('SPREADSHEET_ID'));
    const root = DriveApp.getFolderById(report.folders.root);
    if (!file.getParents().hasNext() || file.getParents().next().getId() !== root.getId()) file.moveTo(root);
  } catch (e) { AppLogger.warn('Gagal memindahkan spreadsheet', { error: String(e) }); }
  report.migration = Migration.run({});
  // Buang "Sheet1" lalai jika kosong
  const ss = Database.open();
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  report.health = SheetManager.health().map(function (s) { return s.sheet + ':' + (s.headersOk ? 'OK' : 'MISSING ' + s.missing); });
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/** Jalankan migrasi tertunda. Untuk semak tanpa ubah: ubah DRY_RUN kepada true. */
function runMigration() {
  requireOwner_();
  const DRY_RUN = false;
  const result = Migration.run({ dryRun: DRY_RUN });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Jana semula data seed yang hilang (kategori/tetapan). */
function seedData() {
  requireOwner_();
  const r = { categories: SeedData.categories(), settings: SeedData.settings() };
  console.log(JSON.stringify(r));
  return r;
}

/**
 * Jadikan BOOTSTRAP_SUPER_ADMIN_EMAIL (Script Property) sebagai SUPER_ADMIN.
 * Gunakan jika akaun telah didaftar sebelum property ditetapkan.
 */
function promoteBootstrapAdmin() {
  requireOwner_();
  const email = StringUtils.normalizeEmail(Env.get('BOOTSTRAP_SUPER_ADMIN_EMAIL'));
  if (!email) throw new Error('Tetapkan Script Property BOOTSTRAP_SUPER_ADMIN_EMAIL dahulu.');
  const u = UserRepository.findByEmail(email);
  if (!u) throw new Error('Pengguna belum mendaftar: ' + email);
  UserRepository.update(u.user_id, { role: ROLES.SUPER_ADMIN, status: USER_STATUS.ACTIVE });
  UserService.invalidate(u.user_id);
  AuthService.revokeAllForUser(u.user_id);
  AuditService.log({ role: 'SYSTEM' }, AUDIT_ACTIONS.USER_ROLE_CHANGED, 'USER', u.user_id, u.role + ' → SUPER_ADMIN (bootstrap)');
  console.log('SUPER_ADMIN: ' + email + ' — sila log masuk semula.');
}

/** Sandaran manual. */
function runBackup() {
  requireOwner_();
  const r = BackupService.run(null);
  console.log(JSON.stringify(r));
  return r;
}

/** Pasang pencetus harian (02:00) untuk penyelenggaraan & sandaran. Idempoten. */
function installTriggers() {
  requireOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyMaintenance' || t.getHandlerFunction() === 'hourlyMaintenance') ScriptApp.deleteTrigger(t);
  });
  const added = MaintenanceService.ensureTriggers();
  console.log('Pencetus dipasang: ' + added.join(', ') + ' (harian ~02:00' + (added.indexOf('hourlyMaintenance') >= 0 ? ', setiap jam' : '') + ').');
}

/** Dipanggil oleh pencetus setiap jam (dipasang automatik jika ada modul dengan hook hourly). */
function hourlyMaintenance(e) {
  if (!(e && e.triggerUid)) requireOwner_();
  return MaintenanceService.hourly();
}

/** Dipanggil oleh pencetus masa (juga boleh dijalankan manual oleh pemilik). */
function dailyMaintenance(e) {
  // Pencetus masa menghantar objek acara dengan triggerUid; panggilan manual mesti pemilik.
  if (!(e && e.triggerUid)) requireOwner_();
  return MaintenanceService.daily();
}

/**
 * Semak konfigurasi notifikasi telefon (FCM) dan hantar notifikasi ujian ke peranti pemilik skrip
 * (jika akaun pemilik dalam sistem telah menghidupkan notifikasi). Jalankan dari editor selepas
 * menetapkan Script Property FCM_SERVICE_ACCOUNT.
 */
function testPushConfig() {
  requireOwner_();
  const cfg = PushService.config();
  if (!cfg) {
    const raw = Env.get('FCM_SERVICE_ACCOUNT', '');
    const d = PushService.diagnose(raw);
    console.log('✖ FCM_SERVICE_ACCOUNT ' + (raw ? 'tidak sah' : 'tiada') + '. Panjang nilai: ' + d.length + ' aksara (fail asal ~2,300–2,400), ' +
      'mula "' + d.first + '", akhir "' + d.last + '", ada BEGIN KEY: ' + d.hasPrivateKey + ', ada END KEY: ' + d.hasEndKey + '.');
    console.log('→ Cara paling mudah: muat naik fail JSON Firebase ke Google Drive anda, kemudian jalankan importFcmKeyFromDrive().');
    return { ok: false };
  }
  CacheService.getScriptCache().remove(PushService.TOKEN_CACHE_KEY);
  PushService.accessToken(cfg); // melontar jika kunci/projek salah
  console.log('✔ Token FCM diperoleh untuk projek ' + cfg.projectId + ' (' + cfg.clientEmail + ')');
  const email = Session.getEffectiveUser().getEmail();
  const user = UserRepository.findByEmail ? UserRepository.findByEmail(email) : null;
  if (!user) {
    console.log('ℹ Tiada akaun sistem untuk ' + email + ' — ujian penghantaran dilangkau.');
    return { ok: true, sent: 0 };
  }
  const devices = PushTokenRepository.activeByUser(user.user_id).length;
  const sent = PushService.sendToUser(user.user_id, { title: CONFIG.APP_NAME, body: 'Ujian notifikasi telefon berjaya.', type: 'TEST', path: '#/notifikasi' });
  console.log('Peranti aktif: ' + devices + ' · berjaya dihantar: ' + sent + (devices ? '' : ' (hidupkan notifikasi di Profil pada telefon dahulu)'));
  return { ok: true, devices: devices, sent: sent };
}

/**
 * Import kunci akaun servis Firebase dari Google Drive (elak masalah salin-tampal):
 *   1. Muat naik fail "...-firebase-adminsdk-....json" ke Google Drive (akaun pemilik skrip).
 *   2. Jalankan fungsi ini dari editor.
 * Fail disahkan, disimpan sebagai Script Property FCM_SERVICE_ACCOUNT (satu baris), kemudian fail di Drive DIBUANG ke Trash.
 */
function importFcmKeyFromDrive() {
  requireOwner_();
  const it = DriveApp.searchFiles("title contains 'firebase-adminsdk' and trashed = false");
  let file = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!/\.json$/i.test(f.getName())) continue;
    if (!file || f.getLastUpdated() > file.getLastUpdated()) file = f;
  }
  if (!file) {
    console.log('✖ Tiada fail "*firebase-adminsdk*.json" dalam Google Drive anda. Muat naik fail dari Firebase → Project settings → Service accounts.');
    return { ok: false };
  }
  const j = PushService.parseServiceAccount(file.getBlob().getDataAsString());
  if (!j) {
    console.log('✖ Fail "' + file.getName() + '" bukan JSON akaun servis yang sah.');
    return { ok: false };
  }
  Env.set('FCM_SERVICE_ACCOUNT', JSON.stringify(j));
  CacheService.getScriptCache().remove(PushService.TOKEN_CACHE_KEY);
  file.setTrashed(true);
  console.log('✔ Kunci projek ' + j.project_id + ' disimpan. Fail "' + file.getName() + '" telah dibuang ke Trash Drive (kosongkan Trash untuk padam kekal).');
  return testPushConfig();
}

/** Semakan kesihatan ke log. */
function healthCheck() {
  requireOwner_();
  const r = HealthService.check();
  console.log(JSON.stringify(r, null, 2));
  return r;
}

/**
 * Ujian dalam Apps Script dipecah kepada 4 bahagian kerana had 6 minit setiap eksekusi.
 * Setiap bahagian guna spreadsheet & folder SEMENTARA (dibuang selepas siap) — data produksi tidak disentuh.
 * Jalankan runTestsPart1 → runTestsPart5 satu demi satu.
 */
function runTestsPart1() { return runTestPart_(1); }
function runTestsPart2() { return runTestPart_(2); }
function runTestsPart3() { return runTestPart_(3); }
function runTestsPart4() { return runTestPart_(4); }
/** Ujian domain projek (src/tests/App*.gs). */
function runTestsPart5() { return runTestPart_(5); }

/** @deprecated Gunakan runTestsPart1..4. Dikekalkan supaya arahan lama tidak gagal. */
function runTests() { return runTestPart_(1); }

function runTestPart_(n) {
  requireOwner_();
  const result = TestRunner.runAll({ live: true, suites: TestRunner.partSuites(n), budgetMs: 4.5 * 60 * 1000 });
  console.log('Bahagian ' + n + ' daripada 5\n' + TestRunner.format(result));
  return result.summary;
}

/**
 * Ukur masa hash kata laluan dalam Apps Script sebenar & cadangkan PBKDF2_ITERATIONS.
 * Sasaran: < 600 ms setiap hash (log masuk terasa pantas, serangan luar talian kekal mahal).
 */
function benchmarkPassword() {
  requireOwner_();
  const pw = SecurityUtils.toBytes('Penanda-aras-123');
  const salt = SecurityUtils.randomBytes(16);
  let best = 10000;
  [10000, 20000, 50000, 100000].forEach(function (n) {
    const t0 = Date.now();
    SecurityUtils.pbkdf2(pw, salt, n);
    const ms = Date.now() - t0;
    console.log(n + ' lelaran: ' + ms + ' ms');
    if (ms < 600) best = n;
  });
  console.log('Semasa: ' + SecurityUtils.iterations() + '. Cadangan PBKDF2_ITERATIONS = ' + best +
    ' (tetapkan dalam Script Properties; hash lama dinaik taraf automatik semasa log masuk).');
  return best;
}

/** Buang fail/folder ujian yang tertinggal (cth. jika ujian terhenti kerana had masa). */
function cleanupTestArtifacts() {
  requireOwner_();
  let n = 0;
  const files = DriveApp.searchFiles("title contains '" + CONFIG.APP_SLUG + "_TEST_' and trashed = false");
  while (files.hasNext()) { files.next().setTrashed(true); n++; }
  const folders = DriveApp.searchFolders("title contains '" + CONFIG.APP_SLUG + "_TEST_' and trashed = false");
  while (folders.hasNext()) { folders.next().setTrashed(true); n++; }
  console.log(n + ' fail/folder ujian dipindahkan ke Sampah.');
  return n;
}

/**
 * Hanya pemilik skrip (dari editor) dibenarkan.
 * Dalam Web App "Execute as: Me", Session.getActiveUser() bagi pelawat ialah kosong/berbeza,
 * jadi panggilan google.script.run daripada pengguna lain ditolak.
 */
function requireOwner_() {
  let active = '';
  let effective = '';
  try { active = Session.getActiveUser().getEmail(); } catch (e) { active = ''; }
  try { effective = Session.getEffectiveUser().getEmail(); } catch (e) { effective = ''; }
  if (!active || !effective || active.toLowerCase() !== effective.toLowerCase()) {
    throw new Error('Dilarang: fungsi ini hanya untuk pemilik skrip.');
  }
}
