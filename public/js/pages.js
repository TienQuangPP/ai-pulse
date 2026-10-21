// Page renderers. Each returns { cleanup?, onEvents?, onTick?, usesRange? }.
import { t, getLang, setLang } from './i18n.js';
import { lineChart, barList, heatmap, sparkline, gauge, onResize, showTip, hideTip } from './charts.js';
import {
  state, api, $, $$, esc, fmtNum, fmtPct, timeAgo, fmtTime, fmtDateTime, fmtAxis, deltaHtml, catColor, catLabel, techColor, techLabel, techTag,
  eventItem, wireCommon, starBtn, openRepo, toast, ownerAvatar, avatarUrl, highlight, loadTaxonomy, rangeLabel, toggleWatch, emit,
} from './core.js';

const tz = () => new Date().getTimezoneOffset();
const throttle = (fn, ms) => {
  let last = 0;
  let timer;
  return () => {
    if (!document.contains(fn.view)) return;
    const wait = ms - (Date.now() - last);
    clearTimeout(timer);
    if (wait <= 0) {
      last = Date.now();
      fn();
    } else timer = setTimeout(() => {
      last = Date.now();
      fn();
    }, wait);
  };
};

// =====================================================================
// Overview
// =====================================================================
export function overview(view) {
  view.innerHTML = `
    <div class="kpis" id="kpis"></div>
    <div class="grid">
      <section class="card span-8"><div class="card-h"><h2>${t('timeline')}</h2><div class="legend" id="tl-legend"></div></div><div id="tl"></div></section>
      <section class="card span-4"><div class="card-h"><h2>${t('categories')}</h2></div><div id="cats"></div></section>
      <section class="card span-5"><div class="card-h"><h2>${t('top_tech')}</h2><a href="#/tech">${t('see_all')}</a></div><div id="tech"></div></section>
      <section class="card span-3"><div class="card-h"><h2>${t('trending')}</h2></div><ul class="trend-list" id="trend"></ul></section>
      <section class="card span-4"><div class="card-h"><h2>${t('latest')}</h2><a href="#/feed">${t('see_all')}</a></div><ul class="feed compact" id="latest"></ul></section>
      <section class="card span-6"><div class="card-h"><h2>${t('top_repos')}</h2><a href="#/repos">${t('see_all')}</a></div><div id="repos"></div></section>
      <section class="card span-6"><div class="card-h"><h2>${t('heatmap')}</h2><small id="hm-note"></small></div><div id="hm"></div></section>
      <section class="card span-6"><div class="card-h"><h2>${t('event_types')}</h2></div><div id="types"></div></section>
      <section class="card span-6"><div class="card-h"><h2>${t('top_devs')}</h2><a href="#/devs">${t('see_all')}</a></div><div id="devs"></div></section>
    </div>`;
  wireCommon(view);
  let data;

  const drawTimeline = () => {
    if (!data) return;
    const series = [
      { name: t('series_total'), color: 'var(--series-0)', values: data.timeline.map((p) => p.total) },
      { name: t('series_ai'), color: 'var(--series-1)', values: data.timeline.map((p) => p.ai), area: true },
    ];
    $('#tl-legend').innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
    lineChart($('#tl'), { x: data.timeline.map((p) => p.t), series, fmtX: fmtAxis(data.bucket), fmtTip: fmtDateTime, height: 260 });
  };

  async function load() {
    data = await api(`/api/summary?range=${state.range}&tz=${tz()}`);
    if (!view.isConnected) return;
    state.lastSummary = data;
    const k = data.kpis;
    const kpi = (lbl, val, sub, title = '') => `<div class="card kpi" title="${esc(title)}"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
    $('#kpis').innerHTML = [
      kpi(t('kpi_ai'), fmtNum(k.aiEvents), k.compareAvailable ? `${deltaHtml(k.aiEvents, k.aiEventsPrev)} ${t('vs_prev')}` : t('no_compare')),
      kpi(t('kpi_share'), fmtPct(k.aiRatio), `${t('of_all')} ${fmtNum(k.totalEvents)} ${t('events')}`),
      kpi(t('kpi_rate'), k.perMinute.toFixed(1), t('last5')),
      kpi(t('kpi_repos'), fmtNum(k.uniqueRepos), rangeLabel()),
      kpi(t('kpi_devs'), fmtNum(k.uniqueActors), rangeLabel()),
      kpi(t('kpi_top'), k.topKeyword ? esc(k.topKeyword.label) : '—', k.topKeyword ? `${fmtNum(k.topKeyword.count)} ${t('events')}` : '', k.topKeyword?.label),
    ].join('');

    drawTimeline();
    barList(
      $('#cats'),
      data.categories.filter((c) => c.count).sort((a, b) => b.count - a.count).map((c) => ({
        label: c.label[getLang()] || c.label.en,
        value: c.count,
        color: catColor(c.id),
        sub: k.aiEvents ? fmtPct(c.count / k.aiEvents, 0) : '',
        onClick: () => (location.hash = `#/tech?cat=${c.id}`),
      })),
      { empty: t('empty') },
    );
    barList(
      $('#tech'),
      data.keywords.slice(0, 10).map((x) => ({ label: x.label, value: x.count, color: catColor(x.category), tip: `${catLabel(x.category)} · ${fmtNum(x.count)} ${t('events')}`, onClick: () => (location.hash = `#/feed?kw=${x.id}`) })),
      { empty: t('empty') },
    );
    $('#trend').innerHTML = data.trending.length
      ? data.trending
          .map(
            (x) => `<li><span class="sw" style="background:${catColor(x.category)}"></span><a class="grow" href="#/feed?kw=${x.id}">${esc(x.label)}</a>
              <small>${fmtNum(x.count)}</small>${deltaHtml(x.count, x.prev)}</li>`,
          )
          .join('')
      : `<li class="empty">${t('empty')}</li>`;
    barList(
      $('#repos'),
      data.topRepos.map((r) => ({ label: r.repo, value: r.count, color: 'var(--series-1)', icon: `${starBtn(r.repo)} `, onClick: () => openRepo(r.repo) })),
      { empty: t('empty') },
    );
    barList($('#types'), data.types.map((x) => ({ label: x.type.replace('Event', ''), value: x.count, color: 'var(--series-1)', sub: k.aiEvents ? fmtPct(x.count / k.aiEvents, 0) : '' })), { empty: t('empty') });
    barList(
      $('#devs'),
      data.topActors.map((a) => ({ label: '@' + a.actor, value: a.count, color: 'var(--series-1)', onClick: () => (location.hash = `#/feed?actor=${encodeURIComponent(a.actor)}`) })),
      { empty: t('empty') },
    );
    const days = t('days');
    heatmap($('#hm'), data.heatmap, { days, fmtTip: (d, h, v) => `<div class="tip-title">${days[d]} · ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59</div><div class="tip-row">${t('series_ai')}<b>${fmtNum(v)}</b></div>` });
    $('#hm-note').textContent = t('r_7d');
    if (!k.storedEvents) $('#kpis').insertAdjacentHTML('afterend', `<div class="card empty" style="margin-bottom:16px">${t('no_data_hint')}</div>`);
  }

  async function loadLatest() {
    const ev = await api('/api/events?limit=8');
    if (!view.isConnected) return;
    $('#latest').innerHTML = ev.length ? ev.map((e) => eventItem(e, { compact: true })).join('') : `<li class="empty">${t('empty')}</li>`;
  }

  load();
  loadLatest();
  load.view = view;
  const refresh = throttle(load, 5000);
  const stopResize = onResize($('#tl'), drawTimeline);
  return {
    usesRange: true,
    cleanup: stopResize,
    onEvents(events) {
      const list = $('#latest');
      if (!list) return;
      list.querySelector('.empty')?.remove();
      list.insertAdjacentHTML('afterbegin', events.slice(-5).reverse().map((e) => eventItem(e, { compact: true, fresh: true })).join(''));
      while (list.children.length > 8) list.lastElementChild.remove();
    },
    onTick: refresh,
  };
}

