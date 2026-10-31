import { useMemo, useState } from 'react';
import { CATEGORIES } from '../core/categories.js';
import { compareScenario, describeAdjustment, parseScenarioLocally, validateAdjustments } from '../core/planner.js';
import { formatINR } from '../core/utils.js';

const EXAMPLES = ['What if I cut dining out by 30%?', 'What if my rent goes up by 3,000?', 'Salary increases by 10% and I buy a laptop for 60k in 2 months', 'Increase my SIP by 2000'];

export default function Planner({ all, ai, state, notify }) {
  const [text, setText] = useState('');
  const [adj, setAdj] = useState([]);
  const [busy, setBusy] = useState(false);
  const [via, setVia] = useState('');
  const [form, setForm] = useState({ type: 'category', category: 'Food & Dining', mode: 'pct', value: '-20', amount: '', monthOffset: '0', name: '' });

  const result = useMemo(() => compareScenario(all.model, adj), [all.model, adj]);

  async function ask(q) {
    const question = (q ?? text).trim();
    if (!question) return;
    setBusy(true);
    try {
      let list = [];
      try {
        list = state.settings.aiEnabled ? await ai.scenario(question, all.model.goals) : [];
        setVia('AI understood your question → structured changes → the numbers are calculated locally');
      } catch {
        list = [];
      }
      if (!list.length) { list = parseScenarioLocally(question); setVia(list.length ? 'Understood with the built-in parser (AI unavailable or unsure)' : ''); }
      if (!list.length) notify("Couldn't turn that into a scenario. Try 'cut food by 20%' or 'rent up by 2000'.");
      setAdj(validateAdjustments(list).valid);
    } finally { setBusy(false); }
  }

  function addManual() {
    const a = form.type === 'one_time' ? { type: 'one_time', amount: Number(form.amount), monthOffset: Number(form.monthOffset), name: form.name || 'One-time' }
      : form.type === 'new_recurring' ? { type: 'new_recurring', amount: Number(form.amount), name: form.name || 'New cost', category: form.category }
      : form.type === 'investment' ? { type: 'investment', mode: 'abs', value: Number(form.value) }
      : form.type === 'income' ? { type: 'income', mode: form.mode, value: Number(form.value) }
      : { type: 'category', category: form.category, mode: form.mode, value: Number(form.value) };
    const v = validateAdjustments([a]);
    if (!v.valid.length) return notify('That change is not valid: ' + (v.rejected[0]?.reason || ''));
    setAdj([...adj, ...v.valid]);
  }

  const b = result.baseline;
  const s = result.scenario;
  return (
    <>
      <div className="card">
        <h2>Goal plan (current pace)</h2>
        <p className="small muted">Each month's surplus ({formatINR(b.monthlySurplus)}) is shared across goals by deadline. Plain maths on your money model — no AI involved in the numbers.</p>
        <table>
          <thead><tr><th>Goal</th><th className="num">Target</th><th>Target month</th><th>Projected</th><th className="num">Needed / month</th></tr></thead>
          <tbody>{b.goals.map((g) => (
            <tr key={g.id}><td>{g.name}</td><td className="num">{formatINR(g.targetAmount)}</td><td>{g.targetMonth}</td>
              <td className={g.onTrack ? 'good' : 'warn'}>{g.eta || '> 5 years'}{g.onTrack ? ' ✓' : g.monthsLate ? ` (${g.monthsLate} mo late)` : ''}</td>
              <td className="num">{formatINR(g.requiredMonthly)}</td></tr>
          ))}</tbody>
        </table>
        {!b.goals.length && <p className="muted">Add goals in Profile & Goals.</p>}
      </div>

      <div className="card">
        <h2>What if…</h2>
        <div className="row">
          <input style={{ flex: 1, minWidth: 260 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask in plain words, e.g. what if I cut dining out by 30%" onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <button disabled={busy} onClick={() => ask()}>{busy ? 'Thinking…' : 'Simulate'}</button>
          <button className="ghost" onClick={() => { setAdj([]); setVia(''); }}>Reset</button>
        </div>
        <div className="row small" style={{ marginTop: 6 }}>{EXAMPLES.map((e) => <button key={e} className="ghost" onClick={() => { setText(e); ask(e); }}>{e}</button>)}</div>
        {via && <p className="small muted">{via}</p>}

        <h3>Or build it by hand</h3>
        <div className="row">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="category">Change a category</option><option value="income">Change income</option><option value="investment">Change monthly investing</option>
            <option value="one_time">One-time expense</option><option value="new_recurring">New monthly cost</option>
          </select>
          {(form.type === 'category' || form.type === 'new_recurring') && <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}
          {(form.type === 'category' || form.type === 'income') && <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="pct">%</option><option value="abs">₹/month</option></select>}
          {['category', 'income', 'investment'].includes(form.type) && <input type="number" style={{ width: 100 }} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />}
          {['one_time', 'new_recurring'].includes(form.type) && <><input placeholder="Label" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input type="number" placeholder="₹" style={{ width: 100 }} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></>}
          {form.type === 'one_time' && <input type="number" min="0" style={{ width: 80 }} title="months from now" value={form.monthOffset} onChange={(e) => setForm({ ...form, monthOffset: e.target.value })} />}
          <button className="ghost" onClick={addManual}>Add change</button>
        </div>

        {adj.length > 0 && (
          <>
            <h3>Scenario</h3>
            <ul>{adj.map((a, i) => <li key={i}>{describeAdjustment(a)} <button className="ghost small" onClick={() => setAdj(adj.filter((_, j) => j !== i))}>×</button></li>)}</ul>
            <div className="grid">
              <div><div className="stat">{formatINR(b.monthlySurplus)}</div><div className="small muted">monthly surplus now</div></div>
              <div><div className={`stat ${s.monthlySurplus >= b.monthlySurplus ? 'good' : 'bad'}`}>{formatINR(s.monthlySurplus)}</div><div className="small muted">with this scenario ({result.surplusChange >= 0 ? '+' : ''}{formatINR(result.surplusChange)})</div></div>
              {s.deficitMonths > 0 && <div><div className="stat bad">{s.deficitMonths}</div><div className="small muted">months in deficit</div></div>}
            </div>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Goal</th><th>Target</th><th>Now</th><th>With scenario</th><th>Change</th></tr></thead>
              <tbody>{result.goals.map((g) => (
                <tr key={g.id}><td>{g.name}</td><td>{g.targetMonth}</td><td>{g.baselineEta || '> 5 yrs'}</td><td className={g.scenarioOnTrack ? 'good' : 'warn'}>{g.scenarioEta || '> 5 yrs'}</td>
                  <td>{g.monthsEarlier === null ? '—' : g.monthsEarlier > 0 ? <span className="good">{g.monthsEarlier} mo sooner</span> : g.monthsEarlier < 0 ? <span className="bad">{-g.monthsEarlier} mo later</span> : 'same'}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}
        <p className="small muted">Educational modelling only — not investment advice.</p>
      </div>
    </>
  );
}
