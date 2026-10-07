/**
 * test-webpush.mjs — ujian Web Push (supabase/functions/api/webpush.mjs) tanpa rangkaian:
 *  - kunci VAPID deterministik daripada AUTH_PEPPER (sama di semua isolat), berbeza bagi pepper lain
 *  - JWT VAPID ES256 sah (disahkan dengan kunci awam) & aud = asal endpoint
 *  - penyulitan RFC 8291 aes128gcm: dinyahsulit oleh pelaksanaan PENERIMA yang ditulis berasingan di sini
 *  - senarai endpoint dibenarkan (SSRF), token wp1_ tidak sah ditolak
 *  - deliverPending: tuntut outbox 'webpush', hantar, ack, langganan mati (410) dibatalkan
 */
import nodeCrypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wp = await import(pathToFileURL(path.join(here, '..', 'supabase', 'functions', 'api', 'webpush.mjs')).href);

let pass = 0;
let fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✔ ' + name); } catch (e) { fail++; console.log('✘ ' + name + '\n    ' + (e && e.stack || e)); }
}
function assert(c, m) { if (!c) throw new Error(m || 'gagal'); }
const b64u = (b) => Buffer.from(b).toString('base64url');

/** Pelayar tiruan: pasangan kunci langganan (p256dh) + rahsia auth. */
function browser() {
  const ecdh = nodeCrypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  return { ecdh, auth, sub: (endpoint) => ({ endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } }) };
}
const tokenOf = (sub) => 'wp1_' + b64u(JSON.stringify(sub));

/** Penyahsulit sisi pelayar (RFC 8291 §3.4 / RFC 8188) — ditulis bebas daripada encrypt(). */
function decrypt(body, br) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  assert(rs === 4096 && idlen === 65, 'pengepala aes128gcm');
  const shared = br.ecdh.computeSecret(asPublic);
  const uaPublic = br.ecdh.getPublicKey();
  const prk = nodeCrypto.createHmac('sha256', br.auth).update(shared).digest();
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = nodeCrypto.createHmac('sha256', prk).update(info).digest();
  const prk2 = nodeCrypto.createHmac('sha256', salt).update(ikm).digest();
  const cek = nodeCrypto.createHmac('sha256', prk2).update(Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).digest().subarray(0, 16);
  const nonce = nodeCrypto.createHmac('sha256', prk2).update(Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).digest().subarray(0, 12);
  const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert(plain[plain.length - 1] === 2, 'pembatas rekod terakhir');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

function verifyJwt(jwt, publicKeyB64u) {
  const [h, c, s] = jwt.split('.');
  const pub = Buffer.from(publicKeyB64u, 'base64url');
  const key = nodeCrypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
  return { ok: nodeCrypto.verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), head: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(c, 'base64url')) };
}

await test('Kunci VAPID: deterministik daripada AUTH_PEPPER, 65 bait P-256, berbeza bagi pepper lain', () => {
  const a = wp.vapidKeys('pepper-satu');
  const b = wp.vapidKeys('pepper-satu');
  const c = wp.vapidKeys('pepper-dua');
  assert(a.publicKey === b.publicKey, 'deterministik');
  assert(a.publicKey !== c.publicKey, 'pepper lain → kunci lain');
  const raw = Buffer.from(a.publicKey, 'base64url');
  assert(raw.length === 65 && raw[0] === 4, 'kunci awam tidak dimampatkan');
  assert(wp.vapidKeys('') === null, 'tiada pepper → tiada kunci');
});

await test('JWT VAPID ES256 sah; aud = asal endpoint; tamat ≤ 24 jam', () => {
  const k = wp.vapidKeys('pepper-jwt');
  const jwt = wp.vapidJwt('https://fcm.googleapis.com/fcm/send/abc', k, 'mailto:it@fkm.test');
  const v = verifyJwt(jwt, k.publicKey);
  assert(v.ok, 'tandatangan');
  assert(v.head.alg === 'ES256', 'alg');
  assert(v.claims.aud === 'https://fcm.googleapis.com', 'aud ' + v.claims.aud);
  assert(v.claims.sub === 'mailto:it@fkm.test', 'sub');
  const ttl = v.claims.exp - Math.floor(Date.now() / 1000);
  assert(ttl > 0 && ttl <= 24 * 3600, 'exp');
});

