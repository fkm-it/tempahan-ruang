/**
 * @file SecurityUtils.gs
 * Kriptografi asas di atas Utilities GAS:
 *  - PBKDF2-HMAC-SHA256 + pepper (rahsia server) untuk kata laluan
 *  - token sesi rawak 256-bit
 *  - perbandingan masa-malar
 *  - token borang awam bertandatangan HMAC
 *
 * GAS tiada bcrypt/argon2. PBKDF2 dilaksana mengikut RFC 8018 (diuji dengan
 * vektor Node crypto.pbkdf2Sync dalam tests). Pepper disimpan dalam Script Properties,
 * jadi kebocoran sheet CREDENTIALS sahaja tidak cukup untuk serangan luar talian.
 */
const SecurityUtils = {
  HASH_SCHEME: 'pbkdf2_sha256',

  /** Byte rawak (signed, -128..127 seperti Byte[] Java). */
  randomBytes: function (n) {
    let out = [];
    while (out.length < n) {
      const seed = Utilities.getUuid() + Utilities.getUuid() + String(Date.now());
      out = out.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8));
    }
    return out.slice(0, n);
  },

  toBytes: function (str) {
    return Utilities.newBlob(String(str)).getBytes();
  },

  base64Url: function (bytes) {
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  },

  /** Token sesi: 32 byte rawak → 43 aksara base64url. */
  randomToken: function () {
    return SecurityUtils.base64Url(SecurityUtils.randomBytes(32));
  },

  isTokenFormat: function (token) {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
  },

  sha256Hex: function (str) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
    return SecurityUtils.bytesToHex(bytes);
  },

  bytesToHex: function (bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i] & 0xff;
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    return hex;
  },

  /** HMAC-SHA256(key, value) — kedua-duanya Byte[]. */
  hmacBytes: function (valueBytes, keyBytes) {
    return Utilities.computeHmacSha256Signature(valueBytes, keyBytes);
  },

  /** HMAC-SHA256 heks dengan kunci string. */
  hmacHex: function (value, key) {
    return SecurityUtils.bytesToHex(
      SecurityUtils.hmacBytes(SecurityUtils.toBytes(value), SecurityUtils.toBytes(key))
    );
  },

  /**
   * PBKDF2-HMAC-SHA256, dkLen = 32 (satu blok).
   * @param {number[]} passwordBytes
   * @param {number[]} saltBytes
   * @param {number} iterations
   * @return {number[]} 32 byte terbitan
   */
  pbkdf2: function (passwordBytes, saltBytes, iterations) {
    // U1 = HMAC(P, S || INT(1)) — satu panggilan Utilities
    const u1 = SecurityUtils.hmacBytes(saltBytes.concat([0, 0, 0, 1]), passwordBytes);
    if (iterations <= 1) return u1.map(function (b) { return ((b & 0xff) << 24) >> 24; });

    // Lelaran 2..c dalam JavaScript tulen dengan keadaan ipad/opad dipra-kira:
    // setiap lelaran = 2 mampatan SHA-256 (tiada panggilan Utilities — ~1ms setiap satu dalam GAS).
    let key = passwordBytes;
    if (key.length > 64) key = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key);
    const ipad = new Int32Array(16);
    const opad = new Int32Array(16);
    for (let i = 0; i < 16; i++) {
      let w = 0;
      for (let b = 0; b < 4; b++) w = (w << 8) | ((key[i * 4 + b] || 0) & 0xff);
      ipad[i] = w ^ 0x36363636;
      opad[i] = w ^ 0x5c5c5c5c;
    }
    const istate = Sha256.compress(Sha256.iv(), ipad);
    const ostate = Sha256.compress(Sha256.iv(), opad);

    const u = new Int32Array(8);
    for (let i = 0; i < 8; i++) {
      u[i] = ((u1[i * 4] & 0xff) << 24) | ((u1[i * 4 + 1] & 0xff) << 16) | ((u1[i * 4 + 2] & 0xff) << 8) | (u1[i * 4 + 3] & 0xff);
    }
    const t = Int32Array.from(u);
    const block = new Int32Array(16);
    for (let n = 1; n < iterations; n++) {
      // dalam: H(istate, U || pad), panjang = (64 + 32) bait = 768 bit
      block.set(u, 0); block[8] = 0x80000000; block.fill(0, 9, 15); block[15] = 768;
      const inner = Sha256.compress(Int32Array.from(istate), block);
      // luar: H(ostate, inner || pad)
      block.set(inner, 0); block[8] = 0x80000000; block.fill(0, 9, 15); block[15] = 768;
      const outer = Sha256.compress(Int32Array.from(ostate), block);
      for (let i = 0; i < 8; i++) { u[i] = outer[i]; t[i] ^= outer[i]; }
    }
    const out = [];
    for (let i = 0; i < 8; i++) out.push(t[i] >> 24, (t[i] << 8) >> 24, (t[i] << 16) >> 24, (t[i] << 24) >> 24);
    return out;
  },

  iterations: function () {
    const n = parseInt(Env.get('PBKDF2_ITERATIONS', ''), 10);
    return n >= 1000 && n <= 200000 ? n : CONFIG.PBKDF2_ITERATIONS_DEFAULT;
  },

  /** Kata laluan dicampur pepper dahulu: HMAC(pepper, password). */
  pepper: function (password) {
    return SecurityUtils.hmacBytes(SecurityUtils.toBytes(password), SecurityUtils.toBytes(Env.secret('AUTH_PEPPER')));
  },

  /** @return {string} 'pbkdf2_sha256$<iter>$<saltB64>$<hashB64>' */
  hashPassword: function (password, iterationsOpt) {
    const iter = iterationsOpt || SecurityUtils.iterations();
    const salt = SecurityUtils.randomBytes(16);
    const dk = SecurityUtils.pbkdf2(SecurityUtils.pepper(password), salt, iter);
    return [SecurityUtils.HASH_SCHEME, iter, Utilities.base64Encode(salt), Utilities.base64Encode(dk)].join('$');
  },

  /** @return {{valid:boolean, needsRehash:boolean}} */
  verifyPassword: function (password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== SecurityUtils.HASH_SCHEME) {
      // jalankan kerja setara supaya masa respons tidak membocorkan kewujudan akaun
      SecurityUtils.pbkdf2(SecurityUtils.pepper(password), SecurityUtils.randomBytes(16), SecurityUtils.iterations());
      return { valid: false, needsRehash: false };
    }
    const iter = parseInt(parts[1], 10);
    const salt = Utilities.base64Decode(parts[2]);
    const expected = parts[3];
    const actual = Utilities.base64Encode(SecurityUtils.pbkdf2(SecurityUtils.pepper(password), salt, iter));
    const valid = SecurityUtils.constantTimeEquals(actual, expected);
    return { valid: valid, needsRehash: valid && iter < SecurityUtils.iterations() };
  },

  constantTimeEquals: function (a, b) {
    a = String(a);
    b = String(b);
    let diff = a.length ^ b.length;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  },

  /** Token borang awam: '<issuedAtMs>.<hmac(code|issuedAt)>' — buktikan borang dimuat dari server. */
  signFormToken: function (scope, issuedAtMs) {
    const issued = String(issuedAtMs || Date.now());
    return issued + '.' + SecurityUtils.hmacHex(scope + '|' + issued, Env.secret('FORM_SECRET')).slice(0, 32);
  },

  /** @return {boolean} sah & dalam tetingkap masa (min/max) */
  verifyFormToken: function (scope, token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !/^\d{13}$/.test(parts[0])) return false;
    const expected = SecurityUtils.hmacHex(scope + '|' + parts[0], Env.secret('FORM_SECRET')).slice(0, 32);
    if (!SecurityUtils.constantTimeEquals(parts[1], expected)) return false;
    const ageSec = (Date.now() - Number(parts[0])) / 1000;
    return ageSec >= CONFIG.PUBLIC_FORM_MIN_SECONDS && ageSec <= CONFIG.PUBLIC_FORM_MAX_HOURS * 3600;
  },

  /** Hash ringkas untuk log (cth. user agent) — bukan untuk rahsia. */
  shortHash: function (value) {
    return value ? SecurityUtils.sha256Hex(value).slice(0, 16) : '';
  }
};

/**
 * Mampatan SHA-256 (FIPS 180-4) dalam JavaScript tulen — hanya untuk gelung dalaman PBKDF2.
 * Satu blok 512-bit; aritmetik integer 32-bit. Disahkan dengan vektor RFC dalam TestUnit.gs.
 */
const Sha256 = (function () {
  const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const W = new Int32Array(64);

  function iv() {
    return new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  }

  /** Mampat satu blok (16 perkataan) ke dalam `state` (diubah & dipulangkan). */
  function compress(state, block) {
    for (let i = 0; i < 16; i++) W[i] = block[i];
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0; state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0; state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
    return state;
  }

  return { iv: iv, compress: compress };
})();
