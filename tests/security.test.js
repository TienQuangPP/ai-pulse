const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuard, csvSafe, rateLimiter } = require('../server/security');

const req = (method, headers = {}) => ({ method, headers: { host: 'localhost:8787', ...headers } });

test('reads from localhost and IP literals are allowed, rebinding hosts are not', () => {
  const g = createGuard();
  assert.equal(g.check(req('GET')), null);
  assert.equal(g.check(req('GET', { host: '192.168.1.20:8787' })), null);
  assert.equal(g.check(req('GET', { host: '[::1]:8787' })), null);
  assert.equal(g.check(req('GET', { host: 'evil.example:8787' })).status, 421);
  assert.equal(createGuard({ allowedHosts: ['pulse.lan'] }).check(req('GET', { host: 'pulse.lan' })), null);
});

test('CSRF: cross-site and non-JSON writes are rejected', () => {
  const g = createGuard();
  const json = { 'content-type': 'application/json' };
  assert.equal(g.check(req('POST', json)), null);
  assert.equal(g.check(req('POST', { 'content-type': 'text/plain' })).status, 415);
  assert.equal(g.check(req('POST', { ...json, origin: 'https://evil.example' })).status, 403);
  assert.equal(g.check(req('POST', { ...json, 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal(g.check(req('POST', { ...json, origin: 'http://localhost:8787', 'sec-fetch-site': 'same-origin' })), null);
  assert.equal(g.check(req('DELETE', { origin: 'https://evil.example' })).status, 403);
});

test('admin token is required for writes when configured', () => {
  const g = createGuard({ adminToken: 's3cret' });
  const json = { 'content-type': 'application/json' };
  assert.equal(g.check(req('GET')), null);
  assert.equal(g.check(req('POST', json)).status, 401);
  assert.equal(g.check(req('POST', { ...json, 'x-aipulse-token': 'wrong!' })).status, 401);
  assert.equal(g.check(req('POST', { ...json, 'x-aipulse-token': 's3cret' })), null);
});

test('CSV export neutralises spreadsheet formulas', () => {
  assert.equal(csvSafe('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvSafe('+1'), "'+1");
  assert.equal(csvSafe('-cmd'), "'-cmd");
  assert.equal(csvSafe('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvSafe('plain, text'), '"plain, text"');
  assert.equal(csvSafe(['a', 'b']), 'a|b');
});

test('rate limiter blocks after the limit', () => {
  const limit = rateLimiter(2, 60_000);
  assert.equal(limit(), 0);
  assert.equal(limit(), 0);
  assert.ok(limit() > 0);
});
