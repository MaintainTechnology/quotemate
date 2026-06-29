# Deployment guide — Vercel + Railway

`quotemate-automation` is configured to deploy cleanly to **either** Vercel or Railway from the same codebase. Pick one or run both in parallel for redundancy / region distribution.

| | Vercel | Railway |
|---|---|---|
| **Build path** | Vercel's own pipeline (ignores `Dockerfile`) | `Dockerfile` → `output: 'standalone'` |
| **Cold start** | ~200ms | ~500ms-1s |
| **Free tier** | Hobby (sufficient for pilot) | $5/mo trial credit, then ~$5-10/mo for this app |
| **Best for** | Frontend + Edge-friendly | Long-running tasks, custom Docker, AU region |
| **Region available in AU** | Sydney (`syd1`) | Singapore (closest) |

The same env vars work on both. The same code paths work on both. The only difference is which dashboard you push to.

---

## Pre-flight (one-time)

You should already have these from following the `stage1-05-sop.html` setup:

- `.env.local` with all keys (Twilio, Vapi, Deepgram, ElevenLabs, Anthropic, Supabase, Stripe, Resend)
- A working local `pnpm dev` that produces quotes against your Supabase

If you don't, finish the Stages 01–05 SOP first.

## Required env vars (both platforms)

Set these in **each** platform's dashboard. They're identical between Vercel and Railway:

