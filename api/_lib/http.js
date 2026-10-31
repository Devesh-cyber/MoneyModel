// Shared hardening for every API function (files in api/_lib are not exposed as routes).
//  • POST + application/json only, body size cap
//  • Origin allow-list (same host, or ALLOWED_ORIGINS)
//  • Best-effort per-IP rate limit (per warm instance — pair with Vercel Firewall rules)
//  • Strict response headers, no caching
//  • Request bodies are NEVER logged

const buckets = new Map();

export function securityHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

export function send(res, status, obj) {
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit(key, { limit = 30, windowMs = 60000 } = {}) {
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
  b.count++;
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return { allowed: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) };
}

export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return process.env.ALLOW_NO_ORIGIN === 'true';
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  const reqHost = req.headers['x-forwarded-host'] || req.headers.host;
  if (host && reqHost && host === String(reqHost).split(',')[0].trim()) return true;
  if (process.env.VERCEL_URL && host === process.env.VERCEL_URL) return true;
  const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

async function readBody(req, maxBytes) {
  if (req.body !== undefined && req.body !== null) {
    const str = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (Buffer.byteLength(str) > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
    return typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(str);
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Wrap a handler: (body, ctx) => result object */
export function withApi(handler, { method = 'POST', maxBytes = 32 * 1024, limit = 30, checkOrigin = method === 'POST' } = {}) {
  return async function api(req, res) {
    securityHeaders(res);
    try {
      if (req.method !== method) { res.setHeader('Allow', method); return send(res, 405, { error: 'Method not allowed' }); }
      if (checkOrigin && !originAllowed(req)) return send(res, 403, { error: 'Origin not allowed' });
      const rl = rateLimit(`${clientIp(req)}|${req.url?.split('?')[0]}`, { limit });
      if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfter)); return send(res, 429, { error: 'Too many requests, slow down' }); }
      let body = {};
      if (method === 'POST') {
        const ct = String(req.headers['content-type'] || '');
        if (!ct.toLowerCase().startsWith('application/json')) return send(res, 415, { error: 'Content-Type must be application/json' });
        try { body = await readBody(req, maxBytes); }
        catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? 'Payload too large' : 'Invalid JSON' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Body must be a JSON object' });
      }
      const out = await handler(body, { req });
      return send(res, 200, out);
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      // log only the error message, never the request body or headers
      console.error(`[api] ${req.url?.split('?')[0]} ${status}: ${String(e.message || e).slice(0, 200)}`);
      return send(res, status, { error: status === 500 ? 'Internal error' : e.message });
    }
  };
}
