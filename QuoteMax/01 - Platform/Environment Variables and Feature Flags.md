---
title: Environment Variables and Feature Flags
type: reference
area: platform
tags: [quotemax, config, feature-flags, env-vars, secrets, fail-closed]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/lib/agents/cron.ts
  - quotemate-automation/lib/sms/llm-receptionist.ts
  - quotemate-automation/app/api/sms/inbound/route.ts
  - quotemate-automation/lib/solar/release.ts
  - quotemate-automation/lib/estimate/rerank.ts
  - quotemate-automation/lib/twilio/provision.ts
  - quotemate-automation/lib/vapi/provision.ts
  - quotemate-automation/lib/stripe/provision.ts
  - quotemate-automation/lib/billing/entitlements.ts
  - quotemate-automation/lib/pdf/gotenberg.ts
---

# Environment Variables and Feature Flags

**No value in this note is a secret.** Names only. The live values live in
`quotemate-automation/.env.local`, which is gitignored and must never be pasted into a
document, a ticket or a prompt.

## How this inventory was built, and what it misses

```
rg -o "process\.env\.[A-Z0-9_]+" app/ lib/ | sed 's/process\.env\.//' | sort -u
```

gives **203 distinct names** read at runtime from `app/` and `lib/`.
Widening to `scripts/` adds roughly fifty more that are ops-only.

⚠ That grep is **not complete**, and knowing why matters. Several modules take an
injected `env` object (for testability) and are called as `f(process.env)`, so the
variable name never appears next to the words `process.env`. Confirmed examples:

| Hidden name | Declared in | Called with `process.env` at |
|---|---|---|
| `SOLAR_AUTO_RELEASE` | `lib/solar/release.ts:69` | `app/api/solar/[tenantSlug]/estimate/route.ts:267` |
| `SOLAR_SUN_ASSETS` | `lib/solar/sun-assets.ts:60` | via `sunAssetsEnabled` |
| `FELT_TAB_ENABLED` | `lib/felt/client.ts:32` | |
| `OPENSOLAR_ENABLED`, `OPENSOLAR_PROPOSALS_ENABLED`, `OPENSOLAR_LEAD_PUSH_TENANTS` | `lib/opensolar/client.ts:36-42` | |
| `OPENSOLAR_ENRICHMENT_ENABLED` | `lib/solar/opensolar-supplement.ts:34` | |
| `PYLON_PROPOSALS_ENABLED` | `lib/pylon/client.ts:393` | |
| `KB_FILESTORE_URL`, `KB_API_KEY`, `KB_FILESTORE_MODEL` | `lib/estimation/filestore-client.ts:38-40` | |

To find *all* of them, grep for the injected shape as well:
`rg "[A-Z_]{4,}\?: string" lib/ app/ --type ts`.

---

## Fail-closed variables — read this section first

### `CRON_SECRET` — absent in production stops the entire quoting pipeline

`isCronAuthorised` (`quotemate-automation/lib/agents/cron.ts:22-36`) is the **only**
gate on the internal routes `POST /api/estimate/draft` and `POST /api/intake/structure`
— `proxy.ts` runs a bare `clerkMiddleware()` and protects nothing.

```
if (env.NODE_ENV === 'production') {
  if (!expected) return false          // ← no secret configured = 401 everything
  return got === `Bearer ${expected}`
}
// dev: no header at all is allowed; a WRONG header still 401s
```

Invariants:

- **In production, a missing `CRON_SECRET` MUST 401 every internal call**, which means
  every intake channel stops producing quotes and three of the four text the customer a
  failure message. This is deliberate — the alternative (open when unconfigured) is a
  public estimate engine.
- `NODE_ENV` is `'production'` on Vercel **Preview** deployments too, so the secret
  MUST be scoped to Preview as well, or every preview 401s the pipeline end to end.
- In dev the guard is asymmetric on purpose: no `Authorization` header at all passes
  (so a developer can curl the route), but a *wrong* Bearer still fails.
- `tests/internal-route-auth.test.ts` fails the build if a new self-call site ships
  without the header. Do not delete that test to make a change go green.
- ⚠ This does not close every door. `/api/vapi/webhook` has no auth of its own, so the
  pipeline is still reachable through the voice channel. See [[Voice Channel (Vapi)]].

