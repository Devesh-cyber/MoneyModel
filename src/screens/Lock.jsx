import { useState } from 'react';
import { validatePasscode } from '../security/vault.js';

export default function Lock({ mode, onSetup, onUnlock, onWipe }) {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const setup = mode === 'setup';

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (setup) {
      const v = validatePasscode(pass);
      if (v) return setErr(v);
      if (pass !== pass2) return setErr('Passcodes do not match');
    }
    setBusy(true);
    try { setup ? await onSetup(pass) : await onUnlock(pass); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); setPass(''); setPass2(''); }
  }

  return (
    <div className="lock card">
      <h2>{setup ? 'Create your vault' : 'Unlock MoneyModel'}</h2>
      <p className="small muted">
        {setup
          ? 'Your transactions are encrypted on this device with a key made from this passcode (PBKDF2 + AES-256-GCM). It is never sent anywhere. If you forget it, the data cannot be recovered.'
          : 'Your data is encrypted on this device.'}
      </p>
      <form onSubmit={submit}>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <input type="password" autoComplete={setup ? 'new-password' : 'current-password'} placeholder="Passcode (min 6 characters)" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          {setup && <input type="password" autoComplete="new-password" placeholder="Repeat passcode" value={pass2} onChange={(e) => setPass2(e.target.value)} />}
          <button disabled={busy || !pass}>{busy ? 'Working…' : setup ? 'Create vault' : 'Unlock'}</button>
          {err && <div className="bad small">{err}</div>}
        </div>
      </form>
      {!setup && (
        <details style={{ marginTop: 16 }}>
          <summary className="small muted">Forgot passcode?</summary>
          <p className="small">The only option is to wipe this device's data and start again. Type WIPE to confirm.</p>
          <div className="row">
            <input value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder="WIPE" />
            <button className="danger" disabled={wipeText !== 'WIPE'} onClick={onWipe}>Wipe everything</button>
          </div>
        </details>
      )}
    </div>
  );
}
