/**
 * @file PushService.gs
 * Notifikasi telefon (Web Push) melalui Firebase Cloud Messaging (FCM) HTTP v1.
 *
 * Kenapa FCM: Web Push terus memerlukan tandatangan ECDSA (VAPID) + penyulitan payload yang tidak disokong
 * Apps Script. FCM melakukan kedua-duanya; kita hanya perlu token OAuth akaun servis (RS256 — disokong
 * oleh Utilities.computeRsaSha256Signature).
 *
 * Konfigurasi (rahsia, pemilik skrip sahaja):
 *   Script Property FCM_SERVICE_ACCOUNT = keseluruhan fail JSON akaun servis Firebase.
 * Tanpa property ini, semua fungsi push senyap (tiada ralat).
 *
 * Keselamatan:
 *   - Token peranti hanya boleh didaftar/dibuang oleh pengguna yang log masuk (Router RBAC).
 *   - Token yang dipindah ke pengguna lain (peranti dikongsi) dipindah milik — notifikasi tidak bocor.
 *   - Token tidak sah (UNREGISTERED) dibatalkan automatik.
 *   - Kegagalan push tidak pernah menggagalkan permintaan asal (laluan bukan kritikal).
 */
const PushService = {
  SCOPE: 'https://www.googleapis.com/auth/firebase.messaging',
  TOKEN_CACHE_KEY: 'fcm:accessToken',
  MAX_TOKENS_PER_USER: 5,
  TOKEN_RE: /^[A-Za-z0-9_:\-]{20,4096}$/,
  /** Jenis notifikasi yang dihantar ke telefon. */
  PUSH_TYPES: ['RECORD_CREATED', 'RECORD_STATUS', 'BROADCAST'],

  /** @return {{projectId:string, clientEmail:string, privateKey:string, tokenUri:string}|null} */
  config: function () {
    const raw = Env.get('FCM_SERVICE_ACCOUNT', '');
    if (!raw) return null;
    const j = PushService.parseServiceAccount(raw);
    if (!j) {
      AppLogger.warn('FCM_SERVICE_ACCOUNT bukan JSON akaun servis sah', PushService.diagnose(raw));
      return null;
    }
    return {
      projectId: String(j.project_id),
      clientEmail: String(j.client_email),
      privateKey: String(j.private_key),
      tokenUri: /^https:\/\/oauth2\.googleapis\.com\/token$/.test(j.token_uri || '') ? j.token_uri : 'https://oauth2.googleapis.com/token'
    };
  },

  /**
   * Hurai JSON akaun servis dengan toleransi kesilapan tampal biasa:
   * BOM, ruang, petikan "pintar" (“ ”), dibalut petikan, atau dikod base64. @return {Object|null}
   */
  parseServiceAccount: function (raw) {
    const valid = function (j) { return j && typeof j === 'object' && j.client_email && j.private_key && j.project_id && /BEGIN PRIVATE KEY/.test(j.private_key) ? j : null; };
    let s = String(raw || '').replace(/^\uFEFF/, '').trim().replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    const attempts = [s];
    if (!/^\{/.test(s)) {
      try { attempts.push(Utilities.newBlob(Utilities.base64Decode(s.replace(/\s+/g, ''))).getDataAsString()); } catch (e) { /* bukan base64 */ }
    }
    for (let i = 0; i < attempts.length; i++) {
      try {
        let j = JSON.parse(attempts[i]);
        if (typeof j === 'string') j = JSON.parse(j); // dibalut petikan dua kali
        if (valid(j)) return j;
      } catch (e) { /* cuba seterusnya */ }
    }
    return null;
  },

  /** Diagnostik TANPA mendedahkan rahsia: panjang & aksara hujung sahaja. */
  diagnose: function (raw) {
    const s = String(raw || '');
    return { length: s.length, first: s.charAt(0), last: s.charAt(s.length - 1), hasPrivateKey: s.indexOf('BEGIN PRIVATE KEY') >= 0, hasEndKey: s.indexOf('END PRIVATE KEY') >= 0 };
  },

  enabled: function () { return !!PushService.config(); },

  b64url: function (value) { return Utilities.base64EncodeWebSafe(value).replace(/=+$/, ''); },

  /** Token akses OAuth (JWT bearer akaun servis), dicache ~55 minit. */
  accessToken: function (cfg) {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(PushService.TOKEN_CACHE_KEY);
    if (hit) return hit;
    const now = Math.floor(Date.now() / 1000);
    const header = PushService.b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = PushService.b64url(JSON.stringify({ iss: cfg.clientEmail, scope: PushService.SCOPE, aud: cfg.tokenUri, iat: now, exp: now + 3600 }));
    const input = header + '.' + claim;
    const signature = PushService.b64url(Utilities.computeRsaSha256Signature(input, cfg.privateKey));
    const res = UrlFetchApp.fetch(cfg.tokenUri, {
      method: 'post',
      payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: input + '.' + signature },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Token FCM gagal: HTTP ' + res.getResponseCode() + ' ' + String(res.getContentText()).slice(0, 200));
    }
    const j = JSON.parse(res.getContentText());
    const ttl = Math.max(60, Math.min(3300, (Number(j.expires_in) || 3600) - 300));
    cache.put(PushService.TOKEN_CACHE_KEY, j.access_token, ttl);
    return j.access_token;
  },

  /** URL awam (versi web) untuk ikon & pautan klik notifikasi. */
  baseUrl: function () {
    const base = Env.get('PUBLIC_BASE_URL', '') || (typeof DEPLOY_INFO !== 'undefined' ? DEPLOY_INFO.publicBaseUrl : '');
    return /^https:\/\//.test(base) ? (base.slice(-1) === '/' ? base : base + '/') : '';
  },

  buildMessage: function (token, msg) {
    const base = PushService.baseUrl();
    // Tag unik setiap rekod → notifikasi bertindan (seperti WhatsApp/FB), kekal dalam bar notifikasi sehingga dibuka.
    // Pelancar Android memaparkan titik/nombor pada ikon app berdasarkan notifikasi yang belum dibuka.
    const tag = msg.tag || ((msg.type || 'app') + (msg.ref ? ':' + msg.ref : ''));
    const webpush = { notification: { tag: tag, renotify: true }, headers: { Urgency: 'high', TTL: '86400' } };
    if (base) {
      webpush.notification.icon = base + 'icons/icon-192.png';
      webpush.notification.badge = base + 'icons/badge-72.png'; // ikon monokrom bar status Android
      webpush.fcm_options = { link: base + (msg.path || '#/notifikasi') };
    }
    return {
      message: {
        token: token,
        notification: { title: StringUtils.truncate(msg.title, 100), body: StringUtils.truncate(msg.body, 240) },
        webpush: webpush,
        // badge = bilangan notifikasi belum dibaca → nombor pada ikon app (iPhone & desktop; Android guna titik pelancar)
        data: { type: String(msg.type || ''), ref: String(msg.ref || ''), badge: String(msg.badge === undefined ? '' : msg.badge) }
      }
    };
  },

  /**
   * Hantar kepada semua peranti aktif pengguna. Tidak melontar.
   * @return {number} bilangan berjaya
   */
  sendToUser: function (userId, msg) {
    try {
      const cfg = PushService.config();
      if (!cfg || !userId) return 0;
      const tokens = PushTokenRepository.activeByUser(userId);
      if (!tokens.length) return 0;
      const access = PushService.accessToken(cfg);
      const url = 'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) + '/messages:send';
      const requests = tokens.map(function (t) {
        return {
          url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + access },
          payload: JSON.stringify(PushService.buildMessage(t.token, msg))
        };
      });
      const responses = UrlFetchApp.fetchAll(requests);
      let sent = 0;
      const dead = {};
      responses.forEach(function (r, i) {
        const code = r.getResponseCode();
        if (code === 200) { sent++; return; }
        const body = String(r.getContentText() || '');
        if (code === 404 || /UNREGISTERED|registration token/i.test(body)) dead[tokens[i].token_id] = { status: 'REVOKED' };
        else if (code === 401) CacheService.getScriptCache().remove(PushService.TOKEN_CACHE_KEY);
        else AppLogger.warn('FCM gagal', { code: code, body: body.slice(0, 200) });
      });
      if (Object.keys(dead).length) PushTokenRepository.updateMany(dead);
      return sent;
    } catch (e) {
      AppLogger.warn('Push gagal', { error: String(e && e.message || e) });
      return 0;
    }
  },

  // ---------------------------------------------------------------- API pengguna

  status: function (ctx) {
    return { serverEnabled: PushService.enabled(), devices: PushTokenRepository.activeByUser(ctx.userId).length };
  },

  register: function (ctx, payload) {
    const data = Validator.validate(payload, {
      token: { type: 'string', required: true, max: 4096, label: 'Token peranti' },
      platform: { type: 'enum', values: ['ANDROID', 'IOS', 'DESKTOP', 'OTHER'], default: 'OTHER' }
    });
    if (!PushService.TOKEN_RE.test(data.token)) throw Errors.validation('Token peranti tidak sah.');
    SecurityService.rateLimit('push.register', ctx.userId);
    const now = DateUtils.nowIso();
    return Database.withLock(function () {
      const existing = PushTokenRepository.findByToken(data.token);
      if (existing) {
        PushTokenRepository.update(existing.token_id, { user_id: ctx.userId, status: 'ACTIVE', platform: data.platform, last_seen_at: now, user_agent: String(ctx.userAgent || '').slice(0, 200) });
      } else {
        PushTokenRepository.insert({
          token_id: IdUtils.generate('K'), user_id: ctx.userId, token: data.token, platform: data.platform,
          user_agent: String(ctx.userAgent || '').slice(0, 200), status: 'ACTIVE', created_at: now, last_seen_at: now
        });
      }
      // Had peranti setiap pengguna: batalkan yang paling lama
      const active = PushTokenRepository.activeByUser(ctx.userId).sort(function (a, b) { return a.last_seen_at < b.last_seen_at ? 1 : -1; });
      const extra = {};
      active.slice(PushService.MAX_TOKENS_PER_USER).forEach(function (t) { extra[t.token_id] = { status: 'REVOKED' }; });
      if (Object.keys(extra).length) PushTokenRepository.updateMany(extra);
      return { registered: true, devices: Math.min(active.length, PushService.MAX_TOKENS_PER_USER), serverEnabled: PushService.enabled() };
    });
  },

  unregister: function (ctx, payload) {
    const data = Validator.validate(payload, { token: { type: 'string', required: true, max: 4096, label: 'Token peranti' } });
    const t = PushTokenRepository.findByToken(data.token);
    if (t && t.user_id === ctx.userId && t.status === 'ACTIVE') PushTokenRepository.update(t.token_id, { status: 'REVOKED' });
    return { unregistered: true };
  },

  /** Hantar notifikasi ujian kepada peranti pengguna sendiri. */
  test: function (ctx) {
    if (!PushService.enabled()) throw Errors.validation('Notifikasi telefon belum dikonfigurasi oleh pentadbir.');
    SecurityService.rateLimit('push.test', ctx.userId);
    const sent = PushService.sendToUser(ctx.userId, { title: SettingsService.get('SYSTEM_NAME'), body: 'Notifikasi telefon berfungsi. Anda akan dimaklumkan apabila ada kemas kini.', type: 'TEST', path: '#/notifikasi' });
    return { sent: sent };
  }
};

const PushTokenRepository = {
  base: function () { return Repo.of('PUSH_TOKENS'); },
  activeByUser: function (userId) {
    return PushTokenRepository.base().find(function (t) { return t.user_id === userId && t.status === 'ACTIVE'; });
  },
  findByToken: function (token) {
    const list = PushTokenRepository.base().find(function (t) { return t.token === token; });
    return list.length ? list[0] : null;
  },
  insert: function (row) { return PushTokenRepository.base().insert(row); },
  update: function (id, patch) { return PushTokenRepository.base().update(id, patch); },
  updateMany: function (patch) { return PushTokenRepository.base().updateMany(patch); },
  /** Buang rekod dibatalkan (penyelenggaraan harian). */
  purgeRevoked: function () { return PushTokenRepository.base().deleteWhere(function (t) { return t.status !== 'ACTIVE'; }); }
};
