/**
 * js-strip.js — buang komen JavaScript daripada <script> dalam fail HTML sebelum dihantar ke Apps Script.
 *
 * Mengapa: HtmlService memproses skrip sebaris (membuang komen) dengan penghurai yang tidak sempurna —
 * komen tertentu (cth. mengandungi petikan dan "/*" bersarang) merosakkan skrip dan menyebabkan
 * "SyntaxError: Invalid or unexpected token" HANYA dalam mod /exec. Jika skrip yang sampai ke GAS
 * tiada komen langsung, tiada apa untuk dirosakkan. Bonus: muatan lebih kecil.
 *
 * Penghurai token ringkas: rentetan '…' "…", templat `…${…}…` (bersarang), regex literal, komen.
 * Bilangan baris dikekalkan (komen blok diganti baris baharu yang sama) supaya nombor baris ralat sepadan.
 */
'use strict';

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * @param {string} code
 * @returns {string} kod tanpa komen
 */
function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  /* Konteks: 'code' atau 'tpl'. braceStack: kedalaman { } dalam setiap ${ } templat. */
  const stack = [];
  let depth = 0;
  /* Token bermakna terakhir: menentukan sama ada "/" ialah regex atau bahagi. */
  let last = { type: 'punct', value: '' };
  const regexAllowed = () => {
    if (last.type === 'num' || last.type === 'str' || last.type === 'tpl' || last.type === 'regex') return false;
    if (last.type === 'word') return REGEX_KEYWORDS.has(last.value);
    return !(last.value === ')' || last.value === ']' || last.value === '}');
  };

  function readTemplate() {
    /* i berada selepas ` atau selepas } penutup ${ */
    while (i < n) {
      const c = code[i];
      if (c === '\\') { out += c + (code[i + 1] || ''); i += 2; continue; }
      if (c === '`') { out += c; i++; last = { type: 'tpl' }; return; }
      if (c === '$' && code[i + 1] === '{') { out += '${'; i += 2; stack.push(depth); depth = 0; last = { type: 'punct', value: '{' }; return; }
      out += c; i++;
    }
    throw new Error('Templat literal tidak ditutup');
  }

  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Komen blok tidak ditutup');
      const body = code.slice(i, end + 2);
      const nl = (body.match(/\n/g) || []).length;
      out += nl ? '\n'.repeat(nl) : ' ';
      i = end + 2;
      continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < n && code[j] !== c) { if (code[j] === '\\') j++; if (code[j] === '\n') throw new Error('Rentetan tidak ditutup'); j++; }
      out += code.slice(i, j + 1); i = j + 1; last = { type: 'str' };
      continue;
    }
    if (c === '`') { out += c; i++; readTemplate(); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n) {
        const ch = code[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') throw new Error('Regex tidak ditutup');
        if (cls) { if (ch === ']') cls = false; } else if (ch === '[') cls = true; else if (ch === '/') break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(code[j])) j++;
      out += code.slice(i, j); i = j; last = { type: 'regex' };
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(code[j])) j++;
      const w = code.slice(i, j);
      out += w; i = j; last = { type: 'word', value: w };
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d || ''))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(code[j])) j++;
      out += code.slice(i, j); i = j; last = { type: 'num' };
      continue;
    }
    if (c === '{') { depth++; out += c; i++; last = { type: 'punct', value: c }; continue; }
    if (c === '}') {
      if (depth === 0 && stack.length) { depth = stack.pop(); out += c; i++; readTemplate(); continue; }
      depth--; out += c; i++; last = { type: 'punct', value: c }; continue;
    }
    if (/\s/.test(c)) { out += c; i++; continue; }
    out += c; i++; last = { type: 'punct', value: c };
  }
  if (stack.length) throw new Error('Ungkapan ${ } templat tidak ditutup');
  return out;
}

/** Buang komen dalam setiap <script> (tanpa atribut) dalam satu fail HTML. */
function stripHtmlScripts(html) {
  return html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => '<script>' + stripComments(code) + '</script>');
}

module.exports = { stripComments, stripHtmlScripts };
