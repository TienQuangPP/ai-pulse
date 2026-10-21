'use strict';
/**
 * "Ask AI Pulse": answers questions about the collected data with Claude.
 * @anthropic-ai/sdk is an optional dependency — the rest of the app works without it.
 */

let Anthropic = null;
try {
  Anthropic = require('@anthropic-ai/sdk');
  Anthropic = Anthropic.default || Anthropic;
} catch {
  /* not installed: `npm install` enables this feature */
}

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are AI Pulse Analyst, the assistant inside AI Pulse — an app that watches the public GitHub event stream in real time and detects which AI/LLM technologies (LLM providers, frameworks, agents & MCP, vector databases, local inference, techniques, generative media, classic ML) open-source developers are working with.

Each user message ends with a <data> block: a JSON snapshot of the dashboard for the selected time range (KPIs, technology counts with the previous period for growth, groups, top repositories and developers, rule-based insights). Ground every number you give in that snapshot and say when the data cannot answer a question. Data marked as demo is simulated; mention that if the user seems to treat it as real.

Answer in the language the user writes in (Vietnamese or English). Be concise and concrete: lead with the answer, then a few supporting facts. Use short Markdown (bold, bullet lists) — no tables, no headings.`;

const status = (getKey) => ({ installed: !!Anthropic, hasKey: !!(getKey() || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), model: MODEL });

function snapshot(summary, insights) {
  return {
    range: summary.range,
    from: new Date(summary.since).toISOString(),
    to: new Date(summary.until).toISOString(),
    kpis: summary.kpis,
    technologies: summary.keywords.slice(0, 30).map(({ label, category, count, prev }) => ({ label, category, count, prev })),
    groups: summary.categories.filter((c) => c.count).map((c) => ({ group: c.label.en, count: c.count })),
    eventTypes: summary.types,
    topRepos: summary.topRepos,
    topDevelopers: summary.topActors,
    insights: insights.map((i) => i.text.en.replace(/\*\*/g, '')),
  };
}

/**
 * Streams the answer as plain text chunks into `res`.
 * history: [{ role: 'user'|'assistant', content: string }]
 */
async function ask({ history, summary, insights, getKey }, res) {
  if (!Anthropic) {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not_installed' }));
  }
  const key = getKey();
  const client = key ? new Anthropic({ apiKey: key }) : new Anthropic();

  const turns = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!turns.length || turns.at(-1).role !== 'user') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Last message must be from the user.' }));
  }
  const last = turns.at(-1);
  last.content = `${last.content}\n\n<data>\n${JSON.stringify(snapshot(summary, insights))}\n</data>`;

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: turns,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') res.write(event.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') res.write('\n\n_(Claude declined to answer this request.)_');
    else if (final.stop_reason === 'max_tokens') res.write('\n\n_(Answer truncated.)_');
  } catch (err) {
    let msg = err.message || String(err);
    if (err instanceof Anthropic.AuthenticationError) msg = 'Anthropic API key is missing or invalid — add one in Settings.';
    else if (err instanceof Anthropic.RateLimitError) msg = 'Rate limited by the Anthropic API — try again shortly.';
    else if (err instanceof Anthropic.APIError) msg = `Anthropic API error ${err.status}: ${err.message}`;
    res.write(`\n\n⚠️ ${msg}`);
  }
  res.end();
}

module.exports = { ask, status, MODEL };
