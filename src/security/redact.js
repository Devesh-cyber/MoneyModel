// PII redaction. Runs in the browser BEFORE anything is sent to the AI, and again on the
// server as defence in depth. Pure and synchronous so both sides use the same code.

const BUSINESS_WORDS = new Set([
  'LTD', 'LIMITED', 'PVT', 'PRIVATE', 'LLP', 'INC', 'CORP', 'COMPANY', 'CO', 'ENTERPRISES', 'ENTERPRISE',
  'TRADERS', 'TRADING', 'STORE', 'STORES', 'MART', 'MARKET', 'SUPERMARKET', 'SHOP', 'CENTRE', 'CENTER',
  'SERVICES', 'SERVICE', 'SOLUTIONS', 'TECHNOLOGIES', 'TECH', 'SOFTECH', 'SYSTEMS', 'INDIA', 'BANK',
  'FINANCE', 'MEDICAL', 'MEDICALS', 'PHARMACY', 'CLINIC', 'HOSPITAL', 'HOTEL', 'RESTAURANT', 'CAFE',
  'COFFEE', 'FOODS', 'KITCHEN', 'DAIRY', 'KIRANA', 'BAKERY', 'SWEETS', 'TIFFIN', 'CLASSES', 'ACADEMY',
  'INSTITUTE', 'ELECTRICITY', 'POWER', 'GAS', 'METRO', 'TRAVELS', 'MOTORS', 'AGENCY', 'AGENCIES',
  'GENERAL', 'PROVISION', 'FARM', 'FRESH', 'BAZAAR', 'ONE', 'PAY', 'ONLINE', 'DIGITAL', 'RETAIL',
  'WHOLESALE', 'FASHION', 'GARMENTS', 'ELECTRONICS', 'MOBILES', 'SALON', 'SPA', 'FITNESS', 'GYM',
  'SOCIETY', 'CHS', 'HOUSING', 'INSURANCE', 'CAPITAL', 'MONEY', 'FUND', 'SECURITIES', 'BROKING',
  'CHEMIST', 'LAB', 'LABS', 'DIAGNOSTICS', 'CABS', 'PETROL', 'PUMP', 'STATION', 'ATM', 'CASH',
  'WITHDRAWAL', 'CHARGES', 'INTEREST', 'SAVINGS', 'BOOKS', 'TEA', 'CHAI', 'JUICE', 'PIZZA', 'BURGER',
]);

// Very common Indian given names help identify person-to-person payments.
const COMMON_GIVEN_NAMES = new Set([
  'AARAV', 'AARTI', 'ABHISHEK', 'ADITI', 'ADITYA', 'AJAY', 'AKASH', 'AMIT', 'ANAND', 'ANIL', 'ANJALI',
  'ANKIT', 'ANUSHKA', 'ARJUN', 'ARUN', 'ASHA', 'DEEPAK', 'DEEPIKA', 'DEVESH', 'DIVYA', 'GAURAV',
  'HARSH', 'ISHA', 'KAVYA', 'KIRAN', 'KUNAL', 'MANISH', 'MEERA', 'MOHIT', 'NEHA', 'NIKHIL', 'NISHA',
  'POOJA', 'PRADEEP', 'PRIYA', 'RAHUL', 'RAJ', 'RAJESH', 'RAKESH', 'RAVI', 'RIYA', 'ROHAN', 'ROHIT',
  'SACHIN', 'SAKSHI', 'SANDEEP', 'SANJAY', 'SHIVAM', 'SHREYA', 'SNEHA', 'SUNIL', 'SURESH', 'TANVI',
  'VIJAY', 'VIKAS', 'VIKRAM', 'VISHAL', 'YASH', 'ZEENAT', 'SIDDHARTH', 'KARAN', 'MAYA', 'NITIN',
]);

