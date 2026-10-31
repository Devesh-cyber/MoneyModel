// Local stand-in for Vercel's /api runtime. Loads .env and serves api/*.js on :3001.
// Vite (port 5173) proxies /api here, so the browser sees one origin — same as production.
import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
process.env.ALLOWED_ORIGINS ||= 'http://localhost:5173,http://127.0.0.1:5173';

const routes = ['categorize', 'scenario', 'coach', 'report', 'health'];
const handlers = {};
for (const r of routes) handlers[r] = (await import(pathToFileURL(path.join(root, 'api', `${r}.js`)).href)).default;

const PORT = Number(process.env.API_PORT || 3001);
http.createServer((req, res) => {
  const name = (req.url || '').split('?')[0].replace(/^\/api\//, '').replace(/\/$/, '');
  const h = handlers[name];
  if (!h) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"Not found"}'); }
  h(req, res);
}).listen(PORT, '127.0.0.1', async () => {
  const g = await import(pathToFileURL(path.join(root, 'api', '_lib', 'grok.js')).href);
  console.log(`[dev-api] http://127.0.0.1:${PORT}  AI: ${g.aiConfigured() ? `${g.providerLabel()} · ${g.model()}` : 'not configured'}`);
});