// =====================================================================
// Live feed
// =====================================================================
export function feed(view, params) {
  const f = { q: params.q || '', category: params.category || '', type: params.type || '', kw: params.kw || '', actor: params.actor || '', repo: params.repo || '', watched: false };
  let paused = false;
  let pending = [];
  let items = [];
  const types = ['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'IssueCommentEvent', 'CreateEvent', 'WatchEvent', 'ForkEvent', 'ReleaseEvent'];

  view.innerHTML = `
    <div class="toolbar">
      <input type="search" class="grow" id="f-q" placeholder="${t('feed_search')}" value="${esc(f.q)}"/>
      <select id="f-type"><option value="">${t('all_types')}</option>${types.map((x) => `<option ${x === f.type ? 'selected' : ''} value="${x}">${x.replace('Event', '')}</option>`).join('')}</select>
      <label class="switch"><input type="checkbox" id="f-watch"/> ${t('watched_only')}</label>
      <button class="btn" id="f-pause">⏸ ${t('feed_pause')}</button>
    </div>
    <div class="toolbar" id="f-cats"></div>
    <div id="f-active" class="toolbar"></div>
    <button class="btn primary new-pill" id="f-new" hidden></button>
    <section class="card"><ul class="feed" id="f-list"></ul><div style="text-align:center"><button class="btn" id="f-more" hidden>${t('load_more')}</button></div></section>`;
  wireCommon(view);

  const renderCats = () => {
    $('#f-cats').innerHTML =
      `<button class="tag ${!f.category ? 'on' : ''}" data-cat="">${t('all_categories')}</button>` +
      state.taxonomy.categories.map((c) => `<button class="tag ${f.category === c.id ? 'on' : ''}" data-cat="${c.id}"><span class="sw" style="background:${catColor(c.id)}"></span>${esc(c.label[getLang()] || c.label.en)}</button>`).join('');
    const active = [];
    if (f.kw) active.push(['kw', techLabel(f.kw)]);
    if (f.actor) active.push(['actor', '@' + f.actor]);
    if (f.repo) active.push(['repo', f.repo]);
    $('#f-active').innerHTML = active.map(([k, v]) => `<button class="tag on" data-clear="${k}">${esc(v)} ✕</button>`).join('');
  };

  const matches = (e) =>
    (!f.category || e.categories.includes(f.category)) &&
    (!f.type || e.type === f.type) &&
    (!f.kw || e.keywords.includes(f.kw)) &&
    (!f.actor || e.actor === f.actor) &&
    (!f.repo || e.repo === f.repo) &&
    (!f.watched || state.watch.has(e.repo)) &&
    (!f.q || (e.repo + ' ' + e.actor + ' ' + e.text).toLowerCase().includes(f.q.toLowerCase()));

  const qs = () => new URLSearchParams(Object.entries({ q: f.q, category: f.category, type: f.type, kw: f.kw, actor: f.actor, repo: f.repo }).filter(([, v]) => v)).toString();

  async function load(append = false) {
    const before = append && items.length ? `&before=${items.at(-1).createdAt}` : '';
    let ev = await api(`/api/events?limit=100&${qs()}${before}`);
    if (!view.isConnected) return;
    if (f.watched) ev = ev.filter((e) => state.watch.has(e.repo));
    items = append ? items.concat(ev) : ev;
    const list = $('#f-list');
    const html = ev.map((e) => eventItem(e)).join('');
    if (append) list.insertAdjacentHTML('beforeend', html);
    else list.innerHTML = html || `<li class="empty" style="display:block">${t('empty')}</li>`;
    $('#f-more').hidden = ev.length < 100;
  }

  const setPaused = (p) => {
    paused = p;
    $('#f-pause').innerHTML = paused ? `▶ ${t('feed_resume')}` : `⏸ ${t('feed_pause')}`;
    if (!paused && pending.length) flush();
  };
  const flush = () => {
    const list = $('#f-list');
    list.querySelector('.empty')?.remove();
    list.insertAdjacentHTML('afterbegin', pending.slice().reverse().map((e) => eventItem(e, { fresh: true })).join(''));
    items = pending.concat(items);
    pending = [];
    $('#f-new').hidden = true;
    while (list.children.length > 400) list.lastElementChild.remove();
  };

  let debounce;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      f.q = e.target.value.trim();
      load();
    }, 250);
  });
  $('#f-type').addEventListener('change', (e) => {
    f.type = e.target.value;
    load();
  });
  $('#f-watch').addEventListener('change', (e) => {
    f.watched = e.target.checked;
    load();
  });
  $('#f-pause').addEventListener('click', () => setPaused(!paused));
  $('#f-more').addEventListener('click', () => load(true));
  $('#f-new').addEventListener('click', () => setPaused(false));
  view.addEventListener('click', (ev) => {
    const cat = ev.target.closest('[data-cat]');
    if (cat) {
      f.category = cat.dataset.cat;
      renderCats();
      load();
    }
    const clr = ev.target.closest('[data-clear]');
    if (clr) {
      f[clr.dataset.clear] = '';
      renderCats();
      load();
    }
  });

  renderCats();
  load();
  return {
    togglePause: () => setPaused(!paused),
    onEvents(events) {
      const fresh = events.filter(matches);
      if (!fresh.length) return;
      pending = pending.concat(fresh);
      if (paused) {
        const n = $('#f-new');
        n.hidden = false;
        n.textContent = `↑ ${pending.length} ${t('new_events')}`;
      } else flush();
    },
  };
}

