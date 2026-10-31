// Goal planner with what-if simulation. Pure deterministic maths — the AI may help turn
// a sentence into adjustments, but it never produces the numbers.

import { CATEGORIES, isValidCategory } from './categories.js';
import { addMonths, monthKey, monthsBetween, round2 } from './utils.js';

export const ADJUSTMENT_TYPES = ['category', 'income', 'one_time', 'new_recurring', 'investment'];

/** Build the planning model from a derived profile. */
export function buildBaseline(derived) {
  const goals = [];
  const ef = derived.emergencyFund;
  if (ef.targetAmount > 0 && ef.current < ef.targetAmount) {
    goals.push({ id: 'emergency', name: 'Emergency fund', targetAmount: ef.targetAmount, saved: ef.current, targetDate: ef.targetDate, isEmergency: true });
  }
  for (const g of derived.goals) goals.push({ id: g.id, name: g.name, targetAmount: g.targetAmount, saved: g.saved || 0, targetDate: g.targetDate });
  return {
    startMonth: addMonths(monthKey(derived.asOf), 1),
    income: derived.income,
    fixed: derived.fixedCosts.map((f) => ({ name: f.name, category: f.category, amount: f.amount })),
    variable: { ...derived.variableByCategory },
    investments: derived.committedInvestments,
    oneTime: [],     // {monthOffset, amount, name}
    timed: [],       // changes that start later: {fromMonth, kind, ...}
    goals,
  };
}

const clampNum = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};

/** Strictly validates adjustments (also used on AI output). Unknown/invalid items are dropped with a reason. */
export function validateAdjustments(list) {
  const valid = [];
  const rejected = [];
  if (!Array.isArray(list)) return { valid, rejected: [{ item: list, reason: 'not a list' }] };
  for (const a of list.slice(0, 10)) {
    if (!a || typeof a !== 'object' || !ADJUSTMENT_TYPES.includes(a.type)) { rejected.push({ item: a, reason: 'unknown type' }); continue; }
    const mode = a.mode === 'abs' ? 'abs' : 'pct';
    const fromMonth = clampNum(a.fromMonth ?? 0, 0, 60) ?? 0;
    if (a.type === 'category') {
      if (!isValidCategory(a.category)) { rejected.push({ item: a, reason: 'invalid category' }); continue; }
      const value = mode === 'pct' ? clampNum(a.value, -100, 500) : clampNum(a.value, -1e7, 1e7);
      if (value === null) { rejected.push({ item: a, reason: 'invalid value' }); continue; }
      valid.push({ type: 'category', category: a.category, mode, value, fromMonth });
    } else if (a.type === 'income') {
      const value = mode === 'pct' ? clampNum(a.value, -100, 500) : clampNum(a.value, -1e7, 1e7);
      if (value === null) { rejected.push({ item: a, reason: 'invalid value' }); continue; }
      valid.push({ type: 'income', mode, value, fromMonth });
    } else if (a.type === 'investment') {
      const value = clampNum(a.value, -1e7, 1e7);
      if (value === null) { rejected.push({ item: a, reason: 'invalid value' }); continue; }
      valid.push({ type: 'investment', mode: 'abs', value, fromMonth });
    } else if (a.type === 'one_time') {
      const amount = clampNum(a.amount, 1, 1e8);
      const monthOffset = clampNum(a.monthOffset ?? 0, 0, 60);
      if (amount === null || monthOffset === null) { rejected.push({ item: a, reason: 'invalid amount/month' }); continue; }
      valid.push({ type: 'one_time', amount, monthOffset: Math.round(monthOffset), name: String(a.name || 'One-time expense').slice(0, 40) });
    } else if (a.type === 'new_recurring') {
      const amount = clampNum(a.amount, -1e7, 1e7);
      if (amount === null) { rejected.push({ item: a, reason: 'invalid amount' }); continue; }
      const category = isValidCategory(a.category) ? a.category : 'Others';
      valid.push({ type: 'new_recurring', amount, name: String(a.name || 'New monthly cost').slice(0, 40), category, fromMonth });
    }
  }
  return { valid, rejected };
}

