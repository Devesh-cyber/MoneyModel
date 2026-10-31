// Parses Indian bank transaction SMS (HDFC, SBI, ICICI, Axis, Kotak and similar formats).
// Pure function, no network. Non-transaction SMS (OTP, promos, collect requests,
// upcoming-debit notices, bill reminders) are skipped with a reason.

import { findDate, parseAmount, round2 } from '../utils.js';
import { extractFromNarration } from './narration.js';

const SKIP_RULES = [
  { re: /\bOTP\b|one[\s-]?time\s+password|verification code|\bcode is\b/i, reason: 'otp' },
  { re: /has requested (money|payment)|collect request|requested Rs/i, reason: 'collect_request' },
  { re: /will be (auto[\s-]?)?(debited|deducted|charged)|is scheduled|upcoming (debit|payment)|pre[\s-]?debit/i, reason: 'upcoming_debit_notice' },
  { re: /\bis due\b|\bdue (date|on|by)\b|minimum amount due|total amount due/i, reason: 'bill_reminder' },
  { re: /pre[\s-]?approved|loan offer|apply now|limited period|\boffer\b.*\bT&C\b|cashback offer/i, reason: 'promotional' },
  { re: /\bfailed\b|\bdeclined\b|\bunsuccessful\b|could not be processed/i, reason: 'failed_transaction' },
];

const DEBIT_RE = /\b(debited|debit of|debit by|has a debit|spent|sent|paid|withdrawn|withdrawal|purchase|purchased|transferred to|deducted)\b/i;
const CREDIT_RE = /\b(credited|received|deposited|refund(ed)?|cashback|reversed|reversal)\b/i;

const BALANCE_RES = [
  /(?:avl|avail(?:able)?|aval)\.?\s*(?:bal(?:ance)?|lmt|limit)\.?\s*(?:is\s*)?[:\-]?\s*(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d{1,2})?/gi,
  /\b(?:a\/c\s*)?bal(?:ance)?\s*(?:is\s*)?[:\-]\s*(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d{1,2})?/gi,
];

const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
const AMOUNT_FALLBACK_RE = /\b(?:debited|credited)\s+(?:by|for|with|of)?\s*([\d,]+(?:\.\d{1,2})?)\b/i;

const STOP = '(?=\\s+(?:on|ref(?:no)?|upi|via|using|thru|through|avl|avail|if|not|for|dated|txn|info)\\b|\\s*[.¦,(;]|$)';
const NOT_ACCOUNT = '(?!your\\b|ur\\b|a\\/?c\\b|acct?\\b|account\\b|rs[\\s.\\d]|inr\\b|₹|\\d|\\()';
const NAME_CHARS = "[A-Za-z0-9&.'\\-_* ]+?";

const MERCHANT_RES = {
  debit: [
    new RegExp(`\\b(?:trf to|transfer(?:red)? to|paid to|sent to|towards)\\s+${NOT_ACCOUNT}(${NAME_CHARS})${STOP}`, 'i'),
    new RegExp(`\\bat\\s+${NOT_ACCOUNT}(${NAME_CHARS})${STOP}`, 'i'),
    new RegExp(`\\bto\\s+${NOT_ACCOUNT}(${NAME_CHARS})${STOP}`, 'i'),
  ],
  credit: [
    new RegExp(`\\b(?:from|by)\\s+(?:vpa\\s+)?${NOT_ACCOUNT}(${NAME_CHARS})${STOP}`, 'i'),
  ],
};

