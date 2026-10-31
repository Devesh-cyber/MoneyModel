import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSms, parseSmsBatch } from '../src/core/ingest/sms.js';
import { parseCsvStatement } from '../src/core/ingest/csv.js';
import { parsePdfStatement } from '../src/core/ingest/pdf.js';
import { extractFromNarration } from '../src/core/ingest/narration.js';
import { readDemo, demo, extractPdfNode } from './helpers.mjs';

const ok = (s) => { const r = parseSms(s, { fallbackDate: '2026-10-31' }); assert.equal(r.ok, true, `should parse: ${s}`); return r.tx; };

test('SMS: HDFC UPI debit', () => {
  const t = ok('Sent Rs.250.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 12/10/26\nRef 429876543210\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808');
  assert.deepEqual([t.date, t.amount, t.direction, t.merchant, t.ref], ['2026-10-12', 250, 'debit', 'SWIGGY', '429876543210']);
});
test('SMS: HDFC card spend with ISO datetime', () => {
  const t = ok('Spent Rs.649 On HDFC Bank Card 5678 At AMAZON PAY On 2026-10-05:14:22:10.Not You? To Block+Reissue Call 18002586161');
  assert.deepEqual([t.date, t.amount, t.merchant], ['2026-10-05', 649, 'AMAZON PAY']);
});
test('SMS: SBI UPI debit without currency symbol', () => {
  const t = ok('Dear UPI user A/C X7730 debited by 250.0 on date 12Oct26 trf to SWIGGY Refno 429876543210. If not u? call 1800111109. -SBI');
  assert.deepEqual([t.date, t.amount, t.direction, t.merchant], ['2026-10-12', 250, 'debit', 'SWIGGY']);
});
test('SMS: SBI credit has no merchant (not "Rs500")', () => {
  const t = ok('Dear SBI UPI User, ur A/cX7730 credited by Rs500 on 12Oct26 by (Ref no 429876543211)');
  assert.equal(t.direction, 'credit'); assert.equal(t.merchant, null); assert.equal(t.ref, '429876543211');
});
test('SMS: ICICI "debited ...; X credited" is a debit to X', () => {
  const t = ok('ICICI Bank Acct XX123 debited for Rs 250.00 on 12-Oct-26; SWIGGY credited. UPI:429876543212. Call 18002662 for dispute.');
  assert.deepEqual([t.direction, t.merchant], ['debit', 'SWIGGY']);
});
test('SMS: salary NEFT, balance is not mistaken for amount', () => {
  const t = ok('ICICI Bank Account XX123 credited:Rs. 85,000.00 on 01-Oct-26. Info NEFT-NIMBUS SOFTECH PVT LTD-SALARY. Available Balance is Rs. 1,02,345.00.');
  assert.deepEqual([t.amount, t.direction, t.merchant], [85000, 'credit', 'NIMBUS SOFTECH']);
});
test('SMS: Axis multi-line UPI/P2M', () => {
  const t = ok('INR 1,499.00 debited\nA/c no. XX1234\n05-10-26, 10:15:32\nUPI/P2M/429876543213/NETFLIX\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank');
  assert.deepEqual([t.amount, t.merchant, t.ref, t.date], [1499, 'NETFLIX', '429876543213', '2026-10-05']);
});
test('SMS: Kotak VPA', () => {
  const t = ok('Sent Rs.120.00 from Kotak Bank AC X1234 to uber@axisbank on 12-10-26.UPI Ref 429876543214. Not you, https://kotak.com/KBANKT/Fraud');
  assert.deepEqual([t.merchant, t.vpa], ['uber', 'uber@axisbank']);
});
test('SMS: ATM withdrawal and NACH', () => {
  assert.equal(ok('Rs.2000.00 withdrawn from HDFC Bank A/c XX4821 at ATM S1AWMU12 on 2026-10-20:18:20:11. Avl bal: Rs.5000.00').hint, 'cash');
  const n = ok('Your A/C XXXXX7730 has a debit by NACH of Rs 5,000.00 on 10/10/26. Avl Bal Rs 41,234.00.-SBI');
  assert.deepEqual([n.amount, n.direction], [5000, 'debit']);
});
test('SMS: non-transaction messages are skipped with a reason', () => {
  const cases = {
    otp: '123456 is your OTP for txn of Rs 500 at AMAZON. Do not share.',
    collect_request: 'Rahul has requested money from you on Google Pay. Rs 300',
    upcoming_debit_notice: 'Your A/c XX4821 will be debited Rs 649 on 08-11-26 towards NETFLIX mandate.',
    promotional: 'You are pre-approved for a loan of Rs 5,00,000. Apply now',
    bill_reminder: 'Your Airtel bill of Rs.599 is due on 05-11-2026.',
    failed_transaction: 'Your UPI transaction of Rs.240.00 to BLINKIT has failed.',
  };
  for (const [reason, s] of Object.entries(cases)) assert.equal(parseSms(s).reason, reason);
});
test('SMS: demo October file', () => {
  const r = parseSmsBatch(readDemo('sms-october.txt'), { fallbackDate: '2026-10-31' });
  assert.equal(r.skipped.length, 6);
  assert.ok(r.txs.length >= 60);
  assert.ok(r.txs.every((t) => t.amount > 0 && /^2026-10-\d\d$/.test(t.date)));
});

