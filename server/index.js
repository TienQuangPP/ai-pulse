'use strict';
/**
 * AI Pulse — zero-dependency Node.js server.
 * Collects GitHub events, detects AI/LLM technologies, serves the PWA, a JSON API and an SSE stream.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Detector } = require('./detector');
const { Store } = require('./store');
const { Collector } = require('./collector');
const { Alerts } = require('./alerts');
const { analyze } = require('./analyzer');
const { normalize, fromFlat } = require('./normalize');
const demo = require('./demo');
const insights = require('./insights');
const assistant = require('./ask');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const VERSION = require('../package.json').version;

// ---------- config ----------
function loadDotEnv() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      const value = m ? m[2].replace(/^["']|["']$/g, '') : '';
      if (m && value && !(m[1] in process.env)) process.env[m[1]] = value;
    }
  } catch {
    /* optional */
  }
}
loadDotEnv();

const DATA = path.resolve(process.env.AIPULSE_DATA_DIR || path.join(ROOT, '.runtime'));
const CONFIG_FILE = path.join(DATA, 'config.json');

const DEFAULT_CONFIG = {
  mode: process.env.AIPULSE_MODE || 'live',
  githubToken: process.env.GITHUB_TOKEN || '',
  pollInterval: Number(process.env.POLL_INTERVAL_SECONDS) || 30,
  pages: 3,
  customKeywords: [],
  alerts: [
    { id: 'default-agents', kind: 'category', value: 'agent', threshold: 15, window: 10, enabled: true },
    { id: 'default-spike', kind: 'any', value: '', threshold: 120, window: 5, enabled: false },
  ],
};

let config = { ...DEFAULT_CONFIG };
try {
  config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  if (!config.githubToken && process.env.GITHUB_TOKEN) config.githubToken = process.env.GITHUB_TOKEN;
} catch {
  /* first run */
}
if (process.argv.includes('--demo')) config.mode = 'demo';
const getConfig = () => config;
function saveConfig(patch) {
  config = { ...config, ...patch };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
const publicConfig = () => ({
  mode: config.mode,
  pollInterval: config.pollInterval,
  pages: config.pages,
  hasToken: !!config.githubToken,
  tokenHint: config.githubToken ? `…${config.githubToken.slice(-4)}` : '',
  customKeywords: config.customKeywords,
  alerts: config.alerts,
  hasAnthropicKey: !!(config.anthropicKey || process.env.ANTHROPIC_API_KEY),
  ai: assistant.status(() => config.anthropicKey),
});

// ---------- core ----------
const detector = new Detector(config.customKeywords);
const store = new Store(path.join(DATA, 'store.json'));
const collector = new Collector({ detector, getConfig });
const alerts = new Alerts({ store, getConfig, saveConfig });
const clients = new Set();

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

collector.on('events', (events) => {
  const added = store.ingest(events);
  if (added.length) broadcast('events', added.slice(-50));
  broadcast('tick', { received: events.length, ai: added.length, at: Date.now(), stored: store.events.length });
  for (const a of alerts.evaluate()) broadcast('alert', a);
});
collector.on('status', (s) => broadcast('status', s));

if (config.mode === 'demo' && store.events.length === 0) {
  store.ingest(demo.history(6, 20).map((e) => normalize(e, detector, { demo: true })));
}
setInterval(() => store.save(), 15_000).unref();

// ---------- http helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : MIME['.json'], 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA fallback
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => (e2 ? send(res, 404, 'Not found') : send(res, 200, html, { 'Content-Type': MIME['.html'] })));
    }
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

