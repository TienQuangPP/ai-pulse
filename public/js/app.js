// App shell: routing, live connection, status, command palette, shortcuts.
import { t, getLang, setLang } from './i18n.js';
import { hideTip } from './charts.js';
import { state, api, $, $$, esc, fmtNum, emit, on, loadTaxonomy, notify, toast, closeDrawer, openRepo, rangeLabel } from './core.js';
import * as pages from './pages.js';
import * as pages2 from './pages2.js';
import { checkMilestone, maybeWelcome, startTv, stopTv, isTv } from './fx.js';

const ROUTES = [
  { path: '/', key: 'overview', icon: '◉', grp: 'monitor', render: pages.overview },
  { path: '/insights', key: 'insights', icon: '✨', grp: 'monitor', render: pages2.insightsPage, isNew: true },
  { path: '/feed', key: 'feed', icon: '≋', grp: 'monitor', render: pages.feed },
  { path: '/radar', key: 'radar', icon: '📡', grp: 'monitor', render: pages2.radar, isNew: true },
  { path: '/alerts', key: 'alerts', icon: '🔔', grp: 'monitor', render: pages.alerts },
  { path: '/tech', key: 'tech', icon: '⬡', grp: 'explore', render: pages.tech },
  { path: '/race', key: 'race', icon: '🏁', grp: 'explore', render: pages2.race, isNew: true },
  { path: '/ecosystem', key: 'ecosystem', icon: '🕸', grp: 'explore', render: pages2.ecosystem, isNew: true },
  { path: '/repos', key: 'repos', icon: '▤', grp: 'explore', render: pages.repos },
  { path: '/devs', key: 'devs', icon: '☺', grp: 'explore', render: pages.devs },
  { path: '/watchlist', key: 'watchlist', icon: '★', grp: 'explore', render: pages.watchlist },
  { path: '/analyzer', key: 'analyzer', icon: '⌬', grp: 'tools', render: pages.analyzer },
  { path: '/playground', key: 'playground', icon: '✎', grp: 'tools', render: pages.playground },
  { path: '/report', key: 'report', icon: '▣', grp: 'tools', render: pages.report },
  { path: '/settings', key: 'settings', icon: '⚙', grp: 'tools', render: pages.settings },
];
const RANGES = ['15m', '1h', '6h', '24h', '7d', 'all'];
let current = null; // { route, page }
let deferredInstall = null;

// ---------- theme / language ----------
function setTheme(mode) {
  if (mode === 'system') {
    localStorage.removeItem('aip.theme');
    delete document.documentElement.dataset.theme;
  } else {
    localStorage.setItem('aip.theme', mode);
    document.documentElement.dataset.theme = mode;
  }
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').content = dark ? '#121211' : '#f4f4f2';
  rerender();
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  setTheme(dark ? 'light' : 'dark');
}
function setLanguage(l) {
  setLang(l);
  renderShell();
  rerender();
}

// ---------- shell ----------
function renderShell() {
  $('#tagline').textContent = t('tagline');
  $('#cmd-label').textContent = t('search');
  $('#lang-btn').textContent = getLang().toUpperCase();
  let html = '';
  let grp = '';
  ROUTES.forEach((r, i) => {
    if (r.grp !== grp) {
      grp = r.grp;
      html += `<div class="grp">${t('grp_' + grp)}</div>`;
    }
    html += `<a href="#${r.path}" data-path="${r.path}" title="${i + 1}"><span class="ico">${r.icon}</span>${t('nav_' + r.key)}${r.isNew && !localStorage.getItem('aip.seen.' + r.key) ? '<span class="new-dot">NEW</span>' : ''}${r.key === 'alerts' && state.unreadAlerts ? `<span class="badge">${state.unreadAlerts}</span>` : ''}${
      r.key === 'watchlist' && state.watch.size ? `<span class="badge" style="background:var(--surface-2);color:var(--text-secondary)">${state.watch.size}</span>` : ''
    }</a>`;
  });
  $('#nav').innerHTML = html;
  $('#range').innerHTML = RANGES.map((r) => `<button role="tab" data-range="${r}" class="${r === state.range ? 'on' : ''}" aria-selected="${r === state.range}">${t('r_' + r)}</button>`).join('');
  markActiveNav();
  renderStatus();
}
function markActiveNav() {
  const path = current?.route.path;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === path));
}

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

function route() {
  const { path, params } = parseHash();
  const r = ROUTES.find((x) => x.path === path) || ROUTES[0];
  current?.page?.cleanup?.();
  hideTip();
  closeDrawer();
  if ($('#palette').open) $('#palette').close();
  $('#sidebar').classList.remove('open');
  if (r !== current?.route) window.scrollTo(0, 0);
  const view = $('#view');
  const fresh = view.cloneNode(false); // drop old listeners
  view.replaceWith(fresh);
  $('#page-title').textContent = t('nav_' + r.key);
  document.title = `${t('nav_' + r.key)} · AI Pulse`;
  const page = r.render(fresh, params, { rerender, setTheme, setLanguage, installPrompt: () => deferredInstall }) || {};
  current = { route: r, page };
  if (r.isNew && !localStorage.getItem('aip.seen.' + r.key)) {
    localStorage.setItem('aip.seen.' + r.key, '1');
    renderShell();
  }
  $('#range').style.visibility = page.usesRange ? 'visible' : 'hidden';
  markActiveNav();
}
function rerender() {
  if (current) route();
}

