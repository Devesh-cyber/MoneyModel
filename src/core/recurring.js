// Detects recurring payments / subscriptions and raises alerts when one changes price,
// stops appearing, or (per the user's own check-ins) goes unused.
//
// Bank data cannot prove whether a subscription is *used*, so "unused" is based on
// honest signals only: the user answering "Not using it" or not confirming use for
// more than 1.5 billing cycles after we asked.

import { addDays, coefVar, diffDays, hash, median, round2 } from './utils.js';

const CADENCES = [
  { name: 'weekly', days: 7, tol: 2 },
  { name: 'monthly', days: 30.4, tol: 6 }, // covers 28-day telecom plans and 31-day months
  { name: 'quarterly', days: 91, tol: 12 },
  { name: 'yearly', days: 365, tol: 20 },
];

const SUBSCRIPTION_LIKE = new Set(['Subscriptions', 'Entertainment', 'Education', 'Personal Care']);
const COMMITMENT = new Set(['Subscriptions', 'EMI & Loans', 'Insurance', 'Rent & Housing', 'Bills & Utilities', 'Investments']);
const NEVER_RECURRING = new Set(['Cash Withdrawal', 'Fees & Charges', 'Refunds & Cashback', 'Income']);
// Everyday spend repeats often but isn't a commitment; only flag it if the amount is (almost) identical.
const EVERYDAY = new Set(['Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Others']);

function pickCadence(intervals) {
  const med = median(intervals);
  for (const c of CADENCES) {
    if (Math.abs(med - c.days) <= c.tol) {
      const within = intervals.filter((i) => Math.abs(i - c.days) <= c.tol * 1.5).length;
      if (within / intervals.length >= 0.7) return { ...c, median: med };
    }
  }
  return null;
}

/**
 * @param {object[]} transactions
 * @param {{asOf:string, meta?:Record<string,{lastUsedAt?:string, markedUnused?:boolean, notRecurring?:boolean, askedAt?:string}>}} opts
 */
