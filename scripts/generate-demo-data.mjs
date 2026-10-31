// Generates a realistic, fully fictional Indian demo dataset (Aug–Oct 2026):
//   public/demo/hdfc-statement.csv        HDFC-style CSV (primary account, preamble + footer)
//   public/demo/sbi-statement.pdf         SBI-style text PDF (secondary account, wrapped narrations)
//   public/demo/sbi-statement-locked.pdf  same PDF, password: AARAV1990
//   public/demo/sms-october.txt           October SMS from HDFC, SBI, ICICI card + noise SMS
//   public/demo/live-sms.json             SMS for the live simulator (31 Oct)
// Persona: "Aarav Mehta", software engineer in Mumbai. All names, numbers and refs are made up.
// Deterministic (seeded), so tests can rely on it.

import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'demo');
mkdirSync(out, { recursive: true });

// ---------- seeded RNG ----------
let seed = 20261031;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));
let refCounter = 429100000000;
const nextRef = () => String(refCounter += between(1000, 90000));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d, yy: pad(y % 100) }; };
const fmt = {
  ddmmyy: (iso, sep = '/') => { const p = parts(iso); return `${pad(p.d)}${sep}${pad(p.m)}${sep}${p.yy}`; },
  ddMonyy: (iso, sep = '-') => { const p = parts(iso); return `${pad(p.d)}${sep}${MON[p.m - 1]}${sep}${p.yy}`; },
  sbiSms: (iso) => { const p = parts(iso); return `${pad(p.d)}${MON[p.m - 1]}${p.yy}`; },
  sbiPdf: (iso) => { const p = parts(iso); return `${p.d} ${MON[p.m - 1]} ${p.y}`; },
};
const money = (n) => n.toFixed(2);
const inr = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const days = [];
for (let d = new Date(Date.UTC(2026, 7, 1)); d <= new Date(Date.UTC(2026, 9, 30)); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));

// ---------- merchants ----------
const M = {
  SWIGGY: { name: 'SWIGGY', vpa: 'swiggy8@ybl' },
  ZOMATO: { name: 'ZOMATO', vpa: 'zomato-order@paytm' },
  ZEPTO: { name: 'ZEPTO', vpa: 'zeptonow@axisbank' },
  BLINKIT: { name: 'BLINKIT', vpa: 'blinkit.payu@hdfcbank' },
  BIGBASKET: { name: 'BIGBASKET', vpa: 'bigbasket@icici' },
  DMART: { name: 'AVENUE SUPERMARTS LTD', vpa: 'dmart.thane@hdfcbank' },
  UBER: { name: 'UBER INDIA', vpa: 'uber@axisbank' },
  OLA: { name: 'OLA CABS', vpa: 'olacabs@ybl' },
  RAPIDO: { name: 'RAPIDO', vpa: 'rapido@ybl' },
  METRO: { name: 'MUMBAI METRO ONE', vpa: 'mmopl@icici' },
  NETFLIX: { name: 'NETFLIX', vpa: 'netflix@hdfcbank' },
  SPOTIFY: { name: 'SPOTIFY INDIA', vpa: 'spotify@icici' },
  JIO: { name: 'RELIANCE JIO', vpa: 'jio@sbi' },
  CULTFIT: { name: 'CULTFIT', vpa: 'cultfit@icici' },
  AMAZON: { name: 'AMAZON PAY', card: true },
  MYNTRA: { name: 'MYNTRA DESIGNS', card: true },
  CHAAYOS: { name: 'CHAAYOS', vpa: 'chaayos@ybl' },
  BLUETOKAI: { name: 'BLUE TOKAI ROASTERS', vpa: 'q781234590@ybl' },
  SHREESAI: { name: 'SHREE SAI MEDICAL', vpa: 'q902117734@ybl' },
  GANESH: { name: 'GANESH KIRANA STORES', vpa: 'gpay-11298345@okbizaxis' },
  ANAND: { name: 'ANAND TIFFIN SERVICE', vpa: 'anandtiffin@okbizicici' },
  KRISHNA: { name: 'KRISHNA DAIRY FARM', vpa: 'q556120983@ybl' },
  VEDANT: { name: 'VEDANT CLASSES', vpa: 'vedantclasses@okbizaxis' },
  PVR: { name: 'PVR INOX', card: true },
  UDEMY: { name: 'UDEMY', card: true },
  ADANI: { name: 'ADANI ELECTRICITY' },
};
const RENT = { name: 'RAJESH KULKARNI', vpa: 'rajesh.kulkarni@okhdfcbank' };
const ROHAN = { name: 'ROHAN DESAI', vpa: 'rohan.desai@okicici' };
const PRIYA = { name: 'PRIYA NAIR', vpa: 'priya.nair92@oksbi' };

