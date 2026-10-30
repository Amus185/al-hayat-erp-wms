# Alhayat assistant (Cloudflare Worker + Workers AI)

A chat assistant inside the staff app ("Assistant" in the menu) for Al-Hayat's managers. It understands and answers in **Somali** (any dialect or spelling, mixed with English), answers questions about **every part of the ERP** from live data (sales, customers and debts, stock, deliveries, purchases and suppliers, accounting, expenses, assets, manufacturing, reports), refuses anything else, and can **propose** stock and price changes that only happen after the user presses **Confirm**.

## How it fits together

```
staff app ──(1) POST /api/v1/agent/session──▶ Alhayat backend   → 5-minute agent token (60 per user per hour)
staff app ──(2) POST /chat + agent token────▶ this Worker        → Workers AI model with tools
Worker    ──(3) POST /api/v1/agent/tools/*──▶ Alhayat backend   → read-only lookups, scoped to the user
                                              (get_data: any module, through that module's own API route)
Worker    ──(4) POST /api/v1/agent/proposals▶ Alhayat backend   → a change is recorded, NOT made
staff app ──(5) Confirm: POST /api/v1/agent/actions/:id/execute (the user's own login)
                                              → runs through the normal route (/inventory/adjust, PATCH /products/:id)
```

- The Worker has **no database access** and no normal login token. The agent token carries the user's session, so signing out, deactivation or a password change cut the assistant off immediately, and permissions are read from the database on every lookup.
- **What it can read** is the catalog in `backend/src/services/agent-data.ts`: one entry per ERP API route (about 50, accounting included). `get_data` runs that route in-process **as the signed-in user**, so permissions, branch scope and figures are exactly those of the user's own screens. To give the assistant a new module, add one line there; the Worker picks the list up when it is next deployed.
- Branch users only see their branch. Per-item cost prices are only sent to the model for users who can see cost reports (`view_reports`); changes need `manage_inventory`.
- A proposal can only be confirmed by the user it was made for, once, within 15 minutes, and then goes through the same validation, branch rules and audit as the normal screens.

## Somali