// =====================================================================
// Technologies
// =====================================================================
export function tech(view, params) {
  let cat = params.cat || '';
  const slots = new Map(); // id -> series slot (color follows the entity)
  let rows = [];
  view.innerHTML = `
    <section class="card" style="margin-bottom:16px">
      <div class="card-h"><h2>${t('tech_compare')}</h2><div class="legend" id="cmp-legend"></div></div>
      <div id="cmp"></div><p class="help">${t('tech_compare_hint')}</p>
    </section>
    <div class="toolbar" id="t-cats"></div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th></th><th>${t('technology')}</th><th>${t('category')}</th><th class="num">${t('count')}</th><th class="num">${t('growth')}</th><th>${t('trend')}</th></tr></thead>
      <tbody id="t-body"></tbody></table></div></section>`;

  let trend;
  const drawCompare = async () => {
    const ids = [...slots.keys()];
    if (!ids.length) {
      $('#cmp').innerHTML = `<div class="empty">${t('tech_compare_hint')}</div>`;
      $('#cmp-legend').innerHTML = '';
      return;
    }
    trend = await api(`/api/trend?range=${state.range}&ids=${ids.join(',')}`);
    if (!view.isConnected) return;
    const series = ids.map((id) => ({ name: techLabel(id), color: `var(--series-${slots.get(id)})`, values: trend.series[id] }));
    $('#cmp-legend').innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
    lineChart($('#cmp'), { x: trend.points, series, fmtX: fmtAxis(trend.bucket), fmtTip: fmtDateTime, height: 260 });
  };

  const renderTable = (sparks) => {
    $('#t-cats').innerHTML =
      `<button class="tag ${!cat ? 'on' : ''}" data-cat="">${t('all_categories')}</button>` +
      state.taxonomy.categories.map((c) => `<button class="tag ${cat === c.id ? 'on' : ''}" data-cat="${c.id}"><span class="sw" style="background:${catColor(c.id)}"></span>${esc(c.label[getLang()] || c.label.en)}</button>`).join('');
    const list = rows.filter((r) => !cat || r.category === cat);
    $('#t-body').innerHTML = list
      .map(
        (r) => `<tr>
        <td><input type="checkbox" data-cmp="${r.id}" ${slots.has(r.id) ? 'checked' : ''} aria-label="compare ${esc(r.label)}"/></td>
        <td><a href="#/feed?kw=${r.id}"><span class="sw" style="background:${catColor(r.category)}"></span> <b style="color:var(--text-primary)">${esc(r.label)}</b></a>${r.custom ? ' <span class="tag">custom</span>' : ''}</td>
        <td><span class="tag">${esc(catLabel(r.category))}</span></td>
        <td class="num">${fmtNum(r.count)}</td>
        <td class="num">${r.count || r.prev ? deltaHtml(r.count, r.prev) : '<small>—</small>'}</td>
        <td>${sparks?.[r.id] ? sparkline(sparks[r.id], { color: catColor(r.category) }) : ''}</td>
      </tr>`,
      )
      .join('');
  };

  async function load() {
    const s = await api(`/api/summary?range=${state.range}&tz=${tz()}`);
    if (!view.isConnected) return;
    const counts = new Map(s.keywords.map((k) => [k.id, k]));
    rows = state.taxonomy.technologies
      .map((x) => ({ ...x, count: counts.get(x.id)?.count || 0, prev: s.kpis.compareAvailable ? counts.get(x.id)?.prev || 0 : null }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    if (!slots.size) rows.slice(0, 4).filter((r) => r.count).forEach((r, i) => slots.set(r.id, i + 1));
    renderTable();
    drawCompare();
    const top = rows.filter((r) => r.count).map((r) => r.id);
    if (top.length) {
      const tr = await api(`/api/trend?range=${state.range}&ids=${top.join(',')}`);
      // compress to ~24 points per sparkline
      const sparks = {};
      for (const [id, vals] of Object.entries(tr.series)) {
        const step = Math.max(1, Math.ceil(vals.length / 24));
        sparks[id] = [];
        for (let i = 0; i < vals.length; i += step) sparks[id].push(vals.slice(i, i + step).reduce((a, b) => a + b, 0));
      }
      renderTable(sparks);
    }
  }

  view.addEventListener('change', (ev) => {
    const id = ev.target.dataset.cmp;
    if (!id) return;
    if (ev.target.checked) {
      if (slots.size >= 6) {
        ev.target.checked = false;
        return toast(t('tech_compare_hint'));
      }
      const used = new Set(slots.values());
      slots.set(id, [1, 2, 3, 4, 5, 6].find((n) => !used.has(n)));
    } else slots.delete(id);
    drawCompare();
  });
  view.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-cat]');
    if (c) {
      cat = c.dataset.cat;
      renderTable();
    }
  });
  load();
  const stop = onResize($('#cmp'), drawCompare);
  return { usesRange: true, cleanup: stop };
}

