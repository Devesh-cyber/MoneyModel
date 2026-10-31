// The persistent financial profile: income, fixed costs, emergency fund, goals, budgets.
// Most values are derived from transactions and then confirmed/overridden by the user.

import { BUDGETABLE, FIXED_CATEGORIES } from './categories.js';
import { addMonths, daysInMonth, median, monthKey, round2, uid } from './utils.js';

export function defaultProfile() {
  return {
    displayName: '',
    ownNames: [],          // the user's own name(s): used to detect self-transfers and always redacted
    hiddenTerms: [],       // anything else the user always wants hidden from the AI
    incomeOverride: null,  // monthly ₹ if the user wants to set it manually
    emergencyFund: { current: 0, targetMonths: 6, targetDate: null },
    goals: [],             // {id, name, targetAmount, targetDate, saved, createdAt}
    budgets: {},           // {category: monthly ₹}; empty → suggestions are used
    manualFixedCosts: [],  // {id, name, amount, category}
  };
}

export function makeGoal({ name, targetAmount, targetDate, saved = 0 }) {
  const n = String(name || '').trim().slice(0, 60);
  const amt = Number(targetAmount);
  if (!n) throw new Error('Goal needs a name');
  if (!(amt > 0) || amt > 1e9) throw new Error('Goal amount must be a positive number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '')) throw new Error('Goal needs a target date (YYYY-MM-DD)');
  return { id: uid('goal'), name: n, targetAmount: round2(amt), targetDate, saved: Math.max(0, round2(Number(saved) || 0)), createdAt: new Date().toISOString() };
}

export const isIncome = (t) => t.direction === 'credit' && t.category === 'Income' && !t.selfTransfer;
export const isInvestment = (t) => t.direction === 'debit' && t.category === 'Investments' && !t.selfTransfer;
export const isSpend = (t) => t.direction === 'debit' && !t.selfTransfer && t.category !== 'Investments';

export function monthlyStats(transactions) {
  const stats = {};
  for (const t of transactions) {
    const mk = monthKey(t.date);
    const s = (stats[mk] ||= { month: mk, income: 0, spend: 0, invest: 0, otherCredits: 0, byCategory: {}, count: 0 });
    s.count++;
    if (isIncome(t)) s.income += t.amount;
    else if (isInvestment(t)) s.invest += t.amount;
    else if (isSpend(t)) { s.spend += t.amount; s.byCategory[t.category] = (s.byCategory[t.category] || 0) + t.amount; }
    else if (t.direction === 'credit' && !t.selfTransfer) s.otherCredits += t.amount;
  }
  for (const s of Object.values(stats)) {
    s.income = round2(s.income); s.spend = round2(s.spend); s.invest = round2(s.invest); s.otherCredits = round2(s.otherCredits);
    for (const k of Object.keys(s.byCategory)) s.byCategory[k] = round2(s.byCategory[k]);
  }
  return stats;
}

/** Complete months available for averaging (the as-of month counts only if it has ended). */
export function completeMonths(stats, asOf) {
  const cur = monthKey(asOf);
  const curComplete = Number(asOf.slice(8, 10)) === daysInMonth(cur);
  return Object.keys(stats).sort().filter((mk) => mk < cur || (mk === cur && curComplete));
}

/**
 * @param {{transactions:object[], profile:object}} state
 * @param {{items:object[]}} recurring output of detectRecurring
 * @param {string} asOf
 */
export function deriveProfile(state, recurring, asOf) {
  const profile = { ...defaultProfile(), ...(state.profile || {}) };
  const txs = state.transactions;
  const stats = monthlyStats(txs);
  const months = completeMonths(stats, asOf).slice(-3);
  const basisMonths = months.length ? months : [monthKey(asOf)];

  const detectedIncome = round2(median(basisMonths.map((m) => stats[m]?.income || 0)));
  const income = profile.incomeOverride && profile.incomeOverride > 0 ? Number(profile.incomeOverride) : detectedIncome;

  const fixedRecurring = recurring.items.filter((r) => r.status === 'active' && FIXED_CATEGORIES.has(r.category));
  const investRecurring = recurring.items.filter((r) => r.status === 'active' && r.category === 'Investments');
  const fixedTxIds = new Set([...fixedRecurring, ...investRecurring].flatMap((r) => r.txIds));

  const fixedCosts = [
    ...fixedRecurring.map((r) => ({ id: r.id, name: r.merchant, amount: r.monthlyEquivalent, category: r.category, source: 'detected', recurringId: r.id })),
    ...(profile.manualFixedCosts || []).map((f) => ({ ...f, source: 'manual' })),
  ];
  const fixedTotal = round2(fixedCosts.reduce((a, f) => a + f.amount, 0));
  const committedInvestments = round2(investRecurring.reduce((a, r) => a + r.monthlyEquivalent, 0));

  // variable spend per category: average over basis months, excluding fixed recurring txns
  const variableByCategory = {};
  for (const mk of basisMonths) {
    for (const t of txs) {
      if (monthKey(t.date) !== mk || !isSpend(t) || fixedTxIds.has(t.id)) continue;
      variableByCategory[t.category] = (variableByCategory[t.category] || 0) + t.amount;
    }
  }
  for (const k of Object.keys(variableByCategory)) variableByCategory[k] = round2(variableByCategory[k] / basisMonths.length);
  const variableTotal = round2(Object.values(variableByCategory).reduce((a, b) => a + b, 0));

  const monthlyExpenses = round2(fixedTotal + variableTotal);
  const ef = profile.emergencyFund || { current: 0, targetMonths: 6 };
  const efTarget = round2(monthlyExpenses * (Number(ef.targetMonths) || 6));

  const suggestedBudgets = {};
  for (const c of BUDGETABLE) {
    const v = variableByCategory[c];
    if (v && v >= 500) suggestedBudgets[c] = Math.round(v / 100) * 100;
  }
  const budgets = Object.keys(profile.budgets || {}).length ? { ...suggestedBudgets, ...profile.budgets } : suggestedBudgets;

  return {
    asOf,
    basisMonths,
    stats,
    income: round2(income),
    detectedIncome,
    incomeSource: profile.incomeOverride ? 'user' : 'detected',
    fixedCosts,
    fixedTotal,
    fixedTxIds: [...fixedTxIds],
    committedInvestments,
    variableByCategory,
    variableTotal,
    monthlyExpenses,
    surplus: round2(income - fixedTotal - variableTotal - committedInvestments),
    savingsRate: income > 0 ? round2(((income - monthlyExpenses) / income) * 100) : 0,
    emergencyFund: {
      current: round2(Number(ef.current) || 0),
      targetMonths: Number(ef.targetMonths) || 6,
      targetAmount: efTarget,
      coverageMonths: monthlyExpenses > 0 ? round2((Number(ef.current) || 0) / monthlyExpenses) : 0,
      targetDate: ef.targetDate || `${addMonths(monthKey(asOf), 12)}-28`,
    },
    goals: profile.goals || [],
    budgets,
    budgetsAreSuggested: !Object.keys(profile.budgets || {}).length,
    profile,
  };
}
