/**
 * load-gas.js — Muat semua fail src/**\/*.gs ke dalam satu konteks VM (meniru global scope GAS).
 * Fail dimuat dalam susunan abjad (seperti clasp) ATAU terbalik (--reverse) untuk membuktikan
 * kod tidak bergantung pada susunan muat.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasEnvironment } = require('./gas-mock');

const SRC = path.join(__dirname, '..', 'src');

function listGs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listGs(p);
    return e.name.endsWith('.gs') ? [p] : [];
  });
}

function loadGas(options = {}) {
  const env = createGasEnvironment(options);
  const context = Object.assign(Object.create(null), env.globals, {
    console: options.quiet ? { log() {}, warn() {}, error() {}, info() {} } : console,
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Intl, Buffer: undefined,
    parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent
  });
  vm.createContext(context);
  let files = listGs(SRC).sort();
  if (options.reverse) files = files.reverse();
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    vm.runInContext(code, context, { filename: path.relative(SRC, f) });
  }
  // `const`/`class` global tidak menjadi sifat objek konteks — dedahkan melalui penilai.
  const get = (name) => vm.runInContext(name, context);
  return { context, env, get, files };
}

module.exports = { loadGas };
