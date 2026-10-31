// Tests your AI key/model with one tiny request and prints the real provider message.
// Usage: npm run ai:check
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { chat, aiConfigured, model, providerLabel, apiKey } = await import('../api/_lib/grok.js');

if (!aiConfigured()) { console.log('✗ No key found. Put AI_API_KEY=... in .env'); process.exit(1); }
const k = apiKey();
console.log(`Provider: ${providerLabel()}   Model: ${model()}   Key: ${k.slice(0, 4)}…${k.slice(-4)} (${k.length} chars)`);
try {
  const reply = await chat({ system: 'Reply with only the JSON {"ok":true}.', user: 'ping', maxTokens: 50, temperature: 0 });
  console.log('✓ Works. Model replied:', reply.trim().slice(0, 120));
} catch (e) {
  console.log('✗ Failed:', e.message);
  if (/401|403|incorrect api key|invalid api key/i.test(e.message)) console.log('  → The key is wrong for this provider. Check the prefix (gsk_ = Groq, xai- = xAI) or set AI_PROVIDER.');
  else if (/model/i.test(e.message)) console.log('  → Model name not available on your account. Set AI_MODEL to one listed in your provider console.');
  process.exit(1);
}
