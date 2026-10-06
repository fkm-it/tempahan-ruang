/**
 * @file DeployInfo.gs
 * Maklumat deploy — DITULIS SEMULA oleh CI (.github/workflows/deploy.yml) sebelum `clasp push`.
 * Nilai di sini awam (bukan rahsia). Script Property PUBLIC_BASE_URL (jika ada) mengatasi publicBaseUrl.
 */
const DEPLOY_INFO = Object.freeze({
  publicBaseUrl: '',
  commit: '',
  builtAt: ''
});