// =====================================================================
// Repositories
// =====================================================================
export function repos(view, params) {
  const f = { q: params.q || '', sort: params.sort || 'count', kw: params.kw || '' };
  view.innerHTML = `
    <div class="toolbar">
      <input type="search" class="grow" id="r-q" placeholder="${t('repo_search')}" value="${esc(f.q)}"/>
      <select id="r-kw"><option value="">${t('all')} ${t('techs').toLowerCase()}</option>${state.taxonomy.technologies.map((x) => `<option value="${x.id}" ${x.id === f.kw ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      <select id="r-sort">${['count', 'recent', 'actors', 'diversity', 'name'].map((s) => `<option value="${s}" ${s === f.sort ? 'selected' : ''}>${t('sort_' + s)}</option>`).join('')}</select>
      <a class="btn" id="r-export" href="#">⤓ CSV</a>
      <small id="r-count"></small>
    </div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th></th><th>${t('repo')}</th><th class="num">${t('events')}</th><th class="num">${t('actors')}</th><th>${t('techs')}</th><th>${t('activity')}</th><th>${t('last_seen')}</th><th></th></tr></thead>
      <tbody id="r-body"></tbody></table></div></section>`;
  wireCommon(view);

  async function load() {
    const qs = new URLSearchParams({ range: state.range, sort: f.sort, q: f.q, kw: f.kw, limit: 300 });
    if (!view.isConnected) return;
    $('#r-export').href = `/api/export?dataset=repos&format=csv&range=${state.range}`;
    const r = await api(`/api/repos?${qs}`);
    if (!view.isConnected) return;
    $('#r-count').textContent = `${fmtNum(r.total)} ${t('results')}`;
    $('#r-body').innerHTML =
      r.items
        .map((x) => {
          const kws = Object.entries(x.keywords).sort((a, b) => b[1] - a[1]);
          return `<tr class="clickable" data-repo="${esc(x.repo)}">
          <td>${starBtn(x.repo)}</td>
          <td><div class="repo-cell"><img class="avatar" loading="lazy" src="${ownerAvatar(x.repo)}" alt=""/><span class="name">${esc(x.repo)}</span></div></td>
          <td class="num">${fmtNum(x.count)}</td>
          <td class="num">${fmtNum(x.actors)}</td>
          <td><div class="chips">${kws.slice(0, 4).map(([k]) => techTag(k)).join('')}${kws.length > 4 ? `<small>+${kws.length - 4}</small>` : ''}</div></td>
          <td>${sparkline(x.spark)}</td>
          <td><small>${timeAgo(x.lastSeen)}</small></td>
          <td><a class="btn sm" href="#/analyzer?repo=${encodeURIComponent(x.repo)}" data-stop>${t('analyze')}</a></td>
        </tr>`;
        })
        .join('') || `<tr><td colspan="8" class="empty">${t('empty')}</td></tr>`;
  }
  let d;
  $('#r-q').addEventListener('input', (e) => {
    clearTimeout(d);
    d = setTimeout(() => {
      f.q = e.target.value.trim();
      load();
    }, 250);
  });
  $('#r-sort').addEventListener('change', (e) => {
    f.sort = e.target.value;
    load();
  });
  $('#r-kw').addEventListener('change', (e) => {
    f.kw = e.target.value;
    load();
  });
  load();
  load.view = view;
  return { usesRange: true, onTick: throttle(load, 15000) };
}

// =====================================================================
// Developers
// =====================================================================
export function devs(view) {
  view.innerHTML = `
    <div class="toolbar"><a class="btn" id="d-export" href="#">⤓ CSV</a></div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>${t('developer')}</th><th class="num">${t('events')}</th><th class="num">${t('repos_n')}</th><th>${t('focus')}</th><th>${t('last_seen')}</th></tr></thead>
      <tbody id="d-body"></tbody></table></div></section>`;
  async function load() {
    if (!view.isConnected) return;
    $('#d-export').href = `/api/export?dataset=developers&format=csv&range=${state.range}`;
    const list = await api(`/api/developers?range=${state.range}&limit=200`);
    if (!view.isConnected) return;
    $('#d-body').innerHTML =
      list
        .map(
          (a, i) => `<tr>
        <td><small>${i + 1}</small></td>
        <td><div class="repo-cell"><img class="avatar" loading="lazy" src="${avatarUrl(a.actor)}" alt=""/>
          <a class="name" href="#/feed?actor=${encodeURIComponent(a.actor)}">@${esc(a.actor)}</a>
          <a href="https://github.com/${esc(a.actor)}" target="_blank" rel="noopener" title="GitHub">↗</a></div></td>
        <td class="num">${fmtNum(a.count)}</td>
        <td class="num">${fmtNum(a.repos)}</td>
        <td><div class="chips">${Object.entries(a.keywords).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => techTag(k)).join('')}</div></td>
        <td><small>${timeAgo(a.lastSeen)}</small></td></tr>`,
        )
        .join('') || `<tr><td colspan="6" class="empty">${t('empty')}</td></tr>`;
  }
  load();
  load.view = view;
  return { usesRange: true, onTick: throttle(load, 20000) };
}

// =====================================================================
// Repo analyzer
// =====================================================================
export function analyzer(view, params) {
  const recent = JSON.parse(localStorage.getItem('aip.analyzed') || '[]');
  const examples = ['langchain-ai/langchain', 'ollama/ollama', 'anthropics/claude-code', 'facebook/react'];
  view.innerHTML = `
    <section class="card" style="margin-bottom:16px">
      <div class="card-h"><h2>${t('an_title')}</h2></div>
      <form class="toolbar" id="an-form">
        <input type="text" class="grow" id="an-in" placeholder="${t('an_ph')}" value="${esc(params.repo || '')}"/>
        <span class="vs">⚔</span>
        <input type="text" class="grow" id="an-vs" placeholder="${t('an_vs_ph')}" value="${esc(params.vs || '')}"/>
        <button class="btn primary" type="submit">${t('an_run')}</button>
      </form>
      <div class="toolbar"><small>${t('an_examples')}:</small>${examples.map((x) => `<button class="tag" data-ex="${x}">${x}</button>`).join('')}
        <button class="tag" data-ex="langchain-ai/langchain" data-vs="run-llama/llama_index">⚔ LangChain vs LlamaIndex</button>
        <button class="tag" data-ex="ollama/ollama" data-vs="vllm-project/vllm">⚔ Ollama vs vLLM</button></div>
      ${recent.length ? `<div class="toolbar"><small>${t('an_recent')}:</small>${recent.map((x) => `<button class="tag" data-ex="${esc(x.repo)}">${esc(x.repo)} · ${x.score}</button>`).join('')}</div>` : ''}
    </section>
    <div id="an-out"></div>`;
  wireCommon(view);

  async function run(repo, vs) {
    if (!repo) return;
    $('#an-in').value = repo;
    $('#an-vs').value = vs || '';
    if (vs) return compareRepos(repo, vs, $('#an-out'));
    history.replaceState(null, '', `#/analyzer?repo=${encodeURIComponent(repo)}`);
    const out = $('#an-out');
    out.innerHTML = `<div class="card empty">${t('loading')}</div>`;
    try {
      const r = await api(`/api/analyze?repo=${encodeURIComponent(repo)}`);
      const rec = [{ repo: r.repo, score: r.score }, ...recent.filter((x) => x.repo !== r.repo)].slice(0, 8);
      localStorage.setItem('aip.analyzed', JSON.stringify(rec));
      const groups = {};
      r.stack.forEach((s) => (groups[s.category] ||= []).push(s));
      const langColors = (i) => `var(--series-${(i % 8) + 1})`;
      out.innerHTML = `
        <div class="grid">
          <section class="card span-12"><div class="an-hero">
            ${gauge(r.score, t('an_score'))}
            <div class="meta">
              <div class="toolbar" style="margin:0 0 6px"><img class="avatar" src="${esc(r.owner.avatar || '')}" alt=""/><h2 style="font-size:20px"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)}</a></h2>
                <span class="tag ${r.score >= 25 ? 'live' : ''}">${t('v_' + r.verdict.replace('-', '_'))}</span>${starBtn(r.repo)}${r.cached ? `<small>${t('cached')}</small>` : ''}</div>
              <div style="color:var(--text-secondary)">${esc(r.description || '')}</div>
              <div class="stats">
                <div><b>${fmtNum(r.stars)}</b><span>★ ${t('stars')}</span></div>
                <div><b>${fmtNum(r.forks)}</b><span>${t('forks')}</span></div>
                <div><b>${fmtNum(r.openIssues)}</b><span>${t('issues')}</span></div>
                <div><b>${esc(r.license || '—')}</b><span>${t('license')}</span></div>
                <div><b>${timeAgo(Date.parse(r.pushedAt))}</b><span>${t('pushed')}</span></div>
              </div>
            </div></div></section>
          <section class="card span-7"><div class="card-h"><h2>${t('an_stack')}</h2><small>${r.stack.length}</small></div>
            ${
              r.stack.length
                ? Object.entries(groups)
                    .map(
                      ([cat, list]) => `<div style="margin-bottom:12px"><div class="help" style="margin:0 0 6px">${esc(catLabel(cat))}</div><div class="chips">${list
                        .map((s) => `<span class="tag" title="${s.sources.map((x) => t('src_' + x)).join(', ')}"><span class="sw" style="background:${catColor(cat)}"></span>${esc(s.label)} <small>${s.sources.map((x) => t('src_' + x)).join(' · ')}</small></span>`)
                        .join('')}</div></div>`,
                    )
                    .join('')
                : `<div class="empty">${t('pg_none')}</div>`
            }
            <div class="help">${t('an_deps')}: ${r.depFiles.length ? r.depFiles.map((x) => `<code>${esc(x)}</code>`).join(', ') : '—'}</div>
            ${r.breakdown ? `<div class="help">${t('an_breakdown')}: ${Object.entries(r.breakdown).map(([k, v]) => `${t('src_' + k)} <b>${v}</b>`).join(' · ')}</div>` : ''}
          </section>
          <section class="card span-5"><div class="card-h"><h2>${t('an_langs')}</h2></div>
            <div class="langbar">${r.languages.map((l, i) => `<span style="width:${l.share * 100}%;background:${langColors(i)}" title="${esc(l.name)} ${fmtPct(l.share)}"></span>`).join('')}</div>
            <div class="legend">${r.languages.map((l, i) => `<span><span class="sw" style="background:${langColors(i)}"></span>${esc(l.name)} ${fmtPct(l.share)}</span>`).join('')}</div>
            <div class="card-h" style="margin-top:16px"><h2>${t('an_topics')}</h2></div>
            <div class="chips">${r.topics.map((x) => `<span class="tag">#${esc(x)}</span>`).join('') || '<small>—</small>'}</div>
          </section>
          <section class="card span-12"><div class="card-h"><h2>${t('an_tracked')}</h2><small>${r.tracked.count}</small></div>
            ${r.tracked.events.length ? `<ul class="feed compact">${r.tracked.events.map((e) => eventItem(e, { compact: true })).join('')}</ul>` : `<div class="empty">${t('empty')}</div>`}
          </section>
        </div>`;
    } catch (err) {
      out.innerHTML = `<div class="card empty" style="color:var(--bad)">${esc(err.message)}</div>`;
    }
  }
  $('#an-form').addEventListener('submit', (e) => {
    e.preventDefault();
    run($('#an-in').value.trim(), $('#an-vs').value.trim());
  });
  view.addEventListener('click', (e) => {
    const ex = e.target.closest('[data-ex]');
    if (ex) run(ex.dataset.ex, ex.dataset.vs);
  });
  if (params.repo) run(params.repo, params.vs);
  else $('#an-in').focus();
  return {};
}

/** Head-to-head comparison of two repositories. */
async function compareRepos(a, b, out) {
  history.replaceState(null, '', `#/analyzer?repo=${encodeURIComponent(a)}&vs=${encodeURIComponent(b)}`);
  out.innerHTML = `<div class="card empty">${t('loading')}</div>`;
  let A;
  let B;
  try {
    [A, B] = await Promise.all([api(`/api/analyze?repo=${encodeURIComponent(a)}`), api(`/api/analyze?repo=${encodeURIComponent(b)}`)]);
  } catch (err) {
    out.innerHTML = `<div class="card empty" style="color:var(--bad)">${esc(err.message)}</div>`;
    return;
  }
  const rows = [
    [t('an_score'), A.score, B.score, (v) => v],
    ['★ ' + t('stars'), A.stars, B.stars, fmtNum],
    [t('forks'), A.forks, B.forks, fmtNum],
    [t('techs'), A.stack.length, B.stack.length, (v) => v],
    [t('pushed'), Date.parse(A.pushedAt), Date.parse(B.pushedAt), (v) => timeAgo(v)],
    [t('an_tracked'), A.tracked.count, B.tracked.count, fmtNum],
  ];
  let winsA = 0;
  let winsB = 0;
  const table = rows
    .map(([label, va, vb, f]) => {
      const wa = va > vb;
      const wb = vb > va;
      winsA += wa;
      winsB += wb;
      return `<tr><td class="num ${wa ? 'win' : ''}">${wa ? '🏆 ' : ''}${f(va)}</td><th class="mid">${label}</th><td class="${wb ? 'win' : ''}">${f(vb)}${wb ? ' 🏆' : ''}</td></tr>`;
    })
    .join('');
  const ids = (r) => new Set(r.stack.map((s) => s.id));
  const sa = ids(A);
  const sb = ids(B);
  const shared = [...sa].filter((x) => sb.has(x));
  const onlyA = [...sa].filter((x) => !sb.has(x));
  const onlyB = [...sb].filter((x) => !sa.has(x));
  const chips = (list) => list.map((k) => techTag(k)).join('') || '<small>—</small>';
  const head = (r) => `<div class="vs-head">${gauge(r.score, t('an_score'))}<div><h2><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)}</a></h2>
    <span class="tag ${r.score >= 25 ? 'live' : ''}">${t('v_' + r.verdict.replace('-', '_'))}</span><p class="help">${esc(r.description || '')}</p></div></div>`;
  const verdict = winsA === winsB ? t('vs_tie') : t('vs_winner', { repo: winsA > winsB ? A.repo : B.repo, n: Math.max(winsA, winsB), m: rows.length });
  out.innerHTML = `
    <div class="grid">
      <section class="card span-6">${head(A)}</section>
      <section class="card span-6">${head(B)}</section>
      <section class="card span-12"><div class="card-h"><h2>⚔ ${t('vs_title')}</h2><span class="tag live">${esc(verdict)}</span></div>
        <table class="vs-table"><tbody>${table}</tbody></table></section>
      <section class="card span-4"><div class="card-h"><h2>${esc(A.repo)}</h2><small>${t('vs_only')}</small></div><div class="chips">${chips(onlyA)}</div></section>
      <section class="card span-4"><div class="card-h"><h2>🤝 ${t('vs_shared')}</h2><small>${shared.length}</small></div><div class="chips">${chips(shared)}</div></section>
      <section class="card span-4"><div class="card-h"><h2>${esc(B.repo)}</h2><small>${t('vs_only')}</small></div><div class="chips">${chips(onlyB)}</div></section>
    </div>`;
}

// =====================================================================
// Detector playground
// =====================================================================
export function playground(view) {
  const sample = 'feat: add RAG pipeline using LangChain + pgvector, served locally by Ollama (llama3). Also expose an MCP server for Claude Desktop.';
  view.innerHTML = `
    <div class="grid">
      <section class="card span-7"><div class="card-h"><h2>${t('pg_title')}</h2></div>
        <textarea id="pg-in" rows="7" placeholder="${t('pg_ph')}">${esc(sample)}</textarea>
        <div class="card-h" style="margin-top:14px"><h2>${t('pg_detected')}</h2><small id="pg-n"></small></div>
        <div class="chips" id="pg-tags" style="margin-bottom:12px"></div>
        <div class="hl" id="pg-hl"></div>
      </section>
      <section class="card span-5"><div class="card-h"><h2>${t('pg_taxonomy')}</h2><small>${state.taxonomy.technologies.length}</small></div><div id="pg-tax"></div></section>
    </div>`;
  const run = async () => {
    const text = $('#pg-in').value;
    const r = await api(`/api/detect?text=${encodeURIComponent(text.slice(0, 4000))}`);
    $('#pg-n').textContent = r.keywords.length;
    $('#pg-tags').innerHTML = r.keywords.map((k) => techTag(k)).join('') || `<small>${t('pg_none')}</small>`;
    $('#pg-hl').innerHTML = highlight(text, r.terms);
  };
  let d;
  $('#pg-in').addEventListener('input', () => {
    clearTimeout(d);
    d = setTimeout(run, 200);
  });
  $('#pg-tax').innerHTML = state.taxonomy.categories
    .map((c) => {
      const list = state.taxonomy.technologies.filter((x) => x.category === c.id);
      return `<div style="margin-bottom:12px"><div class="help" style="margin:0 0 6px"><span class="sw" style="background:${catColor(c.id)}"></span> ${esc(c.label[getLang()] || c.label.en)}</div>
        <div class="chips">${list.map((x) => `<span class="tag" title="${esc(x.patterns.join('  |  '))}">${esc(x.label)}</span>`).join('')}</div></div>`;
    })
    .join('');
  run();
  return {};
}

// =====================================================================
// Alerts
// =====================================================================
export function alerts(view) {
  state.unreadAlerts = 0;
  emit('alerts-read');
  const notifState = () => ('Notification' in window ? Notification.permission : 'unsupported');
  view.innerHTML = `
    <div class="grid">
      <section class="card span-7">
        <div class="card-h"><h2>${t('al_rules')}</h2>
          <button class="btn sm" id="al-notif">${notifState() === 'granted' ? '🔔 ' + t('al_notif_on') : '🔕 ' + t('al_notif')}</button></div>
        <p class="help">${t('al_desc')}</p>
        <form class="form-row" id="al-form">
          <label>${t('al_new')}<select id="al-kind">${['keyword', 'category', 'repo', 'any'].map((k) => `<option value="${k}">${t('kind_' + k)}</option>`).join('')}</select></label>
          <label id="al-val-wrap"></label>
          <label>${t('threshold')}<input type="number" id="al-th" value="10" min="1" style="width:90px"/></label>
          <label>${t('window')}<input type="number" id="al-win" value="10" min="1" max="1440" style="width:90px"/></label>
          <button class="btn primary" type="submit">${t('add')}</button>
        </form>
        <div class="table-wrap"><table><tbody id="al-rules"></tbody></table></div>
      </section>
      <section class="card span-5"><div class="card-h"><h2>${t('al_log')}</h2></div><ul class="trend-list" id="al-log"></ul></section>
    </div>`;

  const valueInput = () => {
    const kind = $('#al-kind').value;
    const w = $('#al-val-wrap');
    if (kind === 'keyword') w.innerHTML = `${t('kind_keyword')}<select id="al-val">${state.taxonomy.technologies.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select>`;
    else if (kind === 'category') w.innerHTML = `${t('kind_category')}<select id="al-val">${state.taxonomy.categories.map((c) => `<option value="${c.id}">${esc(c.label[getLang()] || c.label.en)}</option>`).join('')}</select>`;
    else if (kind === 'repo') w.innerHTML = `${t('kind_repo')}<input type="text" id="al-val" placeholder="owner/repo"/>`;
    else w.innerHTML = '';
  };
  const ruleText = (r) => {
    const target = r.kind === 'keyword' ? techLabel(r.value) : r.kind === 'category' ? catLabel(r.value) : r.kind === 'repo' ? r.value : t('kind_any');
    return `<b>${esc(target)}</b> ≥ ${r.threshold} ${t('events')} / ${r.window}′`;
  };
  async function load() {
    const d = await api('/api/alerts');
    $('#al-rules').innerHTML =
      d.rules
        .map(
          (r) => `<tr><td><label class="switch"><input type="checkbox" data-toggle="${r.id}" ${r.enabled ? 'checked' : ''}/></label></td>
          <td><span class="tag">${t('kind_' + r.kind)}</span></td><td>${ruleText(r)}</td>
          <td class="num"><button class="btn sm danger" data-del="${r.id}">${t('del')}</button></td></tr>`,
        )
        .join('') || `<tr><td class="empty">${t('al_none')}</td></tr>`;
    $('#al-log').innerHTML =
      d.log.map((a) => `<li><span class="sw" style="background:var(--warn)"></span><span class="grow">${ruleText(a.rule)} — ${t('al_fired', { count: a.count, window: a.rule.window })}</span><small>${fmtDateTime(a.at)}</small></li>`).join('') ||
      `<li class="empty">${t('al_none')}</li>`;
    view._rules = d.rules;
  }
  $('#al-kind').addEventListener('change', valueInput);
  $('#al-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/alerts', { method: 'POST', body: { kind: $('#al-kind').value, value: $('#al-val')?.value || '', threshold: $('#al-th').value, window: $('#al-win').value } });
    load();
  });
  view.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      await api(`/api/alerts?id=${del.dataset.del}`, { method: 'DELETE' });
      load();
    }
  });
  view.addEventListener('change', async (e) => {
    const id = e.target.dataset.toggle;
    if (!id) return;
    const rule = view._rules.find((r) => r.id === id);
    await api('/api/alerts', { method: 'POST', body: { ...rule, enabled: e.target.checked } });
  });
  $('#al-notif').addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    await Notification.requestPermission();
    $('#al-notif').textContent = notifState() === 'granted' ? '🔔 ' + t('al_notif_on') : '🔕 ' + t('al_notif');
  });
  valueInput();
  load();
  return { onAlert: load };
}

