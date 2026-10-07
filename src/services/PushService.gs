/**
 * @file PushService.gs
 * Notifikasi telefon.
 *   - Pelayan Supabase (utama): Web Push standard dengan VAPID — dihantar terus oleh Edge Function (webpush.mjs).
 *     Token = 'wp1_' + langganan pelayar. Tiada Firebase / akaun servis diperlukan.
 *   - Apps Script (mod lama / templat): Firebase Cloud Messaging (FCM) HTTP v1, seperti di bawah.
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

  /** Pelayan Supabase (Edge Function): FCM dihantar oleh pekerja Apps Script melalui baris gilir (outbox 'push'). */
  onEdge: function () { return !!PushService.testOutbox || (typeof EDGE_RUNTIME !== 'undefined' && !!EDGE_RUNTIME); },
  /** Baris gilir outbox Supabase (ujian boleh menggantikannya dengan PushService.testOutbox). */
  outbox: function () { return PushService.testOutbox || (typeof EDGE_OUTBOX !== 'undefined' && EDGE_OUTBOX ? EDGE_OUTBOX : null); },
  testOutbox: null,

  /**
   * Di Apps Script: ada akaun servis FCM. Di Supabase: pekerja Apps Script melaporkan (PUSH_RELAY = '1') bahawa
   * ia mempunyai akaun servis FCM — rahsia itu kekal di Apps Script sahaja, tidak disalin ke Supabase.
   */
  enabled: function () { return PushService.onEdge() ? (!!PushService.vapidPublicKey() || Env.get('PUSH_RELAY', '') === '1') : !!PushService.config(); },

  /** Awalan token langganan Web Push standard (VAPID, dihantar terus oleh Supabase — tanpa Firebase). */
  WP_PREFIX: 'wp1_',
  isWebPush: function (token) { return String(token || '').indexOf(PushService.WP_PREFIX) === 0; },

  /** Kunci awam VAPID (pelayan Supabase sahaja; '' di Apps Script). Ujian boleh menetapkan PushService.testVapid. */
  vapidPublicKey: function () {
    if (PushService.testVapid !== null) return PushService.testVapid;
    try { return typeof EDGE_WEBPUSH !== 'undefined' && EDGE_WEBPUSH ? String(EDGE_WEBPUSH.publicKey() || '') : ''; } catch (e) { return ''; }
  },
  testVapid: null,

  /** Perkhidmatan push pelayar yang dibenarkan (sama seperti webpush.mjs) — elak pelayan menghantar ke URL sewenang-wenang. */
  PUSH_HOST_RE: /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/,

  /** Token 'wp1_…' → { endpoint, keys } atau null. */
  parseWebPush: function (token) {
    if (!PushService.isWebPush(token)) return null;
    try {
      const raw = String(token).slice(PushService.WP_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
      const sub = JSON.parse(Utilities.newBlob(Utilities.base64Decode(raw + '==='.slice((raw.length + 3) % 4))).getDataAsString());
      const m = /^https:\/\/([^\/:?#]+)\//.exec(String(sub && sub.endpoint || ''));
      if (!m || !PushService.PUSH_HOST_RE.test(m[1].toLowerCase())) return null;
      if (!sub.keys || !/^[A-Za-z0-9_-]{80,100}$/.test(String(sub.keys.p256dh || '')) || !/^[A-Za-z0-9_-]{16,30}$/.test(String(sub.keys.auth || ''))) return null;
      return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    } catch (e) { return null; }
  },

  /** Dipanggil oleh pelayan Supabase apabila pekerja melaporkan status FCM. @return {boolean} berubah */
  setRelay: function (on) {
    const want = on ? '1' : '';
    if (Env.get('PUSH_RELAY', '') === want) return false;
    Env.set('PUSH_RELAY', want);
    return true;
  },

  /** Token yang ditolak FCM (dilaporkan oleh pekerja) → REVOKED. */
  revokeTokens: function (ids) {
    const patch = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) { if (/^K-[0-9A-F]{16}$/.test(String(id))) patch[id] = { status: 'REVOKED' }; });
    return Object.keys(patch).length ? PushTokenRepository.updateMany(patch) : 0;
  },

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
   * Di Supabase: dibaris gilir (outbox 'push') untuk pekerja Apps Script — pulangkan bilangan peranti dibaris gilir.
   * @return {number} bilangan berjaya / dibaris gilir
   */
  sendToUser: function (userId, msg) {
    try {
      if (!userId || !PushService.enabled()) return 0;
      const tokens = PushTokenRepository.activeByUser(userId);
      if (!tokens.length) return 0;
      if (PushService.onEdge()) {
        const ob = PushService.outbox();
        if (!ob) return 0;
        let n = 0;
        /* Web Push standard: satu item setiap peranti, dihantar terus oleh pelayan Supabase */
        const wp = PushService.vapidPublicKey() ? tokens.filter(function (t) { return PushService.isWebPush(t.token); }) : [];
        wp.forEach(function (t) { ob.queue('webpush', { id: t.token_id, token: t.token, msg: PushService.webPushMessage(msg) }); n++; });
        /* Token FCM lama (jika pekerja Apps Script mempunyai akaun servis Firebase) */
        const fcm = Env.get('PUSH_RELAY', '') === '1' ? tokens.filter(function (t) { return !PushService.isWebPush(t.token); }) : [];
        if (fcm.length) { ob.queue('push', { tokens: fcm.map(function (t) { return { id: t.token_id, token: t.token }; }), msg: msg }); n += fcm.length; }
        return n;
      }
      const r = PushService.sendTokens(tokens.filter(function (t) { return !PushService.isWebPush(t.token); }).map(function (t) { return { id: t.token_id, token: t.token }; }), msg);
      if (r.dead.length) PushService.revokeTokens(r.dead);
      return r.sent;
    } catch (e) {
      AppLogger.warn('Push gagal', { error: String(e && e.message || e) });
      return 0;
    }
  },

  /** Muatan Web Push (dibaca oleh pwa/sw.js): tajuk, teks, pautan penuh, tag & lencana. */
  webPushMessage: function (msg) {
    const m = msg || {};
    const base = PushService.baseUrl();
    const tag = m.tag || ((m.type || 'app') + (m.ref ? ':' + m.ref : ''));
    return {
      wp: 1, title: StringUtils.truncate(String(m.title || ''), 100), body: StringUtils.truncate(String(m.body || ''), 240), tag: tag,
      url: (base || '') + (m.path || '#/notifikasi'), badge: m.badge === undefined ? '' : String(m.badge),
      icon: base ? base + 'icons/icon-192.png' : '', badgeIcon: base ? base + 'icons/badge-72.png' : ''
    };
  },

  /**
   * Hantar mesej kepada senarai token melalui FCM (Apps Script sahaja — memerlukan UrlFetchApp & akaun servis).
   * @param {{id:string, token:string}[]} tokens
   * @return {{sent:number, dead:string[]}} dead = ID token yang tidak lagi sah
   */
  sendTokens: function (tokens, msg) {
    const out = { sent: 0, dead: [] };
    const cfg = PushService.config();
    if (!cfg || !tokens || !tokens.length) return out;
    const access = PushService.accessToken(cfg);
    const url = 'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) + '/messages:send';
    const requests = tokens.map(function (t) {
      return {
        url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + access },
        payload: JSON.stringify(PushService.buildMessage(t.token, msg || {}))
      };
    });
    const responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function (r, i) {
      const code = r.getResponseCode();
      if (code === 200) { out.sent++; return; }
      const body = String(r.getContentText() || '');
      if (code === 404 || /UNREGISTERED|registration token/i.test(body)) out.dead.push(tokens[i].id);
      else if (code === 401) CacheService.getScriptCache().remove(PushService.TOKEN_CACHE_KEY);
      else AppLogger.warn('FCM gagal', { code: code, body: body.slice(0, 200) });
    });
    return out;
  },

  /** Pekerja Apps Script: hantar satu item outbox 'push' daripada Supabase. @return {{sent:number, dead:string[]}} */
  relay: function (payload) {
    const p = payload || {};
    const tokens = (Array.isArray(p.tokens) ? p.tokens : []).filter(function (t) { return t && PushService.TOKEN_RE.test(String(t.token || '')); }).slice(0, PushService.MAX_TOKENS_PER_USER);
    if (!PushService.config()) throw new Error('FCM_SERVICE_ACCOUNT tiada dalam Script Properties');
    return PushService.sendTokens(tokens, p.msg || {});
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
    if (PushService.isWebPush(data.token) && !PushService.parseWebPush(data.token)) throw Errors.validation('Langganan notifikasi tidak sah.');
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
