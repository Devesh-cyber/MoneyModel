import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmsBatch } from '../src/core/ingest/sms.js';
import { parseCsvStatement } from '../src/core/ingest/csv.js';
import { parsePdfStatement } from '../src/core/ingest/pdf.js';
import * as E from '../src/core/engine.js';
import { compareScenario, parseScenarioLocally, simulate, validateAdjustments } from '../src/core/planner.js';
import { makeGoal } from '../src/core/profile.js';
import { computeMonthlyReport, localNarrative, reportToAiPayload } from '../src/core/report.js';
import { readDemo, demo, extractPdfNode } from './helpers.mjs';

async function loadAll({ aiCategorize } = {}) {
  let st = E.emptyState();
  st.profile.ownNames = ['Aarav Mehta'];
  const csv = parseCsvStatement(readDemo('hdfc-statement.csv'));
  const pdf = parsePdfStatement(await extractPdfNode(demo('sbi-statement.pdf')));
  const sms = parseSmsBatch(readDemo('sms-october.txt'), { fallbackDate: '2026-10-31' });
  const r1 = await E.importTransactions(st, csv.txs, { source: 'csv', aiCategorize }); st = r1.state;
  const r2 = await E.importTransactions(st, pdf.txs, { source: 'pdf', aiCategorize }); st = r2.state;
  const r3 = await E.importTransactions(st, sms.txs, { source: 'sms', skipped: sms.skipped, aiCategorize }); st = r3.state;
  return { st, csv, pdf, sms, r1, r2, r3 };
}

test('dedupe: SMS matched to statements; re-import adds nothing', async () => {
  const { st, csv, sms, r3 } = await loadAll();
  assert.equal(r3.summary.added, 4, 'only ICICI credit-card SMS are new');
  assert.equal(r3.summary.matchedOtherSource, sms.txs.length - 4);
  assert.equal(st.transactions.length, 158 + 13 + 4);
  const again = await E.importTransactions(st, csv.txs, { source: 'csv' });
  assert.equal(again.summary.added, 0);
  assert.equal(again.summary.alreadyImported, csv.txs.length);
});

test('dedupe: two genuine identical payments on one day stay two', async () => {
  let st = E.emptyState();
  const raw = { date: '2026-10-05', amount: 20, direction: 'debit', merchant: 'CHAI POINT', rawText: 'UPI-CHAI POINT' };
  st = (await E.importTransactions(st, [raw, { ...raw }], { source: 'csv' })).state;
  assert.equal(st.transactions.length, 2);
  // the SMS for both should match 1:1, not collapse
  const smsRaw = { date: '2026-10-05', amount: 20, direction: 'debit', merchant: 'CHAI POINT', rawText: 'Sent Rs.20 To CHAI POINT' };
  const r = await E.importTransactions(st, [smsRaw, { ...smsRaw }], { source: 'sms' });
  assert.equal(r.summary.added, 0);
  assert.equal(r.summary.matchedOtherSource, 2);
});

test('categorisation: self transfers detected; AI only gets unknown merchants, redacted', async () => {
  const sent = [];
  const aiCategorize = async (items) => {
    sent.push(...items);
    const out = {};
    for (const it of items) out[it.k] = { category: it.merchant === '[PERSON]' ? 'Transfers' : it.merchant.includes('TOKAI') ? 'Food & Dining' : 'NOT A CATEGORY', confidence: 0.8 };
    return out;
  };
  const { st } = await loadAll({ aiCategorize });
  const self = st.transactions.filter((t) => t.selfTransfer);
  assert.equal(self.length, 6);
  const unique = new Set(sent.map((s) => s.merchant + s.direction + s.amountBand));
  assert.ok(sent.length > 0 && unique.size < 15, 'only a handful of unique unknown merchants go to AI');
  const merchants = sent.map((s) => s.merchant);
  assert.ok(!merchants.some((m) => /RAJESH|ROHAN|PRIYA|AARAV/i.test(m)), 'no person names sent');
  assert.ok(sent.every((s) => !('date' in s) && !('amount' in s) && typeof s.amountBand === 'string'));
  const tokai = st.transactions.find((t) => /TOKAI/.test(t.merchant));
  assert.equal(tokai.category, 'Food & Dining'); assert.equal(tokai.categorySource, 'ai');
  // invalid AI category falls back to heuristics / Uncategorized, never stored
  assert.ok(st.transactions.every((t) => t.category !== 'NOT A CATEGORY'));
});

