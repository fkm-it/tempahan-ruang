/**
 * gas-html.js — tiru pemprosesan Apps Script ke atas <script> dalam fail HTML:
 * teks selepas "//" hingga hujung baris dibuang (walaupun di dalam string/regex).
 * Digunakan oleh check-frontend.js & dev-server.js supaya pepijat ini tertangkap sebelum push.
 */
'use strict';
function gasStripScript(code) {
  return code.split('\n').map((line) => {
    const i = line.indexOf('//');
    return i >= 0 ? line.slice(0, i) : line;
  }).join('\n');
}
function gasProcessHtml(html) {
  return html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => '<script>' + gasStripScript(code) + '</script>');
}
module.exports = { gasStripScript, gasProcessHtml };
