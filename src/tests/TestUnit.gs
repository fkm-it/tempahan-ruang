/**
 * @file TestUnit.gs
 * Ujian unit: utiliti, validasi, kriptografi.
 */
const TestSuiteUtils = {
  name: 'Utils',
  tests: [
    ['IdUtils.generate format & unik', function (t) {
      const seen = {};
      for (let i = 0; i < 500; i++) {
        const id = IdUtils.generate('D');
        t.ok(IdUtils.isValid(id, 'D'), 'format ' + id);
        t.ok(!seen[id], 'duplikat ' + id);
        seen[id] = true;
      }
    }],
    ['IdUtils.shareCode abjad selamat', function (t) {
      const code = IdUtils.shareCode(8);
      t.eq(code.length, 8);
      t.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(code), code);
    }],
    ['StringUtils.sheetSafe cegah formula', function (t) {
      t.eq(StringUtils.sheetSafe('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
      t.eq(StringUtils.sheetSafe('+60123'), "'+60123");
      t.eq(StringUtils.sheetSafe('Teks biasa'), 'Teks biasa');
      t.eq(StringUtils.sheetUnescape("'=1+1"), '=1+1');
    }],
    ['StringUtils.escapeHtml & stripTags', function (t) {
      t.eq(StringUtils.escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
      t.eq(StringUtils.stripTags('Ya Allah <script>alert(1)</script>ampunilah'), 'Ya Allah alert(1)ampunilah');
      t.eq(StringUtils.stripTags('Saya <3 ibu'), 'Saya <3 ibu');
    }],
    ['StringUtils.clean buang aksara kawalan & bidi', function (t) {
      t.eq(StringUtils.clean('  a\u0000b‮c  '), 'abc');
    }],
    ['Validator buang medan tidak diisytihar (mass assignment)', function (t) {
      const out = Validator.validate({ name: 'Ali', role: 'SUPER_ADMIN' }, { name: { type: 'string', required: true } });
      t.eq(out.role, undefined);
      t.eq(out.name, 'Ali');
    }],
    ['Validator email/int/enum/date', function (t) {
      t.throws(function () { Validator.validate({ e: 'bukan-email' }, { e: { type: 'email' } }); }, ERROR_CODES.VALIDATION_ERROR);
      t.eq(Validator.validate({ e: ' Ali@Contoh.MY ' }, { e: { type: 'email' } }).e, 'ali@contoh.my');
      t.throws(function () { Validator.validate({ n: '5' }, { n: { type: 'int', max: 3 } }); }, ERROR_CODES.VALIDATION_ERROR);
      t.throws(function () { Validator.validate({ r: 'ROOT' }, { r: { type: 'enum', values: ['A'] } }); }, ERROR_CODES.VALIDATION_ERROR);
      t.throws(function () { Validator.validate({ d: '2026-13-40' }, { d: { type: 'date' } }); }, ERROR_CODES.VALIDATION_ERROR);
      t.eq(Validator.validate({ d: '2026-10-03' }, { d: { type: 'date' } }).d, '2026-10-03');
    }],
    ['Validator.password polisi', function (t) {
      t.throws(function () { Validator.password('pendek1'); }, ERROR_CODES.VALIDATION_ERROR);
      t.throws(function () { Validator.password('tiadanombor'); }, ERROR_CODES.VALIDATION_ERROR);
      t.throws(function () { Validator.password('a1@b.com', 'a1@b.com'); }, ERROR_CODES.VALIDATION_ERROR);
      t.eq(Validator.password('Rahsia123'), 'Rahsia123');
    }],
    ['Validator.paginate meta', function (t) {
      const p = Validator.paginate([1, 2, 3, 4, 5], Validator.paging({ page: 2, pageSize: 2 }));
      t.eq(p.items.join(','), '3,4');
      t.eq(p.meta.totalPages, 3);
      t.eq(Validator.paging({ pageSize: 9999 }).pageSize, CONFIG.MAX_PAGE_SIZE);
    }],
    ['DateUtils zon waktu & julat', function (t) {
      t.eq(DateUtils.dayKey('2026-10-02T17:30:00Z'), '2026-10-03', 'UTC+8');
      const months = DateUtils.lastNMonths(12);
      t.eq(months.length, 12);
      t.ok(months[0] < months[11]);
      t.ok(DateUtils.inDayRange('2026-10-03T01:00:00Z', '2026-10-03', '2026-10-03'));
    }]
  ]
};

const TestSuiteSecurity = {
  name: 'Security',
  tests: [
    ['PBKDF2-HMAC-SHA256 vektor RFC (c=1, c=2)', function (t) {
      const p = SecurityUtils.toBytes('password');
      const s = SecurityUtils.toBytes('salt');
      t.eq(SecurityUtils.bytesToHex(SecurityUtils.pbkdf2(p, s, 1)), '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
      t.eq(SecurityUtils.bytesToHex(SecurityUtils.pbkdf2(p, s, 2)), 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
      t.eq(SecurityUtils.bytesToHex(SecurityUtils.pbkdf2(p, s, 4096)), 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
    }],
    ['PBKDF2: kunci > 64 bait & garam panjang (vektor RFC 7914 dkLen 32)', function (t) {
      const p = SecurityUtils.toBytes('passwordPASSWORDpassword');
      const s = SecurityUtils.toBytes('saltSALTsaltSALTsaltSALTsaltSALTsalt');
      t.eq(SecurityUtils.bytesToHex(SecurityUtils.pbkdf2(p, s, 4096)), '348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1');
      const longKey = SecurityUtils.toBytes(new Array(101).join('k'));
      const h1 = SecurityUtils.bytesToHex(SecurityUtils.pbkdf2(longKey, s, 3));
      t.ok(/^[0-9a-f]{64}$/.test(h1) && h1 === SecurityUtils.bytesToHex(SecurityUtils.pbkdf2(longKey, s, 3)), 'deterministik');
    }],
    ['hashPassword / verifyPassword', function (t) {
      const h = SecurityUtils.hashPassword('Rahsia123');
      t.ok(/^pbkdf2_sha256\$1000\$/.test(h), h);
      t.ok(h.indexOf('Rahsia123') < 0, 'tiada plaintext');
      t.ok(SecurityUtils.verifyPassword('Rahsia123', h).valid);
      t.ok(!SecurityUtils.verifyPassword('rahsia123', h).valid);
      t.ok(!SecurityUtils.verifyPassword('x', 'rosak').valid);
      t.ok(SecurityUtils.hashPassword('Rahsia123') !== h, 'garam unik');
    }],
    ['needsRehash apabila lelaran dinaikkan', function (t) {
      const h = SecurityUtils.hashPassword('Rahsia123', 1000);
      Env.set('PBKDF2_ITERATIONS', '2000'); // hanya menyentuh override ujian
      try {
        t.ok(SecurityUtils.verifyPassword('Rahsia123', h).needsRehash);
      } finally {
        Env.set('PBKDF2_ITERATIONS', '1000');
      }
    }],
    ['Token sesi rawak 256-bit', function (t) {
      const a = SecurityUtils.randomToken();
      t.ok(SecurityUtils.isTokenFormat(a), a);
      t.ok(a !== SecurityUtils.randomToken());
      t.ok(!SecurityUtils.isTokenFormat('abc'));
    }],
    ['constantTimeEquals', function (t) {
      t.ok(SecurityUtils.constantTimeEquals('abc', 'abc'));
      t.ok(!SecurityUtils.constantTimeEquals('abc', 'abd'));
      t.ok(!SecurityUtils.constantTimeEquals('abc', 'abcd'));
    }],
    ['Token borang: terlalu cepat, sah, dipalsukan', function (t) {
      t.ok(!SecurityUtils.verifyFormToken('x', SecurityUtils.signFormToken('x')), 'terlalu cepat');
      t.ok(SecurityUtils.verifyFormToken('x', SecurityUtils.signFormToken('x', Date.now() - 5000)), 'sah');
      t.ok(!SecurityUtils.verifyFormToken('y', SecurityUtils.signFormToken('x', Date.now() - 5000)), 'skop lain');
      t.ok(!SecurityUtils.verifyFormToken('x', SecurityUtils.signFormToken('x', Date.now() - 7 * 3600000)), 'tamat');
      t.ok(!SecurityUtils.verifyFormToken('x', (Date.now() - 5000) + '.deadbeef'), 'dipalsukan');
    }],
    ['Magic bytes: PNG sah, spoof ditolak', function (t) {
      const png = Utilities.base64Decode(TestHelpers.PNG_1PX);
      t.ok(SecurityService.matchesSignature(png, 'image/png'));
      t.ok(!SecurityService.matchesSignature(png, 'image/jpeg'));
      t.ok(!SecurityService.matchesSignature(SecurityUtils.toBytes('<svg onload=alert(1)>'), 'image/png'));
      t.ok(SecurityService.matchesSignature(SecurityUtils.toBytes('%PDF-1.7 ...'), 'application/pdf'));
    }],
    ['validateUpload: jenis, sambungan, saiz', function (t) {
      t.ok(SecurityService.validateUpload({ name: 'a.png', mimeType: 'image/png', data: TestHelpers.PNG_1PX }).size > 0);
      t.throws(function () { SecurityService.validateUpload({ name: 'a.exe', mimeType: 'application/x-msdownload', data: 'TVo=' }); }, ERROR_CODES.VALIDATION_ERROR);
      t.throws(function () { SecurityService.validateUpload({ name: 'a.jpg', mimeType: 'image/png', data: TestHelpers.PNG_1PX }); }, ERROR_CODES.VALIDATION_ERROR, 'sambungan');
      t.throws(function () { SecurityService.validateUpload({ name: 'a.svg', mimeType: 'image/svg+xml', data: 'PHN2Zz4=' }); }, ERROR_CODES.VALIDATION_ERROR, 'svg');
      const big = Utilities.base64Encode(new Array(6 * 1024 * 1024).fill(0));
      t.throws(function () { SecurityService.validateUpload({ name: 'b.png', mimeType: 'image/png', data: big }); }, ERROR_CODES.VALIDATION_ERROR, 'saiz');
    }, { nodeOnly: true }],
    ['Log diredaksi', function (t) {
      const r = AppLogger.redact({ password: 'x', token: 'y', nested: { newPassword: 'z' }, ok: 1 });
      t.eq(r.password, '[REDACTED]');
      t.eq(r.token, '[REDACTED]');
      t.eq(r.nested.newPassword, '[REDACTED]');
      t.eq(r.ok, 1);
    }]
  ]
};
