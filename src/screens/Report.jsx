import { useMemo, useState } from 'react';
import { computeMonthlyReport, localNarrative, reportToAiPayload } from '../core/report.js';
import { formatINR } from '../core/utils.js';

export default function Report({ state, all, ai, notify }) {
  const months = Object.keys(all.derived.stats).sort().reverse();
  const [month, setMonth] = useState(months[0] || '');
  const [narr, setNarr] = useState({});
  const [busy, setBusy] = useState(false);
  const r = useMemo(() => (month ? computeMonthlyReport(state.transactions, month, { derived: all.derived, recurring: all.recurring, rules: state.rules }) : null), [state, month, all]);

  async function write() {
    setBusy(true);
    try {
      const data = await ai.report(reportToAiPayload(r));
      setNarr({ ...narr, [month]: { text: data.narrative, by: 'AI' } });
    } catch (e) {
      setNarr({ ...narr, [month]: { text: localNarrative(r), by: `template (AI unavailable: ${e.message})` } });
    } finally { setBusy(false); }
  }

  if (!r) return <div className="card muted">Import some transactions first.</div>;
  const n = narr[month];
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Monthly review</h2>
        <div className="row">
          <select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m}>{m}</option>)}</select>
          <button disabled={busy} onClick={write}>{busy ? 'Writing…' : 'Write my review'}</button>
        </div>
      </div>
      {n && <div className="card sev-info"><div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div><div className="small muted">Written by {n.by} from aggregates only.</div></div>}
      <div className="grid">
        <div><div className="stat good">{formatINR(r.income)}</div><div className="small muted">income</div></div>
        <div><div className="stat">{formatINR(r.spend)}</div><div className="small muted">spent {r.spendChangePct !== null ? `(${r.spendChangePct >= 0 ? '+' : ''}${r.spendChangePct}% vs ${r.previousMonth})` : ''}</div></div>
        <div><div className="stat">{formatINR(r.invest)}</div><div className="small muted">invested</div></div>
        <div><div className={`stat ${r.net >= 0 ? 'good' : 'bad'}`}>{formatINR(r.net)}</div><div className="small muted">net · savings rate {r.savingsRate ?? '—'}%</div></div>
      </div>
      <h3>By category</h3>
      <table>
        <thead><tr><th>Category</th><th className="num">This month</th><th className="num">Previous</th><th className="num">Change</th><th className="num">Budget</th></tr></thead>
        <tbody>{r.categories.map((c) => (
          <tr key={c.category}><td>{c.category}</td><td className={`num ${c.overBudget ? 'bad' : ''}`}>{formatINR(c.amount)}</td><td className="num">{formatINR(c.previous)}</td>
            <td className="num">{c.changePct === null ? '—' : `${c.changePct >= 0 ? '+' : ''}${c.changePct}%`}</td><td className="num">{c.budget ? formatINR(c.budget) : '—'}</td></tr>
        ))}</tbody>
      </table>
      <div className="grid">
        <div><h3>Top merchants</h3><ol className="small">{r.topMerchants.map((m) => <li key={m.name}>{m.name} — {formatINR(m.amount)} ({m.count}×)</li>)}</ol></div>
        <div><h3>Biggest payments</h3><ol className="small">{r.biggest.map((b, i) => <li key={i}>{b.date} {b.merchant} — {formatINR(b.amount)} ({b.category})</li>)}</ol></div>
        <div><h3>Also</h3><ul className="small">
          <li>{r.recurringCount} recurring payments, {formatINR(r.recurringTotal)}</li>
          {r.priceChanges.map((p) => <li key={p} className="warn">{p}</li>)}
          <li>{r.rulesLearned} rule(s) learned this month</li>
          {r.uncategorized > 0 && <li className="warn">{r.uncategorized} uncategorised</li>}
          <li>Emergency fund covers {r.emergencyCoverageMonths} month(s)</li>
        </ul></div>
      </div>
    </div>
  );
}
