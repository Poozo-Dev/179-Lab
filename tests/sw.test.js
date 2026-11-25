import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { APP_VERSION } from '../js/config.js';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('service worker cache version matches APP_VERSION (updates must be all-or-nothing per version)', () => {
  const v = sw.match(/const VERSION = '([^']+)'/)[1];
  assert.equal(v, APP_VERSION.split(' ')[0], 'bump VERSION in sw.js together with APP_VERSION in js/config.js');
});

test('every app file is in the offline shell and exists', () => {
  const shell = [...sw.matchAll(/'((?:js|icons)\/[^']+)'/g)].map((m) => m[1]);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  for (const f of shell) assert.ok(existsSync(new URL('../' + f, import.meta.url)), f + ' missing');
  // every JS module imported anywhere must be precached, or an offline start fails
  const mods = new Set();
  for (const f of shell.filter((x) => x.endsWith('.js'))) {
    for (const m of readFileSync(new URL('../' + f, import.meta.url), 'utf8').matchAll(/from '\.\/([^']+)'/g)) mods.add('js/' + m[1]);
  }
  for (const m of mods) assert.ok(shell.includes(m), m + ' is imported but not precached');
  assert.ok(html.includes('js/main.js') && main.includes("register('sw.js')"));
});

test('page carries the same version stamp as the code', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/<meta name="app-version" content="([^"]+)">/)[1], APP_VERSION.split(' ')[0]);
});