// ---------- status ----------
function renderStatus() {
  const s = state.status;
  const el = $('#status');
  const stateKey = !state.online ? 'offline' : s?.state || 'idle';
  const mode = state.config?.mode;
  el.innerHTML = `<span class="pulse ${stateKey}"></span><span class="txt">${t('st_' + stateKey)}</span>${mode ? `<span class="tag ${mode === 'demo' ? 'demo' : 'live'}">${t(mode)}</span>` : ''}`;
  const lines = [];
  if (s?.nextPollAt) lines.push(`${t('next_poll')}: ${Math.max(0, Math.round((s.nextPollAt - Date.now()) / 1000))}s`);
  if (s?.rateRemaining != null && mode === 'live') lines.push(`${t('rate')}: ${s.rateRemaining}/${s.rateLimit}`);
  el.title = lines.join('\n');
  $('#side-foot').innerHTML = `
    <div class="row"><span>${t('next_poll')}</span><b id="countdown">${s?.nextPollAt ? Math.max(0, Math.round((s.nextPollAt - Date.now()) / 1000)) + 's' : '—'}</b></div>
    ${mode === 'live' && s?.rateRemaining != null ? `<div class="row"><span>${t('rate')}</span><b>${s.rateRemaining}/${s.rateLimit}</b></div>` : ''}
    <div class="row"><span>${t('events')}</span><b id="stored">${fmtNum(state.stored || 0)}</b></div>`;

  const banner = $('#banner');
  if (!state.online) {
    banner.className = 'banner warn';
    banner.innerHTML = esc(t('offline'));
    banner.hidden = false;
  } else if (s?.lastError && mode === 'live') {
    banner.className = 'banner warn';
    banner.innerHTML = `⚠ ${esc(s.lastError)} <a href="#/settings">${t('nav_settings')} →</a>`;
    banner.hidden = false;
  } else if (mode === 'demo') {
    banner.className = 'banner';
    banner.innerHTML = `🧪 ${esc(t('demo_banner'))} <a href="#/settings">${t('nav_settings')} →</a>`;
    banner.hidden = false;
  } else banner.hidden = true;
}
setInterval(() => {
  const s = state.status;
  const el = $('#countdown');
  if (el && s?.nextPollAt) el.textContent = Math.max(0, Math.round((s.nextPollAt - Date.now()) / 1000)) + 's';
}, 1000);

// ---------- live connection ----------
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => {
    if (!state.online) {
      state.online = true;
      renderStatus();
    }
  });
  es.addEventListener('error', () => {
    state.online = false;
    renderStatus();
  });
  es.addEventListener('status', (e) => {
    state.status = JSON.parse(e.data);
    renderStatus();
  });
  es.addEventListener('config', (e) => {
    state.config = JSON.parse(e.data);
    renderStatus();
  });
  es.addEventListener('events', (e) => {
    const events = JSON.parse(e.data);
    current?.page?.onEvents?.(events);
    for (const ev of events) if (state.watch.has(ev.repo)) notify(t('toast_watch'), `${ev.repo} · ${ev.type.replace('Event', '')}`);
  });
  es.addEventListener('tick', (e) => {
    const d = JSON.parse(e.data);
    state.stored = d.stored;
    checkMilestone(d.stored);
    const st = $('#stored');
    if (st) st.textContent = fmtNum(d.stored);
    current?.page?.onTick?.(d);
  });
  es.addEventListener('alert', (e) => {
    const a = JSON.parse(e.data);
    state.unreadAlerts += 1;
    const r = a.rule;
    const target = r.kind === 'any' ? t('kind_any') : r.kind === 'keyword' ? state.techById.get(r.value)?.label || r.value : r.value;
    notify(`${t('toast_alert')}: ${target}`, t('al_fired', { count: a.count, window: r.window }));
    current?.page?.onAlert?.(a);
    renderShell();
  });
}

