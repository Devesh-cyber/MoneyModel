// Extracts the counterparty (merchant / person) from Indian bank statement narrations.
// Examples handled:
//   UPI-SWIGGY-swiggy8@ybl-YESB0YBLUPI-429876543210-PAYMENT FROM PHONE      (HDFC)
//   TO TRANSFER-UPI/DR/429876543210/RAJESH K/HDFC/rajeshk@okhdfcbank/Rent   (SBI)
//   NEFT CR-HDFC0000123-NIMBUS SOFTECH PVT LTD-AARAV MEHTA-N123456789
//   ACH D- BAJAJ FINANCE LTD-0000123456
//   POS 512345XXXXXX1234 AMAZON PAY IN
//   NWD-512345XXXXXX1234-S1AW1234-MUMBAI    (ATM)
//   BIL/ONL/000123/ADANI ELECTRICITY/...

const BANK_CODES = new Set([
  'HDFC', 'ICIC', 'SBIN', 'UTIB', 'YESB', 'KKBK', 'PUNB', 'BARB', 'CNRB', 'UBIN', 'IDIB', 'IOBA',
  'INDB', 'FDRL', 'IDFB', 'AIRP', 'PYTM', 'BKID', 'MAHB', 'CBIN', 'SBI', 'ICICI', 'AXIS', 'KOTAK',
  'YBL', 'OKAXIS', 'OKHDFC', 'OKICICI', 'OKSBI', 'PAYTM', 'APL', 'IBL',
]);

const NOISE = new Set([
  'UPI', 'DR', 'CR', 'P2M', 'P2A', 'NA', 'NEFT', 'IMPS', 'RTGS', 'ACH', 'NACH', 'D', 'C', 'TO',
  'BY', 'TRANSFER', 'PAYMENT', 'FROM', 'PHONE', 'PAYMENT FROM PHONE', 'COLLECT', 'PAY', 'MOB',
  'MOBILE', 'INB', 'ONL', 'BIL', 'POS', 'ECOM', 'OTHERS', 'OTHER', 'SENT', 'USING', 'APP',
  'TO TRANSFER', 'BY TRANSFER', 'UPI LITE', 'IN',
]);

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MASKED = /^[0-9X*]{6,}$/;
const DIGITS = /^\d+$/;

function cleanPart(p) {
  return p.replace(/\s+/g, ' ').replace(/^[\s\-:.]+|[\s\-:.]+$/g, '').trim();
}

function isNoise(p) {
  const u = p.toUpperCase();
  if (!u) return true;
  if (NOISE.has(u)) return true;
  if (BANK_CODES.has(u)) return true;
  if (IFSC.test(u)) return true;
  if (MASKED.test(u)) return true;
  if (DIGITS.test(u)) return true;
  if (/^[A-Z]?\d{6,}$/.test(u)) return true; // refs like N123456789
  if (/^\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?$/.test(u)) return true; // dates
  if (u.length < 2) return true;
  return false;
}

function pickRef(parts) {
  const r = parts.find((p) => /^\d{9,16}$/.test(p.trim()));
  return r ? r.trim() : null;
}

/**
 * @returns {{merchant:string|null, vpa:string|null, ref:string|null, note:string|null,
 *            channel:string|null, hint:string|null, p2p:boolean}}
 */
