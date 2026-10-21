const test = require('node:test');
const assert = require('node:assert/strict');
const { Detector } = require('../server/detector');

const d = new Detector();
const kw = (text) => d.detect(text).keywords.sort();

test('detects common AI stack terms', () => {
  assert.deepEqual(kw('Add LangChain RAG pipeline with OpenAI embeddings'), ['embedding', 'langchain', 'openai', 'rag']);
});

test('uses word boundaries (no substring false positives)', () => {
  assert.deepEqual(kw('fix storage leak in paragraph renderer'), []);
  assert.deepEqual(kw('dragon drag-and-drop'), []);
});

test('treats -, _, / and . as separators', () => {
  assert.deepEqual(kw('nova-labs/langchain-rag-demo'), ['langchain', 'rag']);
  assert.deepEqual(kw('my_ollama_app'), ['ollama']);
});

test('splits camelCase identifiers', () => {
  assert.ok(kw('RagPipeline').includes('rag'));
});

test('recognises package names in dependency files', () => {
  const k = kw('"@anthropic-ai/sdk": "^0.30", "@modelcontextprotocol/sdk": "1.0", chromadb==0.5');
  assert.ok(k.includes('anthropic') && k.includes('mcp') && k.includes('chroma'));
});

test('chatgpt does not double count as gpt; llama.cpp does not count as llama', () => {
  assert.deepEqual(kw('ChatGPT clone'), ['chatgpt']);
  assert.deepEqual(kw('build llama.cpp server'), ['llamacpp']);
  assert.ok(kw('run llama3 via llama.cpp').includes('llama'));
});

test('supports custom keywords', () => {
  const c = new Detector([{ id: 'c_cursor', label: 'Cursor IDE', terms: ['cursor ide', 'cursor rules'] }]);
  assert.deepEqual(c.detect('Add .cursor-rules file').keywords, ['c_cursor']);
  assert.ok(c.categories().some((x) => x.id === 'custom'));
});
