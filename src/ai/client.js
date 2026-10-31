// Browser-side AI client. Every call is redacted before it leaves the device and
// recorded as a privacy receipt: exactly what was sent, what was hidden, what never left.

import { redactDeep, redactText } from '../security/redact.js';
import { clone, uid } from '../core/utils.js';

export class AiUnavailableError extends Error {
  constructor(msg) { super(msg || 'AI unavailable'); this.name = 'AiUnavailableError'; }
}

const NEVER_SENT = {
  categorize: ['Raw SMS / statement text', 'Account & card numbers', 'Exact amounts (sent as ranges)', 'Dates', 'Balances', 'Reference numbers', 'Names of people (sent as [PERSON])'],
  scenario: ['Your transactions', 'Account details', 'Your name and hidden terms'],
  coach: ['Individual transactions', 'Merchant-level history', 'Account details', 'Names of people'],
  report: ['Individual transactions', 'Account details', 'Names of people (grouped as "Payments to people")'],
};

export function createAiClient({ baseUrl = '', onReceipt = () => {}, isEnabled = () => true, getHiddenTerms = () => [], timeoutMs = 25000 } = {}) {
  async function post(endpoint, payload, { hiddenCounts = {} } = {}) {
    const receipt = {
      id: uid('rcpt'),
      at: new Date().toISOString(),
      endpoint,
      sent: clone(payload),
      hidden: hiddenCounts,
      neverSent: NEVER_SENT[endpoint] || [],
      status: 'pending',
    };
    if (!isEnabled()) {
      receipt.status = 'not sent — AI turned off';
      receipt.sent = null;
      onReceipt(receipt);
      throw new AiUnavailableError('AI is turned off');
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        receipt.status = `failed (${res.status}${data && data.error ? `: ${data.error}` : ''})`;
        onReceipt(receipt);
        throw new AiUnavailableError(data && data.error ? data.error : `AI request failed (${res.status})`);
      }
      receipt.status = 'sent';
      if (data && data.serverRedactions && Object.keys(data.serverRedactions).length) receipt.serverRedactions = data.serverRedactions;
      onReceipt(receipt);
      return data;
    } catch (e) {
      if (e instanceof AiUnavailableError) throw e;
      receipt.status = e.name === 'AbortError' ? 'failed (timeout)' : 'failed (network)';
      onReceipt(receipt);
      throw new AiUnavailableError(receipt.status);
    } finally {
      clearTimeout(t);
    }
  }

  const redact = (text) => redactText(text, { customTerms: getHiddenTerms() });

  return {
    async health() {
      try {
        const r = await fetch(`${baseUrl}/api/health`, { cache: 'no-store', credentials: 'omit' });
        if (!r.ok) return { ok: false, aiConfigured: false };
        return await r.json();
      } catch { return { ok: false, aiConfigured: false }; }
    },

    /** items are already redacted by buildAiItems(). Returns {k: {category, confidence}} */
    async categorize(items, hiddenCounts = {}) {
      const data = await post('categorize', { items }, { hiddenCounts });
      return (data && data.results) || {};
    },

    async scenario(text, goals = []) {
      const r = redact(String(text).slice(0, 300));
      const data = await post('scenario', { text: r.text, goals: goals.map((g) => ({ id: g.id, name: redact(g.name).text })) }, { hiddenCounts: r.counts });
      return (data && data.adjustments) || [];
    },

    async coach(question, context, history = []) {
      const q = redact(String(question).slice(0, 500));
      const counts = { ...q.counts };
      const ctx = redactDeep(context, { customTerms: getHiddenTerms() }, counts);
      const hist = history.slice(-6).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: redact(String(h.content).slice(0, 800)).text }));
      const data = await post('coach', { question: q.text, context: ctx, history: hist }, { hiddenCounts: counts });
      return data;
    },

    async report(payload) {
      const counts = {};
      const p = redactDeep(payload, { customTerms: getHiddenTerms() }, counts);
      const data = await post('report', { report: p }, { hiddenCounts: counts });
      return data;
    },
  };
}