// ---------- command palette ----------
function paletteItems() {
  const items = ROUTES.map((r, i) => ({ label: t('nav_' + r.key), hint: `${t('cmd_go')} · ${i + 1}`, icon: r.icon, run: () => (location.hash = '#' + r.path) }));
  items.push(
    { label: t('cmd_theme'), hint: 'T', icon: '◐', run: toggleTheme },
    { label: t('cmd_tv'), hint: 'F', icon: '📺', run: startTv },
    { label: t('cmd_lang'), hint: '', icon: '🌐', run: () => setLanguage(getLang() === 'vi' ? 'en' : 'vi') },
    { label: t('cmd_pause'), hint: '', icon: '⏯', run: togglePauseCollector },
    { label: t('cmd_poll'), hint: '', icon: '↻', run: () => api('/api/control', { method: 'POST', body: { action: 'poll' } }) },
    { label: t('cmd_export'), hint: 'CSV', icon: '⤓', run: () => (location.href = `/api/export?dataset=events&format=csv&range=${state.range}`) },
    ...RANGES.map((r) => ({ label: `${rangeLabel(r)}`, hint: 'range', icon: '⏱', run: () => setRange(r) })),
  );
  for (const r of state.lastSummary?.topRepos || []) items.push({ label: r.repo, hint: t('cmd_repo'), icon: '▤', run: () => openRepo(r.repo) });
  for (const x of state.taxonomy.technologies) items.push({ label: x.label, hint: t('technology'), icon: '⬡', run: () => (location.hash = `#/feed?kw=${x.id}`) });
  return items;
}
function openPalette() {
  const dlg = $('#palette');
  const input = $('#palette-input');
  const list = $('#palette-list');
  const all = paletteItems();
  let sel = 0;
  let shown = all;
  input.placeholder = t('search_cmd');
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all.slice(0, 14);
    // "owner/repo" typed directly -> analyze it
    if (/^[\w.-]+\/[\w.-]+$/.test(q)) shown.unshift({ label: `${t('analyze')} ${input.value.trim()}`, icon: '⌬', hint: t('nav_analyzer'), run: () => (location.hash = `#/analyzer?repo=${encodeURIComponent(input.value.trim())}`) });
    shown = shown.slice(0, 30);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((i, k) => `<li role="option" data-k="${k}" class="${k === sel ? 'sel' : ''}"><span>${i.icon}</span>${esc(i.label)}<small>${esc(i.hint || '')}</small></li>`).join('');
  };
  const pick = (k) => {
    const it = shown[k];
    dlg.close();
    it?.run();
  };
  input.value = '';
  input.oninput = () => {
    sel = 0;
    draw();
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') sel = Math.min(sel + 1, shown.length - 1);
    else if (e.key === 'ArrowUp') sel = Math.max(sel - 1, 0);
    else if (e.key === 'Enter') return pick(sel);
    else return;
    e.preventDefault();
    draw();
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  };
  list.onclick = (e) => {
    const li = e.target.closest('li');
    if (li) pick(Number(li.dataset.k));
  };
  dlg.onclick = (e) => e.target === dlg && dlg.close();
  draw();
  dlg.showModal();
  input.focus();
}

async function togglePauseCollector() {
  const paused = state.status?.state === 'paused';
  await api('/api/control', { method: 'POST', body: { action: paused ? 'resume' : 'pause' } });
}

function setRange(r) {
  state.range = r;
  localStorage.setItem('aip.range', r);
  $$('#range button').forEach((b) => {
    b.classList.toggle('on', b.dataset.range === r);
    b.setAttribute('aria-selected', b.dataset.range === r);
  });
  if (current?.page?.usesRange) rerender();
}

// ---------- events ----------
function wire() {
  window.addEventListener('hashchange', route);
  $('#range').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (b) setRange(b.dataset.range);
  });
  $('#theme-btn').addEventListener('click', toggleTheme);
  $('#tv-btn').addEventListener('click', startTv);
  $('#lang-btn').addEventListener('click', () => setLanguage(getLang() === 'vi' ? 'en' : 'vi'));
  $('#cmd-btn').addEventListener('click', openPalette);
  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  on('watch', () => renderShell());
  on('alerts-read', () => renderShell());
  on('config-changed', () => {
    renderStatus();
    rerender();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => !localStorage.getItem('aip.theme') && rerender());

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      return openPalette();
    }
    if (e.key === 'Escape') {
      closeDrawer();
      if (isTv()) stopTv();
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('#palette').open;
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 't') toggleTheme();
    else if (e.key === 'f') startTv();
    else if (e.key === 'p') current?.page?.togglePause ? current.page.togglePause() : togglePauseCollector();
    else if (e.key === '?') location.hash = '#/settings?section=shortcuts';
    else if (/^[1-9]$/.test(e.key) && ROUTES[Number(e.key) - 1]) location.hash = '#' + ROUTES[Number(e.key) - 1].path;
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- boot ----------
(async function boot() {
  setLang(getLang());
  wire();
  try {
    const [status] = await Promise.all([api('/api/status'), loadTaxonomy()]);
    state.status = status.collector;
    state.config = status.config;
    state.stored = status.stored;
    state.statusVersion = status.version;
  } catch (err) {
    state.online = false;
    toast('AI Pulse', err.message, 'error');
  }
  renderShell();
  route();
  connect();
  if (state.stored != null) checkMilestone(state.stored);
  maybeWelcome({ setLanguage });
  setInterval(async () => {
    try {
      const s = await api('/api/status');
      state.config = s.config;
      state.stored = s.stored;
      renderStatus();
    } catch {
      /* SSE error handler shows offline */
    }
  }, 30_000);
})();