// =====================================================================
// Watchlist
// =====================================================================
export function watchlist(view) {
  view.innerHTML = `
    <section class="card" style="margin-bottom:16px">
      <div class="card-h"><h2>${t('wl_title')}</h2><small>${state.watch.size}</small></div>
      <p class="help">${t('wl_hint')}</p>
      <form class="toolbar" id="wl-form"><input type="text" class="grow" id="wl-in" placeholder="${t('wl_add')}"/><button class="btn primary">${t('add')}</button></form>
    </section>
    <div class="grid" id="wl-grid"></div>`;
  wireCommon(view);
  async function load() {
    const grid = $('#wl-grid');
    if (!state.watch.size) {
      grid.innerHTML = `<div class="card empty span-12">${t('wl_empty')}</div>`;
      return;
    }
    grid.innerHTML = [...state.watch]
      .map(
        (r) => `<section class="card span-6"><div class="card-h"><img class="avatar" src="${ownerAvatar(r)}" alt=""/><h2><a href="#" data-repo="${esc(r)}">${esc(r)}</a></h2>
        <a class="btn sm" href="#/analyzer?repo=${encodeURIComponent(r)}">${t('analyze')}</a>${starBtn(r)}</div><ul class="feed compact" data-wl="${esc(r)}"><li class="empty">${t('loading')}</li></ul></section>`,
      )
      .join('');
    for (const r of state.watch) {
      const ev = await api(`/api/events?repo=${encodeURIComponent(r)}&limit=5`);
      const ul = view.querySelector(`[data-wl="${CSS.escape(r)}"]`);
      if (ul) ul.innerHTML = ev.map((e) => eventItem(e, { compact: true })).join('') || `<li class="empty">${t('empty')}</li>`;
    }
  }
  $('#wl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#wl-in').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    if (/^[\w.-]+\/[\w.-]+$/.test(v) && !state.watch.has(v)) toggleWatch(v);
    $('#wl-in').value = '';
    load();
  });
  load();
  return { onWatch: load };
}

