import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createVault, VaultThrottledError } from './security/vault.js';
import { idbStorage } from './security/idbStorage.js';
import { createIdleLock } from './security/autolock.js';
import { createAiClient } from './ai/client.js';
import { deriveAll, emptyState, migrateState, redactionTerms } from './core/engine.js';
import Lock from './screens/Lock.jsx';
import ImportScreen from './screens/Import.jsx';
import Transactions from './screens/Transactions.jsx';
import Recurring from './screens/Recurring.jsx';
import Profile from './screens/Profile.jsx';
import Planner from './screens/Planner.jsx';
import Nudges from './screens/Nudges.jsx';
import Report from './screens/Report.jsx';
import Coach from './screens/Coach.jsx';
import Privacy from './screens/Privacy.jsx';

const TABS = ['Import', 'Transactions', 'Recurring', 'Profile & Goals', 'Planner', 'Nudges', 'Report', 'Coach', 'Privacy'];

export default function App() {
  const vault = useMemo(() => createVault(idbStorage()), []);
  const [phase, setPhase] = useState('loading'); // loading | setup | locked | open
  const [state, setState] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [tab, setTab] = useState('Import');
  const [toast, setToast] = useState(null);
  const [health, setHealth] = useState(null);
  const stateRef = useRef(null);
  stateRef.current = state;
  const loadedRef = useRef(false);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(notify.t);
    notify.t = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => { vault.exists().then((e) => setPhase(e ? 'locked' : 'setup')).catch(() => setPhase('setup')); }, [vault]);

  const ai = useMemo(() => createAiClient({
    onReceipt: (r) => setReceipts((list) => [r, ...list].slice(0, 100)),
    isEnabled: () => Boolean(stateRef.current?.settings.aiEnabled),
    getHiddenTerms: () => (stateRef.current ? redactionTerms(stateRef.current) : []),
  }), []);
  const aiCategorize = useCallback((items, hidden) => ai.categorize(items, hidden), [ai]);

  // Persist (encrypted) whenever state or receipts change.
  useEffect(() => {
    if (phase !== 'open' || !state || !loadedRef.current) return;
    const t = setTimeout(() => { vault.save({ ...state, receipts }).catch((e) => notify('Save failed: ' + e.message)); }, 400);
    return () => clearTimeout(t);
  }, [state, receipts, phase, vault, notify]);

  const lock = useCallback(async () => {
    try { if (stateRef.current && vault.isUnlocked()) await vault.save({ ...stateRef.current, receipts }); } catch { /* best effort */ }
    vault.lock();
    loadedRef.current = false;
    setState(null); setReceipts([]); setPhase('locked');
  }, [vault, receipts]);

  // Auto-lock on inactivity.
  useEffect(() => {
    if (phase !== 'open' || !state) return;
    const mins = Number(state.settings.autoLockMinutes) || 0;
    if (mins <= 0) return;
    return createIdleLock({ timeoutMs: mins * 60000, onLock: () => { lock(); notify('Locked after inactivity'); } });
  }, [phase, state?.settings.autoLockMinutes, lock, notify]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (phase === 'open') ai.health().then(setHealth); }, [phase, ai]);

  async function onSetup(pass) {
    await vault.setup(pass);
    const s = emptyState();
    await vault.save({ ...s, receipts: [] });
    loadedRef.current = true;
    setState(s); setPhase('open');
  }
  async function onUnlock(pass) {
    try {
      await vault.unlock(pass);
    } catch (e) {
      if (e instanceof VaultThrottledError) throw new Error(e.message);
      throw e;
    }
    const data = await vault.load();
    const s = migrateState(data);
    setReceipts(Array.isArray(data?.receipts) ? data.receipts : []);
    delete s.receipts;
    loadedRef.current = true;
    setState(s); setPhase('open');
  }
  async function onWipe() {
    await vault.wipe();
    loadedRef.current = false;
    setState(null); setReceipts([]); setPhase('setup');
    notify('All data wiped from this device');
  }

  const all = useMemo(() => (state ? deriveAll(state) : null), [state]);

  if (phase === 'loading') return <div className="wrap muted">Loading…</div>;
  if (phase !== 'open' || !state) return <Lock mode={phase} onSetup={onSetup} onUnlock={onUnlock} onWipe={onWipe} />;

  const props = { state, setState, all, ai, aiCategorize, notify, health };
  const nudgeCount = all.nudges.filter((n) => n.severity !== 'info').length;

  return (
    <div className="wrap">
      <div className="top">
        <div>
          <h1>MoneyModel <span className="muted small">test console</span></h1>
          <div className="small muted">
            {state.transactions.length} transactions · as of {all.asOf} · AI: {state.settings.aiEnabled ? (health?.aiConfigured ? `on (${health.provider} · ${health.model})` : 'not configured on server') : 'off'} · 🔒 encrypted on this device
          </div>
        </div>
        <div className="row"><button className="ghost" onClick={lock}>Lock now</button></div>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
            {t}{t === 'Nudges' && nudgeCount ? ` (${nudgeCount})` : ''}{t === 'Privacy' ? ` (${receipts.length})` : ''}
          </button>
        ))}
      </div>
      {tab === 'Import' && <ImportScreen {...props} />}
      {tab === 'Transactions' && <Transactions {...props} />}
      {tab === 'Recurring' && <Recurring {...props} />}
      {tab === 'Profile & Goals' && <Profile {...props} />}
      {tab === 'Planner' && <Planner {...props} />}
      {tab === 'Nudges' && <Nudges {...props} />}
      {tab === 'Report' && <Report {...props} />}
      {tab === 'Coach' && <Coach {...props} />}
      {tab === 'Privacy' && <Privacy {...props} receipts={receipts} setReceipts={setReceipts} onWipe={onWipe} lock={lock} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