test('categorisation: AI failure is handled gracefully', async () => {
  const { st } = await loadAll({ aiCategorize: async () => { throw new Error('boom'); } });
  assert.ok(st.transactions.length === 175);
  assert.ok(st.imports[0].categorization.aiError);
});

test('correction loop: learn rule, apply to past and future', async () => {
  let { st } = await loadAll();
  const rent = st.transactions.find((t) => t.merchant === 'RAJESH KULKARNI');
  assert.equal(rent.category, 'Transfers');
  const res = E.correctCategory(st, rent.id, 'Rent & Housing', 'always');
  st = res.state;
  assert.equal(res.appliedCount, 3);
  assert.equal(st.rules.length, 1);
  assert.ok(st.transactions.filter((t) => t.merchant === 'RAJESH KULKARNI').every((t) => t.category === 'Rent & Housing'));
  // future transaction picks up the learned rule
  const next = await E.importTransactions(st, [{ date: '2026-11-03', amount: 18000, direction: 'debit', merchant: 'RAJESH KULKARNI', rawText: 'UPI-RAJESH KULKARNI-nov' }], { source: 'csv' });
  const nov = next.state.transactions.find((t) => t.date === '2026-11-03');
  assert.equal(nov.category, 'Rent & Housing'); assert.equal(nov.categorySource, 'rule');
  // "once" corrections are not overwritten by rules
  const once = E.correctCategory(next.state, nov.id, 'Others', 'once').state;
  const again = await E.recategorize(once, {});
  assert.equal(again.state.transactions.find((t) => t.id === nov.id).category, 'Others');
  // deleting the rule releases its transactions
  const after = await E.removeRule(st, st.rules[0].id);
  assert.ok(after.transactions.filter((t) => t.merchant === 'RAJESH KULKARNI').every((t) => t.category !== 'Rent & Housing'));
});

test('recurring: subscriptions, 28-day telecom, price change, usage check-ins', async () => {
  let { st } = await loadAll();
  let all = E.deriveAll(st);
  const names = all.recurring.items.map((r) => r.merchant);
  for (const n of ['NETFLIX', 'SPOTIFY INDIA', 'RELIANCE JIO', 'CULTFIT', 'BAJAJ FINANCE LTD', 'ADANI ELECTRICITY', 'GROWW INVEST TECH']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('SWIGGY'), 'everyday food orders are not subscriptions');
  const nf = all.recurring.items.find((r) => r.merchant === 'NETFLIX');
  assert.deepEqual([nf.typicalAmount, nf.lastAmount], [499, 649]);
  assert.ok(all.recurring.alerts.some((a) => a.type === 'price_change' && a.recurringId === nf.id));
  const cult = all.recurring.items.find((r) => r.merchant === 'CULTFIT');
  st = E.setRecurringUsage(st, cult.id, 'not_used', all.asOf);
  all = E.deriveAll(st);
  assert.ok(all.recurring.alerts.some((a) => a.type === 'unused' && a.recurringId === cult.id));
  st = E.setRecurringUsage(st, cult.id, 'used', all.asOf);
  all = E.deriveAll(st);
  assert.ok(!all.recurring.alerts.some((a) => a.type === 'unused' && a.recurringId === cult.id));
  // stale usage → unused after 1.5 cycles
  all = E.deriveAll(st, { asOf: '2026-12-20' });
  assert.ok(all.recurring.alerts.some((a) => a.recurringId === cult.id && (a.type === 'unused' || a.type === 'missed')));
});

