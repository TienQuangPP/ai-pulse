'use strict';
/** Repo Analyzer: scores how "AI-native" a GitHub repository is and lists its AI stack. */

const DEP_FILES = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml'];
const cache = new Map();
const TTL = 10 * 60_000;

function parseRepo(input) {
  const m = String(input || '')
    .trim()
    .replace(/\.git$/, '')
    .match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function gh(url, token, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'User-Agent': 'AI-Pulse-Tracker' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${url}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached — add a token in Settings.');
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  return accept.includes('raw') ? res.text() : res.json();
}

async function analyze(input, { token, detector, store }) {
  const full = parseRepo(input);
  if (!full) throw new Error('Enter a repository as owner/name or a GitHub URL.');
  const hit = cache.get(full.toLowerCase());
  if (hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };

  const repo = await gh(`/repos/${full}`, token);
  if (!repo) throw new Error(`Repository ${full} not found.`);
  const [languages, readme, ...deps] = await Promise.all([
    gh(`/repos/${full}/languages`, token).catch(() => ({})),
    gh(`/repos/${full}/readme`, token, 'application/vnd.github.raw').catch(() => ''),
    ...DEP_FILES.map((f) => gh(`/repos/${full}/contents/${f}`, token, 'application/vnd.github.raw').catch(() => null)),
  ]);

  const name = detector.detect(repo.full_name.replace('/', ' / '));
  const topics = detector.detect((repo.topics || []).join(' '));
  // When the name or topics already say "AI", ambiguous words in the description
  // ("agents", "embeddings", "MCP") are meaningful too.
  const aiContext = name.keywords.length > 0 || topics.keywords.length > 0;
  const sources = {
    name,
    description: detector.detect(repo.description || '', { allowWeak: aiContext }),
    topics,
    readme: detector.detect((readme || '').slice(0, 200_000)),
    // Package names are unambiguous, so weak terms such as "torch" or "transformers" count here.
    dependencies: detector.detect(deps.filter(Boolean).join('\n'), { allowWeak: true }),
  };

  // Each source saturates on its own, so a long README alone cannot max out the score.
  // Points: [max points, distinct technologies needed to reach the max].
  const SCORING = { name: [15, 1], description: [25, 2], topics: [20, 4], dependencies: [20, 3], readme: [10, 8] };
  const stack = new Map();
  const breakdown = {};
  for (const [src, det] of Object.entries(sources)) {
    const [max, needed] = SCORING[src];
    breakdown[src] = Math.round(max * Math.min(1, det.keywords.length / needed));
    for (const k of det.keywords) {
      const tech = detector.byId.get(k);
      const entry = stack.get(k) || { id: k, label: tech.label, category: tech.category, sources: [] };
      entry.sources.push(src);
      stack.set(k, entry);
    }
  }
  const groups = new Set([...stack.values()].map((s) => s.category));
  breakdown.breadth = Math.round(10 * Math.min(1, groups.size / 5));
  const score = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));

  const langTotal = Object.values(languages || {}).reduce((s, v) => s + v, 0) || 1;
  const tracked = store.query({ range: 'all', repo: repo.full_name, limit: 20 });

  const data = {
    repo: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    owner: { login: repo.owner?.login, avatar: repo.owner?.avatar_url },
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    openIssues: repo.open_issues_count,
    license: repo.license?.spdx_id || null,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    homepage: repo.homepage,
    topics: repo.topics || [],
    languages: Object.entries(languages || {})
      .map(([name, bytes]) => ({ name, share: bytes / langTotal }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 8),
    score,
    verdict: score >= 65 ? 'ai-native' : score >= 35 ? 'ai-enabled' : score > 0 ? 'ai-curious' : 'non-ai',
    breakdown,
    stack: [...stack.values()].sort((a, b) => b.sources.length - a.sources.length),
    depFiles: DEP_FILES.filter((_, i) => deps[i]),
    tracked: { count: tracked.length, events: tracked.slice(0, 10) },
    analyzedAt: Date.now(),
  };
  cache.set(full.toLowerCase(), { at: Date.now(), data });
  return data;
}

module.exports = { analyze, parseRepo };