const csvCell = (v) => {
  const s = Array.isArray(v) ? v.join('|') : v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');

// ---------- routes ----------
const routes = {
  'GET /api/status': () => ({
    version: VERSION,
    collector: collector.status,
    config: publicConfig(),
    stored: store.events.length,
    clients: clients.size,
    uptime: process.uptime(),
  }),

  'GET /api/summary': (q) => store.summary(q.range || '1h', detector, Number(q.tz) || 0),

  'GET /api/insights': (q) => insights.generate(store.summary(q.range || '1h', detector, Number(q.tz) || 0), store, detector),

  'GET /api/ecosystem': (q) => store.cooccurrence(q.range || '24h'),

  'GET /api/race': (q) => store.race(q.range || '24h', Math.min(120, Math.max(5, Number(q.frames) || 40))),

  'GET /api/events': (q) =>
    store.query({
      range: q.range || 'all',
      kw: q.kw,
      category: q.category,
      type: q.type,
      q: q.q,
      repo: q.repo,
      actor: q.actor,
      before: q.before ? Number(q.before) : undefined,
      limit: Math.min(Number(q.limit) || 100, 1000),
    }),

  'GET /api/repos': (q) => store.repos({ range: q.range, q: q.q, sort: q.sort, kw: q.kw, limit: Math.min(Number(q.limit) || 200, 2000) }),

  'GET /api/repo': (q) => {
    const events = store.query({ range: 'all', repo: q.name, limit: 500 });
    const kw = {};
    const actors = {};
    for (const e of events) {
      e.keywords.forEach((k) => (kw[k] = (kw[k] || 0) + 1));
      actors[e.actor] = (actors[e.actor] || 0) + 1;
    }
    return { repo: q.name, count: events.length, keywords: kw, actors, events: events.slice(0, 100) };
  },

  'GET /api/developers': (q) => store.actors({ range: q.range, limit: Math.min(Number(q.limit) || 100, 1000) }),

  'GET /api/trend': (q) => store.trend((q.ids || '').split(',').filter(Boolean).slice(0, 100), q.range || '24h'),

  'GET /api/taxonomy': () => ({ categories: detector.categories(), technologies: detector.list() }),

  'GET /api/alerts': () => ({ rules: alerts.rules(), log: alerts.log.slice(0, 100) }),

  'POST /api/alerts': async (q, body) => {
    const rule = {
      id: body.id || crypto.randomUUID().slice(0, 8),
      kind: ['keyword', 'category', 'repo', 'any'].includes(body.kind) ? body.kind : 'any',
      value: String(body.value || ''),
      threshold: Math.max(1, Number(body.threshold) || 10),
      window: Math.min(1440, Math.max(1, Number(body.window) || 10)),
      enabled: body.enabled !== false,
    };
    const rules = alerts.rules().filter((r) => r.id !== rule.id);
    saveConfig({ alerts: [...rules, rule] });
    return rule;
  },

  'DELETE /api/alerts': (q) => {
    saveConfig({ alerts: alerts.rules().filter((r) => r.id !== q.id) });
    return { ok: true };
  },

  'POST /api/keywords': async (q, body) => {
    const label = String(body.label || '').trim();
    const terms = (Array.isArray(body.terms) ? body.terms : String(body.terms || label).split(','))
      .map((t) => t.trim())
      .filter(Boolean);
    if (!label || !terms.length) throw Object.assign(new Error('Label and at least one term are required.'), { status: 400 });
    const id = 'c_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
    const custom = config.customKeywords.filter((c) => c.id !== id);
    custom.push({ id, label, terms, category: body.category || 'custom' });
    saveConfig({ customKeywords: custom });
    detector.setCustom(custom);
    return { id, label, terms };
  },

  'DELETE /api/keywords': (q) => {
    const custom = config.customKeywords.filter((c) => c.id !== q.id);
    saveConfig({ customKeywords: custom });
    detector.setCustom(custom);
    return { ok: true };
  },

  'POST /api/keywords/retag': () => {
    store.retag(detector);
    return { ok: true, stored: store.events.length };
  },

  'GET /api/detect': (q) => detector.detect(q.text || ''),

  'GET /api/analyze': (q) => analyze(q.repo, { token: config.githubToken, detector, store }),

  'GET /api/settings': () => publicConfig(),

  'PUT /api/settings': async (q, body) => {
    const patch = {};
    if (['live', 'demo'].includes(body.mode)) patch.mode = body.mode;
    if (body.pollInterval) patch.pollInterval = Math.min(3600, Math.max(5, Number(body.pollInterval)));
    if (body.pages) patch.pages = Math.min(3, Math.max(1, Number(body.pages)));
    if (typeof body.githubToken === 'string') patch.githubToken = body.githubToken.trim();
    if (typeof body.anthropicKey === 'string') patch.anthropicKey = body.anthropicKey.trim();
    const modeChanged = patch.mode && patch.mode !== config.mode;
    saveConfig(patch);
    if (modeChanged && patch.mode === 'demo' && !store.events.some((e) => e.demo)) {
      store.ingest(demo.history(6, 20).map((e) => normalize(e, detector, { demo: true })));
    }
    collector.etags.clear();
    collector.start();
    broadcast('config', publicConfig());
    return publicConfig();
  },

  'POST /api/control': async (q, body) => {
    switch (body.action) {
      case 'pause':
        collector.pause();
        break;
      case 'resume':
      case 'poll':
        collector.start();
        break;
      case 'reset':
        store.reset();
        alerts.log.length = 0;
        break;
      case 'purge-demo':
        store.events = store.events.filter((e) => !e.demo);
        store.dirty = true;
        break;
      case 'import-demo':
        return importRecords(demo.history(1, 8), false);
      default:
        throw Object.assign(new Error('Unknown action'), { status: 400 });
    }
    return { ok: true, status: collector.status };
  },

  'POST /api/import': async (q, body) => {
    const records = Array.isArray(body) ? body : body.events;
    if (!Array.isArray(records)) throw Object.assign(new Error('Expected a JSON array of events.'), { status: 400 });
    return importRecords(records, q.shift === '1');
  },
};

/** Import records in either the flat format (event_id/repo_name/...) or raw GitHub format. */
function importRecords(records, shiftToNow) {
  let raw = records.map((r) => (r.event_id ? fromFlat(r) : r));
  if (shiftToNow && raw.length) {
    const latest = Math.max(...raw.map((r) => Date.parse(r.created_at) || 0));
    const delta = Date.now() - latest;
    raw = raw.map((r) => ({ ...r, id: `${r.id}-imp${Date.now()}`, created_at: new Date((Date.parse(r.created_at) || Date.now()) + delta).toISOString() }));
  }
  const added = store.ingest(raw.map((r) => normalize(r, detector, { demo: true })));
  if (added.length) broadcast('events', added.slice(-50));
  return { received: records.length, aiEvents: added.length };
}

function handleExport(q, res) {
  const range = q.range || 'all';
  const dataset = q.dataset || 'events';
  let rows;
  let cols;
  if (dataset === 'repos') {
    rows = store.repos({ range, limit: 100_000 }).items.map((r) => ({ ...r, keywords: Object.keys(r.keywords), lastSeen: new Date(r.lastSeen).toISOString() }));
    cols = ['repo', 'count', 'actors', 'keywords', 'lastSeen'];
  } else if (dataset === 'keywords') {
    rows = store.summary(range, detector).keywords;
    cols = ['id', 'label', 'category', 'count', 'prev', 'growth'];
  } else if (dataset === 'developers') {
    rows = store.actors({ range, limit: 100_000 }).map((a) => ({ ...a, keywords: Object.keys(a.keywords) }));
    cols = ['actor', 'count', 'repos', 'keywords'];
  } else {
    rows = store.query({ range, limit: 1_000_000 }).map((e) => ({ ...e, createdAt: new Date(e.createdAt).toISOString() }));
    cols = ['id', 'createdAt', 'type', 'repo', 'actor', 'keywords', 'categories', 'text', 'demo'];
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (q.format === 'csv') {
    return send(res, 200, '﻿' + toCsv(rows, cols), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="aipulse-${dataset}-${range}-${stamp}.csv"`,
    });
  }
  send(res, 200, JSON.stringify(rows, null, 2), {
    'Content-Type': MIME['.json'],
    'Content-Disposition': `attachment; filename="aipulse-${dataset}-${range}-${stamp}.json"`,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 3000\nevent: status\ndata: ${JSON.stringify(collector.status)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }
  if (url.pathname === '/api/export') return handleExport(q, res);
  if (url.pathname === '/api/ask' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const summary = store.summary(body.range || '1h', detector, Number(body.tz) || 0);
      return assistant.ask({ history: body.messages || [], summary, insights: insights.generate(summary, store, detector), getKey: () => config.anthropicKey }, res);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : undefined;
      send(res, 200, await handler(q, body));
    } catch (err) {
      send(res, err.status || 500, { error: err.message || String(err) });
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  serveStatic(req, res, url.pathname);
});

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`\n  ⚡ AI Pulse v${VERSION} running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  mode: ${config.mode}${config.githubToken ? ' (token set)' : ' (no GitHub token — 60 req/h)'}\n`);
    collector.start();
  });
  const shutdown = () => {
    store.dirty = true;
    store.save();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { server, store, detector, collector };
