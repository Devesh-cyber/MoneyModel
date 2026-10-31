import { dismissNudge } from '../core/engine.js';

export default function Nudges({ state, setState, all }) {
  return (
    <div className="card">
      <h2>Nudges ({all.nudges.length})</h2>
      <p className="small muted">Spending drift vs budget (pace-adjusted for the day of month), goals slipping, thin safety net, unusual payments and subscription changes. As of {all.asOf}.</p>
      {!all.nudges.length && <p className="muted">All calm. Nothing needs attention.</p>}
      {all.nudges.map((n) => (
        <div key={n.id} className={`card sev-${n.severity}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{n.title}</b>
            <button className="ghost" onClick={() => setState(dismissNudge(state, n.id))}>Dismiss</button>
          </div>
          <div className="small">{n.message}</div>
          <div className="small muted">{n.type} · {n.severity}</div>
        </div>
      ))}
    </div>
  );
}
