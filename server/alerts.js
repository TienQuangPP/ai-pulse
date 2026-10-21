'use strict';
/**
 * Threshold alerts: "fire when <target> reaches <threshold> events within <window> minutes".
 * target is { kind: 'keyword'|'category'|'any'|'repo', value }.
 */

class Alerts {
  constructor({ store, getConfig, saveConfig }) {
    this.store = store;
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
    this.lastFired = new Map();
    this.log = [];
  }

  rules() {
    return this.getConfig().alerts || [];
  }

  matches(rule, e) {
    switch (rule.kind) {
      case 'keyword':
        return e.keywords.includes(rule.value);
      case 'category':
        return e.categories.includes(rule.value);
      case 'repo':
        return e.repo.toLowerCase() === String(rule.value).toLowerCase();
      default:
        return true;
    }
  }

  /** Evaluate all enabled rules; returns the alerts that fired. */
  evaluate() {
    const now = Date.now();
    const fired = [];
    for (const rule of this.rules()) {
      if (!rule.enabled) continue;
      const cooldown = (rule.cooldown ?? rule.window) * 60_000;
      if (now - (this.lastFired.get(rule.id) || 0) < cooldown) continue;
      const windowStart = now - rule.window * 60_000;
      const count = this.store.inRange(windowStart).filter((e) => this.matches(rule, e)).length;
      if (count >= rule.threshold) {
        this.lastFired.set(rule.id, now);
        const alert = { id: `${rule.id}-${now}`, ruleId: rule.id, rule, count, at: now };
        this.log.unshift(alert);
        fired.push(alert);
      }
    }
    this.log.length = Math.min(this.log.length, 200);
    return fired;
  }
}

module.exports = { Alerts };