/** Split a pasted blob of many SMS into individual messages (blank-line separated). */
export function splitSmsBlob(blob) {
  return String(blob || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function earliestIndex(re, s) {
  const m = s.match(re);
  return m ? m.index : -1;
}

/**
 * @param {string} sms
 * @param {{fallbackDate?: string}} opts
 * @returns {{ok:true, tx:object} | {ok:false, reason:string}}
 */
export function parseSms(sms, { fallbackDate } = {}) {
  const original = String(sms || '').trim();
  if (!original) return { ok: false, reason: 'empty' };
  if (original.length > 1200) return { ok: false, reason: 'too_long' };

  for (const rule of SKIP_RULES) if (rule.re.test(original)) return { ok: false, reason: rule.reason };

  // Normalise: newline becomes a hard boundary marker so merchant capture stops at line ends.
  let text = original.replace(/\r?\n/g, ' ¦ ').replace(/[ \t]+/g, ' ');

  const d = earliestIndex(DEBIT_RE, text);
  const c = earliestIndex(CREDIT_RE, text);
  if (d < 0 && c < 0) return { ok: false, reason: 'no_transaction_keyword' };
  const direction = d >= 0 && (c < 0 || d < c) ? 'debit' : 'credit';

  // Remove balances/limits before looking for the amount (also keeps them out of storage).
  let noBal = text;
  for (const re of BALANCE_RES) noBal = noBal.replace(re, ' [BAL] ');

  let amount = null;
  const am = noBal.match(AMOUNT_RE) || noBal.match(AMOUNT_FALLBACK_RE);
  if (am) amount = parseAmount(am[1]);
  if (!amount || amount <= 0 || amount > 1e8) return { ok: false, reason: 'no_amount' };

  const fallbackYear = (fallbackDate || '').slice(0, 4) || String(new Date().getFullYear());
  let date = findDate(noBal, fallbackYear);
  const dateInferred = !date;
  if (!date) date = fallbackDate || null;
  if (!date) return { ok: false, reason: 'no_date' };

  // Counterparty
  let merchant = null;
  let vpa = null;
  let p2p = false;
  let upiRef = null;
  let channel = /\bupi\b/i.test(text) ? 'UPI' : /\bcard\b/i.test(text) ? 'CARD' : /\bneft|imps|rtgs\b/i.test(text) ? 'TRANSFER' : null;

  const upiPath = text.match(/UPI\/(P2[MA])\/(\d+)\/([^\/¦\n]+)/i);
  const info = text.match(/\bInfo:?\s*((?:NEFT|IMPS|RTGS|UPI|ACH|NACH|BIL|POS)[^¦]*?)(?:\.\s|¦|$)/i)
    || text.match(/\b((?:NEFT|RTGS|ACH|NACH)\s*(?:CR|DR|D|C)?\s*-\s*[^¦]*?)(?:\.\s?(?=[A-Z])|\.$|¦|$)/i);
  const atm = /\bATM\b/i.test(text) && /withdrawn|withdrawal|\bwdl\b/i.test(text);
  const vpaHit = text.match(/\b(?:to|from|by)\s+(?:vpa\s+)?([a-z0-9.\-_]{2,}@[a-z]{2,})/i);
  const iciciStyle = text.match(/;\s*([A-Za-z0-9 .&'\-]+?)\s+credited/i);

  if (atm) {
    merchant = 'ATM CASH WITHDRAWAL';
    channel = 'ATM';
  } else if (upiPath) {
    merchant = upiPath[3].trim();
    p2p = upiPath[1].toUpperCase() === 'P2A';
    upiRef = upiPath[2];
    channel = 'UPI';
  } else if (info) {
    const n = extractFromNarration(info[1]);
    merchant = n.merchant;
    channel = n.channel || channel;
    p2p = n.p2p;
  } else if (vpaHit) {
    vpa = vpaHit[1].toLowerCase();
    merchant = vpa.split('@')[0];
    channel = 'UPI';
  } else if (direction === 'debit' && iciciStyle) {
    merchant = iciciStyle[1].trim();
  } else {
    for (const re of MERCHANT_RES[direction]) {
      const m = text.match(re);
      if (m && m[1] && /[A-Za-z]{2,}/.test(m[1])) { merchant = m[1].trim(); break; }
    }
  }
  if (!vpa) {
    const anyVpa = text.match(/([a-z0-9.\-_]{2,}@[a-z]{2,})/i);
    if (anyVpa && !/@(?:hdfcbank\.net|sbi\.co\.in)/i.test(anyVpa[0])) vpa = anyVpa[0].toLowerCase();
  }

  if (merchant) {
    merchant = merchant
      .replace(/\s*¦.*$/, '')
      .replace(/\b(PVT|PRIVATE)\.?\s*(LTD|LIMITED)\.?\b/gi, '')
      .replace(/[\s.\-*]+$/, '')
      .trim()
      .slice(0, 48);
    if (/^(hdfc|sbi|icici|axis|kotak)\s*bank\b/i.test(merchant)) merchant = null;
  }

  const refMatch = text.match(/\b(?:ref(?:\s*no)?|refno|upi(?:\s*ref)?|rrn|txn\s*id)[:\s.#]*([0-9]{9,16})\b/i)
    || text.match(/\(\s*ref\s*no\s*([0-9]{9,16})\s*\)/i);

  return {
    ok: true,
    tx: {
      date,
      dateInferred,
      amount: round2(amount),
      direction,
      merchant: merchant || null,
      vpa,
      p2p,
      channel,
      ref: refMatch ? refMatch[1] : upiRef,
      note: null,
      hint: atm ? 'cash' : null,
      rawText: original,
    },
  };
}

/** Parses a blob, returns parsed transactions and a skip report. */
export function parseSmsBatch(blob, opts = {}) {
  const messages = Array.isArray(blob) ? blob : splitSmsBlob(blob);
  const txs = [];
  const skipped = [];
  messages.slice(0, 5000).forEach((m, i) => {
    const r = parseSms(m, opts);
    if (r.ok) txs.push(r.tx);
    else skipped.push({ index: i, reason: r.reason });
  });
  return { txs, skipped, total: messages.length };
}
