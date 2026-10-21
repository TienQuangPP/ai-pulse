'use strict';
const { CATEGORIES, TECHNOLOGIES } = require('./taxonomy');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Custom boundaries: letters/digits only, so "_", "-", "/", "." all separate words.
const toRegex = (patterns) =>
  patterns?.length ? new RegExp(`(?<![a-z0-9])(?:${patterns.map((p) => `(?:${p})`).join('|')})(?![a-z0-9])`, 'gi') : null;

function compile(tech) {
  return { ...tech, regex: toRegex(tech.patterns), weakRegex: toRegex(tech.weak) };
}

class Detector {
  constructor(customTechs = []) {
    this.setCustom(customTechs);
  }

  setCustom(customTechs) {
    this.custom = customTechs.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category || 'custom',
      custom: true,
      patterns: c.terms.map((t) => escapeRegex(t.trim().toLowerCase()).replace(/\s+/g, '[-\\s_]?')),
    }));
    this.techs = [...TECHNOLOGIES, ...this.custom].map(compile);
    this.byId = new Map(this.techs.map((t) => [t.id, t]));
  }

  categories() {
    const cats = [...CATEGORIES];
    if (this.custom.some((c) => c.category === 'custom')) {
      cats.push({ id: 'custom', label: { en: 'Custom', vi: 'Tuỳ chỉnh' } });
    }
    return cats;
  }

  list() {
    return this.techs.map(({ id, label, category, patterns, weak, custom }) => ({ id, label, category, patterns, weak: weak || [], custom: !!custom }));
  }

  /**
   * Returns { keywords: [id], categories: [id], terms: [string] }.
   * Weak (ambiguous) matches count only next to a strong signal, unless `allowWeak`
   * is set (dependency manifests, where every name is a package).
   */
  detect(text, { allowWeak = false } = {}) {
    const empty = { keywords: [], categories: [], terms: [] };
    if (!text) return empty;
    // Also scan a camelCase-split variant so "RagPipeline" -> "rag pipeline".
    const variants = [text, text.replace(/([a-z])([A-Z])/g, '$1 $2')];
    const strong = new Set();
    const weak = new Set();
    const strongTerms = new Set();
    const weakTerms = new Set();
    const scan = (regex, hits, termSet, id) => {
      if (!regex) return;
      for (const v of variants) {
        regex.lastIndex = 0;
        const matches = v.match(regex);
        if (matches) {
          hits.add(id);
          matches.forEach((m) => termSet.add(m.toLowerCase()));
        }
      }
    };
    for (const tech of this.techs) {
      scan(tech.regex, strong, strongTerms, tech.id);
      scan(tech.weakRegex, weak, weakTerms, tech.id);
    }
    if (!strong.size && !allowWeak) return empty;
    const keywords = new Set([...strong, ...weak]);
    const terms = new Set([...strongTerms, ...weakTerms]);
    // "gpt" alone is implied by chatgpt; drop the generic duplicate.
    if (keywords.has('chatgpt')) keywords.delete('gpt');
    // Likewise "llama" is implied by llama.cpp / LlamaIndex unless "llama" appears on its own.
    if ((keywords.has('llamacpp') || keywords.has('llamaindex')) && !/llama[-\s]?\d|llama(?![.\-_\s]?(?:cpp|index))/i.test(text)) {
      keywords.delete('llama');
    }
    const categories = new Set([...keywords].map((k) => this.byId.get(k).category));
    return { keywords: [...keywords], categories: [...categories], terms: [...terms] };
  }
}

module.exports = { Detector, escapeRegex };
