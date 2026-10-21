import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('English and Russian have exactly the same text keys', () => {
  const src = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const block = (name) => src.slice(src.indexOf(`const ${name} = {`), src.indexOf('\n};', src.indexOf(`const ${name} = {`)));
  const keys = (b) => new Set([...b.matchAll(/'([a-zA-Z]+\.[a-zA-Z.-]+)':/g)].map((m) => m[1]));
  const en = keys(block('EN')), ru = keys(block('RU'));
  assert.deepEqual([...en].filter((k) => !ru.has(k)), [], 'missing in Russian');
  assert.deepEqual([...ru].filter((k) => !en.has(k)), [], 'missing in English');
});

test('every key used in the code and HTML exists', () => {
  const src = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const files = ['main.js', 'gallery.js', 'plot.js', 'timing.js', 'frame-source.js', 'store.js'].map((f) => readFileSync(new URL('../js/' + f, import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const used = new Set();
  for (const f of files) for (const m of f.matchAll(/\bt\('([a-zA-Z]+\.[a-zA-Z.-]+)'/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n(?:-html|-aria)?="([^"]+)"/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !src.includes(`'${k}':`));
  assert.deepEqual(missing, []);
});
