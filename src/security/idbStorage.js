// IndexedDB storage adapter for the vault (browser only). Holds only ciphertext + KDF metadata.
import { openDB } from 'idb';

const DB_NAME = 'moneymodel-vault';
const STORE = 'kv';

export function idbStorage() {
  const dbp = openDB(DB_NAME, 1, {
    upgrade(db) { if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); },
  });
  return {
    get: async (k) => (await dbp).get(STORE, k),
    set: async (k, v) => (await dbp).put(STORE, v, k),
    clear: async () => (await dbp).clear(STORE),
  };
}
