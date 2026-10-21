'use strict';
const { CATEGORIES, TECHNOLOGIES } = require('./taxonomy');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(tech) {
  const source = tech.patterns.map((p) => `(?:${p})`).join('|');
  // Custom boundaries: letters/digits only, so "_", "-", "/", "." all separate words.
  return { ...tech, regex: new RegExp(`(?<![a-z0-9])(?:${source})(?![a-z0-9])`, 'gi') };
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
    return this.techs.map(({ id, label, category, patterns, custom }) => ({ id, label, category, patterns, custom: !!custom }));
  }

  /** Returns { keywords: [id], categories: [id], terms: [string] } */
  detect(text) {
    if (!text) return { keywords: [], categories: [], terms: [] };
    // Also scan a camelCase-split variant so "RagPipeline" -> "rag pipeline".
    const variants = [text, text.replace(/([a-z])([A-Z])/g, '$1 $2')];
    const keywords = new Set();
    const terms = new Set();
    for (const tech of this.techs) {
      for (const v of variants) {
        tech.regex.lastIndex = 0;
        const matches = v.match(tech.regex);
        if (matches) {
          keywords.add(tech.id);
          matches.forEach((m) => terms.add(m.toLowerCase()));
        }
      }
    }
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