### `SMS_RECEPTIONIST_ENABLED` — default OFF, and it retires the whole SMS route

`app/api/sms/inbound/route.ts:1668`

```
const RECEPTIONIST_ENABLED = process.env.SMS_RECEPTIONIST_ENABLED === '1'
```

`POST` returns an empty-TwiML 200 and processes **nothing** — no reply, no row
written — unless this is exactly `'1'` (`route.ts:1672-1676`).

⚠ **Drift, and it is the largest one in the vault.** The comment block at
`route.ts:1644-1666` records: *retired 2026-08-05 — the in-app SMS receptionist is
OFF*. Every tenant-owned number now points at a **Front Desk service**, which
identifies tenant + trade and forwards the turn to that trade's own receptionist
(`qm-front-desk` → `qm-<trade>-receptionist`, on Railway). Default-off was chosen so
the retirement is atomic with the deploy rather than depending on someone setting a
dashboard variable — otherwise there would be a window with two systems able to answer
the same customer.

The repo root `CLAUDE.md` still describes `/api/sms/inbound` as the live SMS channel
holding four receptionists. Against the code that is **the rollback path**, not the
running path. Rolling back needs *both* steps: set `SMS_RECEPTIONIST_ENABLED=1` **and**
repoint the Twilio numbers (previous values recorded at cutover). The flag alone
changes nothing while Twilio points elsewhere.

The 200-with-empty-TwiML on a stray inbound is also deliberate: a 4xx/5xx would make
Twilio retry every stray on a schedule, and a stray here means a misconfigured number,
which retrying cannot fix. The error-level log is the alarm.

See [[SMS Inbound Route]] and [[SMS Channel Overview]].

### Flags whose default is ON

| Flag | Default when unset | Kill switch | Where |
|---|---|---|---|
| `SMS_LLM_RECEPTIONIST_ENABLED` | **ON for every tenant** | `0` / `false` / `off` / `no` | `lib/sms/llm-receptionist.ts:104-110` |
| `SOLAR_AUTO_RELEASE` | **ON** (auto-release clean estimates) | `false` / `0` | `lib/solar/release.ts:68-75` |
| `RAG_RERANK_FALLBACK` | **ON** (fall back to the other reranker) | `false` | `lib/estimate/rerank.ts:170` |
| `VAPI_PROMPT_SYNC_ENABLED` | **ON** (prompts sync to Vapi) | `false` | `lib/vapi/update-assistant.ts:49` |
| `ESTIMATOR_CHATBOT_ENABLED` | **ON** (filestore provisioning runs) | `false` | `lib/filestore/provision.ts:23` |
| `WEB_LEAD_DIALOG_ENABLED` | **ON** | `false` | `app/api/t/[slug]/lead/route.ts:162` |

`SMS_LLM_RECEPTIONIST_ENABLED` has a four-way grammar, not a boolean:

| Value | Effect |
|---|---|
| unset | ON for every tenant |
| `0` `false` `off` `no` | OFF — the kill switch, effective on the next inbound, no redeploy |
| `1` `true` `on` `yes` `all` | ON for every tenant, explicitly |
| anything else | treated as a **comma-separated tenant-id allow-list** — narrows back to a pilot |

It is read fresh on every call so a flip takes effect on the next lambda with no state
cleanup, and the route additionally requires a resolved tenant — an inbound mapping to
no tenant (the dev shared number) always runs the deterministic path regardless
(`lib/sms/llm-receptionist.ts:97-99`).

### Provisioning flags — default OFF, and `!== 'true'` is the test

`TWILIO_PROVISIONING_ENABLED`, `VAPI_PROVISIONING_ENABLED`,
`STRIPE_PROVISIONING_ENABLED` all guard with `!== 'true'` and return a stub
(`lib/twilio/provision.ts:94`, `lib/vapi/provision.ts:37`,
`lib/stripe/provision.ts:52,163`). Any value other than the exact string `'true'` —
including `'1'`, `'True'`, `'yes'` — leaves provisioning **off**. That inconsistency
with `SMS_*_ENABLED` (which test `=== '1'`) is real and is a live footgun. See
[[Tradie Onboarding]].

---

## By concern

### Core platform