const PATTERNS = [
  { type: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g, token: '[EMAIL]' },
  { type: 'upi_id', re: /\b[A-Za-z0-9.\-_]{2,}@[A-Za-z]{2,}\b/g, token: '[UPI_ID]' },
  { type: 'url', re: /\bhttps?:\/\/\S+|\bwww\.\S+/gi, token: '[URL]' },
  { type: 'card', re: /\b(?:\d{4}[\s-]?)?(?:[Xx*]{2,}[\s-]?){1,3}\d{2,4}\b|\b\d{4,6}[Xx*]{4,}\d{2,4}\b/g, token: '[CARD]' },
  { type: 'account', re: /\b(?:a\/?c|acct?|account)\s*(?:no\.?|number)?\s*[:\-.]?\s*[Xx*]*\d{2,}\b/gi, token: '[ACCOUNT]' },
  { type: 'ifsc', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, token: '[IFSC]' },
  { type: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, token: '[PAN]' },
  { type: 'aadhaar', re: /\b\d{4}\s\d{4}\s\d{4}\b/g, token: '[ID]' },
  { type: 'phone', re: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{9}\b/g, token: '[PHONE]' },
  { type: 'balance', re: /(?:avl|avail(?:able)?|aval)\.?\s*(?:bal(?:ance)?|lmt|limit)\.?\s*(?:is\s*)?[:\-]?\s*(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d{1,2})?/gi, token: '[BALANCE]' },
  { type: 'reference', re: /\b\d{9,18}\b/g, token: '[REF]' },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact free text.
 * @param {string} text
 * @param {{customTerms?: string[]}} opts customTerms: user's own name(s) or anything they always want hidden
 * @returns {{text:string, counts:Record<string,number>}}
 */
export function redactText(text, { customTerms = [] } = {}) {
  let out = String(text ?? '');
  const counts = {};
  const bump = (t, n) => { if (n) counts[t] = (counts[t] || 0) + n; };
  for (const term of customTerms) {
    const t = String(term || '').trim();
    if (t.length < 2) continue;
    const re = new RegExp(escapeRe(t), 'gi');
    const m = out.match(re);
    if (m) { bump('custom', m.length); out = out.replace(re, '[HIDDEN]'); }
  }
  for (const p of PATTERNS) {
    const m = out.match(p.re);
    if (m) { bump(p.type, m.length); out = out.replace(p.re, p.token); }
  }
  return { text: out, counts };
}

/** Heuristic: does this counterparty look like a private person rather than a business? */
export function looksLikePersonName(name) {
  if (!name) return false;
  const s = String(name).trim();
  if (/@/.test(s)) {
    const [handle, psp] = s.toLowerCase().split('@');
    // merchant QR / business handles: q123…@ybl, gpay-1129…@okbizaxis, paytmqr…, bharatpe…
    if (/^okbiz|^biz/.test(psp) || /^(q\d{6,}|gpay-|paytmqr|bharatpe|mab\.|pay\.|merchant|upiqr)/.test(handle)) return false;
    if (/^[a-z]{2,}[._][a-z]{1,}\d*$/.test(handle)) return true;         // rohan.desai, priya.nair92
    if (COMMON_GIVEN_NAMES.has(handle.replace(/\d+$/, '').toUpperCase())) return true; // rahul1990
    return false;
  }
  const tokens = s.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return false;
  if (tokens.some((t) => BUSINESS_WORDS.has(t))) return false;
  if (tokens.some((t) => COMMON_GIVEN_NAMES.has(t))) return true;
  // dotted handles like "rohan.d" or "priya.n"
  if (/^[a-z]+\.[a-z]{1,3}$/i.test(s)) return true;
  return false;
}

/**
 * Prepare a merchant name for the AI. People become [PERSON]; identifiers are stripped.
 * @returns {{value:string, hidden:string[]}}
 */
export function redactMerchant(name, { p2p = false, customTerms = [] } = {}) {
  const hidden = [];
  if (!name) return { value: '', hidden };
  if (p2p || looksLikePersonName(name)) {
    hidden.push('person_name');
    return { value: '[PERSON]', hidden };
  }
  const { text, counts } = redactText(name, { customTerms });
  Object.keys(counts).forEach((k) => hidden.push(k));
  return { value: text.slice(0, 60), hidden };
}

/** Deep-redact any string values inside a JSON-able object (server-side defence in depth). */
export function redactDeep(value, opts = {}, counts = {}) {
  if (typeof value === 'string') {
    const r = redactText(value, opts);
    for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] || 0) + v;
    return r.text;
  }
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, opts, counts));
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = redactDeep(v, opts, counts);
    return o;
  }
  return value;
}