- **Instructions** (`src/somali.ts`): reply in Somali; understand any dialect, spelling, typos and Somali-English mixes without keywords; a glossary of the Somali words managers use for each ERP area (deyn, faa'iido, xaashida dheelitirka, kharash, bakhaar, sapleer, ...) and for time (maanta, bishan, bishii hore, ...); today's date in Hargeisa time.
- **Off topic:** the model calls `decline_off_topic` and the user gets exactly *"Kaliya waxaan kaaga jawaabi karaa wax ku saabsan hawlaha Al-Hayat."* The Worker also replaces any answer that contains that sentence with exactly it. Greetings and questions about any ERP area, accounting included, are in scope.
- **No invented figures:** every number must come from a tool result. If the model states figures without having looked anything up, the Worker asks it once to look them up, and otherwise answers that it has no data instead of showing the number.
- The Confirm card's summary and the page's labels are in Somali.

## Model

`AI_MODEL` in `wrangler.jsonc` (one place to change it): **`@cf/google/gemma-4-26b-a4b-it`** (Gemma 4, 26B mixture-of-experts with 4B active). Google trained Gemma 4 on 140+ languages and it has native tool calling, so it is the best Somali choice on Workers AI at the time of writing; the previous default (`@cf/qwen/qwen3-30b-a3b-fp8`) is weak in Somali.

**Not tested with the real model yet** (no Cloudflare access where it was built). After deploying, run the Somali evaluation below. If a model does poorly, change `AI_MODEL` and run it again; candidates with tool calling: `@cf/zai-org/glm-4.7-flash`, `@cf/meta/llama-4-scout-17b-16e-instruct`, larger models on a paid plan.

### Settings for heavier use

All optional, in `wrangler.jsonc` vars (Worker) or as backend Worker vars; the defaults work on the Free plan:

| Setting | Default | What |
|---|---|---|
| `AGENT_MAX_ROUNDS` | 6 | model calls per question (2-12) |
| `AGENT_MAX_HISTORY` | 10 | earlier messages sent along (2-40) |
| `AGENT_MAX_REPLY_TOKENS` | 1000 | reply length (200-4000) |
| `AI_GATEWAY_ID` | (none) | send model calls through Cloudflare AI Gateway: logs, caching, rate limits |
| `AGENT_MESSAGES_PER_HOUR` (backend) | 60 | assistant messages per user per hour |

The assistant Worker itself mostly waits on the model and the backend, so it fits the Free plan's CPU limit; the model calls count against Workers AI's daily free allowance, then are billed per token.

## Deploy (you do this; it needs your Cloudflare account)

1. Pick a long random secret, e.g. in PowerShell:
   ```powershell
   [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```
2. On the backend Worker: `cd backend` then `npx wrangler secret put AGENT_TOKEN_SECRET` with that value. It must be 32+ characters and different from `BETTER_AUTH_SECRET`. Without it the assistant stays switched off.
3. `wrangler.jsonc` reaches the backend through the `ALHAYAT_API` service binding (Worker `al-hayat-api`, deployed first; see `docs/DEPLOY_CLOUDFLARE.md`). Check `ALLOWED_ORIGINS` is your staff app address (default `https://al-hayat-erp.pages.dev`).
4. Deploy the Worker:
   ```powershell
   cd C:\al-hayat-erp-wms\ai-agent
   npm install
   npx wrangler login
   npx wrangler secret put AGENT_TOKEN_SECRET
   npx wrangler deploy
   ```
   Note the `https://alhayat-ai-agent.<you>.workers.dev` address it prints.
5. Staff app: set `VITE_AGENT_URL` to that address when building (e.g. `web/.env.production`), then `npm run deploy:web`. The **Assistant** menu item appears only when it is set.
6. Logs: `npx wrangler tail`.

## Try it locally

With the local backend running (see `docs/LOCAL_TESTING.md`) and `AGENT_TOKEN_SECRET` set on it:
```powershell
cd C:\al-hayat-erp-wms
$env:AGENT_TOKEN_SECRET = "the same value as the backend"
$env:ALHAYAT_API_URL = "http://localhost:3100/api/v1"
node --import tsx ai-agent/dev/local-server.ts
```
Then start the staff app with `$env:VITE_AGENT_URL = "http://127.0.0.1:8788"`. Without Cloudflare credentials the local server uses a **simulated model** (keyword matching, no AI) so the screens and the confirm step can be tried. To use the real model locally, also set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with *Workers AI: Read*).

## Somali evaluation with the real model

Asks the live system 35 questions (Somali in several styles and spellings across every module, accounting included; off-topic questions; a greeting; one in English) and reports which ERP area the model consulted, whether it answered in Somali, the off-topic sentence, and any figure not found in the data. Read-only. Use an administrator login so every module is reachable:

```powershell
cd C:\al-hayat-erp-wms
$env:ERP_API_URL = "https://al-hayat-erp.pages.dev/api/v1"
$env:STAFF_EMAIL = "..."; $env:STAFF_PASSWORD = "..."
$env:CLOUDFLARE_ACCOUNT_ID = "..."; $env:CLOUDFLARE_API_TOKEN = "..."   # token with Workers AI: Read
node --import tsx ai-agent/scripts/somali-eval.ts
```
`ONLY=3,7` runs some questions; `AI_MODEL=...` tries another model without deploying. Each question uses one of the user's assistant messages for the hour.

## Tests

```powershell
cd C:\al-hayat-erp-wms
node --import tsx --test ai-agent/tests/*.test.ts
```
They use a scripted model and a stubbed backend (`tests/somali.test.ts`: Somali instructions, one question per module, off-topic reply, no invented figures, settings). The backend side: `backend/tests/agent.test.ts` and `agent-data.test.ts` (every source answers with the same data as its screen; permissions, branch scope, costs, Confirm with a cookie login), and `assistant-somali.test.ts` (Somali questions through this loop into the real backend and database: the model is given exactly the user's screen figures, accounting included). None of these test the real model's Somali; the evaluation above does.

## Not done yet

- Replies are not streamed (each answer arrives in one piece).
- Only stock adjustments and price changes can be proposed; cancelling orders is not offered.
- The real model has not been run here (no Cloudflare account on this computer); test a few questions after deploying.
