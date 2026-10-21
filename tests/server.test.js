const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'aipulse-api-'));
process.env.AIPULSE_DATA_DIR = runtime;
process.env.AIPULSE_MODE = 'live';
const { server, store, collector } = require('../server/index');
// Test settings persistence without polling external GitHub APIs.
collector.start = () => {};
let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  fs.rmSync(runtime, { recursive: true, force: true });
});

test('clean install starts with no bundled data and serves the app', async () => {
  const response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stored, 0);
  assert.equal(store.file, path.join(runtime, 'store.json'));
  const html = await (await fetch(base)).text();
  assert.match(html, /name="author" content="TienQuangPP"/);
});

test('demo action works without docs or data folders, and reset persists', async () => {
  const response = await fetch(`${base}/api/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import-demo' }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.received > 0);
  assert.ok(result.aiEvents > 0);
  assert.ok(store.events.every((event) => event.demo));
  const exported = await (await fetch(`${base}/api/export?format=json`)).json();
  assert.equal(exported.length, result.aiEvents);
  const reset = await fetch(`${base}/api/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset' }),
  });
  assert.equal(reset.status, 200);
  assert.equal(store.events.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).events, []);
});

test('settings persist in the runtime directory and do not expose keys', async () => {
  const response = await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubToken: 'test-only-placeholder' }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.hasToken, true);
  assert.equal(result.githubToken, undefined);
  const config = JSON.parse(fs.readFileSync(path.join(runtime, 'config.json'), 'utf8'));
  assert.equal(config.githubToken, 'test-only-placeholder');
});
