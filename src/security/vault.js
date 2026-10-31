// Encrypted local vault.
//  • Key: PBKDF2-SHA256 (310,000 iterations, 16-byte random salt) from the user's passcode,
//    imported as a NON-extractable AES-GCM-256 key. It lives only in memory while unlocked.
//  • Data: AES-GCM with a fresh 12-byte IV per save and additional authenticated data,
//    so tampered or swapped ciphertext fails to decrypt.
//  • Brute-force throttle: after 5 wrong passcodes, unlock is locked out with backoff.
// Works in browsers and Node ≥ 20 (globalThis.crypto.subtle). Storage is pluggable.

const ITERATIONS = 310000;
const VERIFIER_TEXT = 'moneymodel-vault-verifier-v1';
const AAD_DATA = new TextEncoder().encode('moneymodel:data:v1');
const AAD_VERIFIER = new TextEncoder().encode('moneymodel:verifier:v1');
const MIN_PASSCODE = 6;

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('Web Crypto is not available (needs HTTPS or localhost)');
  return s;
};

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function deriveKey(passcode, salt, iterations) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(key, plaintext, aad) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(plaintext));
  return { iv: b64(iv), ct: b64(ct) };
}

async function decrypt(key, box, aad) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: aad }, key, unb64(box.ct));
  return new TextDecoder().decode(pt);
}

export class VaultLockedError extends Error { constructor() { super('Vault is locked'); this.name = 'VaultLockedError'; } }
export class VaultThrottledError extends Error {
  constructor(ms) { super(`Too many attempts. Try again in ${Math.ceil(ms / 1000)}s`); this.name = 'VaultThrottledError'; this.retryInMs = ms; }
}

export function validatePasscode(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSCODE) return `Passcode must be at least ${MIN_PASSCODE} characters`;
  if (p.length > 128) return 'Passcode too long';
  if (/^(\d)\1+$/.test(p) || ['123456', '1234567', '12345678', 'password', 'qwerty'].includes(p.toLowerCase())) return 'Passcode is too easy to guess';
  return null;
}

/** In-memory storage adapter (tests). */
export function memoryStorage() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined),
    set: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); },
    clear: async () => { m.clear(); },
    _raw: m,
  };
}

export function createVault(storage, { now = () => Date.now(), iterations = ITERATIONS } = {}) {
  let key = null;

  async function throttleState() {
    return (await storage.get('attempts')) || { failures: 0, lockUntil: 0 };
  }
  async function recordFailure() {
    const a = await throttleState();
    a.failures += 1;
    if (a.failures >= 5) a.lockUntil = now() + Math.min(15 * 60000, 30000 * 2 ** (a.failures - 5));
    await storage.set('attempts', a);
    return a;
  }

  return {
    isUnlocked: () => key !== null,

    async exists() {
      return Boolean(await storage.get('meta'));
    },

    async setup(passcode) {
      const err = validatePasscode(passcode);
      if (err) throw new Error(err);
      if (await storage.get('meta')) throw new Error('A vault already exists on this device. Unlock it or wipe it first.');
      const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
      const k = await deriveKey(passcode, salt, iterations);
      const verifier = await encrypt(k, VERIFIER_TEXT, AAD_VERIFIER);
      await storage.set('meta', { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), verifier, createdAt: new Date(now()).toISOString() });
      await storage.set('attempts', { failures: 0, lockUntil: 0 });
      key = k;
    },

    async unlock(passcode) {
      const a = await throttleState();
      if (a.lockUntil && a.lockUntil > now()) throw new VaultThrottledError(a.lockUntil - now());
      const meta = await storage.get('meta');
      if (!meta) throw new Error('No vault on this device');
      const k = await deriveKey(String(passcode || ''), unb64(meta.salt), meta.iterations);
      try {
        const v = await decrypt(k, meta.verifier, AAD_VERIFIER);
        if (v !== VERIFIER_TEXT) throw new Error('bad');
      } catch {
        const st = await recordFailure();
        const left = Math.max(0, 5 - st.failures);
        throw new Error(left > 0 ? `Wrong passcode (${left} attempt${left === 1 ? '' : 's'} before a timeout)` : 'Wrong passcode. Unlock is temporarily locked.');
      }
      await storage.set('attempts', { failures: 0, lockUntil: 0 });
      key = k;
    },

    lock() { key = null; },

    async save(obj) {
      if (!key) throw new VaultLockedError();
      const box = await encrypt(key, JSON.stringify(obj), AAD_DATA);
      await storage.set('data', { ...box, savedAt: new Date(now()).toISOString() });
    },

    async load() {
      if (!key) throw new VaultLockedError();
      const box = await storage.get('data');
      if (!box) return null;
      return JSON.parse(await decrypt(key, box, AAD_DATA));
    },

    async wipe() {
      key = null;
      await storage.clear();
    },
  };
}
