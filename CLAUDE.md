# Engineering context for Claude

> See [README.md](README.md) for the public overview and [docs/strategy.md](docs/strategy.md) for the living strategy + re-evaluation history.
> **This file describes what is actually built and running as of 2026-07-24.** Where the running system has drifted from a documented strategy decision, that drift is called out explicitly (⚠) rather than hidden. When a "decisions" entry diverges from reality, the honest move is to **append a new `docs/strategy.md` iteration entry** documenting the why — not to quietly bury the drift.

## Project state — a multi-trade AI quoting platform, NOT a 2-trade pilot

The app is built and live end-to-end against a real Supabase instance across **three channels** (tradie portal + SMS + voice) and **eight trades**. Any copy of this file, `README.md`, or `docs/strategy.md` that still says "greenfield", "electrical + plumbing only", or "third trade not yet built" is **stale** — treat this section as ground truth.

- **Application lives in [`quotemate-automation/`](quotemate-automation/)** — a Next.js 16 App Router app. The repo root holds planning docs/assets; the product is the subdirectory.
- **Eight trades are LIVE** (present in `tenants.trades[]` and served by real pipelines): **electrical, plumbing, roofing, solar, painting, commercial_painting, aircon, signage**. The old "electrical + plumbing, no third trade" boundary is fully superseded — the `trades` registry + admin CSV loader (`docs/strategy.md` v9) shipped (migration 155 `register_activatable_trades`, 171 `register_roofing_trade`; `lib/admin-loader/*`, `/admin/loader`).
- **8 tenants, all `active`.** Mix of single-trade (3 roofing-only, 1 electrical-only) and multi-trade (two hold all 8 trades). Seed "Pilot Sparky/Plumber" tenants are gone.
- **Three intake channels, all shipped:**
  - **Voice** — Vapi → `/api/vapi/webhook` → intake → estimate → quote SMS. Persona "jon".
  - **SMS** — Twilio → `/api/sms/inbound`. This one route holds **four different receptionists** (see *How the pipelines work*). ⚠ It does NOT choose between them per message: the roofing handler runs first and `shouldEngageRoofing` (`lib/sms/roofing-receptionist.ts:968`) resumes on `isActiveRoofingFlow(prev)` alone, never inspecting the inbound text for another trade. `route.ts:2185-2187` then returns before `extractSlots` (`:2353`). So on a multi-trade tenant an **active roofing thread captures every subsequent turn regardless of what the customer asks**, and the electrical/plumbing dialog is unreachable — the same class as the documented "roofing trigger words hijack painting enquiries" debt.
  - **Web forms** — self-serve customer forms for solar (`/solar/[tenantSlug]`), painting (`/paint-request/[token]`), aircon plan upload, etc.
- **Tradie self-serve onboarding is live** (`/signup`, `/onboard/*`, `/api/onboard/*`), with Twilio + Vapi auto-provisioning (`lib/twilio/provision.ts`, `lib/vapi/provision.ts`). Provisioning flags (`TWILIO_PROVISIONING_ENABLED`, `VAPI_PROVISIONING_ENABLED`) are `false` in dev; every live tenant already has a provisioned SMS + voice number.
- **Auth is Clerk** (`@clerk/nextjs`, `tenants.clerk_user_id`, migration 163; `lib/clerk/*`, `lib/tenant/current.ts` resolves a Clerk **or** legacy Supabase JWT). Supabase PKCE is the older path still present in `/auth/callback`.
- **Production**: custom domain **`https://www.quotemax.com.au`** on Vercel (the `APP_URL` default), served by the Vercel deployment `quote-mate-rho.vercel.app`. ⚠ Provisioned Twilio numbers are split: the 5 older numbers point their SMS webhook at `quote-mate-rho.vercel.app`, the 3 newest (roofing) at `www.quotemax.com.au` — both resolve to the same app, but the webhook URL is written once at provision time and never re-asserted. Also Railway-deployable (`Dockerfile` + `railway.json`, `output: 'standalone'`).
- **Money path: Stripe test mode, but Connect Express IS now wired** (migration 160 `connect_payouts`; `lib/stripe/connect.ts`, `checkout.connect.ts`). The `/r/*` mints route with `transfer_data` + a platform `application_fee` for electrical/plumbing/solar/roofing/painting. **1 of 8 tenants** has a connected account onboarded so far. ⚠ `payments` as a table no longer exists (payment state lives on the `quotes`/measurement rows + Stripe).

## The decisions that shape the work

Settled after substantive re-evaluation (iteration history at the end of `docs/strategy.md`). Don't drift silently — if work demands a change, **add a new iteration entry to `docs/strategy.md`** before changing this table.

