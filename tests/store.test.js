const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Store } = require('../server/store');
const { Detector } = require('../server/detector');
const { normalize, fromFlat } = require('../server/normalize');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aipulse-')), 'store.json');
const d = new Detector();
const raw = (id, text, minsAgo = 1, repo = 'a/b') => ({
  id, type: 'PushEvent', repo: { name: repo }, actor: { login: 'u' + id },
  created_at: new Date(Date.now() - minsAgo * 60000).toISOString(), payload: { commits: [{ message: text }] },
});

test('ingest dedupes and only keeps AI events', () => {
  const s = new Store(tmp());
  const evs = [raw('1', 'add rag'), raw('2', 'fix typo'), raw('1', 'add rag')].map((e) => normalize(e, d));
  const added = s.ingest(evs);
  assert.equal(added.length, 1);
  assert.equal(s.events.length, 1);
  const sum = s.summary('1h', d);
  assert.equal(sum.kpis.aiEvents, 1);
  assert.equal(sum.kpis.totalEvents, 2);
  assert.equal(sum.keywords[0].id, 'rag');
});

test('persists and reloads', () => {
  const file = tmp();
  const s = new Store(file);
  s.ingest([normalize(raw('9', 'ollama support'), d)]);
  s.save();
  const s2 = new Store(file);
  assert.equal(s2.events.length, 1);
  assert.ok(s2.has('9'));
});

test('repos, actors, trend and query', () => {
  const s = new Store(tmp());
  s.ingest([raw('1', 'langchain', 2, 'x/one'), raw('2', 'langchain rag', 3, 'x/one'), raw('3', 'claude', 4, 'y/two')].map((e) => normalize(e, d)));
  const r = s.repos({ range: '1h' });
  assert.equal(r.items[0].repo, 'x/one');
  assert.equal(r.items[0].count, 2);
  assert.equal(s.actors({ range: '1h' }).length, 3);
  const tr = s.trend(['langchain'], '1h');
  assert.equal(tr.series.langchain.reduce((a, b) => a + b, 0), 2);
  assert.equal(s.query({ kw: 'claude' }).length, 1);
  assert.equal(s.query({ q: 'two' }).length, 1);
});

test('flat JSON imports remain supported without a bundled dataset', () => {
  const event = normalize(fromFlat({
    event_id: 'import-check', event_type: 'PushEvent', repo_name: 'example/semantic-search',
    actor_login: 'example-user', created_at: new Date().toISOString(),
    text_content: 'Add semantic search with pgvector and RAG',
  }), d);
  assert.ok(event.keywords.includes('pgvector'));
  assert.ok(event.keywords.includes('rag'));
  const s = new Store(tmp());
  assert.equal(s.ingest([event]).length, 1);
});

test('co-occurrence graph, race frames and insights', () => {
  const insights = require('../server/insights');
  const s = new Store(tmp());
  s.ingest([raw('a', 'langchain + pgvector rag', 2), raw('b', 'langchain with pgvector', 3), raw('c', 'ollama', 4)].map((e) => normalize(e, d)));
  const g = s.cooccurrence('1h');
  const top = g.edges[0];
  assert.deepEqual([top.a, top.b].sort(), ['langchain', 'pgvector']);
  assert.equal(top.weight, 2);
  const r = s.race('1h', 6);
  assert.equal(r.frames.length, 6);
  assert.equal(r.frames.at(-1).values.langchain, 2);
  const list = insights.generate(s.summary('1h', d), s, d);
  assert.ok(list.length > 0 && list.every((i) => i.text.vi && i.text.en));
});

test('no fake trend when the previous period was not observed', () => {
  const s = new Store(tmp());
  s.ingest([raw('p1', 'langchain rag', 5), raw('p2', 'ollama', 6)].map((e) => normalize(e, d)));
  const sum = s.summary('1h', d);
  assert.equal(sum.kpis.compareAvailable, false);
  assert.equal(sum.kpis.aiEventsPrev, null);
  assert.ok(sum.keywords.every((k) => k.prev === null && k.growth === null));
});

test('previous period is compared once it is fully observed', () => {
  const s = new Store(tmp());
  s.ingest([raw('old', 'langchain', 130), raw('mid', 'langchain', 90), raw('new', 'langchain', 10)].map((e) => normalize(e, d)));
  const sum = s.summary('1h', d);
  assert.equal(sum.kpis.compareAvailable, true);
  assert.equal(sum.kpis.aiEventsPrev, 1);
});

test('retag keeps events detected through the repository name', () => {
  const s = new Store(tmp());
  s.ingest([normalize(raw('r1', 'fix typo', 2, 'acme/langchain-rag-demo'), d)]);
  assert.equal(s.events.length, 1);
  s.retag(d);
  assert.equal(s.events.length, 1);
  assert.deepEqual(s.events[0].keywords.sort(), ['langchain', 'rag']);
});

test('non-AI events are not double counted after a restart', () => {
  const file = tmp();
  const s = new Store(file);
  const batch = [raw('x1', 'fix typo', 3), raw('x2', 'add rag', 3)].map((e) => normalize(e, d));
  s.ingest(batch);
  s.save();
  const reloaded = new Store(file);
  reloaded.ingest(batch);
  const total = [...reloaded.minutes.values()].reduce((a, m) => a + m.total, 0);
  assert.equal(total, 2);
});

test('async save writes the same data as sync save', async () => {
  const file = tmp();
  const s = new Store(file);
  s.ingest([normalize(raw('a1', 'claude agent', 1), d)]);
  await s.saveAsync();
  assert.equal(new Store(file).events.length, 1);
});
