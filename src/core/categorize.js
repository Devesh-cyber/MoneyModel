// Categorisation pipeline, cheapest and most trustworthy first:
//   1. user's learned rules          (categorySource 'rule' / 'user')
//   2. bank hints + known merchants   ('keyword')
//   3. Grok, batched, redacted        ('ai')         — only for what is still unknown
//   4. low-confidence word heuristics ('heuristic')  — only if AI unavailable / no answer
//   5. Uncategorized                  ('none')

import { CATEGORIES, UNCATEGORIZED, isValidCategory } from './categories.js';
import { CREDIT_PATTERNS, MERCHANT_MAP, NOTE_PATTERNS, TOKEN_HEURISTICS } from './merchants.js';
import { findRule } from './rules.js';
import { redactMerchant, looksLikePersonName } from '../security/redact.js';
import { amountBand } from './utils.js';

const up = (s) => String(s || '').toUpperCase();

export function isSelfTransfer(tx, ownNames = []) {
  if (!ownNames.length) return false;
  const hay = up(`${tx.merchant} ${tx.rawText}`).replace(/[^A-Z ]/g, ' ');
  return ownNames.some((n) => {
    const tokens = up(n).replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
    return tokens.length >= 2 && tokens.every((t) => new RegExp(`\\b${t}\\b`).test(hay));
  });
}

/** Tiers 1–2. Returns a categorisation or null when the AI is needed. */
export function categorizeLocal(tx, { rules = [], ownNames = [] } = {}) {
  if (tx.categorySource === 'user-once') return null; // pinned by user, leave alone

  const rule = findRule(rules, tx);
  if (rule) return { category: rule.category, categorySource: tx.categorySource === 'user' ? 'user' : 'rule', confidence: 1, ruleId: rule.id };

  if (isSelfTransfer(tx, ownNames)) return { category: 'Transfers', categorySource: 'keyword', confidence: 0.95, selfTransfer: true };

  if (tx.hint === 'cash') return { category: 'Cash Withdrawal', categorySource: 'keyword', confidence: 0.98 };
  if (tx.hint === 'fees') return { category: 'Fees & Charges', categorySource: 'keyword', confidence: 0.95 };
  if (tx.hint === 'interest' && tx.direction === 'credit') return { category: 'Income', categorySource: 'keyword', confidence: 0.9 };

  const key = `${up(tx.merchantKey)} ${up(tx.vpa ? tx.vpa.split('@')[0] : '')}`.trim();

  if (tx.direction === 'credit') {
    const text = `${key} ${up(tx.note)} ${up(tx.rawText)}`;
    for (const [re, cat] of CREDIT_PATTERNS) if (re.test(text)) return { category: cat, categorySource: 'keyword', confidence: 0.9 };
  }

  for (const [re, cat] of NOTE_PATTERNS) if (tx.note && re.test(up(tx.note))) return { category: cat, categorySource: 'keyword', confidence: 0.85 };

  if (tx.direction === 'debit') {
    for (const [re, cat] of MERCHANT_MAP) if (re.test(key)) return { category: cat, categorySource: 'keyword', confidence: 0.92 };
  } else {
    // refunds from known merchants
    for (const [re] of MERCHANT_MAP) if (re.test(key)) return { category: 'Refunds & Cashback', categorySource: 'keyword', confidence: 0.75 };
  }
  return null;
}

/** Tier 4: weak word heuristics. */
export function categorizeHeuristic(tx) {
  if (tx.p2p || looksLikePersonName(tx.merchant) || looksLikePersonName(tx.vpa)) {
    return { category: 'Transfers', categorySource: 'heuristic', confidence: 0.5 };
  }
  const key = up(tx.merchantKey);
  for (const [re, cat] of TOKEN_HEURISTICS) if (re.test(key)) return { category: cat, categorySource: 'heuristic', confidence: 0.55 };
  if (tx.direction === 'credit') return { category: 'Others', categorySource: 'heuristic', confidence: 0.3 };
  return null;
}

