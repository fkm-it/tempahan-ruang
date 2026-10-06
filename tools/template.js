/**
 * template.js — penilai templat Apps Script minimum untuk frontend/index.html:
 *   <?!= include('path'); ?>  → kandungan fail (rekursif)
 *   <?= nama ?>               → nilai di-escape
 * Dikongsi oleh dev-server.js dan build-web.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function escapeHtml(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {string} file laluan relatif kepada src/ tanpa .html
 * @param {Object} vars nilai untuk <?= ?>
 * @param {{processInclude?: function(string):string}} [opts]
 */
function renderTemplate(file, vars, opts) {
  const o = opts || {};
  let src = fs.readFileSync(path.join(SRC, file + '.html'), 'utf8');
  src = src.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, p) => {
    const inner = renderTemplate(p, vars, o);
    return o.processInclude ? o.processInclude(inner) : inner;
  });
  src = src.replace(/<\?=\s*([a-zA-Z]+)\s*\?>/g, (_, k) => escapeHtml(vars[k]));
  return src;
}

/** Baca CONFIG.VERSION / APP_NAME / TAGLINE / APP_SLUG daripada Config.gs. */
function readAppConfig() {
  const cfg = fs.readFileSync(path.join(SRC, 'config', 'Config.gs'), 'utf8');
  const pick = (k) => { const m = cfg.match(new RegExp(k + ":\\s*'([^']*)'")); return m ? m[1] : ''; };
  return { appName: pick('APP_NAME'), tagline: pick('TAGLINE'), version: pick('VERSION'), slug: pick('APP_SLUG'), shortName: pick('SHORT_NAME') };
}

module.exports = { renderTemplate, readAppConfig, escapeHtml, SRC };