// ---------- events ----------
const events = [];
const add = (e) => events.push({ ref: nextRef(), ...e });

for (const iso of days) {
  const { m, d } = parts(iso);
  const oct = m === 10;
  // HDFC — fixed
  if (d === 1) add({ date: iso, acct: 'HDFC', dir: 'credit', kind: 'neft', amount: 85000, name: 'NIMBUS SOFTECH PVT LTD', note: `SALARY ${MON[m - 1].toUpperCase()} 2026` });
  if (d === 2) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'imps_self', amount: 15000, name: 'AARAV MEHTA' });
  if (d === 3) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 18000, ...RENT });
  if (d === 5) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'ach', amount: 3250, name: 'BAJAJ FINANCE LTD' });
  if (d === 8) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: oct ? 649 : 499, ...M.NETFLIX });
  if (d === 12) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 119, ...M.SPOTIFY });
  if (['2026-08-06', '2026-09-03', '2026-10-01', '2026-10-29'].includes(iso)) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 349, ...M.JIO });
  if (d === 20) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'atm', amount: 2000 });
  if (iso === '2026-09-30') add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'fee', amount: 17.7 });
  // SBI — fixed
  if (d === 2) add({ date: iso, acct: 'SBI', dir: 'credit', kind: 'imps_self', amount: 15000, name: 'AARAV MEHTA' });
  if (d === 10) add({ date: iso, acct: 'SBI', dir: 'debit', kind: 'nach', amount: 5000, name: 'GROWW INVEST TECH' });
  if (d === 15) add({ date: iso, acct: 'SBI', dir: 'debit', kind: 'upi', amount: 1499, ...M.CULTFIT });
  if (d === 18) add({ date: iso, acct: 'SBI', dir: 'debit', kind: 'bill', amount: { 8: 1840, 9: 2310, 10: 2060 }[m], name: 'ADANI ELECTRICITY' });
  if (iso === '2026-09-30') add({ date: iso, acct: 'SBI', dir: 'credit', kind: 'interest', amount: 212 });

  // Variable spend (HDFC UPI mostly). October runs hotter on food delivery.
  const foodP = oct ? 0.55 : 0.4;
  if (rnd() < foodP) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: between(180, oct ? 640 : 560), ...pick([M.SWIGGY, M.ZOMATO, M.SWIGGY]) });
  if (rnd() < 0.15) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: between(240, 1250), ...pick([M.ZEPTO, M.BLINKIT, M.BIGBASKET]) });
  if (rnd() < 0.45) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: between(70, 420), ...pick([M.UBER, M.OLA, M.RAPIDO, M.UBER]) });
  if (rnd() < 0.12) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: between(180, 420), ...pick([M.CHAAYOS, M.BLUETOKAI]) });
  if (rnd() < 0.06) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: between(80, 650), ...pick([M.GANESH, M.KRISHNA, M.SHREESAI]) });
  if (d === 14 || d === 28) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: between(1800, 2800), ...M.DMART });
  if (d === 9) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 500, ...M.METRO });
  if (d === 25) add({ date: iso, acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 2400, ...M.ANAND });
}
// One-offs
add({ date: '2026-08-11', acct: 'HDFC', dir: 'debit', kind: 'card', amount: 1299, ...M.AMAZON });
add({ date: '2026-08-23', acct: 'HDFC', dir: 'debit', kind: 'card', amount: 1840, ...M.PVR });
add({ date: '2026-08-17', acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 600, ...ROHAN });
add({ date: '2026-09-06', acct: 'HDFC', dir: 'debit', kind: 'card', amount: 2499, ...M.MYNTRA });
add({ date: '2026-09-13', acct: 'HDFC', dir: 'debit', kind: 'card', amount: 3199, ...M.AMAZON });
add({ date: '2026-09-19', acct: 'HDFC', dir: 'credit', kind: 'upi', amount: 450, ...PRIYA });
add({ date: '2026-09-21', acct: 'HDFC', dir: 'credit', kind: 'card_refund', amount: 1299, name: 'AMAZON PAY' });
add({ date: '2026-09-27', acct: 'HDFC', dir: 'debit', kind: 'card', amount: 499, ...M.UDEMY });
add({ date: '2026-10-04', acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 3500, ...M.VEDANT });
add({ date: '2026-10-10', acct: 'HDFC', dir: 'debit', kind: 'card', amount: 2150, ...M.AMAZON });
add({ date: '2026-10-17', acct: 'HDFC', dir: 'debit', kind: 'upi', amount: 850, ...ROHAN });
add({ date: '2026-10-24', acct: 'HDFC', dir: 'debit', kind: 'card', amount: 4999, name: 'CROMA RETAIL', card: true });
// ICICI credit card — only visible through SMS
for (const [date, amount, name] of [['2026-10-06', 899, 'NYKAA'], ['2026-10-14', 2340, 'DECATHLON'], ['2026-10-19', 1260, 'BARBEQUE NATION'], ['2026-10-26', 640, 'STARBUCKS']]) {
  add({ date, acct: 'ICICICC', dir: 'debit', kind: 'card', amount, name });
}
events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