| Variable | Used by | Public? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Stages 03–10 | yes (bundled into client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Stages 03–10 (with RLS) | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | All server routes | **no — server only** |
| `ANTHROPIC_API_KEY` | Stages 04 (Sonnet) + 05 (Opus) | no |
| `VOYAGE_API_KEY` (optional) | Stage 04 embeddings | no — falls back to stub if unset |
| `TWILIO_ACCOUNT_SID` | Vapi import + future SMS | no |
| `TWILIO_AUTH_TOKEN` | Vapi import + future SMS | no |
| `TWILIO_PHONE_NUMBER` | Display purposes | no |
| `VAPI_API_KEY` | Server-side Vapi management | no |
| `VAPI_ASSISTANT_ID` | Server URL updates | no |
| `VAPI_SERVER_URL` | Where Vapi POSTs end-of-call | no |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Checkout (Stage 10) | yes (with `NEXT_PUBLIC_` prefix if used in browser) |
| `STRIPE_SECRET_KEY` | Stripe API calls | no |
| `STRIPE_CONNECT_CLIENT_ID` | Tradie onboarding | no |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | no |
| `RESEND_API_KEY` | Stage 07 quote emails | no |
| `RESEND_FROM` | Email sender address | no |
| `APP_URL` | Internal route handoffs | yes (different per environment) |
| `QUOTE_SHARE_BASE_URL` | Customer-facing quote URLs | yes (typically same as `APP_URL`) |

The `APP_URL` and `QUOTE_SHARE_BASE_URL` values **differ per environment**:
- Local dev: `http://localhost:3000`
- Vercel: `https://your-app.vercel.app` (or your custom domain)
- Railway: `https://your-app.up.railway.app` (or your custom domain)

---

## Deploying to Vercel

### Initial setup (~5 minutes)

```bash
# 1. Install the Vercel CLI (if you haven't)
pnpm add -g vercel

# 2. From quotemate-automation/, link the project to Vercel
vercel link
# Pick or create a project named "quotemate-automation"

# 3. Push your env vars in bulk (one-time)
vercel env pull .env.vercel.local        # downloads what's already there (likely nothing)
# then in the dashboard or via CLI, add each var per environment (Production / Preview / Development)
```

### Subsequent deploys

```bash
# Preview deploy (safe — gets its own URL, doesn't touch production)
vercel

# Production deploy
vercel --prod
```

Or simply push to your main branch — if you've connected the GitHub repo via the Vercel dashboard, every commit auto-deploys.

### Vercel-specific notes

- Vercel **ignores** `Dockerfile` and `railway.json`. They're harmless to leave in the repo.
- The `output: 'standalone'` flag in `next.config.ts` is also ignored by Vercel — uses its own bundling.
- API routes run as serverless functions. Default 10s timeout on Hobby, 60s on Pro. Stage 04 (Sonnet) and Stage 05 (Opus) routes both have `export const maxDuration = 60` set, so they need at least the Pro plan to run long quotes — or the routes will time out.
- Edge functions are not used in this app — everything is Node runtime (the AI SDK and Stripe SDK are Node-only).

---

## Deploying to Railway

### Initial setup (~10 minutes)

```bash
# 1. Install Railway CLI
pnpm add -g @railway/cli

# 2. Log in
railway login

# 3. From quotemate-automation/, link to a new project
railway init
# Pick "Empty project" — your code will go in via Docker

# 4. Link this directory to that project
railway link

# 5. Push environment variables. Either paste them one-by-one in the dashboard,
#    or in bulk via CLI:
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set NEXT_PUBLIC_SUPABASE_URL=https://...
# ... (repeat for all required env vars)
```

A faster alternative: in the Railway dashboard, click your service → Variables → "Raw editor" → paste your `.env.local` contents directly. Railway parses them all at once.

### Initial deploy

```bash
railway up
```

Railway reads `railway.json`, builds via the `Dockerfile`, exposes the resulting container on a public URL. The first build takes 3–5 minutes (npm/pnpm install + Next.js build); subsequent builds use cached layers and take ~90 seconds.

### Subsequent deploys

```bash
railway up                            # one-shot deploy from local
```

Or connect your GitHub repo via the Railway dashboard for auto-deploy on push.

### Railway-specific notes

- **Port handling**: Railway sets `PORT` dynamically. Next.js's standalone `server.js` honours `process.env.PORT` automatically. The `Dockerfile`'s `ENV PORT=3000` is just a default for local Docker runs.
- **Public URL**: assigned by Railway automatically. Find it under Settings → Networking → Public Networking. Use this as your `APP_URL` and `QUOTE_SHARE_BASE_URL`.
- **Healthchecks**: Railway pings `/api/health` every ~30 seconds. The route returns instantly without a DB ping. If you want a deeper check that includes DB connectivity, point a paid uptime monitor at `/api/health/deep` instead.
- **Custom domain**: Settings → Networking → Custom Domain. Same DNS setup as any other host (CNAME to the Railway-provided domain).
- **Region**: defaults to US-West. Change to Singapore (closest to AU) for lower latency under Settings → Region.
- **Logs**: `railway logs` or Dashboard → Deployments → [latest] → View logs.

---

## After either deploy — point Vapi at the new URL

Vapi needs to know where to POST `end-of-call-report`. Once you have your live URL:

```bash
# From quotemate-automation/, with .env.local pointed at the new live URL:
VAPI_SERVER_URL=https://your-app.vercel.app/api/vapi/webhook \
  node --env-file=.env.local scripts/update-vapi-server-url.mjs
```

Or do it in the Vapi dashboard: Assistants → QuoteMax Receptionist → Messaging → Server URL.

---

## Running both Vercel and Railway in parallel

Possible and reasonable for redundancy. Two patterns:

| Pattern | When to use |
|---|---|
| **Active-active** (both serve traffic via DNS round-robin or a CDN) | High-availability paranoia. Adds complexity — both must stay in sync; webhooks must accept either origin. |
| **Active-passive** (Vercel is primary; Railway is failover) | More reasonable. Use Vercel for production, keep Railway warm-but-idle, point Vapi at Vercel. If Vercel goes down, change one env var (`VAPI_SERVER_URL`) and traffic flows through Railway. |

For a v1 pilot, **pick one**. Vercel is simpler for the Next.js use case; Railway gives you more control and a closer SG region. Don't dual-deploy until you actually need it.

---

## Health check matrix

| Endpoint | What it checks | When it runs |
|---|---|---|
| `GET /api/health` | Just that the process is up + responsive | Railway healthcheck every ~30s |
| `GET /api/health/deep` | Env vars present + Supabase reachable + seed data exists | Manual / paid uptime monitor |
| `POST /api/vapi/webhook` with sentinel payload | Full webhook → DB chain | When you want to verify the deployment end-to-end |

Quick post-deploy verification:

```bash
# Replace with your actual deployed URL
DEPLOY_URL="https://your-app.vercel.app"

# 1. Process up?
curl -s "$DEPLOY_URL/api/health" | jq

# 2. DB reachable + seed loaded?
curl -s "$DEPLOY_URL/api/health/deep" | jq

# 3. Webhook chain alive?
curl -s -X POST "$DEPLOY_URL/api/vapi/webhook" \
  -H "Content-Type: application/json" \
  -d '{"message":{"type":"ping"}}'
# Expected: {"ok":true,"ignored":"ping"}
```

If all three return clean, the deploy is good.

---

## Troubleshooting

### `pnpm build` fails with "Cannot find module 'next'"
You likely ran `npm install` somewhere and corrupted the lockfile. From the project root: `rm -rf node_modules .next && pnpm install`.

### Railway build fails with "no Dockerfile"
Make sure `railway.json` is at the repo root of the linked service. If your Railway service points at the parent monorepo (not `quotemate-automation/`), set the **Root Directory** under Settings → Source → Root Directory to `/quotemate-automation`.

### Vercel deploys but Stage 04/05 routes time out
Sonnet + Opus calls take 25–40 seconds each. Vercel Hobby caps at 10s. Either upgrade to Pro (60s) or move those routes to a longer-tolerance host (Railway has no fixed cap).

### Supabase rejects requests after deploy
Check that `NEXT_PUBLIC_SUPABASE_URL` doesn't end with `/rest/v1/` — that suffix is auto-appended by the JS client. Should be just `https://yourproject.supabase.co`.

### Stripe webhook signature fails
The webhook secret is per-endpoint, not per-account. After deploy, go to Stripe Dashboard → Developers → Webhooks → add a new endpoint pointing at `https://your-deployed-url/api/stripe/webhook`, then copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` on the platform you deployed to.

### Memory or build size warnings on Railway
The standalone Next.js bundle is ~150MB. If you're hitting limits, ensure `.dockerignore` excludes `scripts/` and `sql/` (the included version does this).
