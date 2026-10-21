'use strict';
/** Synthetic GitHub-like events for offline demos and presentations. */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
};

const OWNERS = ['nova-labs', 'hcmut-ai', 'pixelforge', 'openmind-vn', 'datacraft', 'quantum-owl', 'saigon-dev', 'ml-garden', 'byte-river', 'lotus-research', 'acme-corp', 'kieu-ng', 'tranh-dev', 'mekong-ml', 'hanoi-labs'];
const AI_REPOS = ['rag-chatbot', 'llm-agent-toolkit', 'ollama-webui', 'langchain-playground', 'vector-search-api', 'claude-code-helpers', 'gemini-vision-demo', 'mcp-server-filesystem', 'finetune-llama3', 'stable-diffusion-ui', 'whisper-transcriber', 'deepseek-r1-eval', 'crewai-research-team', 'qdrant-benchmarks', 'openai-cookbook-vi', 'pgvector-starter', 'llamaindex-docs-qa', 'autogen-studio-lab', 'pytorch-image-clf', 'vllm-deploy'];
const OTHER_REPOS = ['dotfiles', 'portfolio', 'todo-app', 'blog', 'leetcode', 'react-shop', 'go-microservice', 'android-weather', 'homelab', 'rust-cli', 'django-crm', 'spring-boot-api', 'unity-game', 'k8s-manifests', 'notes'];

const AI_MESSAGES = [
  'Add RAG pipeline with OpenAI embeddings',
  'Switch default model to Claude Sonnet',
  'Integrate Gemini API for image captioning',
  'Implement MCP server for local file tools',
  'Fine-tune Llama 3 with QLoRA on custom dataset',
  'Use pgvector for semantic search',
  'Add Ollama support for local inference',
  'Refactor LangChain agents into LangGraph',
  'Benchmark Qdrant vs Weaviate retrieval latency',
  'Add tool calling to the AI agent loop',
  'Upgrade transformers and fix tokenizer warnings',
  'Add DeepSeek R1 provider',
  'Prompt engineering: tighten system prompt',
  'Stream ChatGPT responses over SSE',
  'Add Whisper speech-to-text endpoint',
  'Export GGUF quantized weights for llama.cpp',
  'CrewAI: add researcher and writer agents',
  'Store chat history in ChromaDB',
  'Train PyTorch model with mixed precision',
  'Deploy vLLM on GPU node',
  'Add Copilot instructions file',
  'Evaluate Qwen2.5 on Vietnamese benchmark',
  'Generative AI demo for marketing copy',
  'Add Anthropic prompt caching',
  'Hybrid search: BM25 + embeddings',
];
const OTHER_MESSAGES = ['Fix typo in README', 'Update dependencies', 'Refactor auth middleware', 'Add dark mode', 'Bump version to 1.2.0', 'Fix CI workflow', 'Improve error handling', 'Add unit tests', 'Clean up CSS', 'Merge branch main'];

let seq = 0;

function makeEvent(now = Date.now()) {
  const ai = Math.random() < 0.42;
  const type = weighted([
    ['PushEvent', 50],
    ['PullRequestEvent', 14],
    ['WatchEvent', 12],
    ['CreateEvent', 8],
    ['IssuesEvent', 7],
    ['IssueCommentEvent', 5],
    ['ForkEvent', 3],
    ['ReleaseEvent', 1],
  ]);
  const repo = `${pick(OWNERS)}/${ai ? pick(AI_REPOS) : pick(OTHER_REPOS)}`;
  const msg = ai ? pick(AI_MESSAGES) : pick(OTHER_MESSAGES);
  const payload = {};
  if (type === 'PushEvent') payload.commits = [{ message: msg }];
  if (type === 'PullRequestEvent') payload.pull_request = { title: msg, body: '' };
  if (type === 'IssuesEvent') payload.issue = { title: msg };
  if (type === 'IssueCommentEvent') Object.assign(payload, { issue: { title: msg }, comment: { body: 'LGTM' } });
  if (type === 'CreateEvent') payload.description = ai ? msg : '';
  if (type === 'ReleaseEvent') payload.release = { name: `v1.${seq % 10}.0`, body: msg };
  return {
    id: `demo-${now}-${++seq}`,
    type,
    repo: { name: repo },
    actor: { login: `${pick(['minh', 'lan', 'huy', 'thao', 'an', 'bao', 'chi', 'duc', 'alex', 'sam', 'kim', 'yuki'])}${Math.floor(Math.random() * 90 + 10)}` },
    created_at: new Date(now - Math.floor(Math.random() * 20_000)).toISOString(),
    payload,
  };
}

function batch(n = 10) {
  const now = Date.now();
  return Array.from({ length: n }, () => makeEvent(now));
}

/** Backfill history so charts are not empty on first demo run. */
function history(hours = 6, perMinute = 6) {
  const out = [];
  const now = Date.now();
  for (let m = hours * 60; m > 0; m--) {
    const wave = 1 + 0.6 * Math.sin((m / 60) * Math.PI / 3);
    const n = Math.max(1, Math.round(perMinute * wave * (0.6 + Math.random() * 0.8)));
    for (let i = 0; i < n; i++) out.push(makeEvent(now - m * 60_000));
  }
  return out;
}

module.exports = { batch, history };
