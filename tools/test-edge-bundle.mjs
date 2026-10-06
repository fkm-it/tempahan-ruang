/**
 * test-edge-bundle.mjs — bukti himpunan Edge (tools/build-edge.js) setara dengan kod GAS:
 * jalankan SEMUA ujian GAS di dalam modul ES (mod ketat) yang dijana, dengan perkhidmatan GAS tiruan.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), 'edge-bundle-test-' + process.pid + '.mjs');
execFileSync(process.execPath, [path.join(here, 'build-edge.js'), '--tests', '--out', out], { stdio: 'inherit' });
const { createBackend } = await import(pathToFileURL(out).href);
const { createGasEnvironment } = require('./gas-mock');

const env = createGasEnvironment({});
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const G = Object.assign({}, env.globals, { console: quiet, EDGE_RUNTIME: false, __mails: env.state.mails });
G.globalThis = {
  __mails: env.state.mails, __mockState: env.state, __setActiveUser: env.setActiveUser,
  __testServiceAccount: JSON.stringify({ type: 'service_account', project_id: 'app-test', client_email: 'fcm@app-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' }),
  __verifyJwt: (jwt) => { const [h, c, s] = jwt.split('.'); return crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), publicKey, Buffer.from(s, 'base64url')); }
};
const B = createBackend(G);
const result = B.TestRunner.runAll({ live: false, filter: process.argv[2] || '' });
console.log(B.TestRunner.format(result).split('\n').filter((l) => !l.startsWith('✔')).join('\n'));
process.exit(result.summary.failed ? 1 : 0);