| Name | Controls | Read at | Unset behaviour | Risk if wrong |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (324 read sites) | everywhere | client construction fails | total outage |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side DB access, **bypasses RLS** | every route/server component | no DB access | a leak is full cross-tenant read/write; tenancy is app-layer only, see [[Tenancy and RLS]] |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser Supabase client, legacy PKCE auth | `/auth/callback` etc. | legacy sign-in breaks | low (Clerk is primary) |
| `SUPABASE_DB_URL` | direct Postgres for migrations + `scripts/*.mjs` (366 sites, nearly all in `scripts/`) | `scripts/run-migration-*.mjs` | scripts cannot connect | ops only |
| `SUPABASE_DEVELOPMENT_DB_URL` | dev DB for scripts | `scripts/` | falls back to prod URL in some scripts | ⚠ a script pointed at prod by accident |
| `APP_URL` | canonical origin for every generated link | `lib/quote/pdf.ts:84`, `lib/quote/booking-notify.ts:42,221`, `lib/sms/plan-estimation.ts:25` and ~70 more | **falls back to `https://www.quotemax.com.au`** at most sites | wrong value = customers texted dead links |
| `NEXT_PUBLIC_APP_URL` | client-side origin; second choice in `lib/email/links.ts:7` | | — | email links break |
| `NODE_ENV` | prod-gates Sentry sampling and the `CRON_SECRET` requirement | `lib/agents/cron.ts:29`, all three Sentry configs | `undefined` in some script contexts | see the fail-closed section |
| `PORT`, `HOSTNAME` | standalone server bind; Railway sets `PORT` dynamically | `Dockerfile:60-61` | 3000 / 0.0.0.0 | — |
| `CI` | silences the Sentry build plugin when false | `next.config.ts:66` | noisy build logs | none |

### Auth, admin and signing secrets

| Name | Controls | Read at | Unset behaviour | Risk |
|---|---|---|---|---|
| `CLERK_SECRET_KEY` | Clerk backend | `lib/clerk/*` | dashboard auth fails | full lockout |
| `PROD_CLERK_SECRET_KEY` | prod Clerk key used by ops scripts | `scripts/` | script fails | ops |
| `PLATFORM_ADMIN_USER_IDS` | comma allow-list of platform admins | `lib/onboard/invitation-codes.ts:81` | nobody is a platform admin | too-wide value = admin escalation |
| `ENCRYPTION_KEY` | **the fallback secret for three unrelated signers** | see below | those signers have no key | one leak compromises CRM OAuth state, PKCE and unsubscribe tokens at once |
| `OAUTH_STATE_SECRET` | CRM OAuth state + PKCE signing; **falls back to `ENCRYPTION_KEY`** | `lib/crm/oauth-state.ts:12`, `lib/crm/pkce.ts:19` | uses `ENCRYPTION_KEY` | CSRF on the CRM connect flow |
| `UNSUBSCRIBE_SECRET` | email unsubscribe token HMAC; **falls back to `ENCRYPTION_KEY`** | `lib/email/unsubscribe-token.ts:12` | uses `ENCRYPTION_KEY` | forged unsubscribes |
| `PREFLIGHT_TOKEN` | gates `/api/onboard/preflight` | `app/api/onboard/preflight/route.ts:34` | route is open (Playwright relies on this) | config disclosure |
| `WEB_ADMIN_PASSWORD`, `WEB_SESSION_SECRET` | the legacy `scripts/web-surface` admin surface | `scripts/` only | — | not in the Next app |
| `QUOTEMATE_AGENTS_BEARER` | bearer for the Railway agents service | `lib/agents/client.ts` | agent calls unauthenticated/rejected | |

⚠ The shared-fallback pattern on `ENCRYPTION_KEY` means three security domains collapse
into one secret whenever the specific vars are unset. Setting all three distinctly is
the safe configuration.

### LLM