await test('Penyulitan RFC 8291 (aes128gcm) dinyahsulit oleh penerima bebas; setiap mesej unik', () => {
  const br = browser();
  const sub = br.sub('https://fcm.googleapis.com/fcm/send/x');
  const msg = { wp: 1, title: 'Tempahan baharu: TP-2026-0010', body: 'Siti · Dewan Kuliah 1 · 08:00–10:00 — ujian unikod ✓', url: 'https://contoh/#/admin/tempahan/1' };
  const b1 = wp.encrypt(sub, msg);
  const b2 = wp.encrypt(sub, msg);
  assert(JSON.parse(decrypt(b1, br)).body === msg.body, 'kandungan');
  assert(!b1.equals(b2), 'garam & kunci efemeral rawak');
  const other = browser();
  let threw = false;
  try { decrypt(b1, other); } catch (e) { threw = true; }
  assert(threw, 'pelayar lain tidak boleh menyahsulit');
});

await test('Endpoint: hanya perkhidmatan push dikenali (elak SSRF); token wp1_ tidak sah ditolak', () => {
  ['https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/a', 'https://web.push.apple.com/abc', 'https://wns2-sg2p.notify.windows.com/w/?token=a']
    .forEach((u) => assert(wp.allowedEndpoint(u), 'dibenarkan: ' + u));
  ['http://fcm.googleapis.com/a', 'https://evil.example.com/a', 'https://fcm.googleapis.com.evil.com/a', 'https://localhost/a', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com:8443/a']
    .forEach((u) => assert(!wp.allowedEndpoint(u), 'ditolak: ' + u));
  const br = browser();
  assert(wp.parseToken(tokenOf(br.sub('https://fcm.googleapis.com/fcm/send/z'))), 'token sah');
  assert(!wp.parseToken(tokenOf(br.sub('https://evil.example.com/x'))), 'endpoint luar');
  assert(!wp.parseToken('wp1_bukan-json'), 'rosak');
  assert(!wp.parseToken('fcmToken123'), 'bukan wp1');
});

await test('deliverPending: tuntut webpush sahaja, hantar dengan pengepala VAPID, ack, langganan mati dibatalkan', async () => {
  const pepper = 'pepper-hantar';
  const keys = wp.vapidKeys(pepper);
  const live = browser();
  const gone = browser();
  const rows = [
    { id: '1', kind: 'webpush', payload: { id: 'K-AAAAAAAAAAAAAAAA', token: tokenOf(live.sub('https://fcm.googleapis.com/fcm/send/live')), msg: { wp: 1, title: 'A', body: 'B' } } },
    { id: '2', kind: 'webpush', payload: { id: 'K-BBBBBBBBBBBBBBBB', token: tokenOf(gone.sub('https://web.push.apple.com/gone')), msg: { wp: 1, title: 'C' } } }
  ];
  let claimedKinds = null;
  const acked = [];
  const revoked = [];
  const store = {
    claimOutbox: async (limit, kinds) => { claimedKinds = kinds; return rows; },
    ackOutbox: async (r) => { acked.push(...r); }
  };
  const runtime = {
    prop: (k) => ({ AUTH_PEPPER: pepper, OWNER_EMAIL: 'owner@fkm.test' }[k]),
    execute: async (fn) => ({ result: fn({ PushService: { revokeTokens: (ids) => { revoked.push(...ids); return ids.length; } } }) })
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: url.indexOf('gone') >= 0 ? 410 : 201, body: null };
  };
  const out = await wp.deliverPending({ store, runtime, fetchImpl });
  assert(claimedKinds.join() === 'webpush', 'hanya webpush dituntut');
  assert(out.sent === 1 && out.revoked === 1, JSON.stringify(out));
  const live1 = calls.find((c) => c.url.indexOf('live') >= 0);
  assert(live1.init.headers['Content-Encoding'] === 'aes128gcm' && live1.init.headers.TTL === '86400', 'pengepala');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(live1.init.headers.Authorization);
  assert(m && m[2] === keys.publicKey, 'Authorization vapid');
  const v = verifyJwt(m[1], keys.publicKey);
  assert(v.ok && v.claims.sub === 'mailto:owner@fkm.test' && v.claims.aud === 'https://fcm.googleapis.com', 'JWT');
  assert(JSON.parse(decrypt(Buffer.from(live1.init.body), live)).title === 'A', 'muatan sampai ke pelayar');
  assert(acked.length === 2 && acked.every((a) => a.ok), 'ack (langganan mati tidak dicuba semula)');
  assert(revoked.join() === 'K-BBBBBBBBBBBBBBBB', 'token mati dibatalkan');
});

console.log('\n' + pass + ' lulus, ' + fail + ' gagal.');
process.exit(fail ? 1 : 0);