// ---------- HDFC CSV ----------
const HDFC_IFSC = { 'swiggy8@ybl': 'YESB0YBLUPI', default: 'HDFC0000001' };
function hdfcNarration(e) {
  switch (e.kind) {
    case 'upi': return `UPI-${e.name}-${e.vpa}-${HDFC_IFSC[e.vpa] || 'HDFC0000001'}-${e.ref}-${e.dir === 'credit' ? 'UPI' : 'PAYMENT FROM PHONE'}`;
    case 'card': return `POS 512345XXXXXX5678 ${e.name}`;
    case 'card_refund': return `REFUND POS 512345XXXXXX5678 ${e.name}`;
    case 'neft': return `NEFT CR-CITI0000002-${e.name}-${e.note}-CITIN26${e.ref.slice(-8)}`;
    case 'imps_self': return `IMPS-${e.ref}-${e.name}-SBIN-XXXXXXX7730-SELF`;
    case 'ach': return `ACH D- ${e.name}-${e.ref.slice(-9)}`;
    case 'atm': return 'NWD-512345XXXXXX5678-S1AWMU12-MUMBAI';
    case 'fee': return 'SMS CHGS FOR JUL-SEP 26 INCL GST';
    default: throw new Error('no hdfc narration for ' + e.kind);
  }
}
{
  let bal = 62450.3;
  const rows = [
    ['HDFC BANK Ltd.', '', '', '', '', '', ''],
    ['Page No .: 1', '', '', '', '', '', 'Statement of accounts'],
    ['MR AARAV MEHTA', '', '', '', '', '', ''],
    ['Account No :XXXXXXXX4821', '', '', '', 'A/C Open Date :12/06/21', '', ''],
    ['Statement From :01/08/2026 To :30/10/2026', '', '', '', '', '', ''],
    [],
    ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
  ];
  for (const e of events.filter((x) => x.acct === 'HDFC')) {
    bal = Math.round((bal + (e.dir === 'credit' ? e.amount : -e.amount)) * 100) / 100;
    rows.push([fmt.ddmmyy(e.date), hdfcNarration(e), e.kind === 'upi' ? '0000' + e.ref : '0000' + e.ref.slice(-12), fmt.ddmmyy(e.date), e.dir === 'debit' ? money(e.amount) : '', e.dir === 'credit' ? money(e.amount) : '', money(bal)]);
  }
  rows.push([], ['STATEMENT SUMMARY :-', '', '', '', '', '', ''], ['Opening Balance', 'Dr Count', 'Cr Count', 'Debits', 'Credits', 'Closing Bal', ''], ['62450.30', '', '', '', '', money(bal), '']);
  rows.push(['Generated On: 31/10/2026', '', '', '', '', '', ''], ['This is a computer generated statement', '', '', '', '', '', '']);
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
  writeFileSync(path.join(out, 'hdfc-statement.csv'), csv);
}

