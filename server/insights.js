'use strict';
/** Rule-based "what's interesting right now" insights, written in both languages. */

const pct = (v) => `${Math.round(v * 100)}%`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const DAYS = { vi: ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };

function generate(summary, store, detector) {
  const out = [];
  const add = (icon, kind, vi, en, link) => out.push({ icon, kind, text: { vi, en }, link });
  const k = summary.kpis;
  const label = (id) => detector.byId.get(id)?.label || id;

  if (!k.aiEvents) return out;

  if (k.topKeyword) {
    const share = k.topKeyword.count / k.aiEvents;
    add('👑', 'star', `**${k.topKeyword.label}** dẫn đầu, xuất hiện trong ${pct(share)} sự kiện AI.`, `**${k.topKeyword.label}** leads, appearing in ${pct(share)} of AI events.`, `#/feed?kw=${k.topKeyword.id}`);
  }

  if (k.aiEventsPrev) {
    const d = (k.aiEvents - k.aiEventsPrev) / k.aiEventsPrev;
    if (Math.abs(d) >= 0.1) {
      add(d > 0 ? '📈' : '📉', d > 0 ? 'up' : 'down', `Hoạt động AI ${d > 0 ? 'tăng' : 'giảm'} **${pct(Math.abs(d))}** so với kỳ trước.`, `AI activity is ${d > 0 ? 'up' : 'down'} **${pct(Math.abs(d))}** vs the previous period.`);
    }
  }

  const movers = summary.keywords.filter((x) => x.count >= 3 && x.prev >= 2);
  const gainer = [...movers].sort((a, b) => b.growth - a.growth)[0];
  if (gainer && gainer.growth > 0.15) {
    add('🚀', 'up', `**${gainer.label}** tăng tốc mạnh nhất: +${pct(gainer.growth)} (${gainer.prev} → ${gainer.count}).`, `**${gainer.label}** is the fastest riser: +${pct(gainer.growth)} (${gainer.prev} → ${gainer.count}).`, `#/feed?kw=${gainer.id}`);
  }
  const loser = [...movers].sort((a, b) => a.growth - b.growth)[0];
  if (loser && loser.growth < -0.25 && loser !== gainer) {
    add('🧊', 'down', `**${loser.label}** hạ nhiệt: ${pct(loser.growth)} so với kỳ trước.`, `**${loser.label}** is cooling: ${pct(loser.growth)} vs the previous period.`);
  }

  const fresh = summary.keywords.filter((x) => x.prev === 0 && x.count >= 3).slice(0, 3);
  if (fresh.length) {
    const names = fresh.map((x) => `**${x.label}**`).join(', ');
    add('✨', 'up', `Mới xuất hiện trong kỳ này: ${names}.`, `New this period: ${names}.`);
  }

  const cat = [...summary.categories].sort((a, b) => b.count - a.count)[0];
  if (cat?.count) add('🧭', 'info', `Nhóm sôi động nhất: **${cat.label.vi}** (${pct(cat.count / k.aiEvents)} sự kiện).`, `Busiest group: **${cat.label.en}** (${pct(cat.count / k.aiEvents)} of events).`, `#/tech?cat=${cat.id}`);

  const repo = summary.topRepos[0];
  if (repo && repo.count >= 2) add('🔥', 'star', `Repo nóng nhất: **${repo.repo}** với ${repo.count} sự kiện AI.`, `Hottest repo: **${repo.repo}** with ${repo.count} AI events.`, `#/repos?q=${encodeURIComponent(repo.repo)}`);

  const diverse = store.repos({ range: summary.range, sort: 'diversity', limit: 1 }).items[0];
  const n = diverse ? Object.keys(diverse.keywords).length : 0;
  if (n >= 4) add('🧩', 'info', `**${diverse.repo}** có AI stack đa dạng nhất: ${n} công nghệ.`, `**${diverse.repo}** has the most diverse AI stack: ${n} technologies.`, `#/analyzer?repo=${encodeURIComponent(diverse.repo)}`);

  const pair = store.cooccurrence(summary.range, { maxNodes: 60, maxEdges: 1 }).edges[0];
  if (pair && pair.weight >= 2) add('🤝', 'info', `Cặp đôi ăn ý: **${label(pair.a)} + ${label(pair.b)}** cùng xuất hiện ${pair.weight} lần.`, `Power couple: **${label(pair.a)} + ${label(pair.b)}** appear together ${pair.weight} times.`, '#/ecosystem');

  let best = { v: 0 };
  summary.heatmap.forEach((row, d) => row.forEach((v, h) => v > best.v && (best = { v, d, h })));
  if (best.v >= 3) add('⏰', 'info', `Giờ cao điểm (7 ngày): **${DAYS.vi[best.d]}, ${hh(best.h)}**.`, `Peak hour (7 days): **${DAYS.en[best.d]}, ${hh(best.h)}**.`);

  if (k.aiRatio) add('📊', 'info', `Cứ 100 sự kiện GitHub thì có **${Math.round(k.aiRatio * 100)}** sự kiện liên quan AI.`, `**${Math.round(k.aiRatio * 100)}** of every 100 GitHub events are AI-related.`);

  return out;
}

module.exports = { generate };
