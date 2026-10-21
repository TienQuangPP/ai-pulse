// Minimal dependency-free SVG/HTML charts with hover tooltips.
const NS = 'http://www.w3.org/2000/svg';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtNum = (n) => (n >= 10_000 ? (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + 'k' : Math.round(n).toLocaleString());

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}
export function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  const r = t.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}
export function hideTip() {
  if (tip) tip.style.display = 'none';
}

function niceMax(v) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * Line / area chart.
 * opts: { x: number[] (ms), series: [{ name, color, values, area? }], fmtX, fmtY, height }
 */
export function lineChart(el, opts) {
  const { x, series, fmtX = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fmtY = fmtNum, height = 240 } = opts;
  el.innerHTML = '';
  el.classList.add('chart');
  const width = Math.max(el.clientWidth, 280);
  const m = { t: 12, r: 16, b: 26, l: 40 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = x.length;
  const sx = (i) => m.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const sy = (v) => m.t + h - (v / max) * h;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label || series.map((s) => s.name).join(', '));

  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = sy(v);
    g += `<line class="grid" x1="${m.l}" x2="${m.l + w}" y1="${y}" y2="${y}"/>`;
    g += `<text class="axis" x="${m.l - 8}" y="${y + 4}" text-anchor="end">${fmtY(v)}</text>`;
  }
  const ticks = Math.min(6, n);
  for (let k = 0; k < ticks; k++) {
    const i = Math.round((k / Math.max(1, ticks - 1)) * (n - 1));
    if (x[i] == null) continue;
    g += `<text class="axis" x="${sx(i)}" y="${height - 6}" text-anchor="${k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle'}">${esc(fmtX(x[i]))}</text>`;
  }
  for (const s of series) {
    const pts = s.values.map((v, i) => `${sx(i)},${sy(v)}`);
    if (!pts.length) continue;
    if (s.area) g += `<path d="M${sx(0)},${sy(0)} L${pts.join(' L')} L${sx(n - 1)},${sy(0)} Z" fill="${s.color}" opacity="0.14"/>`;
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  g += `<line class="crosshair" y1="${m.t}" y2="${m.t + h}" style="display:none"/>`;
  g += series.map((s, i) => `<circle class="dot" data-i="${i}" r="4.5" fill="${s.color}" style="display:none"/>`).join('');
  g += `<rect class="hit" x="${m.l}" y="${m.t}" width="${w}" height="${h}" fill="transparent"/>`;
  svg.innerHTML = g;
  el.appendChild(svg);

  const hit = svg.querySelector('.hit');
  const cross = svg.querySelector('.crosshair');
  const dots = svg.querySelectorAll('.dot');
  hit.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / w) * (n - 1))));
    cross.setAttribute('x1', sx(i));
    cross.setAttribute('x2', sx(i));
    cross.style.display = '';
    dots.forEach((d, k) => {
      d.setAttribute('cx', sx(i));
      d.setAttribute('cy', sy(series[k].values[i] || 0));
      d.style.display = '';
    });
    const rows = series
      .map((s) => `<div class="tip-row"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}<b>${fmtNum(s.values[i] || 0)}</b></div>`)
      .join('');
    showTip(`<div class="tip-title">${esc(opts.fmtTip ? opts.fmtTip(x[i]) : fmtX(x[i]))}</div>${rows}`, ev.clientX, ev.clientY);
  });
  hit.addEventListener('pointerleave', () => {
    cross.style.display = 'none';
    dots.forEach((d) => (d.style.display = 'none'));
    hideTip();
  });
}

/**
 * Horizontal bar list (HTML). items: [{ label, value, color, sub, href, onClick }]
 */
export function barList(el, items, { max, fmt = fmtNum, empty = '—' } = {}) {
  if (!items.length) {
    el.innerHTML = `<div class="empty">${esc(empty)}</div>`;
    return;
  }
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  el.innerHTML = `<ul class="bars">${items
    .map(
      (it, k) => `<li class="bar-row${it.onClick ? ' clickable' : ''}" data-k="${k}" tabindex="${it.onClick ? 0 : -1}">
        <span class="bar-label">${it.icon || ''}${esc(it.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max(1.5, (it.value / top) * 100)}%;background:${it.color || 'var(--series-1)'}"></span></span>
        <span class="bar-value">${fmt(it.value)}${it.sub ? `<small>${it.sub}</small>` : ''}</span>
      </li>`,
    )
    .join('')}</ul>`;
  el.querySelectorAll('.bar-row').forEach((row) => {
    const it = items[row.dataset.k];
    row.addEventListener('pointermove', (ev) => showTip(`<div class="tip-title">${esc(it.label)}</div><div class="tip-row">${esc(it.tip || fmt(it.value))}</div>`, ev.clientX, ev.clientY));
    row.addEventListener('pointerleave', hideTip);
    if (it.onClick) {
      row.addEventListener('click', it.onClick);
      row.addEventListener('keydown', (e) => e.key === 'Enter' && it.onClick());
    }
  });
}

/** Heatmap (7 x 24). matrix[day][hour] */
export function heatmap(el, matrix, { days, fmtTip }) {
  const max = Math.max(1, ...matrix.flat());
  const steps = 7;
  let html = '<div class="heatmap"><span></span>';
  for (let hr = 0; hr < 24; hr++) html += `<span class="hm-h">${hr % 3 === 0 ? hr : ''}</span>`;
  // Monday-first ordering
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    html += `<span class="hm-d">${esc(days[d])}</span>`;
    for (let hr = 0; hr < 24; hr++) {
      const v = matrix[d][hr];
      const lvl = v === 0 ? 0 : Math.max(1, Math.ceil((v / max) * steps));
      html += `<span class="hm-c" data-l="${lvl}" data-d="${d}" data-h="${hr}" data-v="${v}"></span>`;
    }
  }
  html += '</div>';
  el.innerHTML = html;
  el.querySelectorAll('.hm-c').forEach((c) => {
    c.addEventListener('pointermove', (ev) => showTip(fmtTip(Number(c.dataset.d), Number(c.dataset.h), Number(c.dataset.v)), ev.clientX, ev.clientY));
    c.addEventListener('pointerleave', hideTip);
  });
}

/** Inline sparkline SVG string. */
export function sparkline(values, { color = 'var(--series-1)', w = 96, h = 24 } = {}) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => `${(i / Math.max(1, n - 1)) * (w - 4) + 2},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/** Circular score gauge (0-100) as SVG string. */
export function gauge(score, label) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return `<svg class="gauge" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${esc(label)} ${score}/100">
    <circle cx="64" cy="64" r="${r}" class="gauge-track"/>
    <circle cx="64" cy="64" r="${r}" class="gauge-fill" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 64 64)"/>
    <text x="64" y="64" text-anchor="middle" dominant-baseline="central" class="gauge-num">${score}</text>
    <text x="64" y="88" text-anchor="middle" class="gauge-sub">/100</text>
  </svg>`;
}

/** Re-render on container resize. */
export function onResize(el, fn) {
  let last = el.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - last) > 8) {
      last = el.clientWidth;
      fn();
    }
  });
  ro.observe(el);
  return () => ro.disconnect();
}