export function detectRecurring(transactions, { asOf, meta = {} }) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.direction !== 'debit' || !t.merchantKey || t.selfTransfer) continue;
    if (NEVER_RECURRING.has(t.category)) continue;
    if (!groups.has(t.merchantKey)) groups.set(t.merchantKey, []);
    groups.get(t.merchantKey).push(t);
  }

  const items = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    // collapse same-day duplicates (e.g. split payments) into one occurrence
    const occ = [];
    for (const t of sorted) {
      const last = occ[occ.length - 1];
      if (last && last.date === t.date) { last.amount += t.amount; last.ids.push(t.id); }
      else occ.push({ date: t.date, amount: t.amount, ids: [t.id], category: t.category, merchant: t.merchant });
    }
    if (occ.length < 2) continue;

    const intervals = [];
    for (let i = 1; i < occ.length; i++) intervals.push(diffDays(occ[i - 1].date, occ[i].date));
    const cadence = pickCadence(intervals);
    if (!cadence) continue;

    const category = sorted[sorted.length - 1].category;
    const minOcc = cadence.name === 'weekly' ? 4 : cadence.name === 'monthly' ? (COMMITMENT.has(category) ? 2 : 3) : 2;
    if (occ.length < minOcc) continue;

    const amounts = occ.map((o) => o.amount);
    const allowedCV = category === 'Bills & Utilities' ? 0.35 : 0.2;
    const prev = amounts.length >= 3 ? amounts.slice(0, -1) : amounts.slice(0, 1);
    const stablePrev = coefVar(prev) <= allowedCV;
    const stableAll = coefVar(amounts) <= allowedCV;
    if (!stablePrev && !stableAll) continue;
    if (EVERYDAY.has(category) && coefVar(amounts) > 0.05) continue;

    const id = 'rec_' + hash(key);
    const m = meta[id] || {};
    if (m.notRecurring) continue;

    const typical = round2(median(prev));
    const lastOcc = occ[occ.length - 1];
    const step = Math.round(cadence.median);
    const nextExpected = addDays(lastOcc.date, step);
    const grace = Math.max(5, cadence.tol);
    const missed = diffDays(nextExpected, asOf) > grace;
    const perMonth = { weekly: 52 / 12, quarterly: 1 / 3, yearly: 1 / 12 }[cadence.name];
    // monthly bills are once a month; only short-cycle plans (e.g. 28-day recharges) get scaled
    const monthlyEquivalent = round2(perMonth ? typical * perMonth : step <= 29 ? (typical * 365) / step / 12 : typical);

    items.push({
      id,
      merchantKey: key,
      merchant: lastOcc.merchant,
      category,
      cadence: cadence.name,
      intervalDays: step,
      typicalAmount: typical,
      lastAmount: round2(lastOcc.amount),
      firstDate: occ[0].date,
      lastDate: lastOcc.date,
      nextExpected,
      occurrences: occ.length,
      txIds: occ.flatMap((o) => o.ids),
      monthlyEquivalent,
      yearlyCost: round2(monthlyEquivalent * 12),
      status: missed ? 'missed' : 'active',
      subscriptionLike: SUBSCRIPTION_LIKE.has(category),
      usage: { lastUsedAt: m.lastUsedAt || null, markedUnused: Boolean(m.markedUnused), askedAt: m.askedAt || null },
    });
  }

  const alerts = [];
  for (const r of items) {
    const diff = r.lastAmount - r.typicalAmount;
    const watch = COMMITMENT.has(r.category) || r.subscriptionLike;
    if (watch && r.occurrences >= 2 && r.typicalAmount > 0 && Math.abs(diff) / r.typicalAmount > 0.05 && Math.abs(diff) >= 10 && r.category !== 'Bills & Utilities') {
      alerts.push({
        id: `price_${r.id}_${r.lastDate}`, type: 'price_change', severity: diff > 0 ? 'warning' : 'info', recurringId: r.id,
        title: `${r.merchant} ${diff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(round2(diff))}`,
        message: `Usually ₹${r.typicalAmount}, last charged ₹${r.lastAmount} on ${r.lastDate}. That is ₹${Math.abs(round2(diff * (365 / r.intervalDays)))} a year ${diff > 0 ? 'more' : 'less'}.`,
      });
    }
    if (watch && r.status === 'missed') {
      alerts.push({
        id: `missed_${r.id}_${r.nextExpected}`, type: 'missed', severity: 'info', recurringId: r.id,
        title: `${r.merchant} didn't appear when expected`,
        message: `Expected around ${r.nextExpected}. If you cancelled it, great. If not, check whether the payment failed.`,
      });
    }
    if (r.subscriptionLike && r.status === 'active') {
      const lastUsed = r.usage.lastUsedAt;
      const stale = lastUsed ? diffDays(lastUsed, asOf) > r.intervalDays * 1.5 : false;
      if (r.usage.markedUnused || stale) {
        alerts.push({
          id: `unused_${r.id}_${r.lastDate}`, type: 'unused', severity: 'warning', recurringId: r.id,
          title: `You may not be using ${r.merchant}`,
          message: r.usage.markedUnused
            ? `You said you're not using it. Cancelling saves about ₹${r.yearlyCost} a year.`
            : `You last confirmed using it on ${lastUsed}. It costs about ₹${r.yearlyCost} a year.`,
        });
      } else if (!lastUsed) {
        alerts.push({
          id: `usage_${r.id}`, type: 'usage_check', severity: 'info', recurringId: r.id,
          title: `Still using ${r.merchant}?`,
          message: `₹${r.typicalAmount} ${r.cadence}. Tell us if you use it so we can flag it if it goes unused.`,
        });
      }
    }
    if (diffDays(r.firstDate, asOf) <= r.intervalDays * 2 + 5 && r.occurrences === 2) {
      alerts.push({
        id: `new_${r.id}`, type: 'new_recurring', severity: 'info', recurringId: r.id,
        title: `New recurring payment: ${r.merchant}`,
        message: `₹${r.typicalAmount} every ~${r.intervalDays} days since ${r.firstDate}.`,
      });
    }
  }

  items.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
  return { items, alerts };
}
