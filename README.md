# MoneyModel — personal finance coach with a living money model

Problem statement 04. A local-first, encrypted finance coach for Indian users. It reads messy bank data (CSV, PDF, SMS), learns from your corrections, finds subscriptions, keeps a financial profile with goals, runs what-if simulations, nudges you when spending drifts, writes a monthly review and answers questions. It never recommends specific securities.

> **This frontend is a test console** for exercising every backend feature. The real UI/UX is designed separately and plugs into the same `src/core`, `src/security`, `src/ai` and `api/` modules.

---

## Quick start

```bash
npm install
cp .env.example .env        # put your Groq (gsk_…) or xAI (xai-…) key in AI_API_KEY
npm run ai:check            # one test request; prints the provider's real error if it fails
npm run dev                 # API on :3001 + app on http://localhost:5173
npm test                    # 40 tests: parsers, pipeline, security, API
```

In the app: create a passcode → **Import** → **Load full demo (CSV + PDF + SMS)**.
Then try the other tabs. Without an API key, everything still works using local fallbacks (AI features say they're unavailable).

Requires Node ≥ 20.12.

## Deploy (Vercel only — frontend + API together)

1. Push to GitHub, import the repo in Vercel (framework: Vite, auto-detected from `vercel.json`).
2. Project → Settings → Environment Variables: `AI_API_KEY` (required — Groq `gsk_…` or xAI `xai-…`, detected automatically), `AI_MODEL` (optional; defaults: Groq `openai/gpt-oss-120b`, xAI `grok-3-mini`), `AI_PROVIDER` (optional override: `groq` | `xai`).
3. Deploy. The API lives at `/api/*` on the same domain, so there is no CORS setup.
4. Recommended: add a Vercel Firewall rate-limit rule on `/api/*` (the built-in limiter is per warm instance only).

---

## Architecture

```
Browser (everything sensitive happens here)                       Vercel functions (stateless)
──────────────────────────────────────────────                    ───────────────────────────
CSV ─ PapaParse ─┐                                                 /api/categorize ┐
PDF ─ pdf.js ────┤ ingest/*  → normalize → categorize ──redacted──▶ /api/scenario   ├─ re-validate, re-redact
SMS ─ regex ─────┘   (parse)    (dedupe)   rules→known→AI→guess    /api/coach      ├─ guardrails
                                    │                               /api/report     ┘   → xAI Grok
                     correction loop (rules.js)                     /api/health
                                    │
     recurring.js → profile.js → planner.js → nudges.js → report.js
                                    │
            vault.js: AES-256-GCM encrypted IndexedDB, auto-lock, wipe
```

### Pipeline

| Step | File | What it does |
|---|---|---|
| Ingest | `src/core/ingest/sms.js` | HDFC, SBI, ICICI, Axis, Kotak SMS formats. Skips OTPs, collect requests, upcoming-debit notices, bill reminders, promos, failed transactions (with a reason). |
| | `src/core/ingest/csv.js` | Finds the header row under bank preambles, maps columns fuzzily, handles Withdrawal/Deposit columns, Amount + Dr/Cr, signed amounts, Indian number formats, footers. |
| | `src/core/ingest/pdf.js` + `pdfExtract.js` | Text PDFs: groups text into lines, detects table header, assigns amounts to Debit/Credit/Balance columns by position, joins wrapped narrations, balance-delta fallback. Password-protected PDFs supported. Scanned PDFs → clear error (OCR planned). |
| | `src/core/ingest/narration.js` | Pulls the merchant out of UPI / NEFT / IMPS / ACH / NACH / POS / ATM / bill-pay narrations. |
| Normalize | `src/core/normalize.js` | One transaction shape. Dedupe: same file re-imported, same bank reference, or same payment seen in SMS + statement (±2 days, same amount, similar merchant). Genuine identical payments stay separate. |
| Categorize | `src/core/categorize.js` | ① your learned rules → ② bank hints + a map of common Indian merchants → ③ Grok (batched, unique merchants only, redacted) → ④ word heuristics → ⑤ Uncategorized. Self-transfers detected from your own name. |
| Correction loop | `src/core/rules.js` | Fix a category → "Always" creates a rule that re-applies to past and future transactions; "Only this one" pins one transaction. Rules can be deleted. |
| Recurring | `src/core/recurring.js` | Weekly / monthly (incl. 28-day plans) / quarterly / yearly detection with amount stability. Alerts: price change, missed payment, new recurring, unused (based on your check-ins). |
| Profile | `src/core/profile.js` | Income (detected or overridden), fixed costs, variable spend per category, regular investing, emergency fund, goals, budgets (suggested or yours). |
| Planner | `src/core/planner.js` | Month-by-month simulation over 5 years; surplus shared across goals by deadline. What-if adjustments: category %/₹, income, investing, one-time expense, new monthly cost. AI turns a sentence into adjustments; **numbers are always computed locally**. A built-in parser works without AI. |
| Nudges | `src/core/nudges.js` | Over budget, pace-adjusted drift, goals at risk, deficit, thin emergency fund, unusual large payments, subscription alerts. Dismissable. |
| Report | `src/core/report.js` | Monthly totals, categories vs last month and budget, top merchants, biggest payments, recurring, price changes. AI writes the narrative from aggregates; template fallback. |
| Coach | `api/coach.js` | Answers from aggregated context only. |

### Security & privacy

- **Local-first:** files and SMS are parsed in the browser. No database, nothing stored server-side.
- **Encrypted vault** (`src/security/vault.js`): PBKDF2-SHA256 (310k iterations, random salt) → non-extractable AES-256-GCM key held only in memory; fresh IV per save; authenticated data so tampering fails; 5 wrong passcodes → exponential lockout; auto-lock on inactivity/hidden tab; wipe.
- **Redaction before AI** (`src/security/redact.js`): account and card numbers, UPI IDs, phones, emails, IFSC, PAN, Aadhaar-like numbers, balances, reference numbers, URLs, people's names (→ `[PERSON]`), your own name and any custom hidden terms. Categorising sends only merchant + direction + amount **range** + channel — no dates, no exact amounts.
- **Privacy receipts:** every AI call is logged locally showing exactly what was sent, what was hidden, and what never left the device.
- **Server hardening** (`api/_lib/http.js`): POST + JSON only, size caps, origin allow-list, per-IP rate limit, `no-store` + strict headers, request bodies never logged, key only in server env. The server re-redacts everything (defence in depth) and strictly validates AI output (only fixed categories / adjustment schema accepted), which also limits prompt-injection hidden in SMS text.
- **Guardrails** (`src/core/guardrails.js`): requests for specific stocks/funds/crypto are answered with a fixed educational message without calling the AI; AI answers naming specific products are filtered.
- **Frontend headers** (`vercel.json`): strict CSP, HSTS, no framing, no referrer, permissions locked down. pdf.js runs with `isEvalSupported: false`.
- **Honest caveat:** redacted text sent to the AI is processed by xAI.

### Demo data (`public/demo`, regenerate with `npm run demo-data`)

Fictional persona "Aarav Mehta", Aug–Oct 2026: HDFC CSV (158 rows), SBI text PDF (13 rows, wrapped narrations) + the same PDF locked with password `AARAV1990`, 79 October SMS (incl. 6 non-transaction messages) overlapping both statements, plus ICICI credit-card SMS that only exist as SMS, and a live-SMS feed for 31 Oct. Built-in story: Netflix price hike, a 28-day Jio plan, Cult.fit to mark unused, rent paid to a person (correct it to Rent once → learned), self-transfers between own accounts, October food overspend, unknown local merchants for the AI.

## Known limits (honest list)

- Scanned PDFs need OCR (planned with Tesseract.js, in-browser).
- Automatic SMS reading needs a native Android app; here you paste/upload SMS (plus the live simulator).
- "Unused subscription" relies on your check-ins — bank data can't prove usage.
- Rate limiting in serverless is per instance; use Vercel Firewall for a global limit.
- Data lives in one browser; clearing site data or forgetting the passcode loses it (by design).