export function extractFromNarration(raw) {
  const out = { merchant: null, vpa: null, ref: null, note: null, channel: null, hint: null, p2p: false };
  if (!raw) return out;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  const U = s.toUpperCase();

  if (/^(NWD|ATW|EAW|ATM)\b|\bATM\s*(WDL|WITHDRAWAL|CASH)\b|\bCASH\s*(WDL|WITHDRAWAL)\b/.test(U)) {
    return { ...out, merchant: 'ATM CASH WITHDRAWAL', channel: 'ATM', hint: 'cash' };
  }
  if (/\b(CHGS|CHARGES|CHRG|FEE|FEES|GST ON|PENALTY|MIN BAL|NON MAINT|AMC)\b/.test(U) && !/UPI|POS/.test(U)) {
    return { ...out, merchant: 'BANK CHARGES', channel: 'BANK', hint: 'fees' };
  }
  if (/\b(INT\.?\s?PD|INTEREST\s+(PAID|CREDIT|CR)|CREDIT INTEREST|SB INT)\b/.test(U)) {
    return { ...out, merchant: 'SAVINGS INTEREST', channel: 'BANK', hint: 'interest' };
  }

  const vpaMatch = s.match(/([a-zA-Z0-9.\-_]{2,})@([a-zA-Z]{2,})/);
  if (vpaMatch) out.vpa = vpaMatch[0].toLowerCase();

  // UPI
  const upiIdx = U.search(/\bUPI[\/\-]/);
  if (upiIdx >= 0) {
    out.channel = 'UPI';
    const rest = s.slice(upiIdx + 4);
    const parts = rest.split(/[\/]|-(?=\S)|\s-\s/).map(cleanPart).filter(Boolean);
    out.ref = pickRef(parts);
    if (/\bP2A\b/i.test(s)) out.p2p = true;
    const useful = parts.filter((p) => !p.includes('@') && !isNoise(p));
    if (useful.length) {
      out.merchant = useful[0];
      if (useful.length > 1) out.note = useful[useful.length - 1];
    } else if (out.vpa) {
      out.merchant = out.vpa.split('@')[0];
    }
    return finalize(out);
  }

  // NEFT / IMPS / RTGS
  const xfer = U.match(/\b(NEFT|IMPS|RTGS)\b/);
  if (xfer) {
    out.channel = xfer[1];
    const parts = s.split(/[-\/]/).map(cleanPart).filter(Boolean);
    out.ref = pickRef(parts);
    const useful = parts.filter((p) => !isNoise(p) && !/^(NEFT|IMPS|RTGS)(\s?(CR|DR))?$/i.test(p) && /[A-Za-z]{3,}/.test(p));
    if (useful.length) {
      out.merchant = useful[0];
      if (useful.length > 1) out.note = useful[useful.length - 1];
    }
    return finalize(out);
  }

  // ACH / NACH / ECS mandates (EMIs, SIPs)
  const ach = s.match(/\b(?:ACH|NACH|ECS)\s*[-\/]?\s*(?:D|DR|DEBIT)?\s*[-\/]\s*(.+)$/i);
  if (ach) {
    out.channel = 'ACH';
    const parts = ach[1].split(/[-\/]/).map(cleanPart).filter(Boolean);
    out.ref = pickRef(parts);
    const useful = parts.filter((p) => !isNoise(p) && /[A-Za-z]{3,}/.test(p));
    if (useful.length) out.merchant = useful[0];
    return finalize(out);
  }

  // Bill pay
  const bil = s.match(/\bBIL\/(?:ONL|INB|BPAY)?\/?[^\/]*\/([^\/]+)/i);
  if (bil) {
    out.channel = 'BILLPAY';
    out.merchant = cleanPart(bil[1]);
    return finalize(out);
  }

  // Card / POS
  if (/^(POS|ECOM|PCD|VPS|IPS|ME DC|CARD)\b/i.test(s) || /\d{4,}X{2,}\d{2,}/i.test(s)) {
    out.channel = 'CARD';
    const cleaned = s
      .replace(/^(POS|ECOM|PCD|VPS|IPS|ME DC|CARD)\s*/i, '')
      .replace(/\b[0-9X*]{8,}\b/gi, ' ')
      .replace(/\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    out.merchant = cleaned.split(' ').slice(0, 4).join(' ') || null;
    return finalize(out);
  }

  // Fallback: strip numbers and noise, keep first words
  const words = s
    .replace(/[\/\-_]/g, ' ')
    .split(/\s+/)
    .filter((w) => !isNoise(w) && /[A-Za-z]/.test(w));
  out.merchant = words.slice(0, 4).join(' ') || null;
  return finalize(out);
}

function finalize(out) {
  if (out.merchant) {
    out.merchant = out.merchant
      .replace(/\b(PVT|PRIVATE)\.?\s*(LTD|LIMITED)\.?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    if (!out.merchant) out.merchant = null;
  }
  if (out.note && out.merchant && out.note.toUpperCase() === out.merchant.toUpperCase()) out.note = null;
  return out;
}
