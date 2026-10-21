// Shared state, API client, live bus and UI helpers.
import { t, getLang } from './i18n.js';
import { esc, fmtNum, barList } from './charts.js';

export const state = {
  range: localStorage.getItem('aip.range') || '1h',
  status: null,
  config: null,
  taxonomy: { categories: [], technologies: [] },
  techById: new Map(),
  watch: new Set(JSON.parse(localStorage.getItem('aip.watch') || '[]')),
  unreadAlerts: 0,
  online: true,
  lastSummary: null,
};

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => {
  const h = (e) => fn(e.detail);
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export { esc, fmtNum };

// ---------- taxonomy / colors ----------
const CAT_SLOT = { llm: 1, framework: 2, agent: 3, vector: 4, local: 5, technique: 6, genai: 7, ml: 8, custom: 0 };
export const catColor = (cat) => `var(--series-${CAT_SLOT[cat] ?? 0})`;
export const techColor = (id) => catColor(state.techById.get(id)?.category);
export const techLabel = (id) => state.techById.get(id)?.label || id;
export const catLabel = (id) => {
  const c = state.taxonomy.categories.find((x) => x.id === id);
  return c ? c.label[getLang()] || c.label.en : id;
};
export async function loadTaxonomy() {
  state.taxonomy = await api('/api/taxonomy');
  state.techById = new Map(state.taxonomy.technologies.map((x) => [x.id, x]));
}

// ---------- formatting ----------
export const fmtPct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export function timeAgo(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return t('just_now');
  const units = getLang() === 'vi' ? ['giây', 'phút', 'giờ', 'ngày'] : ['s', 'm', 'h', 'd'];
  const sep = getLang() === 'vi' ? ' ' : '';
  if (s < 60) return `${s}${sep}${units[0]} ${t('ago')}`;
  if (s < 3600) return `${Math.floor(s / 60)}${sep}${units[1]} ${t('ago')}`;
  if (s < 86400) return `${Math.floor(s / 3600)}${sep}${units[2]} ${t('ago')}`;
  return `${Math.floor(s / 86400)}${sep}${units[3]} ${t('ago')}`;
}
export const fmtTime = (ms) => new Date(ms).toLocaleTimeString(getLang() === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (ms) =>
  new Date(ms).toLocaleString(getLang() === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtAxis = (bucket) => (ms) => (bucket >= 2 * 3600_000 ? new Date(ms).toLocaleDateString(getLang() === 'vi' ? 'vi-VN' : 'en-US', { month: 'numeric', day: 'numeric' }) + ' ' + fmtTime(ms) : fmtTime(ms));
export function deltaHtml(now, prev) {
  if (!prev) return now ? `<span class="delta up">▲ ${t('new_')}</span>` : '';
  const d = (now - prev) / prev;
  const cls = d >= 0 ? 'up' : 'down';
  return `<span class="delta ${cls}">${d >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(d), 0)}</span>`;
}
export const avatarUrl = (login, url) => url || `https://github.com/${encodeURIComponent(login)}.png?size=60`;
export const ownerAvatar = (repo) => `https://github.com/${encodeURIComponent(repo.split('/')[0])}.png?size=40`;

export function techTag(id, count) {
  return `<span class="tag"><span class="sw" style="background:${techColor(id)}"></span>${esc(techLabel(id))}${count != null ? ` <small>${count}</small>` : ''}</span>`;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function highlight(text, terms = []) {
  let html = esc(text);
  const sorted = [...new Set(terms)].filter((x) => x.length > 1).sort((a, b) => b.length - a.length);
  if (!sorted.length) return html;
  const re = new RegExp(`(?<![a-z0-9])(${sorted.map((x) => escRe(esc(x))).join('|')})(?![a-z0-9])`, 'gi');
  return html.replace(re, '<mark>$1</mark>');
}

// ---------- watchlist ----------
export function toggleWatch(repo) {
  if (state.watch.has(repo)) state.watch.delete(repo);
  else state.watch.add(repo);
  localStorage.setItem('aip.watch', JSON.stringify([...state.watch]));
  emit('watch', repo);
  return state.watch.has(repo);
}
export const starBtn = (repo) =>
  `<button class="star${state.watch.has(repo) ? ' on' : ''}" data-star="${esc(repo)}" title="${t(state.watch.has(repo) ? 'unwatch' : 'watch')}" aria-label="${t('watch')}">${state.watch.has(repo) ? '★' : '☆'}</button>`;

/** Delegate clicks for stars and repo links inside a root element. */
export function wireCommon(root) {
  root.addEventListener('click', (ev) => {
    const star = ev.target.closest('[data-star]');
    if (star) {
      ev.preventDefault();
      ev.stopPropagation();
      const on = toggleWatch(star.dataset.star);
      $$(`[data-star="${CSS.escape(star.dataset.star)}"]`).forEach((b) => {
        b.classList.toggle('on', on);
        b.textContent = on ? '★' : '☆';
      });
      return;
    }
    const repoLink = ev.target.closest('[data-repo]');
    if (repoLink && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      openRepo(repoLink.dataset.repo);
    }
  });
}

// ---------- event item ----------
export function eventItem(e, { compact = false, fresh = false } = {}) {
  const typeShort = e.type.replace('Event', '');
  return `<li class="${fresh ? 'fresh ' : ''}${state.watch.has(e.repo) ? 'watched' : ''}" data-id="${esc(e.id)}">
    <img class="avatar" loading="lazy" src="${esc(avatarUrl(e.actor, e.avatar))}" alt="" onerror="this.style.visibility='hidden'"/>
    <div>
      <div class="head">
        <a class="repo" href="https://github.com/${esc(e.repo)}" data-repo="${esc(e.repo)}">${esc(e.repo)}</a>
        <span class="tag">${esc(typeShort)}</span>
        ${compact ? '' : e.keywords.map((k) => techTag(k)).join('')}
        ${e.demo ? `<span class="tag demo">${t('demo')}</span>` : ''}
      </div>
      ${e.text ? `<div class="text">${highlight(e.text, e.terms)}</div>` : ''}
      ${compact ? `<div class="chips">${e.keywords.slice(0, 3).map((k) => techTag(k)).join('')}</div>` : `<small>@${esc(e.actor)}</small>`}
    </div>
    <div class="time" title="${esc(new Date(e.createdAt).toLocaleString())}">${timeAgo(e.createdAt)}<br/>${compact ? '' : starBtn(e.repo)}</div>
  </li>`;
}

// ---------- toast / notifications ----------
export function toast(title, body = '', kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
  el.addEventListener('click', () => el.remove());
}
export function notify(title, body) {
  toast(title, body, 'alert');
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(title, { body, icon: '/icon.svg' });
    } catch {
      /* some browsers only allow SW notifications */
    }
  }
}

// ---------- drawer ----------
export function openDrawer(html) {
  const d = $('#drawer');
  d.innerHTML = html;
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').hidden = false;
  wireCommon(d);
  d.querySelector('[data-close]')?.addEventListener('click', closeDrawer);
}
export function closeDrawer() {
  const d = $('#drawer');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  $('#drawer-backdrop').hidden = true;
}

export async function openRepo(name) {
  openDrawer(`<div class="empty">${t('loading')}</div>`);
  const r = await api(`/api/repo?name=${encodeURIComponent(name)}`);
  openDrawer(`
    <div class="card-h">
      <img class="avatar" src="${ownerAvatar(name)}" alt="" style="width:36px;height:36px"/>
      <h2 style="font-size:18px;overflow-wrap:anywhere">${esc(name)}</h2>
      ${starBtn(name)}
      <button class="icon-btn" data-close aria-label="${t('close')}">✕</button>
    </div>
    <div class="toolbar">
      <a class="btn" href="https://github.com/${esc(name)}" target="_blank" rel="noopener">${t('on_github')}</a>
      <a class="btn primary" href="#/analyzer?repo=${encodeURIComponent(name)}">${t('analyze')}</a>
      <span class="tag">${fmtNum(r.count)} ${t('events')}</span>
    </div>
    <div class="card" style="margin-bottom:12px"><div class="card-h"><h2>${t('techs')}</h2></div><div id="dr-kw"></div></div>
    <div class="card" style="margin-bottom:12px"><div class="card-h"><h2>${t('contributors')}</h2></div><div id="dr-ac"></div></div>
    <div class="card"><div class="card-h"><h2>${t('recent_events')}</h2></div><ul class="feed compact">${r.events.slice(0, 30).map((e) => eventItem(e, { compact: true })).join('')}</ul></div>
  `);
  const kw = Object.entries(r.keywords).sort((a, b) => b[1] - a[1]);
  barList($('#dr-kw'), kw.map(([id, c]) => ({ label: techLabel(id), value: c, color: techColor(id) })), { empty: t('empty') });
  const ac = Object.entries(r.actors).sort((a, b) => b[1] - a[1]).slice(0, 10);
  barList($('#dr-ac'), ac.map(([a, c]) => ({ label: '@' + a, value: c, color: 'var(--series-1)', onClick: () => window.open(`https://github.com/${a}`, '_blank') })), { empty: t('empty') });
}

export function rangeLabel(r = state.range) {
  return t(`r_${r}`);
}
