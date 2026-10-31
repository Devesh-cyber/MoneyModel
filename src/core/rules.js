// The correction loop. When the user fixes a category, the system learns a rule and
// re-applies it to past and future transactions.
//
// Rule { id, pattern (merchantKey), match 'exact'|'contains', direction 'debit'|'credit'|'any',
//        category, createdAt, updatedAt, hits }

import { isValidCategory } from './categories.js';
import { hash } from './utils.js';

export function ruleMatches(rule, tx) {
  if (!tx.merchantKey) return false;
  if (rule.direction !== 'any' && rule.direction !== tx.direction) return false;
  if (rule.match === 'exact') return tx.merchantKey === rule.pattern;
  return tx.merchantKey.includes(rule.pattern);
}

/** Exact rules beat contains-rules; longer contains-patterns beat shorter ones. */
export function findRule(rules, tx) {
  let best = null;
  for (const r of rules) {
    if (!ruleMatches(r, tx)) continue;
    if (!best) { best = r; continue; }
    if (r.match === 'exact' && best.match !== 'exact') best = r;
    else if (r.match === best.match && r.pattern.length > best.pattern.length) best = r;
    else if (r.match === best.match && r.pattern.length === best.pattern.length && (r.updatedAt || '') > (best.updatedAt || '')) best = r;
  }
  return best;
}

export function upsertRule(rules, { pattern, match = 'exact', direction = 'any', category }) {
  if (!isValidCategory(category)) throw new Error(`Invalid category: ${category}`);
  const p = String(pattern || '').trim().toUpperCase();
  if (p.length < 2) throw new Error('Rule pattern too short');
  const now = new Date().toISOString();
  const id = 'rule_' + hash(`${p}|${match}|${direction}`);
  const existing = rules.find((r) => r.id === id);
  if (existing) {
    return { rules: rules.map((r) => (r.id === id ? { ...r, category, updatedAt: now } : r)), rule: { ...existing, category, updatedAt: now }, created: false };
  }
  const rule = { id, pattern: p, match, direction, category, createdAt: now, updatedAt: now, hits: 0 };
  return { rules: [...rules, rule], rule, created: true };
}

/** Apply rules to every transaction except ones the user pinned individually. */
export function applyRules(transactions, rules) {
  const hits = {};
  const txs = transactions.map((t) => {
    if (t.categorySource === 'user-once') return t;
    const r = findRule(rules, t);
    if (!r) {
      // rule was deleted → release transactions that depended on it
      if ((t.categorySource === 'rule' || t.categorySource === 'user') && t.ruleId && !rules.some((x) => x.id === t.ruleId)) {
        return { ...t, categorySource: 'none', category: 'Uncategorized', ruleId: null, confidence: 0 };
      }
      return t;
    }
    hits[r.id] = (hits[r.id] || 0) + 1;
    if (t.category === r.category && t.ruleId === r.id) return t;
    return { ...t, category: r.category, categorySource: t.categorySource === 'user' && t.ruleId === r.id ? 'user' : 'rule', confidence: 1, ruleId: r.id };
  });
  const outRules = rules.map((r) => ({ ...r, hits: hits[r.id] || 0 }));
  return { transactions: txs, rules: outRules };
}

/**
 * @param {{transactions:object[], rules:object[]}} state
 * @param {string} txId
 * @param {string} category
 * @param {'always'|'once'} scope
 */
export function learnFromCorrection(state, txId, category, scope = 'always') {
  if (!isValidCategory(category)) throw new Error(`Invalid category: ${category}`);
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) throw new Error('Transaction not found');

  if (scope === 'once' || !tx.merchantKey) {
    const transactions = state.transactions.map((t) =>
      t.id === txId ? { ...t, category, categorySource: 'user-once', confidence: 1, ruleId: null } : t,
    );
    return { state: { ...state, transactions }, rule: null, appliedCount: 1, scope: 'once' };
  }

  const { rules, rule } = upsertRule(state.rules, { pattern: tx.merchantKey, match: 'exact', direction: tx.direction, category });
  const before = new Map(state.transactions.map((t) => [t.id, t.category]));
  const res = applyRules(state.transactions, rules);
  const transactions = res.transactions.map((t) => (t.id === txId ? { ...t, categorySource: 'user', ruleId: rule.id } : t));
  const appliedCount = transactions.filter((t) => t.ruleId === rule.id && (before.get(t.id) !== t.category || t.id === txId)).length;
  return { state: { ...state, transactions, rules: res.rules }, rule, appliedCount, scope: 'always' };
}

export function deleteRule(state, ruleId) {
  const rules = state.rules.filter((r) => r.id !== ruleId);
  const res = applyRules(state.transactions, rules);
  return { ...state, rules: res.rules, transactions: res.transactions };
}
