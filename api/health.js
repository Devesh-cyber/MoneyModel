import { withApi } from './_lib/http.js';
import { aiConfigured, model, providerLabel } from './_lib/grok.js';

// Reports whether AI is available. Never reveals the key.
export default withApi(async () => ({
  ok: true,
  aiConfigured: aiConfigured(),
  provider: aiConfigured() ? providerLabel() : null,
  model: aiConfigured() ? model() : null,
}), { method: 'GET', limit: 60 });