export function describeAdjustment(a) {
  const sign = (v) => (v > 0 ? '+' : '');
  switch (a.type) {
    case 'category': return `${a.category}: ${a.mode === 'pct' ? `${sign(a.value)}${a.value}%` : `${sign(a.value)}₹${a.value}/month`}${a.fromMonth ? ` from month ${a.fromMonth + 1}` : ''}`;
    case 'income': return `Income: ${a.mode === 'pct' ? `${sign(a.value)}${a.value}%` : `${sign(a.value)}₹${a.value}/month`}${a.fromMonth ? ` from month ${a.fromMonth + 1}` : ''}`;
    case 'investment': return `Monthly investing: ${sign(a.value)}₹${a.value}`;
    case 'one_time': return `${a.name}: ₹${a.amount} once, in month ${a.monthOffset + 1}`;
    case 'new_recurring': return `${a.name}: ${sign(a.amount)}₹${a.amount}/month (${a.category})`;
    default: return 'Unknown change';
  }
}

/** Monthly cash flow for month index m (0 = first planned month) under adjustments. */
function monthFlow(model, adjustments, m) {
  let income = model.income;
  const variable = { ...model.variable };
  const fixed = model.fixed.map((f) => ({ ...f }));
  let investments = model.investments;
  let extra = 0;
  let oneTime = 0;

  for (const a of adjustments) {
    if (a.type === 'one_time') { if (a.monthOffset === m) oneTime += a.amount; continue; }
    if ((a.fromMonth || 0) > m) continue;
    if (a.type === 'income') income = a.mode === 'pct' ? income * (1 + a.value / 100) : income + a.value;
    else if (a.type === 'investment') investments = Math.max(0, investments + a.value);
    else if (a.type === 'new_recurring') extra += a.amount;
    else if (a.type === 'category') {
      const fixedOfCat = fixed.filter((f) => f.category === a.category);
      if (a.mode === 'pct') {
        const factor = Math.max(0, 1 + a.value / 100);
        if (variable[a.category]) variable[a.category] *= factor;
        fixedOfCat.forEach((f) => { f.amount *= factor; });
      } else if (fixedOfCat.length && !variable[a.category]) {
        fixedOfCat[0].amount = Math.max(0, fixedOfCat[0].amount + a.value);
      } else {
        variable[a.category] = Math.max(0, (variable[a.category] || 0) + a.value);
      }
    }
  }
  const fixedTotal = fixed.reduce((s, f) => s + f.amount, 0);
  const variableTotal = Object.values(variable).reduce((s, v) => s + v, 0);
  const expenses = fixedTotal + variableTotal + extra;
  return {
    income: round2(income), fixedTotal: round2(fixedTotal), variableTotal: round2(variableTotal), extra: round2(extra),
    investments: round2(investments), oneTime: round2(oneTime), expenses: round2(expenses),
    surplus: round2(income - expenses - investments - oneTime), variable,
  };
}

/**
 * Simulates up to `months` months. Each month's surplus is shared across goals by deadline:
 * first every goal gets the pace it needs (remaining ÷ months left), then any leftover
 * accelerates the earliest-deadline goals. Deficit months never drain goal savings.
 */
