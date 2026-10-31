// Nudges: fire when spending drifts off plan, goals slip, the safety net is thin,
// something unusual happens, or a recurring payment changes.

import { daysInMonth, median, monthKey, round2 } from './utils.js';
import { isSpend } from './profile.js';

/**
 * @param {object[]} transactions
 * @param {object} derived  deriveProfile output
 * @param {{alerts:object[]}} recurring detectRecurring output
 * @param {object|null} simulation simulate() output for the baseline
 * @param {{asOf:string, dismissed?:string[]}} opts
 */
export function computeNudges(transactions, derived, recurring, simulation, { asOf, dismissed = [] }) {
  const nudges = [];
  const mk = monthKey(asOf);
  const day = Number(asOf.slice(8, 10));
  const dim = daysInMonth(mk);
  const fraction = day / dim;
  const fixedIds = new Set(derived.fixedTxIds);
  const recurringIds = new Set(recurring.items.flatMap((r) => r.txIds));

  // 1. Category drift vs budget (month-to-date, pace-adjusted)
  const mtd = {};
  for (const t of transactions) {
    if (monthKey(t.date) !== mk || t.date > asOf || !isSpend(t) || fixedIds.has(t.id)) continue;
    mtd[t.category] = (mtd[t.category] || 0) + t.amount;
  }
  for (const [cat, budget] of Object.entries(derived.budgets)) {
    const spent = round2(mtd[cat] || 0);
    if (!budget || spent <= 0) continue;
    const expectedByNow = budget * fraction;
    const projected = round2(spent / Math.max(fraction, 0.1));
    if (spent > budget) {
      nudges.push({
        id: `over_${cat}_${mk}`, type: 'over_budget', severity: 'warning', category: cat,
        title: `${cat} is over budget`,
        message: `₹${spent} spent this month against a ₹${budget} plan (${Math.round((spent / budget) * 100)}%).`,
        data: { spent, budget },
      });
    } else if (day >= 5 && spent > expectedByNow * 1.15 && spent > budget * 0.25) {
      nudges.push({
        id: `drift_${cat}_${mk}`, type: 'drift', severity: 'info', category: cat,
        title: `${cat} is running ahead of plan`,
        message: `₹${spent} so far, ${Math.round((spent / expectedByNow - 1) * 100)}% ahead of pace. At this rate: about ₹${projected} vs ₹${budget} planned.`,
        data: { spent, budget, projected },
      });
    }
  }

  // 2. Goals at risk
  if (simulation) {
    for (const g of simulation.goals) {
      if (!g.onTrack) {
        nudges.push({
          id: `goal_${g.id}_${mk}`, type: 'goal_at_risk', severity: 'warning', goalId: g.id,
          title: `${g.name} is behind schedule`,
          message: g.eta
            ? `At your current pace you'd reach it in ${g.eta}, ${g.monthsLate} month(s) after ${g.targetMonth}. You'd need about ₹${g.requiredMonthly}/month.`
            : `Your current surplus doesn't reach this goal in the next 5 years. You'd need about ₹${g.requiredMonthly}/month.`,
        });
      }
    }
    if (simulation.monthlySurplus < 0) {
      nudges.push({
        id: `deficit_${mk}`, type: 'deficit', severity: 'critical',
        title: 'Spending is above income',
        message: `Planned expenses exceed income by ₹${Math.abs(simulation.monthlySurplus)} a month.`,
      });
    }
  }

  // 3. Emergency fund
  const ef = derived.emergencyFund;
  if (derived.monthlyExpenses > 0 && ef.coverageMonths < 3) {
    nudges.push({
      id: `ef_${mk}`, type: 'emergency_fund', severity: ef.coverageMonths < 1 ? 'warning' : 'info',
      title: 'Your safety net is thin',
      message: `Your emergency fund covers ${ef.coverageMonths} month(s) of expenses. A common rule of thumb is 3–6 months (₹${ef.targetAmount} for ${ef.targetMonths}).`,
    });
  }

  // 4. Unusually large transaction this month
  const byCat = {};
  for (const t of transactions) if (isSpend(t) && !recurringIds.has(t.id)) (byCat[t.category] ||= []).push(t.amount);
  for (const t of transactions) {
    if (monthKey(t.date) !== mk || !isSpend(t) || recurringIds.has(t.id) || t.category === 'Transfers') continue;
    const arr = byCat[t.category] || [];
    if (arr.length < 4) continue;
    const med = median(arr);
    if (t.amount >= 2000 && t.amount > med * 3) {
      nudges.push({
        id: `big_${t.id}`, type: 'unusual', severity: 'info', txId: t.id,
        title: `Large ${t.category} payment`,
        message: `₹${t.amount} to ${t.merchant} on ${t.date} — about ${Math.round(t.amount / med)}× your usual ${t.category} payment.`,
      });
    }
  }

  // 5. Recurring alerts
  for (const a of recurring.alerts) nudges.push(a);

  const order = { critical: 0, warning: 1, info: 2 };
  const dis = new Set(dismissed);
  return nudges.filter((n) => !dis.has(n.id)).sort((a, b) => order[a.severity] - order[b.severity]);
}