| Decision | What it means in practice | Status in the running system |
|---|---|---|
| **Portal + SMS + voice intake** | Tradie-typed portal was the v1 wedge; voice, SMS, and web forms were added. | All live. Voice + SMS + self-serve web forms all ship. Original v3 "voice deferred" is contradicted; drift logged `docs/strategy.md` v6. |
| **Trades-as-data, not hand-wired** | A trade is a `trades` registry row + admin CSV loader, not code. | **Built and live.** 8 trades in production. Registry tables (`trades`, `trade_prompts`, `trade_pricing_defaults`, `trade_spec_defs`) + `lib/admin-loader/*` + `/admin/loader`. `docs/strategy.md` v9 is realised. |
| **Four agents, not ten** | Quote Drafter, Reviewer, Inspection Coordinator, Conversion Engine. | Drafter (Opus) + grounding validator + confidence router shipped; reviewer/conversion partial (tradie-notify, booking, 2h follow-up mig 159). No full follow-up sequence yet. |
| **LLM conversation, deterministic money** | **Every** SMS receptionist — electrical/plumbing, roofing, painting — is Sonnet 5 driven; every figure still comes from a tool, checked by a grounding validator. | Shipped 2026-07-26, `SMS_LLM_RECEPTIONIST_ENABLED` **default ON** (`0` = kill switch for all tenants; a comma-separated tenant-id list narrows to a pilot). Supersedes "zero LLM in the roofing/painting customer flow" — `docs/strategy.md` v17. The deterministic state machines remain as the per-turn **fallback net**, not the driver. |
| **Build the pricing book WITH the tradie** | Base assembly library per trade; tradie overlay via onboarding. | `shared_assemblies` (63) / `shared_materials` (46) seeded; per-tenant overlay via `pricing_book.overlays`, `tenant_custom_assemblies`, `tenant_material_catalogue/preferences`, `tenant_service_offerings` (221), `tenant_tier_ladder`, historical-quote import (`lib/historical-quotes/*`). |
| **Eval framework before prompt iteration** | Hold-out (intake → quote) pairs, rubric scoring. | ⚠ **Partially built.** `eval_runs` + `eval_run_items` tables (55 rows), `/admin/agents/eval-fixture` scorer. Still not the full 100-pair 5-dim rubric; prompts largely iterate without delta measurement. |
| **Stripe Connect Express** | Each tradie owns funds; QuoteMax takes a platform fee. | **Now wired** (mig 160). `/r/*` mints use `transfer_data` + `application_fee` for elec/plumb/solar/roofing, and for painting's $99 site visit (`docs/strategy.md` v19 — the deposit mints that bypassed Connect are retired). 1/8 tenants onboarded to Connect. Still Stripe **test** keys. |
| **Auto-send vs review-required** | Path B: drafted quote auto-sends; tradie reviews after. | Live, per-trade nuance: electrical/plumbing/roofing auto-send; **solar** auto-releases only *clean* estimates (`SOLAR_AUTO_RELEASE` default on — flagged/inspection held); **painting + commercial painting** are review-required (customer sees no price until the tradie releases). ⚠ Price *visibility* only — orthogonal to what the customer is **charged**. See *review gates* below. |
| **What the customer pays** | Originally: a % tier deposit, with the $99 inspection as the fallback route. | ⚠ Superseded per trade. **Flat $99 refundable site visit only**: roofing, painting (`docs/strategy.md` v19), electrical + plumbing (**v20**, 2026-08-06 — the 30% deposit converted at 3.2% vs 14.8% for the $99 on electrical; plumbing's deposit never converted, 0/53). Prices stay visible; the price is confirmed on site. **Tier deposit**: solar + commercial painting only. |
| **Pay-first booking funnel** | Every funnel is quote → Stripe → `/book` (calendar only) → `/thanks`. | Live since 2026-07-22 (`docs/strategy.md` v16). Two invariants an engineer can silently break: (1) the early-booking discount MUST be realised at the Stripe mint (`resolveMintDiscount` in the `/r/*` routes) — moving it back to the book route kills the discount for everyone; (2) `canTakePayment()` MUST gate every mint, so a tenant with zero bookable windows is never charged. ⚠ Both invariants have known holes on tenant-less rows (see debt). ⚠ Invariant (1) now only *reaches* solar + commercial painting — the flat-$99 trades never hit a discountable mint. |

## Repository layout

```
.
├── CLAUDE.md                          # this file
├── README.md                          # public overview (⚠ lags: still says fewer tenants/trades)
├── docs/
│   ├── strategy.md                    # living strategy (v18; SMS routing + trade-guard drift logged 2026-07-29)
│   ├── skills-toolkit.md              # skills/agents/commands → build-phase mapping
│   └── *.html + markdown/*.md + superpowers/specs/*  # build guide, SOPs, progress, specs
├── assets/                            # flow SVG, experience map, logo
├── PRODUCT.md / DESIGN.md / .impeccable/  # design system sources of truth (see Design Context)
├── redesign/DesignSystem/             # canonical QuoteMax design system + quotemax-design skill
├── .claude/                           # vendored skills/agents/commands (see .claude/PLUGINS.md)
└── quotemate-automation/              # ◀── THE APPLICATION
    ├── AGENTS.md                      # ⚠ "This is NOT the Next.js you know" — READ FIRST
    ├── CLAUDE.md                      # just `@AGENTS.md`
    ├── app/                           # Next.js App Router: pages + /api routes (see below)
    ├── lib/                           # ~55 domain modules (see below)
    ├── sql/                           # init.sql + migrations/002…182 (216 files incl. *_down)
    ├── scripts/                       # ~150 ops/diagnostic .mjs (run: node --env-file=.env.local …)
    ├── tests/ + *.test.ts             # vitest unit (6400+ tests) + playwright e2e
    ├── Dockerfile, railway.json, vercel.json, next.config.ts
    └── .env.local                     # all live secrets — NEVER commit, NEVER paste into docs
```

### `lib/` domain modules (largest first)

`solar` · `roofing` · `sms` · `quote` · `estimate` · `painting` · `dashboard` · `signage` · `filestore` · `admin-loader` · `onboard` · `aircon` · `historical-quotes` · `commercial-painting` · `estimation` · `vapi` · `flyer` · `canva` · `crm` · `ig-engine` (image gen) · `email` · `tenant` · `stripe` · `voice` · `clerk` · `videos` (trust videos) · `intake` · `pdf` · `twilio` · `studio` · `features` · `agents` · `marketing` · `billing` · `pylon` · `opensolar` · `customers` · `routing` · `trades` · plus `qr`, `invoice`, `catalogue`, `supabase`, `log`, `phone`, `prompt-template`, `kb-sync`, `auth`.

### The webpage surface (App Router)

**Customer-facing quote + booking pages** — one funnel per trade, all pay-first (quote → `/r/*` Stripe → `/book` calendar → `/thanks`):

| Funnel | Customer view | Booking | Thank-you | Stripe redirect |
|---|---|---|---|---|
| electrical / plumbing / solar | `/q/[token]` | `/q/[token]/book` | `/q/[token]/thanks` | `/r/[token]/[tier]` |
| roofing | `/q/roof/[token]` | `/q/roof/[token]/book` | `/q/roof/[token]/thanks` | `/r/roof/[token]/[tier]` |
| painting | `/q/paint/[token]` | `/q/paint/[token]/book` | `/q/paint/[token]/thanks` | `/r/paint/[token]/[tier]` |
| aircon / commercial paint / plan | `/q/aircon`, `/q/commercial-paint`, `/q/plan`, `/q/choose` | via the generic funnel | | |

- Solar has no pages of its own — it books on the generic `/q/[token]` funnel via a **twin `quotes` row** sharing the same token.
- One picker serves every funnel: `app/q/_chrome/BookingCalendar.tsx`.
- ⚠ `/q/[token]/paid` is **not** a rendered page — it's the Stripe `success_url` router (resolves the webhook race via `confirmPaidFromSession`, then redirects to `/book`/`/thanks`/quote).
- Other customer surfaces: `/upload/[token]` (photo upload), `/s/*` `/share/*` `/t/*` `/p/*` (share/short links, marketing QRs), `/solar/[tenantSlug]` and `/paint-request/[token]` (self-serve intake forms), `/legal/*`, `/pricing`.

**Tradie-facing** (`/dashboard/*`, Clerk-authed): overview/KPIs/pipeline, plus per-trade tabs — `crm`, `estimator`, `quote`, `roofing`, `painting`, `aircon`, `signage`, `studio`, `flyer`, `pricing-wizard`, `invites`. The **`/m/[measure_token]`** page is the tradie-facing Measurement Results surface for roofing (toggle structures, correct measurements → re-price, "save as quote"). Auth/onboarding: `/sign-in` `/sign-up` (Clerk), `/signin` `/signup` `/auth/callback` (legacy Supabase), `/onboard/*`, `/account`, `/forgot-password`.

**Admin** (`/admin/*`): `tenants`, `customers`, `loader` (trades CSV loader), `agents` (+ eval fixtures), `files`, `metrics`, `invites`, `docs`. **Studio** (`/studio`, `/s`): marketing-asset generation (Canva, flyers, trust videos).

**Key API routes** (`app/api/*`): `sms/inbound`, `vapi/webhook` (+ `vapi/tools/*`), `intake/structure`, `estimate/draft`, `quote/[id]/edit`, `stripe/webhook`, `cron/*`; per-trade `roofing/*` (measure, measure-all, save, save-as-quote, measurement, static-map, detect-solar, layout-plan, model3d, verify-photo, q/*), `solar/*` (`[tenantSlug]/estimate`, confirm, redraft, q/[token]/select-building, q/[token]/pdf), `painting/*` (estimate, save, edit, release, preview, structures, detect-material), `aircon`, `signage`, `commercial-paint`; `tenant/*` (`me`, `trades`, `services`, `chats`, `trade-jobs`, `commercial-painting`), `onboard/*`, `admin/*`, `paint-request/[token]`, `filestore/*`, `billing/*`, `health` + `health/deep`.

## Tech stack — as actually wired

| Layer | Reality |
|---|---|
| Framework | **Next.js 16.2.4** App Router, React 19.2, Turbopack, `output: 'standalone'`. ⚠ Breaking changes vs older Next — `quotemate-automation/AGENTS.md` mandates reading `node_modules/next/dist/docs/` before writing Next code. |
| LLM | **Vercel AI SDK v6** (`ai` 6.0, `@ai-sdk/anthropic` 3.0) calling Claude **directly via `ANTHROPIC_API_KEY`** (not the Vercel AI Gateway). **Intake structuring + estimation = Opus 4.8** (`lib/intake/structure.ts`, `lib/estimate/run.ts`). **SMS receptionists (dialog + slot extraction + intent) = `claude-sonnet-5`** (`lib/sms/model.ts` — one shared const, `maxOutputTokens` set explicitly because the pinned `@ai-sdk/anthropic@3.0.71` predates the model id). Vapi voice persona = Haiku 4.5 (`VAPI_VOICE_MODEL`). Anthropic prompt caching on the system prompt. ⚠ The pinned provider has no `claude-sonnet-5` capability entry — see `lib/sms/model.ts` for why `maxOutputTokens`/structured-output need explicit handling. |
| RAG / rerank | Supabase `pgvector` 0.8 (`embedding vector(1536)`, `match_intakes`). Voyage embeddings; Cohere reranker (`RAG_RERANK_PROVIDER`; `lib/estimate/rag.ts`, `rerank.ts`); stubs if unset. |
| Measurement providers | **Roofing** — Geoscape (primary, `GEOSCAPE_API_KEY`) + PropRadar + Google satellite/tiles; `ROOFING_PROVIDER`, semantic edge analysis (`ROOFING_EDGE_ANALYSIS_ENABLED`), 3D model (Tripo, `TRIPO_*`). **Solar** — Google Solar API building-insights + a manual bucket fallback when uncovered; Felt map (`FELT_API_KEY`); OpenSolar + Pylon cross-checks (`PYLON_ENABLED`, `lib/opensolar/*`, `lib/pylon/*`). **Painting** — Google Solar building lookup + street-view for wall area. |
| Image / vision | **Trade "after" renders** (roofing re-roof, painting/commercial repaint) via **Hugging Face** FLUX.1-Kontext-dev (`HF_IMAGE_PROVIDER`/`HF_IMAGE_MODEL`), Replicate → Gemini fallbacks; per-trade `ROOFING_IMAGE_PROVIDER`/`PAINTING_IMAGE_PROVIDER`. **SMS preview/samples** keep a text-to-image selector (`IG_IMAGE_PROVIDER`). Vision/detect (material, solar, signage, judge) spread across Gemini, Cloudflare, NVIDIA, Stability (`*_VISION_MODEL` flags). Selectors in `lib/ig-engine/providers/*`. |
| DB / auth / storage | **Supabase** (Postgres 17 + pgvector), project ref `bobvihqwhtcbxneelfns`. **Auth = Clerk** (primary) + legacy Supabase PKCE. Storage buckets: `intake-photos`, tenant files, tenant videos. Server routes use `SUPABASE_SERVICE_ROLE_KEY` (RLS bypassed — tenancy is app-layer). |
| Voice | Vapi + Deepgram (STT) + ElevenLabs (TTS) — shipped, persona "jon". Prompt sync via `VAPI_PROMPT_SYNC_ENABLED`. |
| SMS / WhatsApp | Twilio AU long codes; SMS-first with WhatsApp fallback (`lib/sms/dispatch.ts`). Dev shared number `+61481613464`. |
| Payments | Stripe **test mode**, **Connect Express wired** (`transfer_data` + platform `application_fee`) for elec/plumb/solar/roofing + painting's $99 site visit (its only customer charge since `docs/strategy.md` v19). |
| Email | Resend (`lib/email/*`, campaigns + transactional). |
| PDF | **Gotenberg HTML→PDF** (`lib/pdf/gotenberg.ts`) from `lib/quote/report-html.ts` and the per-trade report-html builders; cached on the row, lazily regenerated on template/tier-mode change. Live HTML quote pages still exist; no react-pdf. |
| CRM / marketing | CRM push (`lib/crm/*`, `crm_connections`); Canva designs, flyers, marketing QRs, trust videos (`lib/{canva,flyer,marketing,videos}/*`). |
| Analytics / errors | No PostHog/Sentry yet. Observability = `lib/log/pipeline.ts` + **`pipeline_traces`** table (structured per-request traces) + platform logs + `scripts/`. |
| Deploy | Vercel (prod + crons) and/or Railway (Docker). See `quotemate-automation/DEPLOY.md`. |

## The live database (Supabase `bobvihqwhtcbxneelfns`)

**85 base tables** in `public` (was 18). For ad-hoc inspection connect with `pg` via `SUPABASE_DB_URL` (pattern: `scripts/run-migration-*.mjs`). Schema/seed source of truth: `sql/init.sql` + `sql/migrations/002…182`. Grouped by domain:

- **Trades registry (v9):** `trades`, `trade_prompts`, `trade_pricing_defaults`, `trade_spec_defs`, `job_type_bounds`.
- **Pricing / reference:** `pricing_book` (6), `shared_assemblies` (63), `shared_materials` (46), `shared_assembly_bom`, `supplier_catalogue`/`supplier_price_refs`, `paint_rates`, `signage_rules` (882), `categories`, `brands`.
- **Tenancy / onboarding:** `tenants` (8), `tenant_service_offerings` (221), `tenant_custom_assemblies`, `tenant_assembly_overrides`/`_bom`, `tenant_material_catalogue`/`_preferences`, `tenant_tier_ladder`, `tenant_licences`, `tenant_file_documents`/`_comments`, `tenant_historical_quotes`/`_import_batches`, `tenant_trade_videos`, `onboarding_codes`, `code_redemptions`, `tradie_signup_intents`, `tradie_edit_patterns`, `admin_users`, `admin_audit_log`, `orgs`.
- **Pipeline (per trade):** `intakes` (241), `quotes` (228 — G/B/B line items in `good`/`better`/`best` jsonb; `quote_line_items` does not exist / never used), `roofing_measurements` (100), `solar_estimates` (34) + `solar_building_cache` + `solar_config`, `painting_measurements` (22) + `painting_lead_requests`, `paint_runs`, `aircon_recommendations` + `plan_uploads`/`plan_upload_requests`/`plan_extractions`, `signage_requests`/`_assessments`/`_sweeps`/`_photo_submissions`, `pricing_suggestions`, `calls`, `customers` (6), `crm_contacts`/`_connections`, `quote_followup_events`, `trade_paid_amount` (mig 181).
- **SMS:** `sms_conversations` (210; `conversation_type`, `conversation_state`/`roofing_state`/`painting_state` jsonb, follow-up pins), `sms_messages` (2597), `lead_throttle`.
- **Integrations / assets:** `opensolar_proposals`, `pylon_proposals`, `canva_connections`/`_designs`/`_oauth_states`, `flyers`, `marketing_qrs`/`qr_scans`, `studios`, `email_campaigns`/`_sends`/`_unsubscribes`, `invoice_uploads`/`_extractions`, `catalogue_findings`, `import_batches`/`import_staged_rows`, `kb_sync_state`.
- **Eval / observability:** `eval_runs`/`eval_run_items` (55), `pipeline_traces` (1661).

**RLS reality:** RLS is **ON for 78 of 85 tables**. The 7 with RLS off are backup/staging/internal tables (`*_backup_mig*`, `kb_sync_state`, `job_type_bounds`, `painting_lead_requests`, `supplier_price_refs`). Multi-tenant isolation in API routes + server components is still **app-layer `tenant_id` filtering** (service-role key bypasses RLS). ⚠ The audits found tenancy holes on **token-only** endpoints (see debt) — the RLS-on status does not by itself close them.

## How the pipelines work — FOUR distinct shapes

The system is not one pipeline. Which one runs depends on the trade:

**1. Electrical / plumbing — LLM intake → estimate (the original).**
`intake (voice/SMS/portal)` → `lib/intake/structure.ts` (Opus 4.8 vision + Zod) → embedding → `lib/estimate/run.ts` (RAG + brand hint → Opus 4.8 with **tool-calling only** for prices via `lib/estimate/tools.ts`) → JSON draft → **`lib/estimate/validate.ts` grounding check** (every line-item price must derive from `pricing_book` + `shared_*` + `tenant_custom_assemblies` scoped to `intake.trade`; any failure downgrades the whole quote to the $99 inspection route) → `lib/routing/decide.ts` → `quotes` row + Stripe sessions + customer SMS + tradie notify. Trade prompt in `lib/estimate/prompt.ts`. ⚠ Since `docs/strategy.md` v20 (2026-08-06) the Stripe session minted here is **always the flat $99 site inspection** for these two trades — `draft.good/better/best` is still computed, stored, shown on `/q/[token]`, printed in the PDF and listed in the SMS, it is simply not sold against; `createCheckoutSessionsForQuote` (the 3-tier mint) is retired-but-present.

**2. Roofing — SMS receptionist + dashboard measure. LLM conversation, deterministic money.**
⚠ Changed 2026-07-26 (`docs/strategy.md` v17): the customer-facing flow is **no longer zero-LLM**. `app/api/sms/inbound/route.ts` `handleRoofingTurn` gates on `tenants.trades` containing `roofing` (a roofing-only tenant engages without a keyword), then decides the turn one of two ways. ⚠ On a **multi-trade** tenant this is not a per-message choice: `shouldEngageRoofing` (`lib/sms/roofing-receptionist.ts:968`) returns true on `isActiveRoofingFlow(prev)` alone, so once a roofing thread is open it captures every later turn whatever the customer writes, and `route.ts:2185-2187` returns before `extractSlots` (`:2353`) — see `docs/strategy.md` v18.

- **`SMS_LLM_RECEPTIONIST_ENABLED` unset (the default) — AI drives the turn.** `claude-sonnet-5` handles greetings, questions, refusals, trade switches, and asking for missing details in natural language (`lib/sms/llm-receptionist.ts`). It returns a **tool choice**, which maps onto the same `RoofingTurnDecision` union the route already switches on.
- **Fallback, per turn** — any throw, timeout, bad shape or grounding violation runs the **pure state machine** (`lib/sms/roofing-{intake,receptionist,compose}.ts`) for that turn only. Set the flag to `0` to force every turn down that path.

Either way the pipeline is identical and deterministic: address → map-verify (`lib/sms/verify-address.ts`) → confirm → intent → material → (Colorbond profile) → pitch → `measureAndPriceRoofs` (Geoscape et al) → send roof photos + "which building(s)?" → priced SMS + `/q/roof/[token]` link + PDF. **The model never emits a price, area, structure count, measured address, quote link or booking confirmation** — `assertGroundedReply` discards any turn whose text states one no tool produced, and STOP/opt-out is decided before the model is called. The tradie also has a **dashboard path** (`/api/roofing/{measure,save,save-as-quote}` + the `/m/[measure_token]` page). Two tokens minted as a pair (`lib/roofing/tokens.ts`): customer `public_token` (`/q/roof/…`), tradie `measure_token` (`/m/…`).

**3. Solar — deterministic web-form engine (no SMS).**
Public `POST /api/solar/[tenantSlug]/estimate` from the `/solar/[tenantSlug]` form. Fully deterministic chain (`lib/solar/*`): geocode → Google Solar coverage gate → roof facts (or manual bucket fallback) → sizing into G/B/B tiers (capped by roof + DNSP export limit) → annual AC production (CEC cross-check) → price (gross − STC rebate = net, CER postcode→zone table) → savings/payback economics → guardrails. Persists three rows (an `intakes` row, a `solar_estimates` row, and a **twin `quotes` row** for the generic pay-first funnel). Review gate: `SOLAR_AUTO_RELEASE` auto-releases a *clean, priced, non-inspection* estimate in `after()`; flagged/inspection estimates are held behind `lib/solar/publish.ts`. Background OpenSolar + Pylon cross-checks can add guardrail flags. No LLM writes prices; the one AI feature (the "roof intelligence" brief, `lib/solar/ai-brief.ts`, Sonnet) is prompted with zero dollar figures and validated.

**4. Painting — SMS receptionist + self-serve form, review-required.**
Mirrors roofing exactly, including the LLM conversation layer and its `SMS_LLM_RECEPTIONIST_ENABLED` flag (**default ON**; `0` is the kill switch) (`lib/sms/painting-*.ts`, `handlePaintingTurn`), or the `/paint-request/[token]` form. Area from Google Solar building lookup + street-view; pricing in `lib/painting/pricing.ts`. **Review-required**: the customer sees a holding message, and prices + the payable $99 site visit only unlock after the tradie presses "Send" (`lib/painting/publish-gate.ts` gates `/q/paint/[token]`; `resolvePaintMintTier` gates `/r/paint/*` on released-∨-inspection-routed). Since `docs/strategy.md` v19 the ONLY customer payment is that flat $99 refundable visit — no tier deposit. Commercial painting is a **separate stack** (`lib/commercial-painting/*`, `paint_rates`/`paint_runs`) that texts the price immediately (⚠ divergent delivery rule vs residential).

**Aircon** (`lib/aircon/*`): plan-upload → sizing/design → recommendation (`aircon_recommendations`). **Signage** (`lib/signage/*`): photo/vision assessment against `signage_rules` (882 rows). Both hang off the dashboard + generic funnel.

## Review gates & the money invariants (get these right)

- **Who holds prices:** painting + commercial-painting = held until tradie release; solar = held unless clean+auto-release; electrical/plumbing/roofing = auto-send. Each trade has its own gate module — do not assume one covers another. ⚠ This is about **price visibility only** — it says nothing about what the customer is charged (see *What the customer pays* below); elec/plumb auto-send their prices AND take only the $99.
- **Pay-first:** the early-booking discount is realised at the **generic** `/r/[token]/[tier]` mint (`resolveMintDiscount`) — every flat-$99 mint carries no discount, so since v20 the discount is reachable **only by solar and commercial painting**; the elec/plumb quote page suppresses the countdown banner rather than advertise a saving they can no longer earn. `canTakePayment()` must gate every mint.
- **What the customer pays** — the per-trade payment model, stated once:
  - **Flat $99 refundable site visit and nothing else:** roofing, painting (`docs/strategy.md` v19), **electrical + plumbing** (v20, 2026-08-06). G/B/B prices stay **visible** as information; the price is confirmed on site. Retired deposit links keep working by 302: `/r/paint/<token>/<G|B|B>` → `/r/paint/<token>/inspection`, and `/r/<token>/<G|B|B>` → `/r/<token>/inspection` for elec/plumb (`resolveGenericMintTier`, `lib/quote/mint-tier.ts`). A held painting row 302s back to the quote page rather than paying anything.
  - **Tier deposit:** **solar and commercial painting only** — and they mint it through the *same* `/q/[token]` page and `/r/[token]/[tier]` route as electrical/plumbing, as do the roofing rows stored on `quotes`. ⚠ So the elec/plumb gate is an **allowlist of exactly `['electrical','plumbing']`** on the raw `intakes.trade`, and it **fails open** when the trade can't be resolved. A blocklist ("not solar") silently kills roofing's deposit path.
  - ⚠ `needs_inspection` is a **different** axis and was not repurposed: it force-nulls the tiers, so those rows have no prices to show and were always $99-only. The v20 change targets `needs_inspection=false` rows — prices shown, $99 charged.
- **Grounding:** money-touching LLM steps are **tool-calling only**; the grounding validator + inspection fallback is the hard backstop. Roofing/solar/painting pricers are pure and deterministic — no LLM in the money path.

## Conventions

- Currency stored ex-GST, displayed inc-GST. Quotes embed numbers in `good/better/best` jsonb (not normalized).
- AU/NZ-first formatting, language, dates, addresses.
- Multi-trade scoping is by the `trade` column / `tenants.trades[]` everywhere (assemblies, materials, pricing_book, intakes, prompts, validator candidates, SMS receptionist gates).
- A new trade = a `trades` registry row + admin CSV load (`/admin/loader`), **not** hand-wired code. Registry drives prompts (`trade_prompts`), pricing defaults (`trade_pricing_defaults`), spec fields (`trade_spec_defs`).
- Webhook routes fast-ack (<500ms) then run heavy work in `next/server` `after()`; idempotency on Twilio `MessageSid`; `maxDuration` raised on LLM/measure routes (Vercel Hobby's 10s times out — needs Pro or Railway). ⚠ The 60s inflight lock is shorter than the worst-case turn — see debt.
- **Internal routes carry the shared secret.** `POST /api/estimate/draft` and `POST /api/intake/structure` are internal-only and guarded by `isCronAuthorised` (`lib/agents/cron.ts`) — `proxy.ts` is a bare `clerkMiddleware()` and gates nothing, so the guard is the only gate. Every self-call site sends `Authorization: Bearer ${CRON_SECRET}` (six of them: vapi/webhook, sms/inbound, q/choose/[token], intake/structure→draft, t/[slug]/lead, tenant/job-quote). ⚠ **Fail-closed in production: if `CRON_SECRET` is absent, every intake channel stops producing quotes** and three of four text the customer a failure message. `NODE_ENV` is `'production'` on Vercel **Preview** too, so the secret must be scoped to Preview as well or preview deployments 401 the whole pipeline. ⚠ This does not close every door — `/api/vapi/webhook` still has no auth of its own, so the pipeline remains reachable through it. The wiring is enforced by `tests/internal-route-auth.test.ts`, which fails if a new caller ships without the header. `docs/strategy.md` v18.
- **The intake handoff is trade-guarded.** `sideEffectsAllowed` (`lib/sms/inbound-helpers.ts`) takes an `otherTradeActive` signal derived from `roofing_state`/`painting_state.last_step`; without it a roofing thread minted an electrical intake and a real $99 electrical inspection. Never derive that signal from `conversation_state.slots.job_type` — it is null on every conversation since 2026-07-08 and would suppress all SMS quoting. `docs/strategy.md` v18.
- Scripts run with `node --env-file=.env.local scripts/X.mjs`. Never commit `.env.local` or paste its secrets.
- DB changes = a new `sql/migrations/NNN_*.sql` (+ a `NNN_down.sql`) + a `scripts/run-migration-NNN.mjs`, applied to prod Supabase; keep `sql/init.sql` representative.

## Working in this repo

- **Before writing any Next.js code**, read `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide — Next 16 has breaking changes vs training-data knowledge.
- **Strategy/product questions** — `docs/strategy.md` first, but cross-check against this file; the doc lags reality (voice, auto-send, trades-as-data, Connect all shipped past their strategy entries).
- **Adding a trade** = the registry + loader flow, not code (the "electrical + plumbing only" boundary is gone).
- **Don't rebuild ServiceM8/Tradify features** (calendar/CRM/invoicing beyond what exists) — the wedge is the AI quote draft + paid inspection flow.
- **After editing `docs/strategy.md`**, invoke the `strategy-reviewer` agent (catches drift across README/CLAUDE/assets).
- Skills/agents/commands toolkit is vendored in `.claude/` (hyphenated plugin names, e.g. `/vercel-nextjs`, `/supabase-supabase`, `/stripe-best-practices`; built-ins keep bare names). Phase→tool map: [`docs/skills-toolkit.md`](docs/skills-toolkit.md); plugin landscape: [`.claude/PLUGINS.md`](.claude/PLUGINS.md).

## Known debt / honest gaps

Recent audits (roofing SMS, then the roofing/solar/painting trade-job services) surfaced a live backlog. The load-bearing ones:

- **Solar auto-release can send a $0 confirmed quote** when the engine can't size a system (no imagery, roof too small, or **any Google Solar outage**) — `finaliseSolarEstimate` overwrites the `inspection_required` decision. Treat as critical.
- **Solar "held for review" is cosmetic on token routes** — the PDF route and the `/r/*` deposit link check `routing` but not `confirmed_at`/`released_at`, so a flagged estimate is still downloadable/payable by anyone with the link. Same class of hole on the **painting PDF** route.
- **Cross-tenant solar actions** — `/api/solar/{confirm,redraft}` check *signed in*, not *owns the quote*; keyed off the customer's own token.
- ~~Painting deposits bypass Stripe Connect~~ — **fixed by removing the path**: painting's only customer charge is now the $99 site visit, which mints with Connect routing like roofing's (`docs/strategy.md` v19). The retired 30% deposit mints are unreachable from `/r/paint/*`. ⚠ Draft/edit still writes per-tier Sessions into `painting_measurements.stripe_links` (`lib/painting/quote-dispatch.ts`) that nothing reads — dead writes, worth a cleanup.
- **Tenant-less rows skip the `canTakePayment` guard** on `/r/paint` and `/r/roof` (tenant_id NULL → mint anyway).
- **SMS receptionist blockers** (roofing + painting share the class): stop-word false-positives cancel live threads; `y`/`👍`/`ya` not accepted as yes; AU idiom ("no worries") parses as no; multi-pick "1 and 2" truncates; mapper vocabulary gaps route quotable jobs to inspection; the roofing bot's trigger words (gutter/eaves/fascia/paint) hijack painting enquiries; "solar quote please" is a dead lead (no SMS solar flow).
- **Silent notify black holes** — a held quote with no `owner_mobile` (and no `TRADIE_NOTIFY_NUMBER`) notifies nobody; several save/update routes return HTTP 200 on failure.
- **Roofing map-verify layer** (`lib/sms/verify-address.ts`) — unbounded loop when Google "corrects" to the wrong address; no timeout on the inline Google call inside the SMS turn.
- **60s inflight lock vs ~200–300s worst-case turn** — a slow measure lets a second webhook take the lock and run concurrently (duplicate/out-of-order replies).
- **Stripe Connect** onboarded on only 1/8 tenants; **eval framework** partial; **RLS Phase 2** (tenant-scoped positive policies) still deferred — tenancy is app-layer + token-gated only.
- Historical orphan `tenant_id IS NULL` rows from legacy/dev-number traffic remain (accepted, documented; do not delete — still referenced).

## Design Context (impeccable)

Design sources of truth for any UI/frontend work (initialized 2026-07-06 via `/impeccable init`):

- **[PRODUCT.md](PRODUCT.md)** — strategic design context: register (`brand` default; tradie `/dashboard`+`/admin` is a secondary `product` register), users, purpose, brand personality, anti-references, principles, accessibility. Wins on strategy/voice.
- **[DESIGN.md](DESIGN.md)** + **`.impeccable/design.json`** — the visual system: palette, type, elevation, components, do's/don'ts. Wins on visual decisions.
- **[redesign/DesignSystem/](redesign/DesignSystem/)** — the canonical, fuller QuoteMax design system (tokens, foundations, React primitives, UI kits). The `quotemax-design` skill (`redesign/DesignSystem/SKILL.md`) is user-invocable.
- **North Star:** "The Command Centre" — warm-charcoal canvas `#16120F`, one accent (Caterpillar yellow `#FFC400`), Manrope + JetBrains Mono, square corners, borders/lit-edges/grain over shadows, Australian English, zero emoji.
- ⚠ **Retired identity:** the old navy `#0E1622` + orange `#FF5A1F` "Maintain" palette and the vendored `.claude/skills/maintain-design-system/` skill are **deprecated** — do not reintroduce. Yellow + charcoal is canonical.
