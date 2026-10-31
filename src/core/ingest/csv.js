// Parses messy bank-statement CSV exports (HDFC, SBI, ICICI, Axis, Kotak and generic).
// Handles preamble rows before the header, footer summaries, separate Withdrawal/Deposit
// columns, single Amount + Dr/Cr columns, signed amounts and Indian number formatting.

import Papa from 'papaparse';
import { parseAmount, parseDateStrict, round2 } from '../utils.js';
import { extractFromNarration } from './narration.js';

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const COL_TESTS = {
  type: (h) => /^(dr ?\/ ?cr|cr ?\/ ?dr|type|txn type|transaction type|debit ?\/ ?credit|d ?\/ ?c)$/.test(h),
  date: (h) => /^(txn |tran |transaction |posting |value |book )?date$|^date of transaction$/.test(h),
  narration: (h) => /narration|description|particulars|remarks|details|transaction remarks/.test(h),
  debit: (h) => /withdrawal|^debit|debit amount|^dr$|paid out|money out/.test(h),
  credit: (h) => /deposit|^credit|credit amount|^cr$|paid in|money in/.test(h),
  amount: (h) => /^amount|txn amount|transaction amount/.test(h),
  balance: (h) => /balance/.test(h),
  ref: (h) => /ref|chq|cheque/.test(h),
};

function mapHeader(row) {
  const cols = {};
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    if (cols.type === undefined && COL_TESTS.type(h)) { cols.type = i; return; }
    if (COL_TESTS.date(h)) {
      // prefer transaction date over value date
      if (cols.date === undefined || (/value/.test(norm(row[cols.date])) && !/value/.test(h))) cols.date = i;
      return;
    }
    if (cols.narration === undefined && COL_TESTS.narration(h)) { cols.narration = i; return; }
    if (cols.balance === undefined && COL_TESTS.balance(h)) { cols.balance = i; return; }
    if (cols.debit === undefined && COL_TESTS.debit(h)) { cols.debit = i; return; }
    if (cols.credit === undefined && COL_TESTS.credit(h)) { cols.credit = i; return; }
    if (cols.amount === undefined && COL_TESTS.amount(h)) { cols.amount = i; return; }
    if (cols.ref === undefined && COL_TESTS.ref(h)) { cols.ref = i; return; }
  });
  return cols;
}

function headerScore(cols) {
  let s = 0;
  if (cols.date !== undefined) s += 2;
  if (cols.narration !== undefined) s += 2;
  if (cols.debit !== undefined && cols.credit !== undefined) s += 2;
  else if (cols.amount !== undefined) s += 1;
  return s;
}

/**
 * @param {string} text CSV file content
 * @returns {{txs:object[], skippedRows:number, headerRow:number, columns:object, error?:string}}
 */
export function parseCsvStatement(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  if (clean.length > 5 * 1024 * 1024) return { txs: [], skippedRows: 0, headerRow: -1, columns: {}, error: 'File too large (max 5 MB)' };
  const parsed = Papa.parse(clean, { skipEmptyLines: 'greedy' });
  const rows = parsed.data.filter((r) => Array.isArray(r));

  let headerRow = -1;
  let cols = {};
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const c = mapHeader(rows[i]);
    if (headerScore(c) >= 5 || (headerScore(c) >= 4 && (c.amount !== undefined || c.debit !== undefined))) {
      headerRow = i; cols = c; break;
    }
  }
  if (headerRow < 0) {
    return { txs: [], skippedRows: rows.length, headerRow, columns: {}, error: 'Could not find a header row with Date, Description and Amount columns' };
  }

  const txs = [];
  let skippedRows = 0;
  const hasNegatives = cols.amount !== undefined && rows.slice(headerRow + 1).some((r) => {
    const v = parseAmount(r[cols.amount]);
    return v !== null && v < 0 && !/dr\.?$/i.test(String(r[cols.amount]).trim());
  });
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDateStrict(r[cols.date]);
    if (!date) { skippedRows++; continue; }

    let amount = null;
    let direction = null;
    if (cols.debit !== undefined && cols.credit !== undefined) {
      const dr = parseAmount(r[cols.debit]);
      const cr = parseAmount(r[cols.credit]);
      if (dr && Math.abs(dr) > 0) { amount = Math.abs(dr); direction = 'debit'; }
      else if (cr && Math.abs(cr) > 0) { amount = Math.abs(cr); direction = 'credit'; }
    } else if (cols.amount !== undefined) {
      const raw = r[cols.amount];
      const a = parseAmount(raw);
      if (a !== null && a !== 0) {
        amount = Math.abs(a);
        if (cols.type !== undefined) {
          const t = String(r[cols.type] || '').trim().toLowerCase();
          direction = /^(d|dr|debit|withdraw)/.test(t) ? 'debit' : /^(c|cr|credit|deposit)/.test(t) ? 'credit' : null;
        }
        if (!direction) {
          if (a < 0) direction = 'debit';
          else if (/cr\.?$/i.test(String(raw).trim())) direction = 'credit';
          else if (hasNegatives) direction = 'credit'; // signed file: positive = money in
          else direction = /\b(refund|reversal|cashback|credit|cr|salary|received)\b/i.test(String(r[cols.narration] ?? '')) ? 'credit' : 'debit';
        }
      }
    }
    if (!amount || !direction) { skippedRows++; continue; }

    const narration = String(r[cols.narration] ?? '').trim();
    const n = extractFromNarration(narration);
    const ref = cols.ref !== undefined ? String(r[cols.ref] || '').replace(/\D/g, '') : '';
    txs.push({
      date,
      amount: round2(amount),
      direction,
      merchant: n.merchant,
      vpa: n.vpa,
      p2p: n.p2p,
      channel: n.channel,
      hint: n.hint,
      ref: n.ref || (ref.length >= 9 && !/^0+$/.test(ref) ? ref.replace(/^0+/, '') : null),
      note: n.note,
      rawText: narration.slice(0, 300),
    });
  }
  return { txs, skippedRows, headerRow, columns: cols };
}