| Name | Controls | Read at | Unset behaviour |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | every Claude call (the SDK reads it implicitly too) | `lib/estimate/run.ts`, `lib/intake/structure.ts`, `lib/sms/*` | all LLM steps throw; SMS falls back to the deterministic machines, estimate falls back to the inspection route |
| `ANTHROPIC_BASE_URL` | proxy/override for the Anthropic endpoint | 1 site | direct to Anthropic |
| `AI_GATEWAY_API_KEY` | present in 6 sites | | the app calls Anthropic directly, so this is largely vestigial — see open questions |
| `ESTIMATION_MODEL`, `ESTIMATION_TILE_MODEL`, `AC_PLAN_MODEL`, `FILESTORE_CHAT_MODEL`, `PREVIEW_JUDGE_MODEL`, `TRUST_VIDEO_MODEL`, `SIGNAGE_EXTRACT_MODEL`, `SIGNAGE_VISION_MODEL`, `ROOFING_VISION_MODEL`, `ROOFING_LAYOUT_MODEL`, `ROOFING_MODEL3D_IMAGE_MODEL`, `VAPI_VOICE_MODEL` | per-job model overrides | the module that owns that job | each has a hardcoded default, see [[Model and Prompt Inventory]] |
| `VOYAGE_API_KEY`, `VOYAGE_EMBED_MODEL` | RAG embeddings | `lib/estimate/rag.ts` | embedding stub, RAG returns null |
| `COHERE_API_KEY`, `COHERE_RERANK_MODEL`, `VOYAGE_RERANK_MODEL` | reranking | `lib/estimate/rerank.ts` | stub |
| `RAG_DISABLED` | `'true'` kills retrieval | `lib/estimate/rag.ts:84` | RAG on |
| `RAG_RERANK_DISABLED` | `'true'` kills reranking | `lib/estimate/rerank.ts:167` | rerank on |
| `RAG_RERANK_PROVIDER` | `voyage` \| `cohere` | `lib/estimate/rerank.ts:169` | **`voyage`** |
| `RAG_RERANK_FALLBACK` | `'false'` disables cross-provider fallback | `lib/estimate/rerank.ts:170` | **fallback ON** |

⚠ `ROOFING_VISION_MODEL` is the flag that caused a real outage: setting it to
`claude-sonnet-5` turned two unguarded `temperature: 0` call sites into hard HTTP 400s,
because newer models reject the parameter (`lib/llm/sampling.ts:26-32`). Any model
override MUST be checked against `modelAcceptsTemperature`.

### Twilio / SMS / voice

| Name | Controls | Read at | Unset behaviour | Risk |
|---|---|---|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | the Twilio REST client | `lib/twilio/*`, `lib/sms/dispatch.ts` | no outbound SMS | replies silently never send |
| `TWILIO_SMS_NUMBER`, `TWILIO_PHONE_NUMBER` | shared/dev sender numbers | `lib/sms/*` | per-tenant number used | messages from the wrong number |
| `TWILIO_WHATSAPP_FROM` | WhatsApp fallback sender | `lib/sms/dispatch.ts` | SMS only |
| `TWILIO_PROVISIONING_ENABLED` | `'true'` actually buys numbers | `lib/twilio/provision.ts:94` | **stub** — onboarding "succeeds" with no number |
| `TWILIO_ADDRESS_SID`, `TWILIO_BUNDLE_SID` | AU regulatory bundle for number purchase | `lib/twilio/provision.ts` | purchase rejected by Twilio |
| `SMS_WEBHOOK_URL`, `SMS_INBOUND_URL` | webhook URL written at provision time | `lib/twilio/set-sms-webhook.ts` | derived from `APP_URL` | ⚠ written **once** at provision and never re-asserted — this is why live numbers are split across two hostnames |
| `SMS_QUOTE_PDF_MMS` | `'1'` attaches the quote PDF as MMS | `lib/sms/send-quote-pdf.ts:49` | link only |
| `SMS_SIMULATE_ENABLED` | dry-run SMS in scripts | `scripts/` | off |
| `TRADIE_NOTIFY_NUMBER`, `TRADIE_NOTIFY_WHATSAPP`, `TRADIE_NOTIFY_SELF_TEST` | fallback tradie notification destination | `lib/sms/*` | ⚠ a held quote on a tenant with no `owner_mobile` notifies **nobody** — this is the documented silent-black-hole debt |
| `TEST_SENDER`, `TEST_CUSTOMER_NUMBERS`, `SPARKY_NUM` | test-harness numbers | `scripts/` | — |
| `SEVEN_API_KEY`, `SEVEN_FROM` | an alternate SMS provider | 2 sites | unused |
| `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_SERVER_URL` | Vapi voice | `lib/vapi/*` | voice dead |
| `VAPI_PROVISIONING_ENABLED` | `'true'` creates real assistants | `lib/vapi/provision.ts:37` | **stub** |
| `VAPI_PROMPT_SYNC_ENABLED` | `'false'` stops pushing prompts to Vapi | `lib/vapi/update-assistant.ts:49` | **sync ON** |
| `VAPI_VOICE_JON` / `_SARAH` / `_MIKE` / `_ANNA` | ElevenLabs voice ids per persona | `lib/vapi/*` | Vapi default voice |
| `VAPI_DEPLOY_BUSINESS_NAME` | display name at provision | | |
| `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` | STT / TTS behind Vapi | | Vapi's own defaults |

