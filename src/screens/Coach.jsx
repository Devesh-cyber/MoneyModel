import { useState } from 'react';
import { buildCoachContext } from '../core/engine.js';
import { GUARDRAIL_MESSAGE, isSecuritiesRequest } from '../core/guardrails.js';

const STARTERS = ['How am I doing this month?', 'How can I reach my Goa trip goal faster?', 'Is my emergency fund enough?', 'Which subscriptions should I review?', 'Which mutual fund should I buy?'];

export default function Coach({ all, ai, state }) {
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(text) {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ('');
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    // Same guardrail runs here and on the server.
    if (isSecuritiesRequest(question)) {
      setMsgs((m) => [...m, { role: 'assistant', content: GUARDRAIL_MESSAGE, note: 'guardrail (answered locally, nothing sent)' }]);
      return;
    }
    if (!state.settings.aiEnabled) {
      setMsgs((m) => [...m, { role: 'assistant', content: 'AI is turned off in Privacy settings. The Planner, Nudges and Report still work offline.', note: 'offline' }]);
      return;
    }
    setBusy(true);
    try {
      const data = await ai.coach(question, buildCoachContext(all), history);
      setMsgs((m) => [...m, { role: 'assistant', content: data.answer, note: data.guarded ? 'guardrail applied' : '' }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `I couldn't reach the AI (${e.message}). Your numbers are still on the Profile, Planner and Report tabs.`, note: 'error' }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>Coach</h2>
      <p className="small muted">Educates and models scenarios from your aggregated numbers (no individual transactions or names are sent). It will not recommend specific stocks, funds or crypto.</p>
      <div className="row small">{STARTERS.map((s) => <button key={s} className="ghost" onClick={() => send(s)}>{s}</button>)}</div>
      <div className="chat">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}{m.note && <div className="small muted">{m.note}</div>}</div>)}
        {busy && <div className="msg assistant muted">Thinking…</div>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input style={{ flex: 1 }} value={q} maxLength={500} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask about your money…" />
        <button disabled={busy || !q.trim()} onClick={() => send()}>Send</button>
      </div>
    </div>
  );
}
