// Turns positioned text items from a text-based PDF statement into transactions.
// Pure function: the browser (pdfExtract.js) or Node tests produce the items with pdf.js.
//
// Strategy:
//  1. Group items into visual lines by their y coordinate, sort each line by x.
//  2. Find the table header (Date + Debit/Withdrawal + Credit/Deposit [+ Balance]) and
//     remember the x-centre of each amount column. The header can repeat on every page.
//  3. A line whose first cell is a date starts a row. Numbers are assigned to the nearest
//     amount column; text before the first amount column is the description.
//  4. Lines without a date directly under a row are wrapped description continuations.
//  5. No header found? Fall back to balance-delta inference (last number = balance).

import { parseAmount, parseDateStrict, round2 } from '../utils.js';
import { extractFromNarration } from './narration.js';

const NUM_RE = /^-?[\d,]+\.\d{2}(\s?(dr|cr))?$/i;
const FOOTER_RE = /opening balance|closing balance|statement summary|page\s+\d+|^total\b|generated on|this is a computer|end of statement|\*\*\*/i;

export function groupLines(items, tolerance = 2.5) {
  const sorted = items
    .filter((it) => it && typeof it.str === 'string' && it.str.trim())
    .map((it) => ({ str: it.str.trim(), x: it.x, y: it.y, w: it.w || it.str.length * 4.5 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines.length ? lines[lines.length - 1] : null;
    if (line && Math.abs(line.y - it.y) <= tolerance) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function detectHeader(line) {
  const text = line.items.map((i) => i.str).join(' ').toLowerCase();
  if (!/date/.test(text)) return null;
  if (!/(withdrawal|debit|dr\b)/.test(text) || !/(deposit|credit|cr\b)/.test(text)) return null;
  const cols = {};
  for (const it of line.items) {
    const s = it.str.toLowerCase();
    const centre = it.x + it.w / 2;
    const right = it.x + it.w;
    if (/withdrawal|debit|^dr\.?$/.test(s) && !cols.debit) cols.debit = { centre, right, left: it.x };
    else if (/deposit|credit|^cr\.?$/.test(s) && !cols.credit) cols.credit = { centre, right, left: it.x };
    else if (/balance/.test(s) && !cols.balance) cols.balance = { centre, right, left: it.x };
    else if (/description|narration|particulars|details|remarks/.test(s) && !cols.desc) cols.desc = { left: it.x };
  }
  if (!cols.debit || !cols.credit) return null;
  return cols;
}

function nearestColumn(item, cols) {
  const c = item.x + item.w / 2;
  const r = item.x + item.w;
  let best = null;
  let bestD = Infinity;
  for (const name of ['debit', 'credit', 'balance']) {
    if (!cols[name]) continue;
    // amounts are usually right-aligned under the header; use the closer of centre/right distance
    const d = Math.min(Math.abs(cols[name].centre - c), Math.abs(cols[name].right - r));
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

function isRefLike(s) {
  return /^[A-Z0-9\-\/]{6,}$/i.test(s) && /\d{5,}/.test(s) && !/[a-z]{4,}/i.test(s.replace(/\d/g, ''));
}

/**
 * @param {{items:{str:string,x:number,y:number,w:number}[]}[]} pages
 * @returns {{txs:object[], headerFound:boolean, rowsSeen:number, skipped:number}}
 */
export function parsePdfStatement(pages) {
  let header = null;
  let headerFound = false;
  const rows = [];
  let current = null;

  for (const page of pages) {
    const lines = groupLines(page.items || []);
    let lastRowY = null;
    for (const line of lines) {
      const h = detectHeader(line);
      if (h) { header = h; headerFound = true; current = null; continue; }
      const joined = line.items.map((i) => i.str).join(' ');
      if (FOOTER_RE.test(joined)) { current = null; continue; }

      const first = line.items[0]?.str || '';
      // Dates can be split into separate items ("1", "Aug", "2026"); try first 1-3 items.
      let date = null;
      let dateItems = 0;
      for (let k = 1; k <= Math.min(3, line.items.length); k++) {
        const cand = line.items.slice(0, k).map((i) => i.str).join(' ');
        const d = parseDateStrict(cand);
        if (d) { date = d; dateItems = k; }
      }

      if (date) {
        const rest = line.items.slice(dateItems);
        // skip a second "value date" column if it directly follows
        let start = 0;
        for (let k = 1; k <= Math.min(3, rest.length); k++) {
          if (parseDateStrict(rest.slice(0, k).map((i) => i.str).join(' '))) start = k;
        }
        const body = rest.slice(start);
        const nums = [];
        const descParts = [];
        let ref = null;
        const amountZoneLeft = header
          ? Math.min(...['debit', 'credit', 'balance'].filter((n) => header[n]).map((n) => header[n].left)) - 8
          : Infinity;
        for (const it of body) {
          if (NUM_RE.test(it.str) && (it.x + it.w >= amountZoneLeft - 4 || !header)) nums.push(it);
          else if (isRefLike(it.str) && !ref && descParts.length) ref = it.str;
          else descParts.push(it.str);
        }
        current = { date, nums, desc: descParts.join(' '), ref, y: line.y };
        rows.push(current);
        lastRowY = line.y;
        continue;
      }

      // continuation line: only text, close below the previous row, inside description zone
      if (current && lastRowY !== null && lastRowY - line.y < 30) {
        const textOnly = line.items.filter((i) => !NUM_RE.test(i.str));
        const inDesc = header ? textOnly.filter((i) => i.x < (header.debit.left - 8)) : textOnly;
        if (inDesc.length && inDesc.length === line.items.length) {
          current.desc += ' ' + inDesc.map((i) => i.str).join(' ');
          lastRowY = line.y;
        }
      }
    }
  }

  const txs = [];
  let skipped = 0;
  let prevBalance = null;
  for (const row of rows) {
    let amount = null;
    let direction = null;
    let balance = null;
    if (header) {
      for (const n of row.nums) {
        const col = nearestColumn(n, header);
        const v = parseAmount(n.str);
        if (v === null) continue;
        if (col === 'debit' && Math.abs(v) > 0) { amount = Math.abs(v); direction = 'debit'; }
        else if (col === 'credit' && Math.abs(v) > 0) { amount = Math.abs(v); direction = 'credit'; }
        else if (col === 'balance') balance = v;
      }
    } else if (row.nums.length >= 2) {
      const vals = row.nums.map((n) => parseAmount(n.str));
      balance = vals[vals.length - 1];
      amount = Math.abs(vals[vals.length - 2]);
      const marker = row.nums[row.nums.length - 2].str;
      if (/dr$/i.test(marker)) direction = 'debit';
      else if (/cr$/i.test(marker)) direction = 'credit';
      else if (prevBalance !== null) direction = balance < prevBalance ? 'debit' : 'credit';
      else if (/\b(BY|CR)\b/i.test(row.desc)) direction = 'credit';
      else if (/\b(TO|DR)\b/i.test(row.desc)) direction = 'debit';
    }
    if (balance !== null) prevBalance = balance;
    if (!amount || !direction) { skipped++; continue; }
    const desc = row.desc.replace(/\s+/g, ' ').trim();
    const n = extractFromNarration(desc);
    txs.push({
      date: row.date,
      amount: round2(amount),
      direction,
      merchant: n.merchant,
      vpa: n.vpa,
      p2p: n.p2p,
      channel: n.channel,
      hint: n.hint,
      ref: n.ref || (row.ref && /^\d{9,16}$/.test(row.ref) ? row.ref : null),
      note: n.note,
      rawText: desc.slice(0, 300),
    });
  }
  return { txs, headerFound, rowsSeen: rows.length, skipped };
}