// ---------- SBI PDF ----------
function sbiDesc(e) {
  switch (e.kind) {
    case 'upi': return `${e.dir === 'debit' ? 'TO' : 'BY'} TRANSFER-UPI/${e.dir === 'debit' ? 'DR' : 'CR'}/${e.ref}/${e.name}/ICIC/${e.vpa}/UPI--`;
    case 'imps_self': return `BY TRANSFER-IMPS/${e.ref}/${e.name}/HDFC/XXXXXX4821/SELF--`;
    case 'nach': return `DEBIT-NACH-DR-${e.name}-${e.ref.slice(-10)}`;
    case 'bill': return `TO TRANSFER-BIL/ONL/${e.ref.slice(-9)}/${e.name}/MUMBAI--`;
    case 'interest': return 'CREDIT INTEREST--';
    default: throw new Error('no sbi desc for ' + e.kind);
  }
}
function buildSbiPdf(file, password) {
  return new Promise((resolve) => {
    const opts = { size: 'A4', margin: 30, info: { Title: 'Account Statement', Author: 'Demo Bank' } };
    if (password) Object.assign(opts, { userPassword: password, ownerPassword: 'owner-' + password + '-x9', pdfVersion: '1.7ext3', permissions: { printing: 'highResolution', copying: true } });
    const doc = new PDFDocument(opts);
    const stream = createWriteStream(file);
    doc.pipe(stream);
    const COLS = [
      { key: 'date', label: 'Txn Date', x: 30, w: 55 },
      { key: 'vdate', label: 'Value Date', x: 87, w: 55 },
      { key: 'desc', label: 'Description', x: 144, w: 190 },
      { key: 'ref', label: 'Ref No./Cheque No.', x: 336, w: 70 },
      { key: 'debit', label: 'Debit', x: 408, w: 55, align: 'right' },
      { key: 'credit', label: 'Credit', x: 465, w: 55, align: 'right' },
      { key: 'balance', label: 'Balance', x: 522, w: 60, align: 'right' },
    ];
    let y = 0;
    let page = 1;
    const header = () => {
      doc.font('Helvetica-Bold').fontSize(11).text('STATE BANK OF INDIA (DEMO)', 30, 30);
      doc.font('Helvetica').fontSize(8)
        .text('Account Name : Mr. AARAV MEHTA', 30, 48)
        .text('Account Number : XXXXXXX7730', 30, 59)
        .text('Branch : THANE WEST (Demo)', 30, 70)
        .text('Statement From : 1 Aug 2026 to 30 Oct 2026', 300, 48)
        .text('Balance as on 1 Aug 2026 : 38,200.00', 300, 59);
      y = 92;
      doc.font('Helvetica-Bold').fontSize(7.5);
      for (const c of COLS) doc.text(c.label, c.x, y, { width: c.w, align: c.align || 'left' });
      y += 14;
      doc.moveTo(30, y - 3).lineTo(582, y - 3).lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(7.5);
    };
    const footer = () => doc.fontSize(7).text(`Page ${page}`, 30, 805, { width: 535, align: 'center' });
    header();
    let bal = 38200;
    for (const e of events.filter((x) => x.acct === 'SBI')) {
      bal = Math.round((bal + (e.dir === 'credit' ? e.amount : -e.amount)) * 100) / 100;
      const desc = sbiDesc(e);
      const h = Math.max(doc.heightOfString(desc, { width: 190 }), 9) + 5;
      if (y + h > 780) { footer(); doc.addPage(); page++; header(); }
      const vals = { date: fmt.sbiPdf(e.date), vdate: fmt.sbiPdf(e.date), desc, ref: e.kind === 'upi' || e.kind === 'imps_self' ? e.ref : '', debit: e.dir === 'debit' ? inr(e.amount) : '', credit: e.dir === 'credit' ? inr(e.amount) : '', balance: inr(bal) };
      for (const c of COLS) if (vals[c.key]) doc.text(vals[c.key], c.x, y, { width: c.w, align: c.align || 'left' });
      y += h;
    }
    doc.text('**** End of Statement ****', 30, y + 10, { width: 535, align: 'center' });
    footer();
    doc.end();
    stream.on('finish', resolve);
  });
}
await buildSbiPdf(path.join(out, 'sbi-statement.pdf'));
await buildSbiPdf(path.join(out, 'sbi-statement-locked.pdf'), 'AARAV1990');

