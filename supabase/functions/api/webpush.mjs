/**
 * webpush.mjs — notifikasi telefon terus daripada Supabase (piawai Web Push), tanpa Firebase.
 *
 *  - VAPID (RFC 8292): JWT ES256 ditandatangani dengan kunci P-256 pelayan.
 *  - Penyulitan muatan (RFC 8291, aes128gcm): ECDH P-256 + HKDF-SHA256 + AES-128-GCM.
 *  - Kunci VAPID DITERBITKAN daripada AUTH_PEPPER (HMAC) — tiada rahsia baharu untuk disimpan/disalin, sama di semua
 *    isolat, dan tidak pernah keluar dari pelayan. Kunci awam sahaja dihantar ke pelayar (public.config).
 *  - Endpoint langganan disemak terhadap senarai perkhidmatan push yang dikenali (elak SSRF).
 *
 * Langganan disimpan dalam sheet PUSH_TOKENS sebagai token 'wp1_' + base64url(JSON {endpoint, keys:{p256dh, auth}}).
 */
import nodeCrypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const WP_PREFIX = 'wp1_';
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Perkhidmatan push pelayar yang dibenarkan (Chrome/Edge/Android, Firefox, Safari/iPhone, Windows). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch (e) { return false; }
}

const keyCache = new Map();
/**
 * Pasangan kunci VAPID daripada AUTH_PEPPER (deterministik). @return {{publicKey:string, privateKey:KeyObject}|null}
 */
export function vapidKeys(pepper) {
  if (!pepper) return null;
  const hit = keyCache.get(pepper);
  if (hit) return hit;
  let d = null;
  for (let i = 0; i < 16 && !d; i++) {
    const c = nodeCrypto.createHmac('sha256', String(pepper)).update('druang-vapid-v1|' + i).digest();
    const n = BigInt('0x' + c.toString('hex'));
    if (n > 0n && n < P256_N) d = c;
  }
  const ecdh = nodeCrypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); /* 65 bait, tidak dimampatkan */
  const privateKey = nodeCrypto.createPrivateKey({
    format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }
  });
  const keys = { publicKey: b64u(pub), privateKey };
  keyCache.set(pepper, keys);
  return keys;
}

/** JWT VAPID (ES256) untuk asal (origin) endpoint. */
export function vapidJwt(endpoint, keys, subject, nowSec) {
  const aud = new URL(endpoint).origin;
  const exp = (nowSec || Math.floor(Date.now() / 1000)) + 12 * 3600;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp, sub: subject || 'mailto:admin@example.com' }));
  const sig = nodeCrypto.sign('sha256', Buffer.from(head + '.' + body), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64u(sig);
}

/** Sulitkan muatan untuk satu langganan (RFC 8291, aes128gcm). @return {Buffer} badan permintaan */
export function encrypt(sub, payload, opts) {
  const o = opts || {};
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Kunci langganan tidak sah');
  const ecdh = nodeCrypto.createECDH('prime256v1');
  if (o.asPrivate) ecdh.setPrivateKey(o.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = o.salt || nodeCrypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(nodeCrypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)), Buffer.from([2])]);
  const cipher = nodeCrypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ct]);
}

/** Token 'wp1_…' → langganan, atau null jika tidak sah. */
export function parseToken(token) {
  if (typeof token !== 'string' || token.indexOf(WP_PREFIX) !== 0) return null;
  try {
    const s = JSON.parse(fromB64u(token.slice(WP_PREFIX.length)).toString('utf8'));
    if (!s || typeof s.endpoint !== 'string' || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return null;
    return allowedEndpoint(s.endpoint) ? { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } } : null;
  } catch (e) { return null; }
}

/**
 * Hantar satu notifikasi. @return {Promise<{ok:boolean, dead:boolean, status:number, error?:string}>}
 * dead = langganan tamat (404/410) → token perlu dibatalkan.
 */
export async function sendOne(token, msg, keys, opts) {
  const o = opts || {};
  const sub = parseToken(token);
  if (!sub) return { ok: false, dead: true, status: 0, error: 'langganan tidak sah' };
  const body = encrypt(sub, msg);
  const res = await (o.fetch || fetch)(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: 'vapid t=' + vapidJwt(sub.endpoint, keys, o.subject) + ', k=' + keys.publicKey
    },
    body,
    signal: AbortSignal.timeout(15000)
  });
  try { await res.body?.cancel(); } catch (e) { /* abaikan */ }
  if (res.status >= 200 && res.status < 300) return { ok: true, dead: false, status: res.status };
  return { ok: false, dead: res.status === 404 || res.status === 410, status: res.status, error: 'HTTP ' + res.status };
}

/**
 * Hantar semua item outbox 'webpush' yang tertunggak (dipanggil selepas permintaan API & setiap kitaran pekerja).
 * Token mati dibatalkan melalui kod .gs (PushService.revokeTokens) supaya peraturan data kekal di satu tempat.
 */
export async function deliverPending({ store, runtime, fetchImpl, log }) {
  const L = log || console;
  const keys = vapidKeys(runtime.prop('AUTH_PEPPER'));
  if (!keys) return { sent: 0, failed: 0 };
  const rows = await store.claimOutbox(50, ['webpush']);
  if (!rows.length) return { sent: 0, failed: 0 };
  const subject = 'mailto:' + (runtime.prop('OWNER_EMAIL') || 'admin@example.com');
  const results = [];
  const dead = [];
  let sent = 0;
  await Promise.all(rows.map(async (r) => {
    try {
      const p = r.payload || {};
      const out = await sendOne(p.token, p.msg || {}, keys, { fetch: fetchImpl, subject });
      if (out.ok) sent++;
      if (out.dead && p.id) dead.push(String(p.id));
      /* Langganan mati: tandakan "dihantar" supaya tidak dicuba semula */
      results.push({ id: r.id, ok: out.ok || out.dead, error: out.error });
    } catch (e) {
      results.push({ id: r.id, ok: false, error: String(e && e.message || e) });
    }
  }));
  await store.ackOutbox(results);
  if (dead.length) {
    try { await runtime.execute((B) => B.PushService.revokeTokens(dead)); } catch (e) { L.error('[webpush] revoke', e); }
  }
  return { sent, failed: results.filter((x) => !x.ok).length, revoked: dead.length };
}