### Stripe and billing

| Name | Controls | Read at | Unset behaviour | Risk |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | all Stripe API calls (**test keys today**) | `lib/stripe/*` | no mints — pay-first funnel dead-ends | swapping to a live key without auditing the mint routes charges real money |
| `STRIPE_WEBHOOK_SECRET` | verifies `/api/stripe/webhook` | `app/api/stripe/webhook` | webhook rejects everything → paid quotes never confirm |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | verifies the Connect webhook | 1 site | Connect account updates never land |
| `STRIPE_PROVISIONING_ENABLED` | `'true'` creates real Connect accounts | `lib/stripe/provision.ts:52,163`, `app/api/stripe/connect/start/route.ts:79` | **stub** |
| `BILLING_ENFORCEMENT_ENABLED` | `'true'` enforces plan entitlements | `lib/billing/entitlements.ts:41` | **not enforced — every tenant gets everything** |
| `BILLING_ENFORCEMENT` | an older name, still referenced once | | ⚠ likely a stale alias, see open questions |

See [[Payments Overview]], [[Stripe Connect]], [[Mint Routes and Guards]].

### Measurement and geodata providers

| Name | Controls | Read at | Unset behaviour |
|---|---|---|---|
| `GOOGLE_MAPS_API_KEY` | the workhorse key — static maps, tiles, street view (84 sites) | `lib/roofing/*`, `lib/painting/*`, `lib/sms/verify-address.ts` | map-verify, roof photos and paint area all fail |
| `GOOGLE_SOLAR_API_KEY`, `GOOGLE_SOLAR_API_BASE_URL`, `GOOGLE_SOLAR_DATA_LAYERS_API_URL` | Google Solar building insights | `lib/solar/*` | ⚠ solar falls into the manual bucket path; see the `$0 auto-release` entry in [[Known Debt Register]] |
| `GOOGLE_GEOCODE_API_KEY`, `GOOGLE_GEOCODE_API_URL` | geocoding | `lib/solar/*`, `lib/roofing/*` | address resolution fails |
| `GOOGLE_ADDRESS_VALIDATION_API_KEY` / `_API_URL` | AU address validation | | validation skipped |
| `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACES_AUTOCOMPLETE_API_URL`, `GOOGLE_PLACES_DETAILS_API_URL` | address autocomplete | forms | manual typing |
| `GOOGLE_MAP_TILES_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_3D_KEY`, `NEXT_PUBLIC_CESIUM_ION_TOKEN` | 3D/tile rendering in the browser | `app/` client components | 3D views blank |
| `GOOGLE_WEATHER_API_KEY` | weather context | 2 sites | skipped |
| `GEOSCAPE_API_KEY`, `GEOSCAPE_API_BASE_URL` | primary AU roof measurement | `lib/roofing/measure.ts` | roofing falls to the next provider |
| `ROOFING_PROVIDER` | forces a measurement provider | `lib/roofing/measure.ts:96` | automatic selection |
| `PROPRADAR_API_KEY`, `PROPRADAR_API`, `PROPRADAR_API_BASE_URL`, `PROPRADAR_ENRICHMENT` | secondary roof/property data | `lib/roofing/*` | enrichment skipped |
| `DOMAIN_API_KEY`, `DOMAIN_API`, `DOMAIN_API_BASE_URL` | Domain property data | | skipped |
| `NOMINATIM_API_URL` | OSM geocode fallback | 1 site | fallback unavailable |
| `FELT_API_KEY`, `FELT_TAB_ENABLED` | Felt map embeds | `lib/felt/client.ts:32-33` | tab hidden |
| `TRIPO_API_KEY`, `TRIPO_MODEL_VERSION`, `TRIPO_FACE_LIMIT`, `TRIPO_TEXTURE_QUALITY` | 3D roof model generation | `lib/roofing/model3d*` | no 3D model |
| `ROOFING_SOLAR_ENRICHMENT`, `ROOFING_EDGE_ANALYSIS_ENABLED`, `ROOFING_MODEL3D_SYNTH` | roofing sub-features | `lib/roofing/*` | see open questions |
| `OPENSOLAR_*` (`API_TOKEN`, `ORG_ID`, `USERNAME`, `PASSWORD`, `ENABLED`, `PROPOSALS_ENABLED`, `LEAD_PUSH_TENANTS`, `ENRICHMENT_ENABLED`) | OpenSolar cross-check | `lib/opensolar/client.ts:36-42`, `lib/solar/opensolar-supplement.ts:34` | cross-check skipped, no guardrail flag added |
| `PYLON_ENABLED`, `PYLON_API_KEY`, `PYLON_LEAD_PUSH_TENANTS`, `PYLON_PROPOSALS_ENABLED` | Pylon cross-check; `'true'` **or** `'1'` both enable | `lib/pylon/client.ts:30` | skipped |
| `SOLAR_AUTO_RELEASE` | see the default-ON table | `lib/solar/release.ts:69` | **auto-release ON** |
| `SOLAR_EXPANDED_COVERAGE`, `SOLAR_PREMIUM_QUOTE`, `SOLAR_SUN_ASSETS` | solar behaviour toggles | `lib/solar/*` | |