// ---------- October SMS ----------
const time = () => `${pad(between(8, 22))}:${pad(between(0, 59))}:${pad(between(0, 59))}`;
let hdfcBal = 70000;
function sms(e) {
  if (e.acct === 'HDFC') {
    hdfcBal += e.dir === 'credit' ? e.amount : -e.amount;
    switch (e.kind) {
      case 'upi':
        return e.dir === 'debit'
          ? `Sent Rs.${money(e.amount)}\nFrom HDFC Bank A/C *4821\nTo ${e.name}\nOn ${fmt.ddmmyy(e.date)}\nRef ${e.ref}\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808`
          : `Credit Alert!\nRs.${money(e.amount)} credited to HDFC Bank A/c XX4821 on ${fmt.ddmmyy(e.date, '-')} from VPA ${e.vpa} (UPI ${e.ref})`;
      case 'card': return `Spent Rs.${money(e.amount)} On HDFC Bank Card 5678 At ${e.name} On ${e.date}:${time()}.Not You? To Block+Reissue Call 18002586161/SMS BLOCK DC 5678 to 7308080808`;
      case 'neft': return `Update! INR ${inr(e.amount)} deposited in HDFC Bank A/c XX4821 on ${fmt.ddMonyy(e.date)} for NEFT Cr-CITI0000002-${e.name}-${e.note}-CITIN26${e.ref.slice(-8)}.Avl bal INR ${inr(hdfcBal)}. Cheque deposits in A/C are subject to clearing`;
      case 'imps_self': return `Sent Rs.${money(e.amount)}\nFrom HDFC Bank A/C *4821\nTo ${e.name}\nOn ${fmt.ddmmyy(e.date)}\nRef ${e.ref}\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808`;
      case 'ach': return `Amt Debited: INR ${inr(e.amount)} from HDFC Bank A/c **4821 on ${fmt.ddmmyy(e.date)} towards ACH D- ${e.name}-${e.ref.slice(-9)}. Avl Bal INR ${inr(hdfcBal)}`;
      case 'atm': return `Rs.${money(e.amount)} withdrawn from HDFC Bank A/c XX4821 at ATM S1AWMU12 on ${e.date}:${time()}. Avl bal: Rs.${money(hdfcBal)}. Not you? Call 18002586161`;
      default: return null;
    }
  }
  if (e.acct === 'SBI') {
    switch (e.kind) {
      case 'upi': return `Dear UPI user A/C X7730 debited by ${e.amount.toFixed(1)} on date ${fmt.sbiSms(e.date)} trf to ${e.name.split(' ')[0]} Refno ${e.ref}. If not u? call 1800111109. -SBI`;
      case 'nach': return `Your A/C XXXXX7730 has a debit by NACH of Rs ${inr(e.amount)} on ${fmt.ddmmyy(e.date)}. Avl Bal Rs 41,234.00.-SBI`;
      case 'bill': return `Dear Customer, Rs.${inr(e.amount)} debited from A/c XX7730 on ${fmt.ddmmyy(e.date, '-')} towards ${e.name}. Ref ${e.ref}. -SBI`;
      case 'imps_self': return `Dear SBI UPI User, ur A/cX7730 credited by Rs${e.amount} on ${fmt.sbiSms(e.date)} by (Ref no ${e.ref})`;
      default: return null;
    }
  }
  if (e.acct === 'ICICICC') return `INR ${inr(e.amount)} spent on ICICI Bank Card XX9012 on ${fmt.ddMonyy(e.date)} at ${e.name}. Avl Lmt: INR ${inr(between(80000, 140000))}. To dispute, call 18002662 or SMS BLOCK 9012 to 9215676766`;
  return null;
}
const NOISE = [
  '483920 is your OTP for transaction of INR 2,150.00 at AMAZON PAY on HDFC Bank Card 5678. Valid for 10 mins. Do not share OTP with anyone.',
  'ROHAN DESAI has requested money from you on your UPI app. Rs 350. Approve only if you know the requester. -HDFC Bank',
  'Dear Customer, Rs.649.00 will be debited from your HDFC Bank A/c XX4821 on 08-11-26 towards NETFLIX for e-mandate. To cancel visit hdfcbank.com',
  'Congratulations! You are pre-approved for a Personal Loan of Rs 5,00,000 at attractive rates. Apply now: hdfc.bank/PL T&C apply',
  'Your Airtel bill of Rs.599 is due on 05-11-2026. Pay now on Airtel Thanks app to avoid late fee.',
  'Dear Customer, your UPI transaction of Rs.240.00 to BLINKIT has failed. Amount if debited will be refunded within 48 hrs. -HDFC Bank',
];
{
  const octEvents = events.filter((e) => e.date >= '2026-10-01');
  const msgs = octEvents.map(sms).filter(Boolean);
  // sprinkle noise
  NOISE.forEach((n, i) => msgs.splice(Math.min(msgs.length, 6 + i * 9), 0, n));
  writeFileSync(path.join(out, 'sms-october.txt'), msgs.join('\n\n') + '\n');
}

