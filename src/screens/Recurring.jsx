import { setRecurringUsage } from '../core/engine.js';
import { formatINR } from '../core/utils.js';

export default function Recurring({ state, setState, all, notify }) {
  const { items, alerts } = all.recurring;
  const act = (id, action, msg) => { setState(setRecurringUsage(state, id, action, all.asOf)); notify(msg); };
  const total = items.reduce((a, r) => a + r.monthlyEquivalent, 0);

  return (
    <>
      <div className="card">
        <h2>Recurring payments ({items.length}) · about {formatINR(total)}/month</h2>
        <p className="small muted">Detected from repeating merchant, interval (weekly / ~monthly incl. 28-day plans / quarterly / yearly) and stable amount. "Unused" is based on your answers — bank data can't prove usage.</p>
        <table>
          <thead><tr><th>Merchant</th><th>Category</th><th>Cadence</th><th className="num">Usual</th><th className="num">Last</th><th>Last paid</th><th>Next expected</th><th>Status</th><th>Usage</th></tr></thead>
          <tbody>{items.map((r) => (
            <tr key={r.id}>
              <td>{r.merchant}<div className="small muted">{r.occurrences} payments · {formatINR(r.yearlyCost)}/yr</div></td>
              <td>{r.category}</td>
              <td>{r.cadence} (~{r.intervalDays}d)</td>
              <td className="num">{formatINR(r.typicalAmount)}</td>
              <td className={`num ${r.lastAmount > r.typicalAmount * 1.05 ? 'bad' : ''}`}>{formatINR(r.lastAmount)}</td>
              <td className="small">{r.lastDate}</td>
              <td className="small">{r.nextExpected}</td>
              <td>{r.status === 'missed' ? <span className="warn">missed</span> : 'active'}</td>
              <td>
                <div className="row">
                  {r.subscriptionLike && <button className="ghost" onClick={() => act(r.id, 'used', `Noted: you use ${r.merchant}`)}>I use it</button>}
                  {r.subscriptionLike && <button className="ghost" onClick={() => act(r.id, 'not_used', `Flagged ${r.merchant} as unused`)}>Not using</button>}
                  <button className="ghost" onClick={() => act(r.id, 'not_recurring', `${r.merchant} hidden from recurring`)}>Not recurring</button>
                </div>
                {r.usage.lastUsedAt && <div className="small muted">used as of {r.usage.lastUsedAt}</div>}
                {r.usage.markedUnused && <div className="small warn">marked unused</div>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <h2>Alerts ({alerts.length})</h2>
        {!alerts.length && <p className="muted">No alerts.</p>}
        {alerts.map((a) => <div key={a.id} className={`card sev-${a.severity}`}><b>{a.title}</b><div className="small">{a.message}</div><div className="small muted">{a.type}</div></div>)}
      </div>
    </>
  );
}
