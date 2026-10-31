// Engine facade: one place the UI (or tests) call. Pure state in → new state out.
// The AI is injected as a function so the engine never talks to the network itself.

import { categorizeTransactions } from './categorize.js';
import { mergeTransactions, normalizeBatch } from './normalize.js';
import { deleteRule, learnFromCorrection } from './rules.js';
import { detectRecurring } from './recurring.js';
import { defaultProfile, deriveProfile } from './profile.js';
import { buildBaseline, simulate } from './planner.js';
import { computeNudges } from './nudges.js';
import { todayISO, uid } from './utils.js';

export const STATE_VERSION = 1;

export function emptyState() {
  return {
    version: STATE_VERSION,
    transactions: [],
    rules: [],
    profile: defaultProfile(),
    recurringMeta: {},
    dismissedNudges: [],
    receipts: [],
    imports: [],
    settings: { autoLockMinutes: 5, aiEnabled: true, asOfMode: 'latest' },
  };
}

/** Fills in fields missing from older saved states. */
export function migrateState(s) {
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  return {
    ...base,
    ...s,
    profile: { ...base.profile, ...(s.profile || {}) },
    settings: { ...base.settings, ...(s.settings || {}) },
    version: STATE_VERSION,
  };
}

export const redactionTerms = (state) => [...(state.profile.ownNames || []), ...(state.profile.hiddenTerms || [])];

/**
 * @param {object} state
 * @param {object[]} rawTxs parser output
 * @param {{source:'sms'|'csv'|'pdf'|'manual', label?:string, skipped?:object[], aiCategorize?:Function}} opts
 */
export async function importTransactions(state, rawTxs, { source, label = '', skipped = [], aiCategorize } = {}) {
  const batchId = uid('batch');
  const importedAt = new Date().toISOString();
  const normalized = normalizeBatch(rawTxs, { source, batchId, importedAt });
  const { merged, added, duplicates, linked } = mergeTransactions(state.transactions, normalized);
  const addedIds = new Set(added.map((t) => t.id));
  const cat = await categorizeTransactions(merged, {
    rules: state.rules,
    ownNames: state.profile.ownNames,
    customTerms: redactionTerms(state),
    aiCategorize: state.settings.aiEnabled ? aiCategorize : undefined,
  });
  const skipReasons = {};
  for (const s of skipped) skipReasons[s.reason] = (skipReasons[s.reason] || 0) + 1;
  const record = {
    id: batchId,
    at: importedAt,
    source,
    label: String(label).slice(0, 80),
    parsed: rawTxs.length,
    added: added.length,
    alreadyImported: duplicates.filter((d) => d.reason === 'already_imported').length,
    matchedOtherSource: linked.length,
    skipped: skipped.length,
    skipReasons,
    categorization: cat.stats,
  };
  return {
    state: { ...state, transactions: cat.transactions, imports: [record, ...state.imports].slice(0, 50) },
    summary: record,
    addedIds: [...addedIds],
  };
}

export async function recategorize(state, { aiCategorize, force = false } = {}) {
  const cat = await categorizeTransactions(state.transactions, {
    rules: state.rules,
    ownNames: state.profile.ownNames,
    customTerms: redactionTerms(state),
    aiCategorize: state.settings.aiEnabled ? aiCategorize : undefined,
    force,
  });
  return { state: { ...state, transactions: cat.transactions }, stats: cat.stats };
}

export function correctCategory(state, txId, category, scope = 'always') {
  return learnFromCorrection(state, txId, category, scope);
}

export async function removeRule(state, ruleId, { aiCategorize } = {}) {
  const next = deleteRule(state, ruleId);
  return (await recategorize(next, { aiCategorize })).state;
}

export function setRecurringUsage(state, recurringId, action, asOf) {
  const meta = { ...state.recurringMeta };
  const cur = { ...(meta[recurringId] || {}) };
  if (action === 'used') { cur.lastUsedAt = asOf; cur.markedUnused = false; }
  else if (action === 'not_used') { cur.markedUnused = true; }
  else if (action === 'not_recurring') { cur.notRecurring = true; }
  else if (action === 'reset') { meta[recurringId] = {}; return { ...state, recurringMeta: meta }; }
  else throw new Error('Unknown usage action');
  meta[recurringId] = cur;
  return { ...state, recurringMeta: meta };
}

export function dismissNudge(state, id) {
  return { ...state, dismissedNudges: [...new Set([...state.dismissedNudges, id])].slice(-500) };
}

export function computeAsOf(state) {
  if (state.settings.asOfMode === 'today' || !state.transactions.length) return todayISO();
  return state.transactions.reduce((m, t) => (t.date > m ? t.date : m), state.transactions[0].date);
}

export function deriveAll(state, { asOf } = {}) {
  const at = asOf || computeAsOf(state);
  const recurring = detectRecurring(state.transactions, { asOf: at, meta: state.recurringMeta });
  const derived = deriveProfile(state, recurring, at);
  const model = buildBaseline(derived);
  const simulation = simulate(model, []);
  const nudges = computeNudges(state.transactions, derived, recurring, simulation, { asOf: at, dismissed: state.dismissedNudges });
  return { asOf: at, recurring, derived, model, simulation, nudges };
}

/** Aggregated, name-free context for the coach. Never includes raw transactions. */
export function buildCoachContext(all) {
  const { derived, simulation, recurring } = all;
  return {
    asOf: all.asOf,
    monthlyIncome: derived.income,
    monthlyFixedCosts: derived.fixedTotal,
    fixedCosts: derived.fixedCosts.map((f) => ({ category: f.category, amount: f.amount })),
    monthlyVariableSpend: derived.variableByCategory,
    monthlyInvesting: derived.committedInvestments,
    monthlySurplus: simulation.monthlySurplus,
    savingsRatePct: derived.savingsRate,
    emergencyFund: { current: derived.emergencyFund.current, coverageMonths: derived.emergencyFund.coverageMonths, targetMonths: derived.emergencyFund.targetMonths },
    budgets: derived.budgets,
    goals: simulation.goals.map((g) => ({ name: g.name, target: g.targetAmount, saved: g.saved, targetMonth: g.targetMonth, projectedMonth: g.eta, onTrack: g.onTrack, requiredMonthly: g.requiredMonthly })),
    subscriptions: recurring.items.filter((r) => r.category === 'Subscriptions').map((r) => ({ name: r.merchant, monthly: r.monthlyEquivalent })),
  };
}
