#!/usr/bin/env node
/**
 * run-tests.js — Jalankan suite ujian GAS dalam Node dengan mock.
 *   node tools/run-tests.js            (susunan muat abjad)
 *   node tools/run-tests.js --reverse  (susunan terbalik — bukti tiada kebergantungan susunan)
 *   node tools/run-tests.js --filter Auth
 */
'use strict';
const { loadGas } = require('./load-gas');

const args = process.argv.slice(2);
const reverse = args.includes('--reverse');
const fi = args.indexOf('--filter');
const filter = fi >= 0 ? args[fi + 1] : '';

const gas = loadGas({ reverse, quiet: true });
// Kait mock ke globalThis konteks supaya ujian nodeOnly boleh membaca email & tukar pengguna aktif
gas.context.globalThis = gas.context;
gas.context.__mails = gas.env.state.mails;
gas.context.__mockState = gas.env.state;
// Kunci RSA ujian untuk akaun servis FCM palsu
const { privateKey: __pk, publicKey: __pub } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
gas.context.__testServiceAccount = JSON.stringify({ type: 'service_account', project_id: 'app-test', client_email: 'fcm@app-test.iam.gserviceaccount.com',
  private_key: __pk.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' });
gas.context.__verifyJwt = (jwt) => { const [h, c, s] = jwt.split('.'); return require('crypto').verify('RSA-SHA256', Buffer.from(h + '.' + c), __pub, Buffer.from(s, 'base64url')); };
gas.context.__setActiveUser = gas.env.setActiveUser;

const TestRunner = gas.get('TestRunner');
const result = TestRunner.runAll({ live: false, filter });
console.log(TestRunner.format(result));
console.log(`\nSusunan muat: ${reverse ? 'TERBALIK' : 'abjad'} · ${gas.files.length} fail .gs`);
process.exit(result.summary.failed ? 1 : 0);