test('profile: income detected, self-transfers excluded, fixed costs from recurring', async () => {
  const { st } = await loadAll();
  const { derived } = E.deriveAll(st);
  assert.ok(derived.income >= 85000 && derived.income < 85300);
  assert.deepEqual(derived.basisMonths, ['2026-08', '2026-09']);
  assert.ok(derived.fixedCosts.some((f) => f.name === 'BAJAJ FINANCE LTD' && f.amount === 3250));
  assert.ok(derived.committedInvestments > 4900);
  const sepSpend = derived.stats['2026-09'].spend;
  assert.ok(sepSpend < 85000, 'self transfer of 15000 not counted as spend');
});

test('planner: goals, what-if, validation, local NL parsing', async () => {
  let { st } = await loadAll();
  st = { ...st, profile: { ...st.profile, emergencyFund: { current: 60000, targetMonths: 6 }, goals: [makeGoal({ name: 'Goa trip', targetAmount: 40000, targetDate: '2027-03-31' })] } };
  const all = E.deriveAll(st);
  const food = all.model.variable['Food & Dining'];
  const cmp = compareScenario(all.model, [{ type: 'category', category: 'Food & Dining', mode: 'pct', value: -30 }]);
  assert.ok(Math.abs(cmp.surplusChange - food * 0.3) < 1, 'surplus rises by exactly 30% of food spend');
  assert.ok(cmp.goals.every((g) => g.monthsEarlier === null || g.monthsEarlier >= 0));
  const rent = compareScenario(all.model, [{ type: 'category', category: 'Transfers', mode: 'abs', value: 3000 }]);
  assert.ok(Math.abs(rent.surplusChange + 3000) < 1);
  const bad = validateAdjustments([{ type: 'category', category: 'Stocks', value: 5 }, { type: 'hack' }, { type: 'income', mode: 'pct', value: 99999 }]);
  assert.equal(bad.valid.length, 1); assert.equal(bad.valid[0].value, 500); assert.equal(bad.rejected.length, 2);
  assert.deepEqual(parseScenarioLocally('what if I cut dining out by 30%'), [{ type: 'category', category: 'Food & Dining', mode: 'pct', value: -30, fromMonth: 0 }]);
  const r2 = parseScenarioLocally('rent goes up by 3,000 and salary increases by 10%');
  assert.equal(r2.length, 2);
  assert.deepEqual([r2[0].category, r2[0].value, r2[1].type, r2[1].value], ['Rent & Housing', 3000, 'income', 10]);
  const one = parseScenarioLocally('buy a laptop for 80k in 3 months');
  assert.deepEqual([one[0].type, one[0].amount, one[0].monthOffset], ['one_time', 80000, 3]);
  // deficits never drain goals
  const sim = simulate(all.model, [{ type: 'income', mode: 'pct', value: -100 }]);
  assert.ok(sim.deficitMonths > 0); assert.ok(sim.goals.every((g) => !g.eta || g.saved >= g.targetAmount));
});

test('nudges + monthly report', async () => {
  const { st } = await loadAll();
  const all = E.deriveAll(st);
  assert.ok(all.nudges.some((n) => n.type === 'over_budget' && n.category === 'Food & Dining'));
  assert.ok(all.nudges.some((n) => n.type === 'price_change'));
  const dismissed = E.dismissNudge(st, all.nudges[0].id);
  assert.ok(!E.deriveAll(dismissed).nudges.some((n) => n.id === all.nudges[0].id));
  const rep = computeMonthlyReport(st.transactions, '2026-09', { derived: all.derived, recurring: all.recurring, rules: st.rules });
  assert.equal(rep.income, 85212);
  assert.ok(rep.categories.length > 3);
  const payload = JSON.stringify(reportToAiPayload(rep));
  assert.ok(!/RAJESH|ROHAN|PRIYA|AARAV|4821|7730/.test(payload), 'no names or account digits in AI payload');
  assert.ok(localNarrative(rep).includes('2026-09'));
});

test('coach context is aggregated (no transactions, no names)', async () => {
  const { st } = await loadAll();
  const ctx = JSON.stringify(E.buildCoachContext(E.deriveAll(st)));
  assert.ok(!/RAJESH|ROHAN|PRIYA|AARAV|429\d{9}|rawText/.test(ctx));
});
