// Delight layer: confetti, welcome tour, milestones, TV / presentation mode.
import { t, getLang } from './i18n.js';
import { api, $, state, toast, fmtNum, emit } from './core.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function confetti(n = 160) {
  if (reduced()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const W = (c.width = innerWidth);
  const H = (c.height = innerHeight);
  const css = getComputedStyle(document.documentElement);
  const colors = [1, 2, 3, 4, 5, 7, 8].map((i) => css.getPropertyValue(`--series-${i}`).trim());
  const parts = Array.from({ length: n }, () => ({
    x: W / 2 + (Math.random() - 0.5) * 200,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 14 - 4,
    s: 4 + Math.random() * 6,
    rot: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (now) => {
    const age = now - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 2800);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (age < 2800) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- milestones ----------
const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000];
let baseline = null;
export function checkMilestone(stored) {
  const reached = MILESTONES.filter((m) => stored >= m).at(-1) || 0;
  const last = Number(localStorage.getItem('aip.milestone') || 0);
  if (baseline === null) {
    // First reading after load: remember silently, celebrate only live crossings.
    baseline = reached;
    if (reached > last) localStorage.setItem('aip.milestone', reached);
    return;
  }
  if (reached > last) {
    localStorage.setItem('aip.milestone', reached);
    confetti();
    toast(`🎉 ${t('milestone', { n: fmtNum(reached) })}`, t('milestone_sub'));
  }
}

// ---------- welcome tour ----------
export function maybeWelcome({ setLanguage }) {
  if (localStorage.getItem('aip.welcomed')) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'welcome';
  const draw = () => {
    dlg.innerHTML = `
      <div class="welcome-hero"><img src="/icon.svg" width="64" height="64" alt=""/><div><h2>${t('wel_title')}</h2><p>${t('wel_sub')}</p></div>
        <span class="seg" id="wel-lang"><button data-l="vi" class="${getLang() === 'vi' ? 'on' : ''}">VI</button><button data-l="en" class="${getLang() === 'en' ? 'on' : ''}">EN</button></span></div>
      <div class="welcome-grid">
        ${t('wel_features')
          .map(([icon, title, desc], i) => `<div class="wf" style="animation-delay:${i * 70}ms"><span>${icon}</span><b>${title}</b><small>${desc}</small></div>`)
          .join('')}
      </div>
      <p class="help">${t('wel_choose')}</p>
      <div class="welcome-actions">
        <button class="btn primary" data-mode="live">🌐 ${t('mode_live')}</button>
        <button class="btn" data-mode="demo">🧪 ${t('mode_demo')}</button>
      </div>
      <p class="help" style="text-align:center;margin:12px 0 0">${t('wel_tip')}</p>`;
  };
  draw();
  document.body.appendChild(dlg);
  dlg.addEventListener('click', async (e) => {
    const l = e.target.closest('[data-l]');
    if (l) {
      setLanguage(l.dataset.l);
      draw();
      return;
    }
    const m = e.target.closest('[data-mode]');
    if (!m) return;
    localStorage.setItem('aip.welcomed', '1');
    if (state.config?.mode !== m.dataset.mode) {
      state.config = await api('/api/settings', { method: 'PUT', body: { mode: m.dataset.mode } });
      emit('config-changed');
    }
    dlg.close();
    dlg.remove();
    confetti(90);
  });
  dlg.addEventListener('cancel', () => localStorage.setItem('aip.welcomed', '1'));
  dlg.showModal();
}

// ---------- TV / presentation mode ----------
const TV_ROUTES = ['/', '/radar', '/race', '/insights', '/ecosystem', '/feed'];
const TV_MS = 25_000;
let tvTimer = null;
export const isTv = () => document.body.classList.contains('tv');
export function startTv() {
  if (isTv()) return stopTv();
  document.body.classList.add('tv');
  document.documentElement.requestFullscreen?.().catch(() => {});
  let i = Math.max(0, TV_ROUTES.indexOf((location.hash.slice(1) || '/').split('?')[0]));
  const bar = document.createElement('div');
  bar.className = 'tv-bar';
  bar.innerHTML = `<i></i><button class="btn sm" id="tv-exit">✕ ${t('tv_exit')}</button>`;
  document.body.appendChild(bar);
  $('#tv-exit').addEventListener('click', stopTv);
  const next = () => {
    location.hash = '#' + TV_ROUTES[i % TV_ROUTES.length];
    i += 1;
    const fill = bar.querySelector('i');
    fill.style.transition = 'none';
    fill.style.width = '0';
    requestAnimationFrame(() => {
      fill.style.transition = `width ${TV_MS}ms linear`;
      fill.style.width = '100%';
    });
  };
  next();
  tvTimer = setInterval(next, TV_MS);
  toast('📺 ' + t('tv_on'), t('tv_hint'));
}
export function stopTv() {
  clearInterval(tvTimer);
  document.body.classList.remove('tv');
  document.querySelector('.tv-bar')?.remove();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => !document.fullscreenElement && isTv() && stopTv());
