'use strict';
const fs = require('fs');
const path = require('path');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RANGES = {
  '15m': { span: 15 * MINUTE, bucket: MINUTE },
  '1h': { span: HOUR, bucket: MINUTE },
  '6h': { span: 6 * HOUR, bucket: 5 * MINUTE },
  '24h': { span: DAY, bucket: 15 * MINUTE },
  '7d': { span: 7 * DAY, bucket: 2 * HOUR },
};

const MAX_EVENTS = 50_000;
const MINUTE_RETENTION = 14 * DAY;

class Store {
  constructor(file) {
    this.file = file;
    this.events = []; // AI-related events, oldest first
    this.minutes = new Map(); // minuteMs -> { total, ai }
    this.seen = new Set();
    this.seenOrder = [];
    this.dirty = false;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.events = raw.events || [];
      for (const [t, total, ai] of raw.minutes || []) this.minutes.set(t, { total, ai });
      // Recent non-AI ids too: GitHub re-serves the same latest events after a restart,
      // and without them every non-AI event would be counted twice in the totals.
      (raw.seen || []).forEach((id) => this.markSeen(id));
      this.events.forEach((e) => this.markSeen(e.id));
    } catch {
      /* first run */
    }
  }

  serialize() {
    this.dirty = false;
    return JSON.stringify({
      savedAt: Date.now(),
      events: this.events,
      minutes: [...this.minutes].map(([t, m]) => [t, m.total, m.ai]),
      seen: this.seenOrder.slice(-5000),
    });
  }

  /** Synchronous save (shutdown / reset). Writes to a temp file then renames atomically. */
  save() {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.serialize());
    fs.renameSync(tmp, this.file);
  }

  /** Non-blocking periodic save; overlapping calls are skipped. */
  async saveAsync() {
    if (!this.dirty || this.saving) return;
    this.saving = true;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      await fs.promises.writeFile(tmp, this.serialize());
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      this.dirty = true;
      throw err;
    } finally {
      this.saving = false;
    }
  }

  reset() {
    this.events = [];
    this.minutes.clear();
    this.seen.clear();
    this.seenOrder = [];
    this.dirty = true;
    this.save();
  }

  markSeen(id) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 100_000) {
      for (const old of this.seenOrder.splice(0, 50_000)) this.seen.delete(old);
    }
  }

  has(id) {
    return this.seen.has(id);
  }

  /** Ingest normalized events (AI and non-AI). Returns the newly added AI events. */
  ingest(events) {
    const added = [];
    for (const e of events) {
      if (!e.id || this.seen.has(e.id)) continue;
      this.markSeen(e.id);
      const minute = Math.floor(e.createdAt / MINUTE) * MINUTE;
      const bucket = this.minutes.get(minute) || { total: 0, ai: 0 };
      bucket.total += 1;
      if (e.keywords.length) {
        bucket.ai += 1;
        this.events.push(e);
        added.push(e);
      }
      this.minutes.set(minute, bucket);
    }
    if (!events.length) return added;
    // Keep chronological order (GitHub pages are newest-first); sort only the unsorted tail.
    if (added.length) {
      const firstNew = this.events.length - added.length;
      const tailStart = Math.max(0, firstNew - 1);
      let ordered = true;
      for (let i = tailStart + 1; i < this.events.length && ordered; i++) ordered = this.events[i - 1].createdAt <= this.events[i].createdAt;
      if (!ordered) this.events.sort((a, b) => a.createdAt - b.createdAt);
    }
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const cutoff = Date.now() - MINUTE_RETENTION;
    for (const t of this.minutes.keys()) if (t < cutoff) this.minutes.delete(t);
    this.dirty = true;
    return added;
  }

  /** Re-tag every stored event (after keyword list changes). */
  retag(detector) {
    // Same input as normalize(): the repository name is part of the signal.
    for (const e of this.events) Object.assign(e, detector.detect(`${e.repo.replace('/', ' / ')} ${e.text}`));
    this.events = this.events.filter((e) => e.keywords.length);
    this.dirty = true;
  }

  rangeInfo(range) {
    const now = Date.now();
    if (RANGES[range]) return { since: now - RANGES[range].span, until: now, bucket: RANGES[range].bucket };
    const first = this.events[0]?.createdAt ?? now - HOUR;
    const span = Math.max(now - first, HOUR);
    const bucket = Math.max(MINUTE, Math.ceil(span / 60 / MINUTE) * MINUTE);
    return { since: first, until: now, bucket };
  }

  inRange(since, until = Infinity) {
    // events are sorted; binary search the start
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].createdAt < since) lo = mid + 1;
      else hi = mid;
    }
    const out = [];
    for (let i = lo; i < this.events.length && this.events[i].createdAt < until; i++) out.push(this.events[i]);
    return out;
  }

  timeline(since, until, bucket) {
    const start = Math.floor(since / bucket) * bucket;
    const points = [];
    // Only complete buckets: a half-filled current bucket would always show a false drop.
    for (let t = start; t + bucket <= until; t += bucket) points.push({ t, total: 0, ai: 0 });
    for (const [t, m] of this.minutes) {
      if (t < start || t > until) continue;
      const p = points[Math.floor((t - start) / bucket)];
      if (p) {
        p.total += m.total;
        p.ai += m.ai;
      }
    }
    return points;
  }

  summary(range, detector, tzOffsetMin = 0) {
    const { since, until, bucket } = this.rangeInfo(range);
    const events = this.inRange(since, until);
    // Compare with the previous period only when we actually observed all of it;
    // otherwise "-80% vs previous period" right after a fresh start would be fiction.
    const minuteKeys = [...this.minutes.keys()];
    const firstObserved = minuteKeys.length ? Math.min(...minuteKeys) : until;
    const lastObserved = minuteKeys.length ? Math.max(...minuteKeys) + MINUTE : until;
    const prevComplete = Boolean(RANGES[range]) && firstObserved <= since - (until - since) + bucket;
    const prev = prevComplete ? this.inRange(since - (until - since), since) : [];
    const timeline = this.timeline(since, until, bucket);

    const count = (list, key) => {
      const m = new Map();
      for (const e of list) for (const k of [].concat(e[key])) m.set(k, (m.get(k) || 0) + 1);
      return m;
    };
    const kwNow = count(events, 'keywords');
    const kwPrev = count(prev, 'keywords');
    const keywords = [...kwNow]
      .map(([id, c]) => {
        const tech = detector.byId.get(id);
        const p = prevComplete ? kwPrev.get(id) || 0 : null;
        return {
          id,
          label: tech?.label || id,
          category: tech?.category || 'custom',
          count: c,
          prev: p,
          growth: p ? (c - p) / p : null,
        };
      })
      .sort((a, b) => b.count - a.count);

    const catNow = count(events, 'categories');
    const categories = detector.categories().map((c) => ({ ...c, count: catNow.get(c.id) || 0 }));

    const types = [...count(events, 'type')].map(([type, c]) => ({ type, count: c })).sort((a, b) => b.count - a.count);
    const repos = [...count(events, 'repo')].sort((a, b) => b[1] - a[1]);
    const actors = [...count(events, 'actor')].sort((a, b) => b[1] - a[1]);

    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    // Heatmap always covers the last 7 days so weekday/hour patterns are visible.
    for (const e of this.inRange(until - 7 * DAY, until)) {
      const d = new Date(e.createdAt - tzOffsetMin * MINUTE);
      heatmap[d.getUTCDay()][d.getUTCHours()] += 1;
    }

    const totalAll = timeline.reduce((s, p) => s + p.total, 0);
    // GitHub's public feed lags ~5 min, so use the average rate over the observed span.
    const firstSeen = events[0]?.createdAt ?? until;
    const spanMin = Math.max(1, (until - Math.max(since, firstSeen)) / MINUTE);
    // Momentum compares the two halves of the observed part of the current window,
    // so it works right after start-up and is not skewed by the feed's trailing lag.
    const dataUntil = Math.min(until, lastObserved);
    const mid = Math.max(since, firstObserved) + (dataUntil - Math.max(since, firstObserved)) / 2;
    const firstHalf = count(this.inRange(since, mid), 'keywords');
    const secondHalf = count(this.inRange(mid, dataUntil), 'keywords');
    const trending = keywords
      .map((k) => ({ ...k, count: secondHalf.get(k.id) || 0, prev: firstHalf.get(k.id) || 0 }))
      .filter((k) => k.count >= 3 && k.count > k.prev)
      .map((k) => ({ ...k, momentum: (k.count - k.prev) / Math.max(k.prev, 1) }))
      .sort((a, b) => b.momentum - a.momentum || b.count - a.count)
      .slice(0, 5);

    return {
      range,
      since,
      until,
      bucket,
      kpis: {
        aiEvents: events.length,
        aiEventsPrev: prevComplete ? prev.length : null,
        compareAvailable: prevComplete,
        totalEvents: totalAll,
        aiRatio: totalAll ? events.length / totalAll : 0,
        uniqueRepos: repos.length,
        uniqueActors: actors.length,
        perMinute: events.length / spanMin,
        topKeyword: keywords[0] || null,
        lastEventAt: this.events.at(-1)?.createdAt || null,
        storedEvents: this.events.length,
        demoShare: events.length ? events.filter((e) => e.demo).length / events.length : 0,
      },
      timeline,
      keywords,
      categories,
      types,
      trending,
      topRepos: repos.slice(0, 10).map(([repo, c]) => ({ repo, count: c })),
      topActors: actors.slice(0, 10).map(([actor, c]) => ({ actor, count: c })),
      heatmap,
    };
  }

  query({ range = 'all', kw, category, type, q, repo, actor, before, limit = 100 } = {}) {
    const { since } = this.rangeInfo(range);
    const needle = q ? q.toLowerCase() : null;
    const out = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.events[i];
      if (e.createdAt < since) break;
      if (before && e.createdAt >= before) continue;
      if (kw && !e.keywords.includes(kw)) continue;
      if (category && !e.categories.includes(category)) continue;
      if (type && e.type !== type) continue;
      if (repo && e.repo !== repo) continue;
      if (actor && e.actor !== actor) continue;
      if (needle && !(e.repo + ' ' + e.actor + ' ' + e.text).toLowerCase().includes(needle)) continue;
      out.push(e);
    }
    return out;
  }

  repos({ range = '24h', q, sort = 'count', limit = 200, kw } = {}) {
    const { since, until } = this.rangeInfo(range);
    const sparkBuckets = 12;
    const step = (until - since) / sparkBuckets;
    const map = new Map();
    for (const e of this.inRange(since, until)) {
      if (kw && !e.keywords.includes(kw)) continue;
      let r = map.get(e.repo);
      if (!r) {
        r = { repo: e.repo, count: 0, keywords: {}, actors: new Set(), types: {}, firstSeen: e.createdAt, lastSeen: 0, spark: Array(sparkBuckets).fill(0) };
        map.set(e.repo, r);
      }
      r.count += 1;
      r.actors.add(e.actor);
      r.lastSeen = Math.max(r.lastSeen, e.createdAt);
      r.types[e.type] = (r.types[e.type] || 0) + 1;
      for (const k of e.keywords) r.keywords[k] = (r.keywords[k] || 0) + 1;
      r.spark[Math.min(sparkBuckets - 1, Math.floor((e.createdAt - since) / step))] += 1;
    }
    let list = [...map.values()].map((r) => ({ ...r, actors: r.actors.size }));
    if (q) {
      const n = q.toLowerCase();
      list = list.filter((r) => r.repo.toLowerCase().includes(n));
    }
    const sorters = {
      count: (a, b) => b.count - a.count,
      recent: (a, b) => b.lastSeen - a.lastSeen,
      actors: (a, b) => b.actors - a.actors,
      diversity: (a, b) => Object.keys(b.keywords).length - Object.keys(a.keywords).length,
      name: (a, b) => a.repo.localeCompare(b.repo),
    };
    list.sort(sorters[sort] || sorters.count);
    return { total: list.length, items: list.slice(0, limit) };
  }

  actors({ range = '24h', limit = 100 } = {}) {
    const { since, until } = this.rangeInfo(range);
    const map = new Map();
    for (const e of this.inRange(since, until)) {
      let a = map.get(e.actor);
      if (!a) {
        a = { actor: e.actor, count: 0, repos: new Set(), keywords: {}, lastSeen: 0 };
        map.set(e.actor, a);
      }
      a.count += 1;
      a.repos.add(e.repo);
      a.lastSeen = Math.max(a.lastSeen, e.createdAt);
      for (const k of e.keywords) a.keywords[k] = (a.keywords[k] || 0) + 1;
    }
    return [...map.values()]
      .map((a) => ({ ...a, repos: a.repos.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /** Technology co-occurrence graph: which technologies show up in the same event. */
  cooccurrence(range = '24h', { maxNodes = 40, maxEdges = 90 } = {}) {
    const { since, until } = this.rangeInfo(range);
    const nodes = new Map();
    const edges = new Map();
    for (const e of this.inRange(since, until)) {
      const ks = [...new Set(e.keywords)].sort();
      for (const k of ks) nodes.set(k, (nodes.get(k) || 0) + 1);
      for (let i = 0; i < ks.length; i++) {
        for (let j = i + 1; j < ks.length; j++) {
          const key = `${ks[i]}|${ks[j]}`;
          edges.set(key, (edges.get(key) || 0) + 1);
        }
      }
    }
    const top = new Set([...nodes].sort((a, b) => b[1] - a[1]).slice(0, maxNodes).map(([k]) => k));
    return {
      nodes: [...top].map((id) => ({ id, count: nodes.get(id) })),
      edges: [...edges]
        .map(([key, weight]) => {
          const [a, b] = key.split('|');
          return { a, b, weight };
        })
        .filter((x) => top.has(x.a) && top.has(x.b))
        .sort((x, y) => y.weight - x.weight)
        .slice(0, maxEdges),
    };
  }

  /** Cumulative counts per technology at evenly spaced frames (for the bar-chart race). */
  race(range = '24h', frames = 40) {
    const { since, until } = this.rangeInfo(range);
    const events = this.inRange(since, until);
    const step = (until - since) / frames;
    const totals = {};
    const out = [];
    let i = 0;
    for (let f = 1; f <= frames; f++) {
      const edge = since + f * step;
      while (i < events.length && events[i].createdAt <= edge) {
        for (const k of events[i].keywords) totals[k] = (totals[k] || 0) + 1;
        i++;
      }
      out.push({ t: edge, values: { ...totals } });
    }
    return { since, until, frames: out };
  }

  trend(ids, range) {
    const { since, until, bucket } = this.rangeInfo(range);
    const start = Math.floor(since / bucket) * bucket;
    const n = Math.floor((until - start) / bucket) + 1;
    const series = Object.fromEntries(ids.map((id) => [id, Array(n).fill(0)]));
    for (const e of this.inRange(start, until)) {
      const i = Math.floor((e.createdAt - start) / bucket);
      for (const k of e.keywords) if (series[k]) series[k][i] += 1;
    }
    return { start, bucket, points: Array.from({ length: n }, (_, i) => start + i * bucket), series };
  }
}

module.exports = { Store, RANGES };
