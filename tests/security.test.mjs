import test from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactMerchant, looksLikePersonName } from '../src/security/redact.js';
import { createVault, memoryStorage, validatePasscode } from '../src/security/vault.js';
import { filterAdvice, isSecuritiesRequest } from '../src/core/guardrails.js';

test('redaction: account, card, UPI id, phone, email, IFSC, PAN, balance, refs, custom names', () => {
  const s = 'Sent Rs.250 From HDFC Bank A/C *4821 card 5123XXXXXX5678 to rohan.d@okaxis Ref 429876543210 call 9876543210 mail a.b@gmail.com IFSC HDFC0001234 PAN ABCDE1234F Avl bal: Rs.12,345.00 by Aarav Mehta';
  const r = redactText(s, { customTerms: ['Aarav Mehta'] });
  for (const leak of ['4821', '5678', 'rohan.d@okaxis', '429876543210', '9876543210', 'a.b@gmail.com', 'HDFC0001234', 'ABCDE1234F', '12,345', 'Aarav']) {
    assert.ok(!r.text.includes(leak), `leaked ${leak}: ${r.text}`);
  }
  assert.ok(r.text.includes('Rs.250'), 'transaction amount itself is kept');
  for (const k of ['account', 'card', 'upi_id', 'reference', 'phone', 'email', 'ifsc', 'pan', 'balance', 'custom']) assert.ok(r.counts[k] >= 1, k);
});

test('redaction: people vs businesses', () => {
  assert.equal(redactMerchant('RAJESH KULKARNI').value, '[PERSON]');
  assert.equal(redactMerchant('rohan.desai@okicici').value, '[PERSON]');
  assert.equal(redactMerchant('SHREE SAI MEDICAL').value, 'SHREE SAI MEDICAL');
  assert.equal(looksLikePersonName('q556120983@ybl'), false);
  assert.equal(looksLikePersonName('gpay-11298345@okbizaxis'), false);
  assert.equal(looksLikePersonName('NIMBUS SOFTECH'), false);
  assert.equal(redactMerchant('ANYONE', { p2p: true }).value, '[PERSON]');
});

test('vault: setup, save/load, lock, wrong passcode, throttle, tamper detection', async () => {
  const storage = memoryStorage();
  let clock = 1_000_000;
  const v = createVault(storage, { now: () => clock, iterations: 1000 });
  assert.ok(validatePasscode('123456')); assert.ok(validatePasscode('abc'));
  await v.setup('correct horse 42');
  await v.save({ secret: 'salary 85000', list: [1, 2, 3] });
  const raw = JSON.stringify([...storage._raw.values()]);
  assert.ok(!raw.includes('salary') && !raw.includes('85000'), 'storage holds ciphertext only');
  v.lock();
  await assert.rejects(() => v.load(), /locked/);
  for (let i = 0; i < 5; i++) await assert.rejects(() => v.unlock('wrong pass ' + i));
  await assert.rejects(() => v.unlock('correct horse 42'), (e) => e.name === 'VaultThrottledError');
  clock += 31_000;
  await v.unlock('correct horse 42');
  assert.deepEqual(await v.load(), { secret: 'salary 85000', list: [1, 2, 3] });
  // tamper: flip a byte of the ciphertext → decryption must fail
  const box = await storage.get('data');
  const bytes = Uint8Array.from(atob(box.ct), (c) => c.charCodeAt(0)); bytes[3] ^= 0xff;
  await storage.set('data', { ...box, ct: btoa(String.fromCharCode(...bytes)) });
  await assert.rejects(() => v.load());
  await v.wipe();
  assert.equal(await v.exists(), false);
});

test('vault: cannot overwrite an existing vault', async () => {
  const v = createVault(memoryStorage(), { iterations: 1000 });
  await v.setup('first passcode');
  await assert.rejects(() => v.setup('second passcode'), /already exists/);
});

test('guardrails', () => {
  assert.ok(isSecuritiesRequest('Which mutual fund should I buy?'));
  assert.ok(isSecuritiesRequest('should I buy TCS shares'));
  assert.ok(!isSecuritiesRequest('should I buy a laptop next month?'));
  assert.ok(!isSecuritiesRequest('how does an emergency fund work'));
  const f = filterAdvice('Keep 6 months aside. You should invest in Parag Parikh Flexi Cap Fund.');
  assert.ok(f.flagged && !/Parag/.test(f.text) && /6 months/.test(f.text));
});
