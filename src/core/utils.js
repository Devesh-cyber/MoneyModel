// Small, dependency-free helpers shared by the engine, the API and tests.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Date patterns used in Indian bank SMS / statements. Indian formats are day-first.
const DATE_PATTERNS = [
  // 2026-10-05 or 2026-10-05:14:22:10
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/, map: (m) => [m[1], m[2], m[3]] },
  // 05/10/2026, 05-10-26, 05.10.26
  { re: /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/, map: (m) => [m[3], m[2], m[1]] },
  // 05-Oct-26, 05 Oct 2026, 5 Oct, 2026, 05Oct26, 05-Oct-2026
  {
    re: /\b(\d{1,2})[\s\-\/]?(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*[\s\-\/,]*(\d{4}|\d{2})?\b/i,
    map: (m, fallbackYear) => [m[3] || fallbackYear, MONTHS[m[2].toLowerCase()], m[1]],
  },
  // Oct 05, 2026
  {
    re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i,
    map: (m) => [m[3], MONTHS[m[1].toLowerCase()], m[2]],
  },
];

/** Finds the first valid date inside a string. Returns 'YYYY-MM-DD' or null. */
export function findDate(text, fallbackYear) {
  if (!text) return null;
  for (const { re, map } of DATE_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(text))) {
      const [y, mo, d] = map(m, fallbackYear);
      if (!y) continue;
      const iso = toISODate(y, mo, d);
      if (iso) return iso;
    }
  }
  return null;
}

/** Strict: the whole (trimmed) string must be a date. */
export function parseDateStrict(text, fallbackYear) {
  if (!text) return null;
  const s = String(text).trim();
  if (s.length < 5 || s.length > 24) return null;
  const iso = findDate(s, fallbackYear);
  if (!iso) return null;
  // reject strings with lots of non-date content (e.g. narrations containing a date)
  const stripped = s.replace(/[\d\s\/.\-:,]/g, '').replace(/^(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*$/i, '');
  return stripped.length === 0 ? iso : null;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a, b) {
  // b - a in days
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export const monthKey = (iso) => iso.slice(0, 7);

export function daysInMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
}

export function monthsBetween(mkA, mkB) {
  const [ya, ma] = mkA.split('-').map(Number);
  const [yb, mb] = mkB.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses Indian-formatted money strings: "1,02,345.50", "₹250", "(1,234.00)", "1234.50 Dr", "-120". */
export function parseAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bdr\.?$/i.test(s)) sign = -1;
  s = s.replace(/\b(dr|cr)\.?$/i, '').replace(/(rs\.?|inr|₹)/gi, '').replace(/[,\s]/g, '');
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s) * sign;
  return Number.isFinite(n) ? n : null;
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function coefVar(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  if (m === 0) return 0;
  const v = mean(arr.map((x) => (x - m) ** 2));
  return Math.sqrt(v) / m;
}

/** FNV-1a 32-bit — used for stable ids/fingerprints, NOT for security. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function uid(prefix = 'id') {
  const rnd = (globalThis.crypto && globalThis.crypto.getRandomValues)
    ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 14);
  return `${prefix}_${rnd}`;
}

const SUFFIX_TOKENS = new Set(['PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'INC', 'CO', 'THE', 'P', 'L']);

/** Canonical merchant key: uppercase alphanumerics, company suffixes removed. */
export function merchantKey(name) {
  if (!name) return '';
  const tokens = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const kept = tokens.filter((t) => !SUFFIX_TOKENS.has(t));
  return (kept.length ? kept : tokens).join(' ').slice(0, 48);
}

export function formatINR(n, { decimals = 0 } = {}) {
  const v = Number(n) || 0;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function amountBand(n) {
  const a = Math.abs(n);
  if (a < 100) return '<100';
  if (a < 500) return '100-500';
  if (a < 2000) return '500-2000';
  if (a < 10000) return '2000-10000';
  if (a < 50000) return '10000-50000';
  return '50000+';
}

export const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
