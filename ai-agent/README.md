# Alhayat assistant (Cloudflare Worker + Workers AI)

A chat assistant inside the staff app ("Assistant" in the menu) that answers questions about products, stock, sales and orders from live data, and can **propose** stock and price changes that only happen after the user presses **Confirm**.

## How it fits together

```
staff app ──(1) POST /api/v1/agent/session──▶ Alhayat backend   → 5-minute agent token (60 per user per hour)
staff app ──(2) POST /chat + agent token────▶ this Worker        → Workers AI model with tools
Worker    ──(3) POST /api/v1/agent/tools/*──▶ Alhayat backend   → read-only lookups, scoped to the user
Worker    ──(4) POST /api/v1/agent/proposals▶ Alhayat backend   → a change is recorded, NOT made
staff app ──(5) Confirm: POST /api/v1/agent/actions/:id/execute (the user's own login)
                                              → runs through the normal route (/inventory/adjust, PATCH /products/:id)
```

- The Worker has **no database access** and no normal login token. The agent token carries the user's session, so signing out, deactivation or a password change cut the assistant off immediately, and permissions are read from the database on every lookup.
- Branch users only see their branch. Sales figures and low stock need `view_reports`; orders need `manage_sales`; changes need `manage_inventory`. Cost prices are never sent to the model.
- A proposal can only be confirmed by the user it was made for, once, within 15 minutes, and then goes through the same validation, branch rules and audit as the normal screens.

## Model

`AI_MODEL` in `wrangler.jsonc` (one place to change it): **`@cf/qwen/qwen3-30b-a3b-fp8`**.

Workers AI prices (from Cloudflare's pricing page, October 2026), per million tokens, for models tagged *Function calling*:

| Model | Input | Output | Notes |
|---|---|---|---|
| `@cf/ibm-granite/granite-4.0-h-micro` | $0.017 | $0.112 | cheapest, but a ~3B "micro" model: weak for multi-step tool use |
| **`@cf/qwen/qwen3-30b-a3b-fp8`** | **$0.051** | **$0.335** | 30B mixture-of-experts, function calling, 32k context |
| `@cf/zai-org/glm-4.7-flash` | $0.060 | $0.400 | documented multi-turn tool calling, 131k context |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | $0.270 | $0.850 | |

Qwen3-30B is the cheapest one that is large enough to be reliable with tools. If it misbehaves, switch `AI_MODEL` to `@cf/zai-org/glm-4.7-flash` (about 20% more).

**Rough cost:** a typical question is 2 model calls of about 1,500 input tokens each plus ~250 output tokens: about **$0.0002 per question, $0.20 per 1,000 questions**. Workers AI also includes 10,000 free Neurons per day.

Cost limits in `src/agent.ts`: short system prompt, last 8 messages only, 600 tokens per reply, at most 4 model calls per question, identical lookups run once per question and are cached 30 s per user; the backend allows 60 messages per user per hour.

## Deploy (you do this; it needs your Cloudflare account)

1. Pick a long random secret, e.g. in PowerShell:
   ```powershell
   [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```
2. **Railway → backend service → Variables:** `AGENT_TOKEN_SECRET` = that value. It must be 32+ characters and different from `JWT_ACCESS_SECRET`. Without it the assistant stays switched off.
3. Edit `wrangler.jsonc`: `ALHAYAT_API_URL` (your backend, ending in `/api/v1`) and `ALLOWED_ORIGINS` (your staff app address, e.g. `https://al-hayat-erp.pages.dev`).
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

## Tests

```powershell
cd C:\al-hayat-erp-wms
node --import tsx --test ai-agent/tests/*.test.ts
```
They use a simulated model and a stubbed backend. The backend side is covered by `backend/tests/agent.test.ts`.

## Not done yet

- Replies are not streamed (each answer arrives in one piece).
- Only stock adjustments and price changes can be proposed; cancelling orders is not offered.
- The real model has not been run here (no Cloudflare account on this computer); test a few questions after deploying.