/** Builds the minimal, redacted payload for the AI. Exported so the privacy receipt can show it. */
export function buildAiItems(txs, { customTerms = [] } = {}) {
  const groups = new Map();
  for (const t of txs) {
    const gk = `${t.merchantKey || t.merchant}|${t.direction}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(t);
  }
  const items = [];
  const keyToTxIds = {};
  const hiddenCounts = {};
  let i = 0;
  for (const [, group] of groups) {
    const t = group[0];
    const { value, hidden } = redactMerchant(t.merchant, { p2p: t.p2p || looksLikePersonName(t.vpa), customTerms });
    hidden.forEach((h) => { hiddenCounts[h] = (hiddenCounts[h] || 0) + 1; });
    const k = 'm' + (++i);
    keyToTxIds[k] = group.map((g) => g.id);
    items.push({ k, merchant: value || '[UNKNOWN]', direction: t.direction, amountBand: amountBand(t.amount), channel: t.channel || 'unknown', count: group.length });
  }
  return { items, keyToTxIds, hiddenCounts };
}

/**
 * Categorise transactions. Only transactions with categorySource 'none' (or all, with force)
 * are processed; user decisions are never overwritten.
 * @param {object[]} transactions
 * @param {{rules?:object[], ownNames?:string[], customTerms?:string[], force?:boolean,
 *          aiCategorize?: (items:object[]) => Promise<Record<string,{category:string,confidence:number}>>}} opts
 */
export async function categorizeTransactions(transactions, opts = {}) {
  const { rules = [], ownNames = [], customTerms = [], aiCategorize, force = false } = opts;
  const stats = { local: 0, ai: 0, heuristic: 0, uncategorized: 0, aiSentItems: 0, aiError: null };
  const out = transactions.map((t) => ({ ...t }));
  const pending = [];

  for (const t of out) {
    if (t.categorySource === 'user-once') continue;
    const needsWork = force || t.categorySource === 'none' || (t.categorySource === 'heuristic' && typeof aiCategorize === 'function');
    if (!needsWork) {
      // already categorised: only make sure newer user rules still win
      const r = findRule(rules, t);
      if (r && (t.category !== r.category || t.ruleId !== r.id)) {
        Object.assign(t, { category: r.category, categorySource: t.categorySource === 'user' ? 'user' : 'rule', confidence: 1, ruleId: r.id });
      }
      continue;
    }
    const local = categorizeLocal(t, { rules, ownNames });
    if (local) { Object.assign(t, { ruleId: null, selfTransfer: false }, local); stats.local++; }
    else pending.push(t);
  }

  if (pending.length && typeof aiCategorize === 'function') {
    const { items, keyToTxIds, hiddenCounts } = buildAiItems(pending, { customTerms });
    stats.aiSentItems = items.length;
    const byId = new Map(out.map((t) => [t.id, t]));
    for (let start = 0; start < items.length; start += 40) {
      const chunk = items.slice(start, start + 40);
      try {
        const answers = (await aiCategorize(chunk, start === 0 ? hiddenCounts : {})) || {};
        for (const it of chunk) {
          const a = answers[it.k];
          if (!a || !isValidCategory(a.category)) continue;
          const conf = Math.max(0, Math.min(1, Number(a.confidence) || 0.6));
          for (const id of keyToTxIds[it.k]) {
            const t = byId.get(id);
            Object.assign(t, { category: a.category, categorySource: 'ai', confidence: conf, ruleId: null });
            stats.ai++;
          }
        }
      } catch (e) {
        stats.aiError = e && e.message ? e.message : 'AI unavailable';
      }
    }
  }

  for (const t of pending) {
    if (t.categorySource === 'ai') continue;
    const h = categorizeHeuristic(t);
    if (h) { Object.assign(t, h); stats.heuristic++; }
    else { Object.assign(t, { category: UNCATEGORIZED, categorySource: 'none', confidence: 0 }); stats.uncategorized++; }
  }
  return { transactions: out, stats };
}

export { CATEGORIES };
