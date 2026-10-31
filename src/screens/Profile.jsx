import { useState } from 'react';
import { BUDGETABLE, FIXED_CATEGORIES } from '../core/categories.js';
import { makeGoal } from '../core/profile.js';
import { formatINR, uid } from '../core/utils.js';

const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10);

export default function Profile({ state, setState, all, notify }) {
  const p = state.profile;
  const d = all.derived;
  const set = (patch) => setState({ ...state, profile: { ...p, ...patch } });
  const [goal, setGoal] = useState({ name: '', targetAmount: '', targetDate: '', saved: '' });
  const [fc, setFc] = useState({ name: '', amount: '', category: 'Rent & Housing' });
  const [names, setNames] = useState((p.ownNames || []).join(', '));
  const [hidden, setHidden] = useState((p.hiddenTerms || []).join(', '));

  function addGoal() {
    try { set({ goals: [...p.goals, makeGoal({ ...goal, targetAmount: Number(goal.targetAmount), saved: Number(goal.saved) || 0 })] }); setGoal({ name: '', targetAmount: '', targetDate: '', saved: '' }); }
    catch (e) { notify(e.message); }
  }
  function updateGoal(id, patch) { set({ goals: p.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }); }
  function setBudget(cat, v) {
    const budgets = { ...(p.budgets || {}) };
    if (v === '' || Number(v) <= 0) delete budgets[cat]; else budgets[cat] = Math.round(Number(v));
    set({ budgets });
  }

  return (
    <>
      <div className="card">
        <h2>Your living money model</h2>
        <div className="grid">
          <div><div className="stat">{formatINR(d.income)}</div><div className="small muted">monthly income ({d.incomeSource}, basis {d.basisMonths.join(', ')})</div></div>
          <div><div className="stat">{formatINR(d.fixedTotal)}</div><div className="small muted">fixed costs / month</div></div>
          <div><div className="stat">{formatINR(d.variableTotal)}</div><div className="small muted">variable spend / month</div></div>
          <div><div className="stat">{formatINR(d.committedInvestments)}</div><div className="small muted">regular investing / month</div></div>
          <div><div className={`stat ${d.surplus < 0 ? 'bad' : 'good'}`}>{formatINR(d.surplus)}</div><div className="small muted">left for goals / month</div></div>
          <div><div className="stat">{d.emergencyFund.coverageMonths}</div><div className="small muted">months of expenses in emergency fund</div></div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>About you</h2>
          <label className="small">Your name(s) as banks write them — used to spot self-transfers and always hidden from the AI</label>
          <div className="row"><input style={{ flex: 1 }} value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. Aarav Mehta" />
            <button className="ghost" onClick={() => { set({ ownNames: toList(names) }); notify('Saved. Re-run categorisation on the Transactions tab to re-check self-transfers.'); }}>Save</button></div>
          <label className="small">Other words to always hide from the AI (comma separated)</label>
          <div className="row"><input style={{ flex: 1 }} value={hidden} onChange={(e) => setHidden(e.target.value)} placeholder="e.g. landlord's name, company" />
            <button className="ghost" onClick={() => set({ hiddenTerms: toList(hidden) })}>Save</button></div>
          <label className="small">Monthly income override (blank = detected {formatINR(d.detectedIncome)})</label>
          <input type="number" min="0" value={p.incomeOverride ?? ''} onChange={(e) => set({ incomeOverride: e.target.value === '' ? null : Number(e.target.value) })} />
        </div>
        <div className="card">
          <h2>Emergency fund</h2>
          <label className="small">Current amount set aside (₹)</label>
          <input type="number" min="0" value={p.emergencyFund.current} onChange={(e) => set({ emergencyFund: { ...p.emergencyFund, current: Number(e.target.value) || 0 } })} />
          <label className="small">Target (months of expenses)</label>
          <input type="number" min="1" max="24" value={p.emergencyFund.targetMonths} onChange={(e) => set({ emergencyFund: { ...p.emergencyFund, targetMonths: Number(e.target.value) || 6 } })} />
          <label className="small">Reach it by</label>
          <input type="date" value={p.emergencyFund.targetDate || ''} onChange={(e) => set({ emergencyFund: { ...p.emergencyFund, targetDate: e.target.value || null } })} />
          <p className="small muted">Target: {formatINR(d.emergencyFund.targetAmount)} by {d.emergencyFund.targetDate}</p>
        </div>
      </div>

      <div className="card">
        <h2>Goals</h2>
        <table>
          <thead><tr><th>Goal</th><th className="num">Target</th><th>By</th><th className="num">Saved so far</th><th>Projection</th><th /></tr></thead>
          <tbody>
            {p.goals.map((g) => {
              const sim = all.simulation.goals.find((x) => x.id === g.id);
              return (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td className="num">{formatINR(g.targetAmount)}</td>
                  <td>{g.targetDate}</td>
                  <td className="num"><input type="number" min="0" style={{ width: 110 }} value={g.saved} onChange={(e) => updateGoal(g.id, { saved: Number(e.target.value) || 0 })} /></td>
                  <td className={sim?.onTrack ? 'good' : 'warn'}>{sim ? (sim.eta ? `${sim.eta}${sim.onTrack ? ' ✓ on track' : ` · ${sim.monthsLate} mo late`}` : 'not within 5 yrs') : ''}<div className="small muted">needs {formatINR(sim?.requiredMonthly || 0)}/mo</div></td>
                  <td><button className="ghost" onClick={() => set({ goals: p.goals.filter((x) => x.id !== g.id) })}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder="Goal name" value={goal.name} onChange={(e) => setGoal({ ...goal, name: e.target.value })} />
          <input type="number" placeholder="Target ₹" value={goal.targetAmount} onChange={(e) => setGoal({ ...goal, targetAmount: e.target.value })} />
          <input type="date" value={goal.targetDate} onChange={(e) => setGoal({ ...goal, targetDate: e.target.value })} />
          <input type="number" placeholder="Saved ₹" value={goal.saved} onChange={(e) => setGoal({ ...goal, saved: e.target.value })} />
          <button onClick={addGoal}>Add goal</button>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Monthly budgets {d.budgetsAreSuggested && <span className="small muted">(suggested from your average)</span>}</h2>
          <table>
            <thead><tr><th>Category</th><th className="num">Avg/month</th><th className="num">Budget</th></tr></thead>
            <tbody>{BUDGETABLE.filter((c) => d.variableByCategory[c] || d.budgets[c]).map((c) => (
              <tr key={c}><td>{c}</td><td className="num">{formatINR(d.variableByCategory[c] || 0)}</td>
                <td className="num"><input type="number" min="0" style={{ width: 100 }} placeholder={d.budgets[c] || ''} value={p.budgets?.[c] ?? ''} onChange={(e) => setBudget(c, e.target.value)} /></td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="card">
          <h2>Fixed costs</h2>
          <table>
            <tbody>{d.fixedCosts.map((f) => (
              <tr key={f.id}><td>{f.name}<div className="small muted">{f.category} · {f.source}</div></td><td className="num">{formatINR(f.amount)}</td>
                <td>{f.source === 'manual' && <button className="ghost" onClick={() => set({ manualFixedCosts: p.manualFixedCosts.filter((x) => x.id !== f.id) })}>Remove</button>}</td></tr>
            ))}</tbody>
          </table>
          <h3>Add one we couldn't detect</h3>
          <div className="row">
            <input placeholder="Name" value={fc.name} onChange={(e) => setFc({ ...fc, name: e.target.value })} />
            <input type="number" placeholder="₹/month" value={fc.amount} onChange={(e) => setFc({ ...fc, amount: e.target.value })} style={{ width: 100 }} />
            <select value={fc.category} onChange={(e) => setFc({ ...fc, category: e.target.value })}>{[...FIXED_CATEGORIES].map((c) => <option key={c}>{c}</option>)}</select>
            <button onClick={() => { if (!fc.name || !(Number(fc.amount) > 0)) return notify('Name and a positive amount needed'); set({ manualFixedCosts: [...(p.manualFixedCosts || []), { id: uid('fc'), name: fc.name.slice(0, 40), amount: Number(fc.amount), category: fc.category }] }); setFc({ name: '', amount: '', category: fc.category }); }}>Add</button>
          </div>
        </div>
      </div>
    </>
  );
}