### Image and vision providers

Selection is layered: a per-trade override, then a global override, then a default.

| Name | Controls | Read at |
|---|---|---|
| `IG_IMAGE_PROVIDER` | global text-to-image selector | `lib/ig-engine/providers/select.ts:36` |
| `ROOFING_IMAGE_PROVIDER` | roofing "after" render provider | `lib/roofing/roof-after.ts:68`, `showcase-render.ts:149` |
| `PAINTING_IMAGE_PROVIDER` | painting "after" render provider | `lib/painting/paint-after.ts:101`, `app/api/painting/preview/refine/route.ts:49` |
| `ROOFING_VISION_PROVIDER`, `ROOFING_VISION_MODEL` | roof photo verification | `lib/roofing/vision-provider.ts:103,214` |
| `HF_TOKEN`, `HUGGING_FACE_API_TOKEN`, `HF_IMAGE_PROVIDER`, `HF_IMAGE_MODEL`, `HF_VISION_MODEL`, `HF_IMAGE_TIMEOUT_MS` | Hugging Face FLUX.1-Kontext | `lib/ig-engine/providers/huggingface.ts:62` |
| `REPLICATE_API_TOKEN`, `REPLICATE_IMAGE_MODEL`, `REPLICATE_IMAGE_RESOLUTION` | Replicate fallback | `lib/ig-engine/providers/*` |
| `GEMINI_API_KEY` + `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_MODEL_HOME`, `GEMINI_VISION_MODEL`, `GEMINI_TEXT_MODEL`, `GEMINI_VERIFY_MODEL`, `GEMINI_IMAGE_{ASPECT,SIZE,TEMPERATURE,TOP_P,THINKING_LEVEL}`, `GEMINI_RETRY_{ATTEMPTS,BASE_MS,MAX_DELAY_MS}` | Gemini vision + image | `lib/ig-engine/providers/*` |
| `STABILITY_API_KEY`, `STABILITY_NIM_URL`, `STABILITY_IMAGE_{STEPS,MODE,CFG_SCALE,NEGATIVE_PROMPT}` | Stability | `lib/ig-engine/providers/*` |
| `NVIDIA_API_KEY` | NVIDIA-hosted vision | |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WORKERS_AI_TOKEN`, `CLOUDFLARE_VISION_MODEL`, `CLOUDFLARE_CLAUDE_VISION` | Workers AI vision | |
| `OPENAI_IMAGE_MODEL` | an OpenAI image path | 1 site |
| `SIGNAGE_VISION_{MODEL,CHUNK,CONCURRENCY}`, `SIGNAGE_TWO_STAGE`, `SIGNAGE_EXTRACT_MODEL`, `SIGNAGE_DEMO_EMAIL` | signage assessment | `lib/signage/*` |
| `PREVIEW_{TWO_PASS,VERIFY_LOOP,VERIFY_MAX_RETRIES,PROMPT_VERSION,JUDGE_MODEL}`, `WP4_RENDER_VERIFY`, `DISABLE_AI_SAMPLES` | render/verify loop tuning | `lib/ig-engine/*` |
| `TRUST_VIDEO_MODEL`, `TRUST_VIDEO_AUTOGEN` | trust-video generation | `lib/videos/*` |

When every provider key is unset the selectors return stubs — the app keeps working and
simply shows no generated imagery. That is the intended degradation.

### Documents, email, CRM, knowledge base

| Name | Controls | Read at | Unset behaviour |
|---|---|---|---|
| `GOTENBERG_URL` | HTML→PDF service | `lib/pdf/gotenberg.ts:28,57` | `gotenbergConfigured()` returns false and **PDF generation is skipped with a warning, not an error** (`lib/estimation/sms-run.ts:234`) — quotes send with no PDF |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_INBOX_EMAIL` | transactional + campaign email | `lib/email/*` | no email sent |
| `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI` | HubSpot CRM OAuth | `lib/crm/*` | connector hidden |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`, `ZOHO_ACCOUNTS_DOMAIN`, `ZOHO_API_DOMAIN` | Zoho CRM OAuth | `lib/crm/*` | connector hidden |
| `TENANT_FILESTORE_ENABLED`, `TENANT_FILESTORE_MAX_DOCS`, `TENANT_FILESTORE_MAX_RETRIES` | per-tenant document store | `lib/estimate/run.ts:360`, `lib/filestore/*` | **OFF** (`!== 'true'`) |
| `ESTIMATOR_FILESTORE_SUPPLEMENT_ENABLED`, `PAINT_KB_SUPPLEMENT_ENABLED` | feed filestore docs into estimation | `lib/estimate/*`, `lib/painting/*` | off |
| `KB_FILESTORE_URL`, `KB_API_KEY`, `KB_FILESTORE_MODEL`, `KB_PRICING_STORE_ID`, `KB_SYNC_MAX_TABLES_PER_RUN` | external knowledge-base sync | `lib/estimation/filestore-client.ts:38-40`, `lib/kb-sync/*` | sync skipped |

### Estimation behaviour toggles

| Name | Controls | Read at | Unset |
|---|---|---|---|
| `DETERMINISTIC_BOM` | deterministic bill-of-materials path; **not a plain boolean** — parsed in `lib/estimate/deterministic-flag.ts:40` | `lib/estimate/*` | see that module |
| `ESTIMATOR_CHATBOT_ENABLED` | `'false'` disables filestore provisioning | `lib/filestore/provision.ts:23` | **ON** |
| `PRICE_HISTORY_HINT` | feed historical prices as a hint | `lib/estimate/*` | off |
| `FULL_QUOTE_DOC` | full-document quote rendering | 3 sites | off |
| `FORCE_GAS_HWS_SITE_VISIT` | forces a site visit for gas hot-water jobs | 1 site | normal routing |
| `R22_REVIEW_WINDOW_DAYS` | aircon R22 review window | 1 site | module default |
| `WP9_PRODUCT_OPTIONS`, `SPEC_GUARD_MODE` | work-package flags | | |
| `EVAL_TENANT_ID` | tenant used by the eval harness | `lib/agents/*` | eval targets nothing |

### Cron, ops and deployment metadata

| Name | Controls | Read at | Notes |
|---|---|---|---|
| `CRON_SECRET` | see the fail-closed section | `lib/agents/cron.ts:27` | Vercel Cron injects `Authorization: Bearer ${CRON_SECRET}` automatically |
| `CRONJOB_ORG_API_KEY` | external cron-as-a-service (used when not on Vercel Cron) | `scripts/` | see [[Deployment and Hosting]] |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Sentry target; both have a **hardcoded fallback DSN in the config files** | `sentry.{server,edge}.config.ts`, `instrumentation-client.ts` | ⚠ a DSN is public and safe, but the fallback means events ship even with the var unset |
| `SENTRY_AUTH_TOKEN` | **build-time only** — source-map upload | `next.config.ts:55`, `Dockerfile:37` | absent → build succeeds, prod traces stay minified |
| `VERCEL_REGION`, `VERCEL_GIT_COMMIT_SHA`, `RAILWAY_REGION`, `RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_PUBLIC_DOMAIN`, `FLY_REGION` | platform-injected; used for the health/deploy banner | `app/api/health` | read-only, never set by hand |
| `HTTP_TIMEOUT_MS` | shared outbound HTTP timeout | 1 site | module default |
| `ENGINE_BASE_URL` | where the carved-out receptionist services call back for intake/estimate | `scripts/export-receptionist.mjs:408,412,1020` | defaults to loopback `http://127.0.0.1:${PORT}` — see the Front Desk drift above |
| `LIVE_DB`, `LIVE_LLM`, `LIVE_PDF`, `LIVE_PAGE`, `LIVE_REFINE` | opt-in switches that let a test hit the real thing | `lib/**/*.test.ts` | tests skip by default; never set in a deployment |
| `SMOKE_BASE`, `DIAG_BASE_URL`, `HARNESS_WEBHOOK`, `SIM_API_KEY`, `SANDBOX_WAIT_MS`, `APPLY_ROOF_EDGE_ANALYSIS_MIGRATION` | ops scripts | `scripts/` | not read by the app |
| `PLAYWRIGHT_PORT`, `PLAYWRIGHT_HOST` | e2e harness | `playwright.config.ts:10-15` | 3100 / `localhost` — see [[Testing Strategy]] for why not `127.0.0.1` |
| `APPLE_TEAM_ID`, `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS` | app-link association files | `app/.well-known/*` | association files render empty |

---

## Rules for anyone adding a variable

1. **Pick one truthiness convention and state it in a comment.** The codebase currently
   mixes `=== '1'`, `=== 'true'`, `!== 'true'` and `!== 'false'`. Read the neighbouring
   code before assuming.
2. **A default-ON flag MUST document its kill switch** next to the read, the way
   `llmReceptionistEnabled` and `solarAutoReleaseEnabled` do. A default-ON flag with no
   documented off-value is unrollbackable.
3. **Read the flag fresh inside the function, not at module scope,** when the point is
   to flip it without a redeploy. `SMS_ROOFING_ENABLED` and `SMS_RECEPTIONIST_ENABLED`
   are module-level constants, so flipping them requires a new lambda;
   `SMS_LLM_RECEPTIONIST_ENABLED` is read per call and does not.
4. **Anything that gates money or auth fails closed.** Follow `isCronAuthorised`.
5. **Never print a value.** Names in docs, values only in the platform's secret store.

## Open questions

- `AI_GATEWAY_API_KEY` appears at six sites, but `lib/estimate` and `lib/sms` call
  Anthropic directly. Whether any live path routes via the Vercel AI Gateway is not
  established here.
- `BILLING_ENFORCEMENT` (one site) versus `BILLING_ENFORCEMENT_ENABLED` (six) — whether
  the short name is a live alias or dead is unverified.
- `ROOFING_EDGE_ANALYSIS_ENABLED` is named in the repo root `CLAUDE.md` but a grep of
  `app/` and `lib/` did not locate a read site; it may live only in `scripts/`.
- `WP9_PRODUCT_OPTIONS`, `SPEC_GUARD_MODE` and `WP4_RENDER_VERIFY` look like
  work-package-era toggles; whether they still do anything was not traced.
- The exact set of variables configured in the Vercel project (versus merely present in
  `.env.local`) cannot be read from the repo. Confirm in the Vercel dashboard,
  especially `CRON_SECRET` on the **Preview** environment.

## Related

- [[Tech Stack]]
- [[Deployment and Hosting]]
- [[Next.js 16 Conventions in This Repo]]
- [[SMS Inbound Route]]
- [[LLM Receptionist]]
- [[Known Debt Register]]
- [[Auth and Identity]]
- [[External Services and Integrations]]
