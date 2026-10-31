// Monthly review: computed locally; the AI only writes the narrative from aggregates.

import { addMonths, monthKey, round2 } from './utils.js';
import { isIncome, isInvestment, isSpend } from './profile.js';
import { looksLikePersonName } from '../security/redact.js';

export function computeMonthlyReport(transactions, month, { derived, recurring, rules = [] }) {
  const inMonth = transactions.filter((t) => monthKey(t.date) === month);
  const prevMonth = addMonths(month, -1);
  const inPrev = transactions.filter((t) => monthKey(t.date) === prevMonth);

  const sum = (arr, f) => round2(arr.filter(f).reduce((a, t) => a + t.amount, 0));
  const income = sum(inMonth, isIncome);
  const spend = sum(inMonth, isSpend);
  const invest = sum(inMonth, isInvestment);
  const prevSpend = sum(inPrev, isSpend);

  const cats = {};
  const prevCats = {};
  for (const t of inMonth) if (isSpend(t)) cats[t.category] = (cats[t.category] || 0) + t.amount;
  for (const t of inPrev) if (isSpend(t)) prevCats[t.category] = (prevCats[t.category] || 0) + t.amount;
  const categories = Object.entries(cats)
    .map(([category, amount]) => ({
      category,
      amount: round2(amount),
      previous: round2(prevCats[category] || 0),
      changePct: prevCats[category] ? round2(((amount - prevCats[category]) / prevCats[category]) * 100) : null,
      budget: derived.budgets[category] || null,
      overBudget: derived.budgets[category] ? amount > derived.budgets[category] : false,
    }))
    .sort((a, b) => b.amount - a.amount);

  const merchants = {};
  for (const t of inMonth) {
    if (!isSpend(t)) continue;
    const isPerson = t.p2p || looksLikePersonName(t.merchant);
    const name = isPerson ? 'Payments to people' : t.merchant;
    merchants[name] = (merchants[name] || { name, amount: 0, count: 0, isPerson });
    merchants[name].amount += t.amount; merchants[name].count++;
  }
  const topMerchants = Object.values(merchants).map((m) => ({ ...m, amount: round2(m.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 5);

  const biggest = inMonth.filter(isSpend).sort((a, b) => b.amount - a.amount).slice(0, 3)
    .map((t) => ({ date: t.date, amount: t.amount, category: t.category, merchant: t.p2p || looksLikePersonName(t.merchant) ? 'A person' : t.merchant }));

  const recurringInMonth = recurring.items.filter((r) => r.txIds.some((id) => inMonth.some((t) => t.id === id)));
  const priceChanges = recurring.alerts.filter((a) => a.type === 'price_change' && a.id.includes(`_${month}`));

  const rulesLearned = rules.filter((r) => (r.createdAt || '').slice(0, 7) === month).length;
  const uncategorized = inMonth.filter((t) => t.category === 'Uncategorized').length;

  return {
    month,
    income,
    spend,
    invest,
    net: round2(income - spend - invest),
    savingsRate: income > 0 ? round2(((income - spend) / income) * 100) : null,
    previousMonth: prevMonth,
    previousSpend: prevSpend,
    spendChangePct: prevSpend > 0 ? round2(((spend - prevSpend) / prevSpend) * 100) : null,
    categories,
    topMerchants,
    biggest,
    recurringTotal: round2(recurringInMonth.reduce((a, r) => a + r.lastAmount, 0)),
    recurringCount: recurringInMonth.length,
    priceChanges: priceChanges.map((p) => p.title),
    goals: derived.goals.map((g) => ({ name: g.name, saved: g.saved, targetAmount: g.targetAmount, targetDate: g.targetDate })),
    emergencyCoverageMonths: derived.emergencyFund.coverageMonths,
    rulesLearned,
    uncategorized,
    transactionCount: inMonth.length,
  };
}

/** Aggregates only — no raw text, no references, no person names. */
export function reportToAiPayload(r) {
  return {
    month: r.month,
    income: r.income, spend: r.spend, invest: r.invest, net: r.net, savingsRate: r.savingsRate,
    spendChangePct: r.spendChangePct,
    categories: r.categories.slice(0, 10).map((c) => ({ category: c.category, amount: c.amount, previous: c.previous, budget: c.budget })),
    topMerchants: r.topMerchants.map((m) => ({ name: m.name, amount: m.amount, count: m.count })),
    recurringTotal: r.recurringTotal,
    priceChanges: r.priceChanges,
    goals: r.goals.map((g) => ({ name: g.name, saved: g.saved, targetAmount: g.targetAmount, targetDate: g.targetDate })),
    emergencyCoverageMonths: r.emergencyCoverageMonths,
  };
}

/** Template narrative used when the AI is unavailable. */
export function localNarrative(r) {
  const lines = [];
  lines.push(`In ${r.month} you earned ₹${r.income} and spent ₹${r.spend}${r.invest ? `, and invested ₹${r.invest}` : ''}.`);
  if (r.savingsRate !== null) lines.push(`Your savings rate was ${r.savingsRate}%.`);
  if (r.spendChangePct !== null) lines.push(`Spending was ${Math.abs(r.spendChangePct)}% ${r.spendChangePct >= 0 ? 'higher' : 'lower'} than ${r.previousMonth}.`);
  const top = r.categories[0];
  if (top) lines.push(`Your biggest category was ${top.category} at ₹${top.amount}.`);
  const over = r.categories.filter((c) => c.overBudget);
  if (over.length) lines.push(`Over budget: ${over.map((c) => `${c.category} (₹${c.amount} vs ₹${c.budget})`).join(', ')}.`);
  if (r.priceChanges.length) lines.push(`Price changes: ${r.priceChanges.join('; ')}.`);
  if (r.uncategorized) lines.push(`${r.uncategorized} transaction(s) still need a category.`);
  return lines.join(' ');
}
