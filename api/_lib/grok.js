// Minimal LLM client for OpenAI-compatible Chat Completions APIs.
// Supports xAI (Grok) and Groq. The provider is picked from AI_PROVIDER, or
// auto-detected from the key prefix: "xai-" → xAI, "gsk_" → Groq.
// The key is read from the server environment only and never returned or logged.
import { HttpError } from './http.js';

const PROVIDERS = {
  xai: { url: 'https://api.x.ai/v1/chat/completions', model: 'grok-3-mini', label: 'xAI Grok' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', label: 'Groq' },
};

export function apiKey() {
  return process.env.AI_API_KEY || process.env.XAI_API_KEY || process.env.GROQ_API_KEY || '';
}

export function provider() {
  const explicit = String(process.env.AI_PROVIDER || '').toLowerCase().trim();
  if (PROVIDERS[explicit]) return explicit;
  const key = apiKey();
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('xai-')) return 'xai';
  if (process.env.GROQ_API_KEY) return 'groq';
  return 'xai';
}

export const providerLabel = () => PROVIDERS[provider()].label;
export const model = () => process.env.AI_MODEL || process.env.GROK_MODEL || PROVIDERS[provider()].model;
const endpoint = () => process.env.AI_BASE_URL || process.env.XAI_BASE_URL || PROVIDERS[provider()].url;
export const aiConfigured = () => Boolean(apiKey());

// Reasoning models spend tokens "thinking" before answering; give them room so the answer isn't empty.
const isReasoningModel = (m) => /gpt-oss|grok-3-mini|grok-4|deepseek-r1|qwq|o\d/i.test(m);

/** Removes anything that looks like a key from provider error text before it is shown. */
function scrub(text) {
  return String(text || '')
    .replace(/\b(xai|gsk|sk)[-_][A-Za-z0-9_\-*]{4,}/g, '[key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [key]')
    .slice(0, 300);
}

export async function chat({ system, user, maxTokens = 700, temperature = 0.2, timeoutMs = 30000 }) {
  if (!aiConfigured()) throw new HttpError(503, 'AI is not configured on the server (set AI_API_KEY)');
  const m = model();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: m,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature,
        max_tokens: isReasoningModel(m) ? Math.max(maxTokens * 3, 2000) : maxTokens,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new HttpError(504, e.name === 'AbortError' ? 'AI timed out' : `Could not reach ${providerLabel()}`);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.error || body?.message || '';
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch { /* non-JSON error body */ }
    const status = res.status === 429 ? 429 : 502;
    throw new HttpError(status, `${providerLabel()} error ${res.status}${detail ? `: ${scrub(detail)}` : ''} (model: ${m})`);
  }
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new HttpError(502, `Empty AI response from ${m} (try a non-reasoning model or raise max tokens)`);
  return content;
}

/** Pulls the first JSON object out of a model reply (handles ```json fences / extra prose). */
export function parseJsonLoose(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}