// =====================================================================
// Report
// =====================================================================
export function report(view) {
  view.innerHTML = `<div class="report" id="rp"><div class="empty">${t('loading')}</div></div>`;
  let s;
  const draw = () => s && lineChart($('#rp-tl'), { x: s.timeline.map((p) => p.t), series: [{ name: t('series_ai'), color: 'var(--series-1)', values: s.timeline.map((p) => p.ai), area: true }], fmtX: fmtAxis(s.bucket), fmtTip: fmtDateTime, height: 220 });
  (async () => {
    s = await api(`/api/summary?range=${state.range}&tz=${tz()}`);
    const k = s.kpis;
    const summary = t('rp_summary', {
      period: rangeLabel().toLowerCase(),
      ai: `<b>${fmtNum(k.aiEvents)}</b>`,
      total: fmtNum(k.totalEvents),
      share: fmtPct(k.aiRatio),
      repos: `<b>${fmtNum(k.uniqueRepos)}</b>`,
      devs: `<b>${fmtNum(k.uniqueActors)}</b>`,
      top: `<b>${esc(k.topKeyword?.label || '—')}</b>`,
    });
    $('#rp').innerHTML = `
      <div class="toolbar no-print"><button class="btn primary" id="rp-print">🖨 ${t('rp_print')}</button>
        <button class="btn" id="rp-copy">📋 ${t('rp_copy')}</button>
        <a class="btn" href="/api/export?dataset=keywords&format=csv&range=${state.range}">⤓ ${t('exp_keywords')} CSV</a>
        <a class="btn" href="/api/export?dataset=events&format=csv&range=${state.range}">⤓ ${t('exp_events')} CSV</a></div>
      <section class="card" style="margin-bottom:16px">
        <div class="toolbar" style="margin:0"><img src="/icon.svg" width="40" height="40" alt=""/><div><h1>${t('rp_title')}</h1>
        <small>${t('rp_period')}: ${rangeLabel()} (${fmtDateTime(s.since)} – ${fmtDateTime(s.until)}) · ${t('rp_generated')}: ${fmtDateTime(Date.now())}${k.demoShare > 0 ? ` · <span class="tag demo">${t('demo')} ${fmtPct(k.demoShare, 0)}</span>` : ''}</small></div></div>
        <p class="lead">${summary}</p>
      </section>
      <div class="kpis">
        ${[[t('kpi_ai'), fmtNum(k.aiEvents)], [t('kpi_share'), fmtPct(k.aiRatio)], [t('kpi_repos'), fmtNum(k.uniqueRepos)], [t('kpi_devs'), fmtNum(k.uniqueActors)], [t('kpi_rate'), k.perMinute.toFixed(1)], [t('kpi_top'), esc(k.topKeyword?.label || '—')]]
          .map(([l, v]) => `<div class="card kpi"><div class="lbl">${l}</div><div class="val">${v}</div></div>`)
          .join('')}
      </div>
      <section class="card" style="margin-bottom:16px"><div class="card-h"><h2>${t('timeline')}</h2></div><div id="rp-tl"></div></section>
      <div class="grid">
        <section class="card span-6"><div class="card-h"><h2>${t('top_tech')}</h2></div>
          <table><thead><tr><th>#</th><th>${t('technology')}</th><th>${t('category')}</th><th class="num">${t('count')}</th><th class="num">${t('growth')}</th></tr></thead><tbody>
          ${s.keywords.slice(0, 15).map((x, i) => `<tr><td>${i + 1}</td><td><span class="sw" style="background:${catColor(x.category)}"></span> ${esc(x.label)}</td><td>${esc(catLabel(x.category))}</td><td class="num">${fmtNum(x.count)}</td><td class="num">${deltaHtml(x.count, x.prev)}</td></tr>`).join('')}
          </tbody></table></section>
        <section class="card span-6"><div class="card-h"><h2>${t('top_repos')}</h2></div>
          <table><thead><tr><th>#</th><th>${t('repo')}</th><th class="num">${t('events')}</th></tr></thead><tbody>
          ${s.topRepos.map((r, i) => `<tr><td>${i + 1}</td><td><a href="https://github.com/${esc(r.repo)}" target="_blank" rel="noopener">${esc(r.repo)}</a></td><td class="num">${fmtNum(r.count)}</td></tr>`).join('')}
          </tbody></table>
          <div class="card-h" style="margin-top:16px"><h2>${t('categories')}</h2></div><div id="rp-cats"></div></section>
      </div>`;
    draw();
    barList($('#rp-cats'), s.categories.filter((c) => c.count).sort((a, b) => b.count - a.count).map((c) => ({ label: c.label[getLang()] || c.label.en, value: c.count, color: catColor(c.id) })), { empty: t('empty') });
    $('#rp-print').addEventListener('click', () => print());
    $('#rp-copy').addEventListener('click', async () => {
      const top = s.keywords.slice(0, 5).map((x, i) => `${i + 1}. ${x.label} — ${x.count}`).join('\n');
      const text = `⚡ AI Pulse · ${t('rp_title')} (${rangeLabel()})\n\n${summary.replace(/<[^>]+>/g, '')}\n\n${t('top_tech')}:\n${top}`;
      await navigator.clipboard.writeText(text);
      toast(t('copied'));
    });
  })();
  return { usesRange: true };
}