// ---------- Live simulator (31 Oct) ----------
const live = [
  'Sent Rs.486.00\nFrom HDFC Bank A/C *4821\nTo SWIGGY\nOn 31/10/26\nRef 429988120011\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
  'Sent Rs.212.00 from Kotak Bank AC X3309 to uber@axisbank on 31-10-26.UPI Ref 429988120012. Not you, https://kotak.com/KBANKT/Fraud',
  '771204 is your OTP to login to HDFC Bank NetBanking. Do not share it with anyone.',
  'INR 389.00 debited\nA/c no. XX6612\n31-10-26, 13:42:09\nUPI/P2M/429988120013/ZOMATO\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank',
  'ICICI Bank Acct XX231 debited for Rs 320.00 on 31-Oct-26; BLUE TOKAI ROASTERS credited. UPI:429988120014. Call 18002662 for dispute. SMS BLOCK 231 to 9215676766.',
  'INR 1,749.00 spent on ICICI Bank Card XX9012 on 31-Oct-26 at H AND M. Avl Lmt: INR 1,02,410.00. To dispute, call 18002662 or SMS BLOCK 9012 to 9215676766',
  'Credit Alert!\nRs.1,299.00 credited to HDFC Bank A/c XX4821 on 31-10-26 from VPA amazonrefunds@apl (UPI 429988120015)',
];
writeFileSync(path.join(out, 'live-sms.json'), JSON.stringify(live, null, 2));

const counts = events.reduce((a, e) => ((a[e.acct] = (a[e.acct] || 0) + 1), a), {});
console.log('Demo data written to public/demo', counts);