export function simulate(model, adjustments = [], { months = 60 } = {}) {
  const goals = model.goals.map((g) => ({ ...g, remaining: Math.max(0, g.targetAmount - (g.saved || 0)), eta: g.saved >= g.targetAmount ? model.startMonth : null }))
    .sort((a, b) => (a.targetDate < b.targetDate ? -1 : 1));
  const timeline = [];
  let deficitMonths = 0;
  let cumulativeDeficit = 0;
  let totalSaved = 0;
  const startRequired = {};
  for (const g of goals) {
    const left = monthsBetween(model.startMonth, monthKey(g.targetDate)) + 1;
    startRequired[g.id] = round2(g.remaining / Math.max(1, left));
  }

  for (let m = 0; m < months; m++) {
    const mk = addMonths(model.startMonth, m);
    const flow = monthFlow(model, adjustments, m);
    let avail = flow.surplus;
    if (avail < 0) { deficitMonths++; cumulativeDeficit += -avail; avail = 0; }
    const alloc = {};
    for (const g of goals) {
      if (g.remaining <= 0) continue;
      const left = Math.max(1, monthsBetween(mk, monthKey(g.targetDate)) + 1);
      const give = Math.min(avail, g.remaining / left, g.remaining);
      g.remaining -= give; avail -= give; alloc[g.id] = (alloc[g.id] || 0) + give;
    }
    for (const g of goals) {
      if (avail <= 0) break;
      if (g.remaining <= 0) continue;
      const give = Math.min(avail, g.remaining);
      g.remaining -= give; avail -= give; alloc[g.id] = (alloc[g.id] || 0) + give;
    }
    for (const g of goals) if (g.remaining <= 0.01 && !g.eta) { g.remaining = 0; g.eta = mk; }
    totalSaved += flow.surplus > 0 ? flow.surplus : 0;
    timeline.push({
      month: mk, income: flow.income, expenses: flow.expenses, investments: flow.investments, oneTime: flow.oneTime,
      surplus: flow.surplus, unallocated: round2(avail),
      goals: Object.fromEntries(goals.map((g) => [g.id, round2(g.targetAmount - g.remaining)])),
      alloc: Object.fromEntries(Object.entries(alloc).map(([k, v]) => [k, round2(v)])),
    });
    if (goals.every((g) => g.remaining <= 0) && m >= 11) break;
  }

  const goalResults = goals.map((g) => {
    const targetMonth = monthKey(g.targetDate);
    const onTrack = Boolean(g.eta && g.eta <= targetMonth);
    const atTarget = timeline.find((t) => t.month === targetMonth);
    return {
      id: g.id, name: g.name, isEmergency: Boolean(g.isEmergency), targetAmount: g.targetAmount, saved: g.saved || 0,
      targetDate: g.targetDate, targetMonth, eta: g.eta, onTrack,
      monthsLate: g.eta ? Math.max(0, monthsBetween(targetMonth, g.eta)) : null,
      requiredMonthly: startRequired[g.id],
      projectedAtTarget: atTarget ? atTarget.goals[g.id] : null,
    };
  });

  const first = timeline[0] || monthFlow(model, adjustments, 0);
  return {
    startMonth: model.startMonth,
    monthlySurplus: first.surplus,
    firstMonth: first,
    goals: goalResults,
    timeline,
    deficitMonths,
    cumulativeDeficit: round2(cumulativeDeficit),
    totalSavedOverHorizon: round2(totalSaved),
  };
}

/** Baseline vs scenario, with per-goal differences in months. */
export function compareScenario(model, adjustments) {
  const { valid, rejected } = validateAdjustments(adjustments);
  const base = simulate(model, []);
  const scen = simulate(model, valid);
  const goals = base.goals.map((bg) => {
    const sg = scen.goals.find((g) => g.id === bg.id);
    const delta = bg.eta && sg.eta ? monthsBetween(sg.eta, bg.eta) : null; // positive = scenario earlier
    return { id: bg.id, name: bg.name, targetMonth: bg.targetMonth, baselineEta: bg.eta, scenarioEta: sg.eta, monthsEarlier: delta, baselineOnTrack: bg.onTrack, scenarioOnTrack: sg.onTrack };
  });
  return {
    adjustments: valid,
    rejected,
    descriptions: valid.map(describeAdjustment),
    baseline: base,
    scenario: scen,
    surplusChange: round2(scen.monthlySurplus - base.monthlySurplus),
    goals,
  };
}

// ---------- Local natural-language fallback (used when the AI is unavailable) ----------