test('Narration: HDFC/SBI/NEFT/ACH/POS formats', () => {
  assert.equal(extractFromNarration('UPI-SWIGGY-swiggy8@ybl-YESB0YBLUPI-429876543210-PAYMENT FROM PHONE').merchant, 'SWIGGY');
  assert.equal(extractFromNarration('TO TRANSFER-UPI/DR/429876543210/RAJESH K/HDFC/rajeshk@okhdfcbank/Rent--').note, 'Rent');
  assert.equal(extractFromNarration('NEFT CR-HDFC0000123-NIMBUS SOFTECH PVT LTD-AARAV MEHTA-N123456789').merchant, 'NIMBUS SOFTECH');
  assert.equal(extractFromNarration('ACH D- BAJAJ FINANCE LTD-0000123456').merchant, 'BAJAJ FINANCE LTD');
  assert.equal(extractFromNarration('POS 512345XXXXXX1234 AMAZON PAY IN').merchant, 'AMAZON PAY IN');
  assert.equal(extractFromNarration('NWD-512345XXXXXX1234-S1AW1234-MUMBAI').hint, 'cash');
});

test('CSV: HDFC demo with preamble and footer', () => {
  const r = parseCsvStatement(readDemo('hdfc-statement.csv'));
  assert.equal(r.error, undefined);
  assert.equal(r.headerRow, 5); // blank lines are skipped
  assert.equal(r.txs.length, 158);
  const sal = r.txs.filter((t) => t.merchant === 'NIMBUS SOFTECH');
  assert.equal(sal.length, 3);
  assert.ok(sal.every((t) => t.direction === 'credit' && t.amount === 85000));
});
test('CSV: single Amount + Dr/Cr column, Indian commas', () => {
  const csv = 'Some Bank\nTxn Date,Description,Amount (INR),Dr/Cr,Balance\n05-10-2026,UPI/P2M/429000000001/ZOMATO/zomato@hdfc,"1,250.00",DR,"10,000.00"\n06-10-2026,NEFT-ACME LTD-SALARY,"50,000.00",CR,"60,000.00"\nTotal,,,,\n';
  const r = parseCsvStatement(csv);
  assert.equal(r.txs.length, 2);
  assert.deepEqual([r.txs[0].amount, r.txs[0].direction, r.txs[1].direction], [1250, 'debit', 'credit']);
});
test('CSV: signed amounts', () => {
  const r = parseCsvStatement('Date,Particulars,Amount\n2026-10-01,UBER TRIP,-230.50\n2026-10-02,REFUND AMAZON,499\n');
  assert.deepEqual(r.txs.map((t) => t.direction), ['debit', 'credit']);
});
test('CSV: garbage gives a clear error', () => {
  assert.ok(parseCsvStatement('hello,world\n1,2\n').error);
});

test('PDF: SBI demo statement (wrapped narrations, right-aligned columns)', async () => {
  const r = parsePdfStatement(await extractPdfNode(demo('sbi-statement.pdf')));
  assert.equal(r.headerFound, true);
  assert.equal(r.txs.length, 13);
  const groww = r.txs.filter((t) => /GROWW/.test(t.merchant));
  assert.equal(groww.length, 3);
  assert.ok(groww.every((t) => t.direction === 'debit' && t.amount === 5000));
  const self = r.txs.filter((t) => t.merchant === 'AARAV MEHTA');
  assert.ok(self.every((t) => t.direction === 'credit'));
});
test('PDF: password-protected statement', async () => {
  await assert.rejects(() => extractPdfNode(demo('sbi-statement-locked.pdf')), (e) => e.name === 'PasswordException');
  const r = parsePdfStatement(await extractPdfNode(demo('sbi-statement-locked.pdf'), 'AARAV1990'));
  assert.equal(r.txs.length, 13);
});
