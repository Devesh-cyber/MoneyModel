// Converts parser output into the one canonical Transaction shape and merges new
// transactions into the existing set without duplicates.
//
// Transaction {
//   id, date 'YYYY-MM-DD', amount (positive ₹), direction 'debit'|'credit',
//   merchant (display), merchantKey, vpa, p2p, channel, hint, note, ref,
//   rawText (kept locally, encrypted; never sent to the AI),
//   sources ['sms'|'csv'|'pdf'|'manual'], fp (re-import fingerprint), batchId, importedAt,
//   category, categorySource 'rule'|'keyword'|'ai'|'heuristic'|'user'|'user-once'|'none',
//   confidence 0..1, ruleId?, selfTransfer?
// }

import { diffDays, hash, merchantKey, round2 } from './utils.js';
import { UNCATEGORIZED } from './categories.js';

export const SOURCES = ['sms', 'csv', 'pdf', 'manual'];

const normRaw = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

export function makeTransaction(raw, { source, batchId, importedAt, occurrence = 0 }) {
  const merchant = raw.merchant ? String(raw.merchant).trim() : null;
  const fpBase = `${source}|${raw.date}|${round2(raw.amount)}|${raw.direction}|${normRaw(raw.rawText)}`;
  const fp = `${hash(fpBase)}#${occurrence}`;
  return {
    id: 'tx_' + hash(fpBase + '#' + occurrence + '|' + (batchId || '')),
    date: raw.date,
    amount: round2(raw.amount),
    direction: raw.direction,
    merchant: merchant || (raw.direction === 'credit' ? 'Unknown credit' : 'Unknown payee'),
    merchantKey: merchantKey(merchant || raw.vpa || ''),
    vpa: raw.vpa || null,
    p2p: Boolean(raw.p2p),
    channel: raw.channel || null,
    hint: raw.hint || null,
    note: raw.note || null,
    ref: raw.ref || null,
    rawText: String(raw.rawText || '').slice(0, 1200),
    dateInferred: Boolean(raw.dateInferred),
    sources: [source],
    fp,
    batchId: batchId || null,
    importedAt: importedAt || new Date().toISOString(),
    category: UNCATEGORIZED,
    categorySource: 'none',
    confidence: 0,
    ruleId: null,
    selfTransfer: false,
  };
}

/** Build canonical transactions for one import batch (handles identical rows inside the batch). */
export function normalizeBatch(rawTxs, { source, batchId, importedAt }) {
  const seen = new Map();
  return rawTxs
    .filter((r) => r && r.date && r.amount > 0 && (r.direction === 'debit' || r.direction === 'credit'))
    .map((r) => {
      const base = `${source}|${r.date}|${round2(r.amount)}|${r.direction}|${normRaw(r.rawText)}`;
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      return makeTransaction(r, { source, batchId, importedAt, occurrence: n });
    });
}

function merchantSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(' ').filter((t) => t.length >= 3));
  return b.split(' ').some((t) => t.length >= 3 && ta.has(t));
}

/**
 * Merge incoming canonical transactions into existing ones.
 * Duplicate rules:
 *   1. Same fingerprint (same file/SMS imported again)               → duplicate
 *   2. Same bank reference number and amount                          → same transaction from another source
 *   3. Different source, same direction & amount, date within 2 days,
 *      and similar merchant (or same date when one side has no merchant) → same transaction
 * Each existing transaction can absorb at most one match per source, so two genuine
 * ₹20 chai payments on the same day stay two transactions.
 */
export function mergeTransactions(existing, incoming) {
  const merged = existing.map((t) => ({ ...t, sources: [...t.sources] }));
  const byFp = new Set(merged.map((t) => t.fp));
  const byRef = new Map();
  for (const t of merged) if (t.ref) byRef.set(`${t.ref}|${t.amount}`, t);

  const added = [];
  const duplicates = [];
  const linked = [];

  for (const inc of incoming) {
    if (byFp.has(inc.fp)) { duplicates.push({ id: inc.id, reason: 'already_imported' }); continue; }
    const src = inc.sources[0];

    let match = inc.ref ? byRef.get(`${inc.ref}|${inc.amount}`) : null;
    if (match && match.sources.includes(src)) match = null;

    if (!match) {
      match = merged.find((t) =>
        !t.sources.includes(src) &&
        t.direction === inc.direction &&
        t.amount === inc.amount &&
        Math.abs(diffDays(t.date, inc.date)) <= 2 &&
        (merchantSimilar(t.merchantKey, inc.merchantKey) ||
          (t.date === inc.date && (!t.merchantKey || !inc.merchantKey || t.merchant.startsWith('Unknown') || inc.merchant.startsWith('Unknown')))),
      );
    }

    if (match) {
      match.sources.push(src);
      // Fill in better details from the richer record, never overriding a user's category.
      if ((match.merchant.startsWith('Unknown') || !match.merchantKey) && inc.merchantKey) {
        match.merchant = inc.merchant;
        match.merchantKey = inc.merchantKey;
      }
      if (!match.ref && inc.ref) { match.ref = inc.ref; byRef.set(`${inc.ref}|${inc.amount}`, match); }
      if (!match.note && inc.note) match.note = inc.note;
      if (!match.hint && inc.hint) match.hint = inc.hint;
      if (match.dateInferred && !inc.dateInferred) { match.date = inc.date; match.dateInferred = false; }
      linked.push({ existingId: match.id, incomingId: inc.id, source: src });
      duplicates.push({ id: inc.id, reason: 'matched_other_source', matchedId: match.id });
      continue;
    }

    merged.push(inc);
    byFp.add(inc.fp);
    if (inc.ref) byRef.set(`${inc.ref}|${inc.amount}`, inc);
    added.push(inc);
  }

  merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { merged, added, duplicates, linked };
}
