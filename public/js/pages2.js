// v2.1 pages: AI Insights + Ask, Live Radar, Technology Race, Ecosystem graph.
import { t, getLang } from './i18n.js';
import { showTip, hideTip, onResize } from './charts.js';
import { state, api, $, esc, fmtNum, timeAgo, catColor, catLabel, techLabel, techColor, techTag, eventItem, wireCommon, openRepo, fmtDateTime, rangeLabel } from './core.js';

const tz = () => new Date().getTimezoneOffset();
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const resolveColor = (v) => (v.startsWith('var(') ? cssVar(v.slice(4, -1)) : v);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tiny, safe Markdown subset: **bold**, `code`, bullet lists, line breaks. */
export function miniMarkdown(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) {
      list ??= [];
      list.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (list) {
      out.push(`<ul>${list.join('')}</ul>`);
      list = null;
    }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}

// =====================================================================
// AI Insights + Ask AI Pulse
// =====================================================================
export function insightsPage(view) {
  const KEY = 'aip.chat';
  let messages = JSON.parse(sessionStorage.getItem(KEY) || '[]');
  let busy = false;
  const ai = state.config?.ai || {};
  const suggestions = t('ask_suggestions');

  view.innerHTML = `
    <div class="grid">
      <section class="card span-5"><div class="card-h"><h2>✨ ${t('ins_title')}</h2><small>${rangeLabel()}</small></div><ul class="insights" id="ins"></ul></section>
      <section class="card span-7 chat">
        <div class="card-h"><h2>💬 ${t('ask_title')}</h2><small>${esc(ai.model || '')}</small><button class="btn sm" id="ask-clear">${t('ask_clear')}</button></div>
        ${!ai.installed ? `<div class="notice">${t('ask_install')}<pre><code>npm install</code></pre></div>` : !state.config?.hasAnthropicKey ? `<div class="notice">${t('ask_key')} <a href="#/settings">${t('nav_settings')} →</a></div>` : ''}
        <div class="chat-log" id="chat-log" aria-live="polite"></div>
        <div class="chips" id="ask-sugg">${suggestions.map((s) => `<button class="tag" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <form class="chat-form" id="ask-form">
          <textarea id="ask-in" rows="2" placeholder="${t('ask_ph')}"></textarea>
          <button class="btn primary" id="ask-send">${t('ask_send')} ↵</button>
        </form>
      </section>
    </div>`;
  wireCommon(view);

  const log = $('#chat-log');
  const renderLog = () => {
    log.innerHTML = messages.length
      ? messages.map((m) => `<div class="msg ${m.role}">${m.role === 'assistant' ? `<span class="bot">⚡</span>` : ''}<div class="bubble">${m.role === 'assistant' ? miniMarkdown(m.content) || '<span class="typing"><i></i><i></i><i></i></span>' : esc(m.content)}</div></div>`).join('')
      : `<div class="empty">${t('ask_empty')}</div>`;
    log.scrollTop = log.scrollHeight;
  };

  async function loadInsights() {
    const list = await api(`/api/insights?range=${state.range}&tz=${tz()}`);
    if (!view.isConnected) return;
    $('#ins').innerHTML =
      list
        .map(
          (i, k) => `<li class="ins ${i.kind}" style="animation-delay:${k * 60}ms"><span class="ins-ico">${i.icon}</span>
          <span>${miniMarkdown(i.text[getLang()]).replace(/^<p>|<\/p>$/g, '')}</span>${i.link ? `<a href="${esc(i.link)}" aria-label="${t('open')}">→</a>` : ''}</li>`,
        )
        .join('') || `<li class="empty">${t('no_data_hint')}</li>`;
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    $('#ask-send').disabled = true;
    messages.push({ role: 'user', content: text.trim() });
    const reply = { role: 'assistant', content: '' };
    messages.push(reply);
    renderLog();
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: state.range, tz: tz(), messages: messages.slice(0, -1) }),
      });
      if (res.status === 501) reply.content = t('ask_install_short');
      else if (!res.ok) reply.content = `⚠️ ${(await res.json().catch(() => ({}))).error || res.status}`;
      else {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          reply.content += dec.decode(value, { stream: true });
          if (view.isConnected) renderLog();
        }
      }
    } catch (err) {
      reply.content = `⚠️ ${err.message}`;
    }
    if (!reply.content) reply.content = '—';
    sessionStorage.setItem(KEY, JSON.stringify(messages.slice(-30)));
    busy = false;
    if (view.isConnected) {
      renderLog();
      $('#ask-send').disabled = false;
    }
  }

  $('#ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#ask-in').value;
    $('#ask-in').value = '';
    send(v);
  });
  $('#ask-in').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#ask-form').requestSubmit();
    }
  });
  $('#ask-sugg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (b) send(b.dataset.q);
  });
  $('#ask-clear').addEventListener('click', () => {
    messages = [];
    sessionStorage.removeItem(KEY);
    renderLog();
  });
  renderLog();
  loadInsights();
  let last = Date.now();
  return {
    usesRange: true,
    onTick() {
      if (Date.now() - last > 20_000) {
        last = Date.now();
        loadInsights();
      }
    },
  };
}

// =====================================================================
// Live radar
// =====================================================================
export function radar(view) {
  const cats = state.taxonomy.categories.filter((c) => c.id !== 'custom');
  const SWEEP_MS = 4000;
  const blips = [];
  const counts = Object.fromEntries(cats.map((c) => [c.id, 0]));
  view.innerHTML = `
    <div class="grid">
      <section class="card span-8 radar-card"><div class="card-h"><h2>📡 ${t('radar_title')}</h2><small id="rd-n"></small></div>
        <div class="radar-wrap"><canvas id="rd" role="img" aria-label="${t('radar_title')}"></canvas></div></section>
      <section class="card span-4"><div class="card-h"><h2>${t('categories')}</h2><small>${t('radar_session')}</small></div><ul class="trend-list" id="rd-legend"></ul>
        <div class="card-h" style="margin-top:18px"><h2>${t('latest')}</h2></div><ul class="feed compact" id="rd-feed"></ul></section>
    </div>`;
  wireCommon(view);
  const canvas = $('#rd');
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let colors = {};

  const resize = () => {
    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    W = box.width;
    H = Math.min(560, Math.max(320, box.width * 0.72));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    colors = Object.fromEntries(cats.map((c) => [c.id, resolveColor(catColor(c.id))]));
    colors.text = cssVar('--text-muted');
    colors.grid = cssVar('--grid');
    colors.accent = cssVar('--accent');
  };

  const legend = () => {
    $('#rd-legend').innerHTML = cats
      .map((c) => `<li><span class="sw" style="background:${catColor(c.id)}"></span><span class="grow">${esc(c.label[getLang()] || c.label.en)}</span><b>${fmtNum(counts[c.id])}</b></li>`)
      .join('');
    $('#rd-n').textContent = `${fmtNum(blips.length)} ${t('events')}`;
  };

  const addBlip = (e, fresh) => {
    const cat = e.categories.find((c) => counts[c] != null) || cats[0].id;
    const idx = cats.findIndex((c) => c.id === cat);
    const sector = (Math.PI * 2) / cats.length;
    counts[cat] += 1;
    blips.push({
      e,
      cat,
      angle: idx * sector + sector * (0.12 + Math.random() * 0.76) - Math.PI / 2,
      r: 0.18 + Math.random() * 0.78,
      size: 3 + Math.min(4, e.keywords.length),
      born: fresh ? performance.now() : performance.now() - 5000,
    });
    if (blips.length > 160) blips.shift();
  };

  let raf;
  const start = performance.now();
  const draw = (now) => {
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) / 2 - 28;
    ctx.clearRect(0, 0, W, H);
    // rings & sectors
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    const sector = (Math.PI * 2) / cats.length;
    ctx.font = '600 11px Inter, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    cats.forEach((c, i) => {
      const a = i * sector - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
      const mid = a + sector / 2;
      ctx.fillStyle = colors[c.id];
      ctx.fillText(c.label[getLang()] || c.label.en, cx + Math.cos(mid) * (R + 16), cy + Math.sin(mid) * (R + 14));
    });
    // sweep
    const sweep = (((now - start) % SWEEP_MS) / SWEEP_MS) * Math.PI * 2 - Math.PI / 2;
    if (!reducedMotion()) {
      const trail = 0.9;
      for (let k = 0; k < 24; k++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, sweep - (trail * (k + 1)) / 24, sweep - (trail * k) / 24);
        ctx.closePath();
        ctx.fillStyle = colors.accent;
        ctx.globalAlpha = 0.16 * (1 - k / 24);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R);
      ctx.stroke();
    }
    // blips
    for (const b of blips) {
      const x = cx + Math.cos(b.angle) * b.r * R;
      const y = cy + Math.sin(b.angle) * b.r * R;
      b.x = x;
      b.y = y;
      let since = (sweep - b.angle) % (Math.PI * 2);
      if (since < 0) since += Math.PI * 2;
      const lit = reducedMotion() ? 0.85 : Math.max(0.28, 1 - since / (Math.PI * 1.6));
      const age = now - b.born;
      ctx.globalAlpha = lit;
      ctx.fillStyle = colors[b.cat];
      ctx.beginPath();
      ctx.arc(x, y, b.size, 0, Math.PI * 2);
      ctx.fill();
      if (age < 1600) {
        const p = age / 1600;
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = colors[b.cat];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, b.size + p * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    raf = requestAnimationFrame(draw);
  };

  canvas.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    let best = null;
    let bd = 14 ** 2;
    for (const b of blips) {
      const d = (b.x - px) ** 2 + (b.y - py) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    canvas.style.cursor = best ? 'pointer' : 'default';
    canvas._hover = best;
    if (best) showTip(`<div class="tip-title">${esc(best.e.repo)}</div><div class="chips">${best.e.keywords.map((k) => techTag(k)).join('')}</div><small>${timeAgo(best.e.createdAt)}</small>`, ev.clientX, ev.clientY);
    else hideTip();
  });
  canvas.addEventListener('pointerleave', hideTip);
  canvas.addEventListener('click', () => canvas._hover && openRepo(canvas._hover.e.repo));

  resize();
  const stopResize = onResize(canvas.parentElement, resize);
  raf = requestAnimationFrame(draw);
  (async () => {
    const ev = await api('/api/events?limit=60');
    if (!view.isConnected) return;
    ev.reverse().forEach((e) => addBlip(e, false));
    $('#rd-feed').innerHTML = ev.slice(-6).reverse().map((e) => eventItem(e, { compact: true })).join('');
    legend();
  })();

  return {
    cleanup() {
      cancelAnimationFrame(raf);
      stopResize();
    },
    onEvents(events) {
      events.forEach((e, i) => setTimeout(() => addBlip(e, true), i * 120));
      const list = $('#rd-feed');
      list.insertAdjacentHTML('afterbegin', events.slice(-4).reverse().map((e) => eventItem(e, { compact: true, fresh: true })).join(''));
      while (list.children.length > 6) list.lastElementChild.remove();
      setTimeout(legend, events.length * 120);
    },
  };
}

// =====================================================================
// Technology race (bar chart race)
// =====================================================================
export function race(view) {
  const TOP = 10;
  const ROW = 44;
  view.innerHTML = `
    <section class="card race-card">
      <div class="card-h"><h2>🏁 ${t('race_title')}</h2><small>${t('race_hint')}</small></div>
      <div class="race-time" id="rc-time"></div>
      <div class="race" id="rc" style="height:${TOP * ROW}px"></div>
      <div class="toolbar race-ctl">
        <button class="btn primary" id="rc-play">⏸</button>
        <input type="range" id="rc-slider" min="0" value="0" class="grow" aria-label="frame"/>
        <select id="rc-speed"><option value="700">0.5×</option><option value="350" selected>1×</option><option value="160">2×</option><option value="70">4×</option></select>
        <button class="btn" id="rc-replay">↺ ${t('race_replay')}</button>
      </div>
    </section>`;
  let data;
  let frame = 0;
  let playing = true;
  let timer;
  const rows = new Map();

  const render = () => {
    const f = data.frames[frame];
    const entries = Object.entries(f.values).sort((a, b) => b[1] - a[1]).slice(0, TOP);
    const max = Math.max(1, entries[0]?.[1] || 1);
    const box = $('#rc');
    const seen = new Set();
    entries.forEach(([id, v], rank) => {
      seen.add(id);
      let el = rows.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'race-row';
        el.innerHTML = `<span class="race-rank"></span><span class="race-bar"><span class="race-label"></span></span><span class="race-val"></span>`;
        el.style.transform = `translateY(${TOP * ROW}px)`;
        box.appendChild(el);
        rows.set(id, el);
        el.querySelector('.race-label').textContent = techLabel(id);
        el.querySelector('.race-bar').style.background = techColor(id);
      }
      el.style.opacity = 1;
      el.style.transform = `translateY(${rank * ROW}px)`;
      el.querySelector('.race-rank').textContent = `#${rank + 1}`;
      el.querySelector('.race-bar').style.width = `${Math.max(4, (v / max) * 100)}%`;
      el.querySelector('.race-val').textContent = fmtNum(v);
    });
    for (const [id, el] of rows) {
      if (!seen.has(id)) {
        el.style.opacity = 0;
        el.style.transform = `translateY(${TOP * ROW}px)`;
      }
    }
    $('#rc-time').textContent = fmtDateTime(f.t);
    $('#rc-slider').value = frame;
  };

  const tick = () => {
    if (!playing || !view.isConnected) return;
    if (frame < data.frames.length - 1) {
      frame += 1;
      render();
      timer = setTimeout(tick, Number($('#rc-speed').value));
    } else setPlaying(false);
  };
  const setPlaying = (p) => {
    playing = p;
    $('#rc-play').textContent = p ? '⏸' : '▶';
    clearTimeout(timer);
    if (p) timer = setTimeout(tick, Number($('#rc-speed').value));
  };
  $('#rc-play').addEventListener('click', () => {
    if (!playing && frame >= data.frames.length - 1) frame = 0;
    setPlaying(!playing);
  });
  $('#rc-replay').addEventListener('click', () => {
    frame = 0;
    render();
    setPlaying(true);
  });
  $('#rc-slider').addEventListener('input', (e) => {
    setPlaying(false);
    frame = Number(e.target.value);
    render();
  });

  (async () => {
    data = await api(`/api/race?range=${state.range === '15m' ? '1h' : state.range}&frames=60`);
    if (!view.isConnected) return;
    $('#rc-slider').max = data.frames.length - 1;
    if (!Object.keys(data.frames.at(-1).values).length) {
      $('#rc').innerHTML = `<div class="empty">${t('no_data_hint')}</div>`;
      return;
    }
    if (reducedMotion()) {
      frame = data.frames.length - 1;
      render();
      setPlaying(false);
    } else {
      render();
      setPlaying(true);
    }
  })();
  return { usesRange: true, cleanup: () => clearTimeout(timer) };
}

