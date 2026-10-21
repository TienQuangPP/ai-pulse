const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('Vietnamese and English translations have the same keys', async () => {
  const { STRINGS } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'i18n.js')).href);
  const vi = Object.keys(STRINGS.vi).sort();
  const en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(vi.filter((k) => !en.includes(k)), [], 'missing in en');
  assert.deepEqual(en.filter((k) => !vi.includes(k)), [], 'missing in vi');
  for (const k of vi) {
    if (Array.isArray(STRINGS.vi[k])) assert.equal(STRINGS.vi[k].length, STRINGS.en[k].length, k);
  }
});