const SYNONYMS = [
  [/dining( out)?|eating out|restaurants?|food delivery|swiggy|zomato|takeaway|food/, 'Food & Dining'],
  [/grocer(y|ies)|kirana|zepto|blinkit|bigbasket/, 'Groceries'],
  [/rent|housing|house rent/, 'Rent & Housing'],
  [/uber|ola|cab|commute|transport|travel to work|fuel|petrol/, 'Transport'],
  [/shopping|amazon|flipkart|myntra|clothes/, 'Shopping'],
  [/subscriptions?|netflix|spotify|ott/, 'Subscriptions'],
  [/movies?|entertainment|outings?/, 'Entertainment'],
  [/bills?|electricity|utilities|phone bill|recharge/, 'Bills & Utilities'],
  [/trips?|vacation|holiday|flights?|travel/, 'Travel'],
  [/emi|loan/, 'EMI & Loans'],
  [/health|medical|medicine/, 'Health'],
  [/education|course|classes/, 'Education'],
];

function findCategory(s) {
  for (const [re, c] of SYNONYMS) if (re.test(s)) return c;
  const direct = CATEGORIES.find((c) => s.includes(c.toLowerCase()));
  return direct || null;
}

const num = (s) => {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k|thousand|l|lakh|lakhs|lac)?/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === 'k' || u === 'thousand') v *= 1000;
  if (['l', 'lakh', 'lakhs', 'lac'].includes(u)) v *= 100000;
  return v;
};

/** Rule-based parser for common what-if sentences. Returns adjustments (may be empty). */
export function parseScenarioLocally(text) {
  const out = [];
  const clauses = String(text || '').toLowerCase().split(/\band\b|,(?!\d)|;|\balso\b/);
  for (const raw of clauses) {
    const s = raw.trim();
    if (!s) continue;
    const s2 = s.replace(/in\s+\d+\s+months?/, ' ');
    const pct = s2.match(/(\d+(?:\.\d+)?)\s*(%|percent)/);
    const amt = s2.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?\s*(?:k|thousand|lakhs?|lac|l)?)\b/i);
    const down = /\b(cut|reduce|less|lower|drop|decrease|save on|spend less)\b/.test(s);
    const up = /\b(up|increase|more|raise|hike|goes up|rises?|higher|grow)\b/.test(s);
    const monthsIn = s.match(/in\s+(\d+)\s+months?/);
    const fromMonth = monthsIn ? Number(monthsIn[1]) : 0;

    if (/\b(salary|income|pay|raise|hike|bonus)\b/.test(s) && !/\bone[- ]time|bonus\b/.test(s)) {
      if (pct) out.push({ type: 'income', mode: 'pct', value: (down ? -1 : 1) * Number(pct[1]), fromMonth });
      else if (amt) out.push({ type: 'income', mode: 'abs', value: (down ? -1 : 1) * num(amt[1]), fromMonth });
      continue;
    }
    if (/\b(buy|purchase|spend|pay for|trip|wedding|laptop|phone)\b/.test(s) && /\bonce|one[- ]time|buy|purchase|wedding|laptop|phone\b/.test(s) && amt && !pct) {
      out.push({ type: 'one_time', amount: num(amt[1]), monthOffset: fromMonth, name: s.slice(0, 40) });
      continue;
    }
    if (/\b(sip|invest)/.test(s) && amt && !pct) {
      out.push({ type: 'investment', mode: 'abs', value: (down ? -1 : 1) * num(amt[1]) });
      continue;
    }
    const cat = findCategory(s);
    if (cat) {
      if (pct) out.push({ type: 'category', category: cat, mode: 'pct', value: (down ? -1 : up ? 1 : -1) * Number(pct[1]), fromMonth });
      else if (amt) out.push({ type: 'category', category: cat, mode: 'abs', value: (down ? -1 : 1) * num(amt[1]), fromMonth });
    }
  }
  return validateAdjustments(out).valid;
}
