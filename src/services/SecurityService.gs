/**
 * @file SecurityService.gs
 * RBAC, had kadar, idempotensi, dan pengesahan muat naik fail.
 */
const SecurityService = {
  hasRole: function (role, required) {
    return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[required] || 0);
  },

  requireRole: function (ctx, required) {
    if (required === ROLES.PUBLIC) return;
    if (!ctx || !ctx.userId) throw Errors.unauthenticated();
    if (!SecurityService.hasRole(ctx.role, required)) throw Errors.forbidden();
  },

  /**
   * Had kadar tetingkap tetap menggunakan CacheService.
   * Nota: CacheService tidak atomik; kiraan mungkin terlepas sedikit di bawah konkurensi tinggi
   * — diterima untuk tujuan anti-penyalahgunaan (bukan pengebilan).
   * @param {string} bucket kunci dalam CONFIG.RATE_LIMITS
   * @param {string} identity cth. email / userId / kod pautan
   */
  rateLimit: function (bucket, identity) {
    const rule = CONFIG.RATE_LIMITS[bucket];
    if (!rule) return;
    const limit = rule[0];
    const windowSec = rule[1];
    const windowId = Math.floor(Date.now() / 1000 / windowSec);
    const key = AppCache.PREFIX + 'rl:' + bucket + ':' + SecurityUtils.shortHash(String(identity || 'global')) + ':' + windowId;
    const cache = CacheService.getScriptCache();
    const current = parseInt(cache.get(key) || '0', 10);
    if (current >= limit) {
      AppLogger.warn('Had kadar dicapai', { bucket: bucket });
      throw Errors.rateLimited();
    }
    cache.put(key, String(current + 1), windowSec + 5);
  },

  /**
   * Cegah hantaran berganda (klik dua kali / cubaan semula rangkaian).
   * Klien menghantar requestId unik per borang; respons pertama dicache & dipulangkan semula.
   */
  idempotent: function (scope, requestId, fn) {
    if (!requestId || !/^[A-Za-z0-9_-]{8,64}$/.test(String(requestId))) return fn();
    const key = 'idem:' + scope + ':' + requestId;
    const hit = AppCache.get(key);
    if (hit) return hit;
    return Database.withLock(function () {
      const again = AppCache.get(key);
      if (again) return again;
      const result = fn();
      AppCache.put(key, result, CONFIG.IDEMPOTENCY_TTL_SECONDS);
      return result;
    });
  },

  /**
   * Sahkan fail muat naik: nama, sambungan, MIME (senarai dibenarkan), saiz, dan MAGIC BYTES.
   * @param {{name:string, mimeType:string, data:string}} file data = base64 (tanpa prefix data:)
   * @return {{filename:string, mimeType:string, bytes:number[], size:number}}
   */
  validateUpload: function (file) {
    if (!file || typeof file !== 'object') throw Errors.validation('Lampiran tidak sah.');
    const allowed = SettingsService.allowedMimeTypes();
    const maxBytes = SettingsService.get('MAX_ATTACHMENT_MB') * 1024 * 1024;
    const filename = StringUtils.safeFilename(file.name);
    const mime = String(file.mimeType || '').toLowerCase().split(';')[0].trim();
    const ext = StringUtils.extension(filename);

    if (allowed.indexOf(mime) < 0) throw Errors.validation('Jenis fail "' + filename + '" tidak dibenarkan.');
    if (FILE_SIGNATURES[mime].exts.indexOf(ext) < 0) throw Errors.validation('Sambungan fail "' + filename + '" tidak sepadan dengan jenisnya.');

    const b64 = String(file.data || '').replace(/^data:[^,]*,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw Errors.validation('Data fail rosak.');
    // semak saiz SEBELUM decode (elak beban memori)
    if (Math.floor(b64.length * 3 / 4) > maxBytes + 3) {
      throw Errors.validation('Fail "' + filename + '" melebihi had ' + SettingsService.get('MAX_ATTACHMENT_MB') + 'MB.');
    }
    const bytes = Utilities.base64Decode(b64.replace(/\s/g, ''));
    if (!bytes.length) throw Errors.validation('Fail kosong.');
    if (bytes.length > maxBytes) throw Errors.validation('Fail "' + filename + '" melebihi had saiz.');
    if (!SecurityService.matchesSignature(bytes, mime)) {
      throw Errors.validation('Kandungan fail "' + filename + '" tidak sepadan dengan jenisnya.');
    }
    return { filename: filename, mimeType: mime, bytes: bytes, size: bytes.length };
  },

  /** Semak magic bytes. */
  matchesSignature: function (bytes, mime) {
    const b = function (i) { return bytes[i] === undefined ? -1 : bytes[i] & 0xff; };
    const ascii = function (start, len) {
      let s = '';
      for (let i = start; i < start + len; i++) s += String.fromCharCode(b(i));
      return s;
    };
    switch (mime) {
      case 'image/jpeg': return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
      case 'image/png': return b(0) === 0x89 && ascii(1, 3) === 'PNG';
      case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
      case 'application/pdf': return ascii(0, 5) === '%PDF-';
      case 'audio/mpeg': return ascii(0, 3) === 'ID3' || (b(0) === 0xff && (b(1) & 0xe0) === 0xe0);
      case 'audio/mp4':
      case 'audio/x-m4a': return ascii(4, 4) === 'ftyp';
      case 'audio/ogg': return ascii(0, 4) === 'OggS';
      case 'audio/wav': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
      default: return false;
    }
  }
};