// =====================================================================
// Ecosystem: technology co-occurrence graph
// =====================================================================
export function ecosystem(view) {
  view.innerHTML = `
    <div class="grid">
      <section class="card span-8"><div class="card-h"><h2>🕸 ${t('eco_title')}</h2><small>${t('eco_hint')}</small></div><div id="eco" class="eco"></div><div class="legend" id="eco-legend"></div></section>
      <section class="card span-4"><div class="card-h"><h2>🤝 ${t('eco_pairs')}</h2></div><ul class="trend-list" id="eco-pairs"></ul></section>
    </div>`;
  let raf;
  let graph;

  const build = () => {
    const el = $('#eco');
    const W = Math.max(320, el.clientWidth);
    const H = Math.min(620, Math.max(380, W * 0.68));
    const maxC = Math.max(...graph.nodes.map((n) => n.count), 1);
    const maxW = Math.max(...graph.edges.map((e) => e.weight), 1);
    const nodes = graph.nodes.map((n, i) => ({
      ...n,
      r: 6 + Math.sqrt(n.count / maxC) * 22,
      x: W / 2 + Math.cos(i * 2.4) * (40 + i * 6),
      y: H / 2 + Math.sin(i * 2.4) * (40 + i * 6),
      vx: 0,
      vy: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges.map((e) => ({ ...e, s: byId.get(e.a), t: byId.get(e.b) }));
    const svgEdges = edges.map((e) => `<line class="eco-edge" data-a="${e.a}" data-b="${e.b}" stroke-width="${1 + (e.weight / maxW) * 6}" />`).join('');
    const svgNodes = nodes
      .map((n) => `<g class="eco-node" data-id="${n.id}" tabindex="0"><circle r="${n.r}" fill="${techColor(n.id)}"/><text dy="${n.r + 13}" text-anchor="middle">${esc(techLabel(n.id))}</text></g>`)
      .join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${t('eco_title')}"><g>${svgEdges}</g><g>${svgNodes}</g></svg>`;
    const lineEls = [...el.querySelectorAll('.eco-edge')];
    const nodeEls = [...el.querySelectorAll('.eco-node')];

    let alpha = 1;
    const step = (animate = true) => {
      // repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const d2 = Math.max(dx * dx + dy * dy, 30);
          const f = (7000 * alpha) / d2;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx -= dx * f;
          a.vy -= dy * f;
          b.vx += dx * f;
          b.vy += dy * f;
        }
      }
      // springs
      for (const e of edges) {
        const dx = e.t.x - e.s.x;
        const dy = e.t.y - e.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = 90 + e.s.r + e.t.r;
        const f = ((d - target) / d) * 0.02 * alpha * (0.5 + e.weight / maxW);
        e.s.vx += dx * f;
        e.s.vy += dy * f;
        e.t.vx -= dx * f;
        e.t.vy -= dy * f;
      }
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.003 * alpha;
        n.vy += (H / 2 - n.y) * 0.003 * alpha;
        n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x + (n.vx *= 0.82)));
        n.y = Math.max(n.r + 4, Math.min(H - n.r - 18, n.y + (n.vy *= 0.82)));
      }
      lineEls.forEach((l, k) => {
        const e = edges[k];
        l.setAttribute('x1', e.s.x);
        l.setAttribute('y1', e.s.y);
        l.setAttribute('x2', e.t.x);
        l.setAttribute('y2', e.t.y);
      });
      nodeEls.forEach((g, k) => g.setAttribute('transform', `translate(${nodes[k].x},${nodes[k].y})`));
      alpha *= 0.985;
      if (animate && alpha > 0.02) raf = requestAnimationFrame(() => step());
    };
    if (reducedMotion()) for (let i = 0; i < 300; i++) step(false);
    else step();

    const neighbors = (id) => new Set(edges.filter((e) => e.a === id || e.b === id).flatMap((e) => [e.a, e.b]));
    nodeEls.forEach((g) => {
      const id = g.dataset.id;
      g.addEventListener('pointerenter', (ev) => {
        const nb = neighbors(id);
        el.classList.add('focus');
        nodeEls.forEach((x) => x.classList.toggle('on', nb.has(x.dataset.id) || x.dataset.id === id));
        lineEls.forEach((l) => l.classList.toggle('on', l.dataset.a === id || l.dataset.b === id));
        const n = byId.get(id);
        const top = edges.filter((e) => e.a === id || e.b === id).sort((a, b) => b.weight - a.weight).slice(0, 4);
        showTip(
          `<div class="tip-title">${esc(techLabel(id))} · ${fmtNum(n.count)}</div>${top.map((e) => `<div class="tip-row">+ ${esc(techLabel(e.a === id ? e.b : e.a))}<b>${e.weight}</b></div>`).join('')}`,
          ev.clientX,
          ev.clientY,
        );
      });
      g.addEventListener('pointerleave', () => {
        el.classList.remove('focus');
        nodeEls.forEach((x) => x.classList.remove('on'));
        lineEls.forEach((l) => l.classList.remove('on'));
        hideTip();
      });
      g.addEventListener('click', () => (location.hash = `#/feed?kw=${id}`));
    });
  };

  (async () => {
    graph = await api(`/api/ecosystem?range=${state.range}`);
    if (!view.isConnected) return;
    if (!graph.edges.length) {
      $('#eco').innerHTML = `<div class="empty">${t('no_data_hint')}</div>`;
      return;
    }
    const usedCats = [...new Set(graph.nodes.map((n) => state.techById.get(n.id)?.category))];
    $('#eco-legend').innerHTML = usedCats.map((c) => `<span><span class="sw" style="background:${catColor(c)}"></span>${esc(catLabel(c))}</span>`).join('');
    $('#eco-pairs').innerHTML = graph.edges
      .slice(0, 12)
      .map((e) => `<li><span class="chips grow">${techTag(e.a)}<small>+</small>${techTag(e.b)}</span><b>${e.weight}</b></li>`)
      .join('');
    build();
  })();
  const stop = onResize($('#eco'), () => {
    cancelAnimationFrame(raf);
    if (graph?.edges.length) build();
  });
  return {
    usesRange: true,
    cleanup() {
      cancelAnimationFrame(raf);
      stop();
    },
  };
}
