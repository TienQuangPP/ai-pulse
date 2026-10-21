'use strict';
const { EventEmitter } = require('events');
const { normalize } = require('./normalize');
const demo = require('./demo');

const EVENTS_URL = 'https://api.github.com/events';

/**
 * Polls the GitHub public Events API (with ETag caching so unchanged pages do not
 * burn rate limit) or generates demo events. Emits 'events' with normalized records
 * and 'status' whenever the collector state changes.
 */
class Collector extends EventEmitter {
  constructor({ detector, getConfig }) {
    super();
    this.detector = detector;
    this.getConfig = getConfig;
    this.etags = new Map();
    this.timer = null;
    this.status = {
      state: 'idle',
      mode: 'live',
      lastPoll: null,
      lastSuccess: null,
      lastError: null,
      rateLimit: null,
      rateRemaining: null,
      rateReset: null,
      polls: 0,
      fetched: 0,
      nextPollAt: null,
      interval: null,
    };
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.status);
  }

  effectiveInterval() {
    const cfg = this.getConfig();
    if (cfg.mode === 'demo') return 5;
    const pages = this.pages();
    // Unauthenticated: 60 req/h. Keep the request rate under it.
    const floor = cfg.githubToken ? 5 : 60 * pages;
    return Math.max(cfg.pollInterval || 30, floor, this.serverPollHint || 0);
  }

  pages() {
    const cfg = this.getConfig();
    return Math.min(3, Math.max(1, cfg.githubToken ? cfg.pages || 3 : 1));
  }

  start() {
    this.stop();
    this.paused = false;
    this.tick();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  pause() {
    this.paused = true;
    this.stop();
    this.setStatus({ state: 'paused', nextPollAt: null });
  }

  schedule() {
    if (this.paused) return;
    const seconds = this.effectiveInterval();
    this.setStatus({ nextPollAt: Date.now() + seconds * 1000, interval: seconds });
    this.timer = setTimeout(() => this.tick(), seconds * 1000);
  }

  async tick() {
    this.stop();
    const cfg = this.getConfig();
    this.status.mode = cfg.mode;
    try {
      if (cfg.mode === 'demo') this.runDemo();
      else await this.pollGitHub(cfg);
    } catch (err) {
      this.setStatus({ state: 'error', lastError: String(err.message || err) });
    }
    this.schedule();
  }

  runDemo() {
    const raw = demo.batch(1 + Math.floor(Math.random() * 5));
    this.publish(raw, { demo: true });
    this.setStatus({ state: 'running', lastPoll: Date.now(), lastSuccess: Date.now(), lastError: null, polls: this.status.polls + 1 });
  }

  async pollGitHub(cfg) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AI-Pulse-Tracker',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (cfg.githubToken) headers.Authorization = `Bearer ${cfg.githubToken}`;

    let fetched = 0;
    for (let page = 1; page <= this.pages(); page++) {
      const url = `${EVENTS_URL}?per_page=100&page=${page}`;
      const h = { ...headers };
      if (this.etags.has(url)) h['If-None-Match'] = this.etags.get(url);
      const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(15_000) });
      this.serverPollHint = Number(res.headers.get('x-poll-interval')) || 0;
      this.setStatus({
        rateLimit: Number(res.headers.get('x-ratelimit-limit')) || this.status.rateLimit,
        rateRemaining: res.headers.has('x-ratelimit-remaining') ? Number(res.headers.get('x-ratelimit-remaining')) : this.status.rateRemaining,
        rateReset: Number(res.headers.get('x-ratelimit-reset')) * 1000 || this.status.rateReset,
      });
      if (res.status === 304) continue;
      if (res.status === 403 || res.status === 429) {
        const reset = this.status.rateReset;
        this.setStatus({ state: 'rate_limited', lastPoll: Date.now(), lastError: `GitHub rate limit reached. Resets at ${reset ? new Date(reset).toLocaleTimeString() : 'later'}. Add a token in Settings or switch to Demo mode.` });
        return;
      }
      if (res.status === 401) {
        this.setStatus({ state: 'error', lastPoll: Date.now(), lastError: 'GitHub token is invalid (401). Update it in Settings.' });
        return;
      }
      if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
      const etag = res.headers.get('etag');
      if (etag) this.etags.set(url, etag);
      const raw = await res.json();
      fetched += raw.length;
      this.publish(raw);
    }
    this.setStatus({
      state: 'running',
      lastPoll: Date.now(),
      lastSuccess: Date.now(),
      lastError: null,
      polls: this.status.polls + 1,
      fetched: this.status.fetched + fetched,
    });
  }

  publish(rawEvents, extra) {
    const normalized = rawEvents.map((e) => normalize(e, this.detector, extra));
    this.emit('events', normalized);
  }
}

module.exports = { Collector };
