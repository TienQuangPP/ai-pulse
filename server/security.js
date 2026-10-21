'use strict';
/**
 * Request hardening for a local-first app:
 * - Host allow-list (blocks DNS-rebinding: evil.example resolving to 127.0.0.1)
 * - Same-origin + JSON-only writes (blocks CSRF "simple requests" such as text/plain POSTs)
 * - Optional admin token for every write (needed when the server is reachable on a network)
 * - Security headers and a strict Content-Security-Policy
 */
const crypto = require('crypto');
const net = require('net');

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://github.com https://avatars.githubusercontent.com",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function hostnameOf(hostHeader = '') {
  const h = String(hostHeader).trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.replace(/:\d+$/, '');
}

function createGuard({ adminToken = '', allowedHosts = [] } = {}) {
  const extraHosts = new Set(allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const tokenBuf = adminToken ? Buffer.from(adminToken) : null;

  const hostAllowed = (hostHeader) => {
    const name = hostnameOf(hostHeader);
    if (!name) return false;
    // IP literals cannot be used for DNS rebinding, so LAN access by IP stays possible.
    return LOOPBACK_NAMES.has(name) || net.isIP(name.replace(/^\[|\]$/g, '')) !== 0 || extraHosts.has(name);
  };

  const tokenOk = (req) => {
    if (!tokenBuf) return true;
    const given = Buffer.from(String(req.headers['x-aipulse-token'] || ''));
    return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
  };

  /** Returns null when the request may proceed, otherwise { status, error }. */
  function check(req) {
    if (!hostAllowed(req.headers.host)) return { status: 421, error: 'host_not_allowed' };
    if (!WRITE_METHODS.has(req.method)) return null;

    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        return { status: 403, error: 'bad_origin' };
      }
      if (originHost !== String(req.headers.host).toLowerCase()) return { status: 403, error: 'cross_origin' };
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return { status: 403, error: 'cross_site' };

    const hasBody = req.method !== 'DELETE';
    if (hasBody && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return { status: 415, error: 'json_required' };
    }
    if (!tokenOk(req)) return { status: 401, error: 'admin_token_required' };
    return null;
  }

  return { check, hostAllowed, requiresToken: !!tokenBuf };
}

/** Neutralise spreadsheet formulas (CSV injection) in exported cells. */
function csvSafe(value) {
  const s = Array.isArray(value) ? value.join('|') : value == null ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Tiny fixed-window rate limiter. */
function rateLimiter(limit, windowMs) {
  let windowStart = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= limit ? 0 : Math.ceil((windowStart + windowMs - now) / 1000);
  };
}

module.exports = { createGuard, csvSafe, rateLimiter, SECURITY_HEADERS, hostnameOf };
