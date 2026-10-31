import { useMemo, useState } from 'react';
import { CATEGORIES, UNCATEGORIZED } from '../core/categories.js';
import { correctCategory, recategorize, removeRule } from '../core/engine.js';
import { formatINR, monthKey } from '../core/utils.js';

const SOURCE_LABEL = { rule: 'learned rule', user: 'you', 'user-once': 'you (once)', keyword: 'known merchant', ai: 'AI', heuristic: 'guess', none: 'unknown' };

export default function Transactions({ state, setState, aiCategorize, notify }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [src, setSrc] = useState('');
  const [month, setMonth] = useState('');
  const [pending, setPending] = useState(null); // {tx, category}
  const [busy, setBusy] = useState(false);

  const months = useMemo(() => [...new Set(state.transactions.map((t) => monthKey(t.date)))].sort().reverse(), [state.transactions]);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return state.transactions
      .filter((t) => (!cat || t.category === cat) && (!src || t.sources.includes(src)) && (!month || monthKey(t.date) === month))
      .filter((t) => !ql || t.merchant.toLowerCase().includes(ql) || String(t.amount).includes(ql))
      .slice()
      .reverse();
  }, [state.transactions, q, cat, src, month]);

  function apply(scope) {
    try {
      const res = correctCategory(state, pending.tx.id, pending.category, scope);
      setState(res.state);
      notify(res.rule
        ? `Learned: ${res.rule.pattern} → ${res.rule.category}. Applied to ${res.appliedCount} transaction(s), and future ones.`
        : `Changed just this transaction to ${pending.category}.`);
    } catch (e) { notify(e.message); }
    setPending(null);
  }

  async function rerun() {
    setBusy(true);
    try {
      const r = await recategorize(state, { aiCategorize });
      setState(r.state);
      notify(`AI categorised ${r.stats.ai}, heuristics ${r.stats.heuristic}, still unknown ${r.stats.uncategorized}${r.stats.aiError ? ` (AI: ${r.stats.aiError})` : ''}`);
    } finally { setBusy(false); }
  }

  const uncategorized = state.transactions.filter((t) => t.category === UNCATEGORIZED || t.categorySource === 'heuristic').length;

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Transactions ({rows.length})</h2>
          <button className="ghost" disabled={busy} onClick={rerun}>{busy ? 'Working…' : `Re-run AI on ${uncategorized} unsure/unknown`}</button>
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <input placeholder="Search merchant or amount" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{[...CATEGORIES, UNCATEGORIZED].map((c) => <option key={c}>{c}</option>)}</select>
          <select value={src} onChange={(e) => setSrc(e.target.value)}><option value="">All sources</option>{['sms', 'csv', 'pdf'].map((s) => <option key={s}>{s}</option>)}</select>
          <select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All months</option>{months.map((m) => <option key={m}>{m}</option>)}</select>
        </div>
        {pending && (
          <div className="card sev-info">
            Change <b>{pending.tx.merchant}</b> from {pending.tx.category} to <b>{pending.category}</b>?
            <div className="row" style={{ marginTop: 6 }}>
              <button onClick={() => apply('always')} disabled={!pending.tx.merchantKey}>Always for {pending.tx.merchant} (learn rule)</button>
              <button className="ghost" onClick={() => apply('once')}>Only this transaction</button>
              <button className="ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        <table>
          <thead><tr><th>Date</th><th>Merchant</th><th className="num">Amount</th><th>Category</th><th className="hide-sm">How</th><th className="hide-sm">Seen in</th></tr></thead>
          <tbody>
            {rows.slice(0, 400).map((t) => (
              <tr key={t.id}>
                <td className="small">{t.date}{t.dateInferred ? '*' : ''}</td>
                <td>{t.merchant}{t.selfTransfer && <span className="badge">self transfer</span>}<div className="small muted">{t.channel || ''}</div></td>
                <td className={`num ${t.direction === 'credit' ? 'good' : ''}`}>{t.direction === 'credit' ? '+' : '−'}{formatINR(t.amount, { decimals: t.amount % 1 ? 2 : 0 })}</td>
                <td>
                  <select value={t.category} onChange={(e) => setPending({ tx: t, category: e.target.value })}>
                    {t.category === UNCATEGORIZED && <option>{UNCATEGORIZED}</option>}
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td className="hide-sm"><span className={`badge ${t.categorySource.replace('-once', '')}`}>{SOURCE_LABEL[t.categorySource] || t.categorySource}{t.categorySource === 'ai' ? ` ${Math.round(t.confidence * 100)}%` : ''}</span></td>
                <td className="hide-sm">{t.sources.map((s) => <span key={s} className="badge">{s}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 400 && <p className="small muted">Showing the latest 400. Use filters to narrow down.</p>}
      </div>

      <div className="card">
        <h2>Learned rules ({state.rules.length})</h2>
        {!state.rules.length ? <p className="muted small">Fix a category above and choose "Always" — the rule appears here and applies to past and future transactions.</p> : (
          <table>
            <thead><tr><th>Merchant</th><th>Direction</th><th>Category</th><th className="num">Matches</th><th /></tr></thead>
            <tbody>{state.rules.map((r) => (
              <tr key={r.id}><td>{r.pattern}</td><td>{r.direction}</td><td>{r.category}</td><td className="num">{r.hits}</td>
                <td><button className="ghost" onClick={async () => { setState(await removeRule(state, r.id, { aiCategorize })); notify('Rule removed'); }}>Delete</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
