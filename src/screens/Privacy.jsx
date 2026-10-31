import { useState } from 'react';

export default function Privacy({ state, setState, receipts, setReceipts, onWipe, lock, health }) {
  const [wipe, setWipe] = useState('');
  const s = state.settings;
  const setS = (patch) => setState({ ...state, settings: { ...s, ...patch } });

  return (
    <>
      <div className="card">
        <h2>How your data is protected</h2>
        <ul className="small">
          <li><b>Stays on this device:</b> statements and SMS are parsed in your browser. Nothing is stored on any server.</li>
          <li><b>Encrypted vault:</b> everything is saved with AES-256-GCM using a key derived from your passcode (PBKDF2-SHA256, 310k iterations). The key exists only in memory while unlocked.</li>
          <li><b>Auto-lock:</b> locks after {s.autoLockMinutes || 'no'} minute(s) of inactivity; 5 wrong passcodes trigger a timeout.</li>
          <li><b>Redaction before AI:</b> account/card numbers, UPI IDs, phone numbers, emails, IFSC, PAN, balances, reference numbers and names of people are removed before anything is sent. Exact amounts and dates are not sent for categorising.</li>
          <li><b>Server keeps nothing:</b> the API only forwards redacted data to the AI provider, re-checks it, logs no request bodies and holds the API key server-side.</li>
          <li><b>Honest caveat:</b> the redacted text that is sent is processed by the AI provider's servers (Groq or xAI) under their terms.</li>
        </ul>
        <p className="small">AI on the server: {health?.aiConfigured ? `configured (${health.provider} · ${health.model})` : 'not configured — the app works with local fallbacks'}</p>
      </div>

      <div className="card">
        <h2>Settings</h2>
        <div className="row"><label><input type="checkbox" checked={s.aiEnabled} onChange={(e) => setS({ aiEnabled: e.target.checked })} /> Allow AI features (categorising unknown merchants, what-if parsing, coach, review)</label></div>
        <div className="row"><label>Auto-lock after <input type="number" min="1" max="60" style={{ width: 70 }} value={s.autoLockMinutes} onChange={(e) => setS({ autoLockMinutes: Math.min(60, Math.max(1, Number(e.target.value) || 5)) })} /> minutes</label></div>
        <div className="row"><label>"Today" for nudges and plans: <select value={s.asOfMode} onChange={(e) => setS({ asOfMode: e.target.value })}><option value="latest">latest transaction date</option><option value="today">real today</option></select></label></div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={lock}>Lock now</button>
          <input value={wipe} onChange={(e) => setWipe(e.target.value)} placeholder="type WIPE" style={{ width: 110 }} />
          <button className="danger" disabled={wipe !== 'WIPE'} onClick={onWipe}>Wipe all data on this device</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Privacy receipts ({receipts.length})</h2>
          <button className="ghost" onClick={() => setReceipts([])}>Clear receipts</button>
        </div>
        <p className="small muted">Every AI request, exactly as it left your device.</p>
        {!receipts.length && <p className="muted">No AI requests yet.</p>}
        {receipts.map((r) => (
          <details key={r.id} className="card">
            <summary><b>{r.endpoint}</b> · {new Date(r.at).toLocaleString()} · <span className={r.status === 'sent' ? 'good' : 'warn'}>{r.status}</span>
              {Object.keys(r.hidden || {}).length > 0 && <> · hidden: {Object.entries(r.hidden).map(([k, v]) => `${k.replace(/_/g, ' ')} ×${v}`).join(', ')}</>}</summary>
            <div className="grid" style={{ marginTop: 8 }}>
              <div><div className="small muted">Sent</div><pre>{r.sent ? JSON.stringify(r.sent, null, 2) : 'nothing'}</pre></div>
              <div>
                <div className="small muted">Never left your device</div>
                <ul className="small">{(r.neverSent || []).map((x) => <li key={x}>{x}</li>)}</ul>
                {r.serverRedactions && <p className="small">The server's second check removed: {Object.entries(r.serverRedactions).map(([k, v]) => `${k} ×${v}`).join(', ')}</p>}
              </div>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
