import { useEffect, useRef, useState } from 'react';
import { parseSms, parseSmsBatch } from '../core/ingest/sms.js';
import { parseCsvStatement } from '../core/ingest/csv.js';
import { parsePdfStatement } from '../core/ingest/pdf.js';
import { extractPdfPages, PdfPasswordError } from '../core/ingest/pdfExtract.js';
import { importTransactions } from '../core/engine.js';
import { makeGoal } from '../core/profile.js';
import { formatINR, todayISO } from '../core/utils.js';

const DEMO_PROFILE = (p) => ({
  ...p,
  displayName: 'Aarav',
  ownNames: ['Aarav Mehta'],
  emergencyFund: { current: 60000, targetMonths: 6, targetDate: null },
  goals: [
    makeGoal({ name: 'Goa trip', targetAmount: 40000, targetDate: '2027-03-31' }),
    makeGoal({ name: 'New laptop', targetAmount: 90000, targetDate: '2027-06-30', saved: 10000 }),
    makeGoal({ name: 'Bike down payment', targetAmount: 120000, targetDate: '2027-12-31' }),
  ],
});

const MAX_FILE = 15 * 1024 * 1024;

export default function ImportScreen({ state, setState, aiCategorize, notify }) {
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');
  const [lastSummary, setLastSummary] = useState(null);
  const [pendingPdf, setPendingPdf] = useState(null); // {buffer, name, error}
  const [pdfPass, setPdfPass] = useState('');
  const [live, setLive] = useState({ running: false, feed: [] });
  const liveRef = useRef({ queue: [], timer: null });
  const stateRef = useRef(state);
  stateRef.current = state;

  async function runImport(raw, source, label, skipped = []) {
    const res = await importTransactions(stateRef.current, raw, { source, label, skipped, aiCategorize });
    stateRef.current = res.state;
    setState(res.state);
    setLastSummary(res.summary);
    return res;
  }

  async function withBusy(fn) {
    setBusy(true);
    try { await fn(); } catch (e) { notify(e.message || String(e)); } finally { setBusy(false); }
  }

  const fetchText = async (f) => { const r = await fetch(`/demo/${f}`); if (!r.ok) throw new Error(`Missing demo file ${f}`); return r.text(); };
  const fetchBuf = async (f) => { const r = await fetch(`/demo/${f}`); if (!r.ok) throw new Error(`Missing demo file ${f}`); return r.arrayBuffer(); };

  async function importCsvText(text, label) {
    const r = parseCsvStatement(text);
    if (r.error) throw new Error(r.error);
    return runImport(r.txs, 'csv', label);
  }
  async function importPdfBuffer(buffer, label, password) {
    try {
      const pages = await extractPdfPages(buffer.slice(0), password);
      const r = parsePdfStatement(pages);
      if (!r.txs.length) throw new Error('No transactions found in this PDF. Is it a bank statement with a Date / Debit / Credit table?');
      setPendingPdf(null); setPdfPass('');
      return await runImport(r.txs, 'pdf', label);
    } catch (e) {
      if (e instanceof PdfPasswordError) { setPendingPdf({ buffer, name: label, error: e.kind === 'incorrect' ? 'Incorrect password' : null }); return null; }
      throw e;
    }
  }
  async function importSmsText(text, label) {
    const r = parseSmsBatch(text, { fallbackDate: todayISO() });
    if (!r.txs.length) throw new Error(`No transactions found (${r.skipped.length} messages skipped)`);
    return runImport(r.txs, 'sms', label, r.skipped);
  }

  const loadFullDemo = () => withBusy(async () => {
    const withProfile = { ...stateRef.current, profile: DEMO_PROFILE(stateRef.current.profile) };
    stateRef.current = withProfile;
    setState(withProfile);
    await importCsvText(await fetchText('hdfc-statement.csv'), 'Demo: HDFC statement (CSV)');
    await importPdfBuffer(await fetchBuf('sbi-statement.pdf'), 'Demo: SBI statement (PDF)');
    await importSmsText(await fetchText('sms-october.txt'), 'Demo: October SMS');
    notify('Demo loaded: CSV + PDF + SMS, with a demo profile and goals');
  });

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE) return notify('File too large (max 15 MB)');
    const name = file.name.toLowerCase();
    withBusy(async () => {
      if (name.endsWith('.csv')) await importCsvText(await file.text(), file.name);
      else if (name.endsWith('.pdf')) await importPdfBuffer(await file.arrayBuffer(), file.name);
      else if (name.endsWith('.txt')) await importSmsText(await file.text(), file.name);
      else throw new Error('Supported files: .csv, .pdf (text-based), .txt (SMS export)');
    });
  }

  // ---- live SMS simulator ----
  async function startLive() {
    const list = await (await fetch('/demo/live-sms.json')).json();
    liveRef.current.queue = [...list];
    setLive({ running: true, feed: [] });
  }
  useEffect(() => {
    if (!live.running) return undefined;
    const tick = async () => {
      const next = liveRef.current.queue.shift();
      if (!next) { setLive((l) => ({ ...l, running: false })); return; }
      const parsed = parseSms(next, { fallbackDate: todayISO() });
      let entry;
      if (!parsed.ok) entry = { text: next, result: `skipped (${parsed.reason})` };
      else {
        const res = await runImport([parsed.tx], 'sms', 'Live SMS');
        const t = res.state.transactions.find((x) => res.addedIds.includes(x.id));
        entry = { text: next, result: t ? `${t.direction === 'debit' ? '−' : '+'}${formatINR(t.amount)} · ${t.merchant} → ${t.category} (${t.categorySource})` : 'matched an existing transaction' };
      }
      setLive((l) => ({ ...l, feed: [entry, ...l.feed] }));
      liveRef.current.timer = setTimeout(tick, 1800);
    };
    liveRef.current.timer = setTimeout(tick, 400);
    return () => clearTimeout(liveRef.current.timer);
  }, [live.running]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="card">
        <h2>Bring in transactions</h2>
        <p className="small muted">Everything is parsed inside your browser. Files never leave this device; only unknown merchant names (redacted) may be sent to the AI for categorising.</p>
        <div className="row">
          <button disabled={busy} onClick={loadFullDemo}>Load full demo (CSV + PDF + SMS)</button>
          <button className="ghost" disabled={busy} onClick={() => withBusy(async () => importCsvText(await fetchText('hdfc-statement.csv'), 'Demo: HDFC CSV'))}>Demo CSV</button>
          <button className="ghost" disabled={busy} onClick={() => withBusy(async () => importPdfBuffer(await fetchBuf('sbi-statement.pdf'), 'Demo: SBI PDF'))}>Demo PDF</button>
          <button className="ghost" disabled={busy} onClick={() => withBusy(async () => importPdfBuffer(await fetchBuf('sbi-statement-locked.pdf'), 'Demo: locked SBI PDF'))}>Demo locked PDF</button>
          <button className="ghost" disabled={busy} onClick={() => withBusy(async () => importSmsText(await fetchText('sms-october.txt'), 'Demo: October SMS'))}>Demo SMS</button>
        </div>
        <h3>Upload your own</h3>
        <input type="file" accept=".csv,.pdf,.txt" onChange={onFile} disabled={busy} />
        <span className="small muted"> CSV / text PDF statement, or a .txt of SMS (blank line between messages). Scanned PDFs (OCR) are not supported yet.</span>
        {pendingPdf && (
          <div className="card" style={{ marginTop: 10 }}>
            <b>{pendingPdf.name} is password protected.</b>
            <div className="small muted">Indian bank statements are often locked (e.g. name + birth date). The password is used only in your browser and is not saved. Demo password: AARAV1990</div>
            <div className="row" style={{ marginTop: 6 }}>
              <input type="password" value={pdfPass} onChange={(e) => setPdfPass(e.target.value)} placeholder="PDF password" autoComplete="off" />
              <button disabled={busy || !pdfPass} onClick={() => withBusy(() => importPdfBuffer(pendingPdf.buffer, pendingPdf.name, pdfPass))}>Open</button>
              <button className="ghost" onClick={() => { setPendingPdf(null); setPdfPass(''); }}>Cancel</button>
              {pendingPdf.error && <span className="bad small">{pendingPdf.error}</span>}
            </div>
          </div>
        )}
        <h3>Paste SMS</h3>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Paste one or more bank SMS here, separated by a blank line.\n\nSent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 12/10/26\nRef 429876543210'} />
        <div className="row"><button disabled={busy || !paste.trim()} onClick={() => withBusy(async () => { await importSmsText(paste, 'Pasted SMS'); setPaste(''); })}>Parse & import</button></div>
        {busy && <p className="muted">Working…</p>}
      </div>

      {lastSummary && <ImportSummary s={lastSummary} />}

      <div className="card">
        <h2>Live SMS simulator</h2>
        <p className="small muted">Drops new bank SMS in one by one (31 Oct, 4 different banks + an OTP) and categorises each instantly. Real auto-reading needs an Android app with SMS permission.</p>
        <div className="row">
          <button disabled={live.running || busy} onClick={startLive}>Start</button>
          <button className="ghost" disabled={!live.running} onClick={() => { liveRef.current.queue = []; setLive((l) => ({ ...l, running: false })); }}>Stop</button>
        </div>
        <ul className="feed small">
          {live.feed.map((f, i) => <li key={i}><b>{f.result}</b><br /><span className="muted">{f.text.replace(/\n/g, ' ').slice(0, 120)}…</span></li>)}
        </ul>
      </div>

      <div className="card">
        <h2>Import history</h2>
        {!state.imports.length ? <p className="muted">Nothing imported yet.</p> : (
          <table>
            <thead><tr><th>When</th><th>Source</th><th>Label</th><th className="num">Parsed</th><th className="num">New</th><th className="num">Matched other source</th><th className="num">Already had</th><th className="num">Skipped</th></tr></thead>
            <tbody>{state.imports.map((i) => (
              <tr key={i.id}><td className="small">{new Date(i.at).toLocaleString()}</td><td>{i.source}</td><td>{i.label}</td><td className="num">{i.parsed}</td><td className="num">{i.added}</td><td className="num">{i.matchedOtherSource}</td><td className="num">{i.alreadyImported}</td><td className="num">{i.skipped}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ImportSummary({ s }) {
  const c = s.categorization || {};
  return (
    <div className="card">
      <h2>Last import: {s.label || s.source}</h2>
      <div className="grid">
        <div><div className="stat">{s.added}</div><div className="small muted">new transactions</div></div>
        <div><div className="stat">{s.matchedOtherSource}</div><div className="small muted">matched to the same payment from another source</div></div>
        <div><div className="stat">{s.alreadyImported}</div><div className="small muted">already imported (skipped)</div></div>
        <div><div className="stat">{s.skipped}</div><div className="small muted">non-transaction SMS ignored</div></div>
      </div>
      {Object.keys(s.skipReasons || {}).length > 0 && <p className="small muted">Ignored: {Object.entries(s.skipReasons).map(([k, v]) => `${k.replace(/_/g, ' ')} ×${v}`).join(', ')}</p>}
      <p className="small">Categorised by rules/known merchants: {c.local} · by AI: {c.ai} · by fallback heuristics: {c.heuristic} · still uncategorised: {c.uncategorized}
        {c.aiSentItems ? ` · ${c.aiSentItems} unique redacted merchant(s) sent to AI` : ''}
        {c.aiError ? <span className="warn"> · AI unavailable ({c.aiError}) — used local fallback</span> : null}</p>
    </div>
  );
}