// =====================================================================
// Settings
// =====================================================================
export function settings(view, params, ctx) {
  const c = state.config;
  view.innerHTML = `
    <div class="grid">
      <section class="card span-6"><div class="card-h"><h2>${t('set_source')}</h2></div>
        <div class="seg" id="s-mode"><button data-mode="live" class="${c.mode === 'live' ? 'on' : ''}">🌐 ${t('mode_live')}</button><button data-mode="demo" class="${c.mode === 'demo' ? 'on' : ''}">🧪 ${t('mode_demo')}</button></div>
        <div class="form-row" style="margin-top:16px">
          <label style="flex:1">${t('token')} ${c.hasToken ? `<span class="tag live">${t('token_saved')} ${esc(c.tokenHint)}</span>` : ''}
            <input type="password" id="s-token" placeholder="${t('token_ph')}" autocomplete="off"/></label>
          <button class="btn" id="s-token-save">${t('save')}</button>
          ${c.hasToken ? `<button class="btn danger" id="s-token-clear">${t('token_clear')}</button>` : ''}
        </div>
        <p class="help">${t('token_help')}</p>
        <div class="form-row">
          <label>${t('poll')}<input type="number" id="s-poll" min="5" max="3600" value="${c.pollInterval}" style="width:110px"/></label>
          <label>${t('pages')}<select id="s-pages">${[1, 2, 3].map((n) => `<option ${n === c.pages ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <button class="btn primary" id="s-save">${t('save')}</button>
        </div>
      </section>

      <section class="card span-6"><div class="card-h"><h2>✨ ${t('set_ai')}</h2>${c.ai?.installed ? `<span class="tag live">SDK ✓</span>` : `<span class="tag demo">${t('sdk_missing')}</span>`}</div>
        <div class="form-row">
          <label style="flex:1">Anthropic API key ${c.hasAnthropicKey ? `<span class="tag live">${t('token_saved')}</span>` : ''}
            <input type="password" id="s-akey" placeholder="sk-ant-…" autocomplete="off"/></label>
          <button class="btn" id="s-akey-save">${t('save')}</button>
          ${c.hasAnthropicKey ? `<button class="btn danger" id="s-akey-clear">${t('token_clear')}</button>` : ''}
        </div>
        <p class="help">${t('ai_help', { model: esc(c.ai?.model || '') })}</p>
      </section>

      <section class="card span-6"><div class="card-h"><h2>${t('set_keywords')}</h2></div>
        <form class="form-row" id="s-kw-form">
          <label>${t('kw_label')}<input type="text" id="s-kw-label" placeholder="Cursor IDE" style="width:150px"/></label>
          <label style="flex:1">${t('kw_terms')}<input type="text" id="s-kw-terms" placeholder="cursor ide, cursor rules"/></label>
          <button class="btn primary">${t('add')}</button>
        </form>
        <div class="chips" id="s-kw-list"></div>
        <div style="margin-top:12px"><button class="btn sm" id="s-retag">↻ ${t('kw_retag')}</button></div>
      </section>

      <section class="card span-6"><div class="card-h"><h2>${t('set_data')}</h2></div>
        <div class="toolbar"><b style="min-width:70px">${t('export')}</b>
          ${['events', 'repos', 'keywords', 'developers']
            .map((d) => `<span class="chips"><span class="tag">${t('exp_' + (d === 'developers' ? 'devs' : d))}</span><a class="btn sm" href="/api/export?dataset=${d}&format=csv&range=${state.range}">CSV</a><a class="btn sm" href="/api/export?dataset=${d}&format=json&range=${state.range}">JSON</a></span>`)
            .join('')}
        </div>
        <div class="toolbar">
          <label class="btn">⤒ ${t('imp')}<input type="file" id="s-import" accept=".json,application/json" hidden/></label>
          <button class="btn" id="s-demo">◈ ${t('imp_demo')}</button>
          <button class="btn" id="s-purge">🧹 ${t('purge_demo')}</button>
          <button class="btn danger" id="s-reset">🗑 ${t('reset')}</button>
        </div>
        <p class="help" id="s-stored"></p>
      </section>

      <section class="card span-6"><div class="card-h"><h2>${t('set_look')}</h2></div>
        <div class="form-row"><label>${t('theme')}<span class="seg" id="s-theme">${['system', 'dark', 'light'].map((x) => `<button data-theme="${x}" class="${(localStorage.getItem('aip.theme') || 'system') === x ? 'on' : ''}">${t('th_' + x)}</button>`).join('')}</span></label>
          <label>${t('language')}<span class="seg" id="s-lang"><button data-lang="vi" class="${getLang() === 'vi' ? 'on' : ''}">Tiếng Việt</button><button data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">English</button></span></label></div>
        <button class="btn" id="s-install" hidden>⬇ ${t('install')}</button>
        <div class="card-h" style="margin-top:16px" id="shortcuts"><h2>${t('shortcuts')}</h2></div>
        <div class="shortcut-list">
          <kbd>Ctrl K</kbd><span>${t('sc_palette')}</span><kbd>T</kbd><span>${t('sc_theme')}</span><kbd>P</kbd><span>${t('sc_pause')}</span><kbd>1 … 9</kbd><span>${t('sc_nav')}</span><kbd>F</kbd><span>${t('sc_tv')}</span><kbd>?</kbd><span>${t('sc_help')}</span>
        </div>
      </section>

      <section class="card span-12"><div class="card-h"><h2>${t('set_about')}</h2></div><p class="help" style="margin:0">${esc(t('about', { v: state.statusVersion || '2' }))}</p></section>
    </div>`;

  const saveSettings = async (body) => {
    state.config = await api('/api/settings', { method: 'PUT', body });
    toast(t('set_saved'));
    ctx.rerender();
  };
  $('#s-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) saveSettings({ mode: b.dataset.mode });
  });
  $('#s-token-save').addEventListener('click', () => {
    const v = $('#s-token').value.trim();
    if (v) saveSettings({ githubToken: v });
  });
  $('#s-token-clear')?.addEventListener('click', () => saveSettings({ githubToken: '' }));
  $('#s-akey-save').addEventListener('click', () => {
    const v = $('#s-akey').value.trim();
    if (v) saveSettings({ anthropicKey: v });
  });
  $('#s-akey-clear')?.addEventListener('click', () => saveSettings({ anthropicKey: '' }));
  $('#s-save').addEventListener('click', () => saveSettings({ pollInterval: Number($('#s-poll').value), pages: Number($('#s-pages').value) }));

  const renderKw = () => {
    $('#s-kw-list').innerHTML =
      state.config.customKeywords.map((k) => `<span class="tag">${esc(k.label)} <small>${esc(k.terms.join(', '))}</small><button class="star" data-kwdel="${k.id}" aria-label="${t('del')}">✕</button></span>`).join('') || `<small>—</small>`;
  };
  $('#s-kw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/keywords', { method: 'POST', body: { label: $('#s-kw-label').value, terms: $('#s-kw-terms').value } });
      state.config = await api('/api/settings');
      await loadTaxonomy();
      renderKw();
      $('#s-kw-label').value = $('#s-kw-terms').value = '';
    } catch (err) {
      toast(err.message, '', 'error');
    }
  });
  $('#s-kw-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kwdel]');
    if (!b) return;
    await api(`/api/keywords?id=${b.dataset.kwdel}`, { method: 'DELETE' });
    state.config = await api('/api/settings');
    await loadTaxonomy();
    renderKw();
  });
  $('#s-retag').addEventListener('click', async () => {
    await api('/api/keywords/retag', { method: 'POST' });
    toast(t('kw_retag_done'));
  });

  const stored = async () => {
    const s = await api('/api/status');
    $('#s-stored').textContent = `${fmtNum(s.stored)} ${t('events')} · v${s.version}`;
  };
  $('#s-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const body = JSON.parse(await file.text());
      const r = await api('/api/import?shift=0', { method: 'POST', body });
      toast(t('imported', { n: r.aiEvents }));
      stored();
    } catch (err) {
      toast(err.message, '', 'error');
    }
  });
  $('#s-demo').addEventListener('click', async () => {
    const r = await api('/api/control', { method: 'POST', body: { action: 'import-demo' } });
    toast(t('imported', { n: r.aiEvents }));
    stored();
  });
  $('#s-purge').addEventListener('click', async () => {
    await api('/api/control', { method: 'POST', body: { action: 'purge-demo' } });
    toast(t('purge_demo'));
    stored();
  });
  $('#s-reset').addEventListener('click', async () => {
    if (!confirm(t('reset_confirm'))) return;
    await api('/api/control', { method: 'POST', body: { action: 'reset' } });
    toast(t('reset'));
    stored();
  });
  $('#s-theme').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (b) ctx.setTheme(b.dataset.theme);
  });
  $('#s-lang').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (b) ctx.setLanguage(b.dataset.lang);
  });
  if (ctx.installPrompt()) {
    $('#s-install').hidden = false;
    $('#s-install').addEventListener('click', () => ctx.installPrompt().prompt());
  }
  renderKw();
  stored();
  if (params.section === 'shortcuts') $('#shortcuts').scrollIntoView();
  return {};
}
