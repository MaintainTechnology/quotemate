---
title: Tech Stack
type: reference
area: platform
tags: [quotemax, stack, nextjs, dependencies, runtime, versions]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/package.json
  - quotemate-automation/next.config.ts
  - quotemate-automation/tsconfig.json
  - quotemate-automation/instrumentation.ts
  - quotemate-automation/sentry.server.config.ts
  - quotemate-automation/lib/sms/model.ts
  - quotemate-automation/lib/llm/sampling.ts
  - quotemate-automation/lib/vapi/voice-model.ts
---

# Tech Stack

Every version below is read from `quotemate-automation/package.json` at the pinned
value, not from memory. The app is a single Next.js App Router project; there is no
second service, no queue worker and no separate API server. Anything that looks like
a background job is either a Vercel cron hitting `/api/cron/*` or `after()` work
running inside the same request (see [[Next.js 16 Conventions in This Repo]]).

## Runtime and framework

| Thing | Pinned version | Where |
|---|---|---|
| Next.js | **16.2.4** (exact, not caret) | `quotemate-automation/package.json:44` |
| React / React DOM | **19.2.4** (exact) | `package.json:49-50` |
| TypeScript | `^5`, `strict: true`, `moduleResolution: "bundler"`, target ES2017 | `quotemate-automation/tsconfig.json` |
| Node | **20 LTS Alpine** in Docker; Vercel picks its own | `quotemate-automation/Dockerfile:11` |
| Package manager | **pnpm 10.33.2** (declared via `packageManager`, corepack-enabled in the image) | `package.json:5`, `Dockerfile:13` |
| Bundler | **Turbopack** (the Next 16 default) with `turbopack.root` pinned to the app dir | `quotemate-automation/next.config.ts:14-16` |
| Build output | `output: "standalone"` → `.next/standalone/server.js` | `next.config.ts:13` |
| CSS | Tailwind v4 via `@tailwindcss/postcss` | `package.json:63,73`, `postcss.config.mjs` |
| Lint | ESLint 9 + `eslint-config-next@16.2.4` | `package.json:71-72` |

`turbopack.root` is pinned deliberately: the repo root holds an orphaned
`package-lock.json` from an accidental `npm install`, and without the pin Turbopack
walks up and adopts the wrong workspace root (`next.config.ts:5-7`).

⚠ **Drift** — the repo root `CLAUDE.md` tech-stack table says "Next.js 16.2.4" but
also claims **"No PostHog/Sentry yet"**. Sentry is fully wired (below). Treat that
CLAUDE.md row as stale.

## Observability — Sentry is live (CLAUDE.md says it is not)

`@sentry/nextjs@^10.63.0` is installed and initialised on all three runtimes:

| Runtime | Init file | Loaded by |
|---|---|---|
| Node server | `quotemate-automation/sentry.server.config.ts` | `instrumentation.ts` `register()` when `NEXT_RUNTIME === 'nodejs'` |
| Edge (this matters — `proxy.ts` runs Clerk on the edge) | `quotemate-automation/sentry.edge.config.ts` | same `register()` when `NEXT_RUNTIME === 'edge'` |
| Browser | `quotemate-automation/instrumentation-client.ts` | Next 16 auto-loads the file convention (it replaces the legacy `sentry.client.config.ts`) |

Load-bearing details:

- `instrumentation.ts` also exports `onRequestError = Sentry.captureRequestError`,
  which is what captures unhandled errors in route handlers and RSC.
- `instrumentation-client.ts` exports `onRouterTransitionStart` — client navigations
  only become spans **because that export exists in that file**.
- **PII is off everywhere**: `sendDefaultPii: false` in all three configs, and replays
  run `maskAllText: true, blockAllMedia: true`. This is not cosmetic — estimate
  prompts and SMS bodies carry customer names, addresses and phone numbers.
- Tracing, replay-session sampling and profiling are all **gated to production**
  (`isProd ? 0.1 : 0`). The dev-gate is not a cost decision: Next 16 restricts
  `Math.random()` before uncached data access, which trips Sentry's OTel span-id
  generation and spams dev warnings (`instrumentation-client.ts` comment).
- The server config forwards only `console.warn` / `console.error` into Sentry Logs,
  **never `console.log`** — the app's own log pipeline is chatty and its lines contain
  phone numbers (`sentry.server.config.ts`).
- `Sentry.vercelAIIntegration()` gives model id / token usage / tool calls for AI SDK
  calls that opt in with `experimental_telemetry: { isEnabled: true }`.
- Browser events tunnel through `tunnelRoute: "/monitoring"` so ad-blockers don't drop
  them. That path is reachable because `proxy.ts` never calls `auth.protect()`.

Source-map upload only happens when `SENTRY_AUTH_TOKEN` is present at **build** time.
Under Turbopack there is no bundler plugin, so upload runs after the build via Next's
`runAfterProductionCompile` hook (`next.config.ts:39-48`). Webpack-only Sentry options
(`autoInstrument*`, `excludeServerRoutes`, `automaticVercelMonitors`,
`unstable_sentryWebpackPluginOptions`) are **no-ops under Turbopack** and are
intentionally omitted.

See [[Observability and Tracing]] for the in-app `pipeline_traces` layer, which is a
separate and older mechanism.

## LLM layer

Vercel AI SDK v6 (`ai@^6.0.168`) calling Anthropic directly through
`@ai-sdk/anthropic@^3.0.71` — not the Vercel AI Gateway.

| Job | Model id | Constant / file |
|---|---|---|
| Intake structuring | `claude-opus-4-8` | `lib/intake/structure.ts:187` (default param) |
| Estimation | `claude-opus-4-8` | `lib/estimate/run.ts:147` (default param) |
| SMS receptionists (dialog + slot extraction + intent) | `claude-sonnet-5` | `lib/sms/model.ts:32` `SMS_RECEPTIONIST_MODEL` |
| Voice persona | `claude-sonnet-5` | `lib/vapi/voice-model.ts:7` `DEFAULT_VOICE_MODEL`, overridable by `VAPI_VOICE_MODEL` |
| Quote chat-edit | `claude-opus-4-8` | `lib/quote/chat-edit.ts:36` |
| Aircon plan extraction | `claude-opus-4-8` | `lib/aircon/plan-extract.ts:25` |
| Commercial-paint extraction / measurement parse | `claude-opus-4-8` / `claude-sonnet-4-6` | `lib/commercial-painting/extract.ts:26-27` |
| Commercial-paint classify | `claude-sonnet-4-6` | `lib/commercial-painting/classify.ts:19` |
| Solar AI brief | `claude-sonnet-4-6` | `lib/solar/ai-brief.ts:30` |
| Roofing vision / layout plan | `claude-sonnet-4-6` default, env-overridable | `lib/roofing/vision-verify.ts:20`, `lib/roofing/layout-plan.ts:670` |
| Signage vision / brand extract | `claude-sonnet-4-6` default, env-overridable | `lib/signage/vision-assess.ts:20`, `lib/signage/extract-brand.ts:16` |
| Historical-quote categorise / column map | `claude-sonnet-4-6` | `lib/historical-quotes/{categorize,column-map}.ts:13` |

⚠ **Drift** — the repo root `CLAUDE.md` says the "Vapi voice persona = Haiku 4.5
(`VAPI_VOICE_MODEL`)". The code has said `claude-sonnet-5` since the 2026-07-23
upgrade (`lib/vapi/voice-model.ts:1-7`). The env var still exists, but as a rollback
lever, not as the source of the default.

### Two SDK-level landmines worth knowing before touching any model call

1. **`maxOutputTokens` MUST be passed explicitly on `claude-sonnet-5`.** The pinned
   `@ai-sdk/anthropic@3.0.71` resolves per-model limits from a hardcoded table that
   predates Sonnet 5; the id matches no branch (notably *not* the `claude-sonnet-4-`
   prefix) and falls into the unknown-model default of 4096. Worse, Sonnet 5 runs
   adaptive thinking when the request omits a `thinking` field — and this provider
   version never sends one — so thinking tokens draw from the same ceiling as the
   reply. `SMS_RECEPTIONIST_MAX_TOKENS = 8192` exists for exactly this reason
   (`lib/sms/model.ts:35-63`).
2. **`temperature` / `top_p` / `top_k` are HTTP 400 on newer models**, not a warning
   and not a no-op. Verified live 2026-08-04: `claude-sonnet-5` and `claude-opus-4-8`
   reject them; `claude-sonnet-4-6` and `claude-haiku-4-5` accept them
   (`lib/llm/sampling.ts:10-21`). Use `deterministicSampling(model)` from
   `lib/llm/sampling.ts`, which yields `{ temperature: 0 }` or `{}` as appropriate.
   There is no `seed` on this API, so on a rejecting model **there is no sampling knob
   at all** — determinism has to come from the prompt, tool-calling and the grounding
   validators. Three older near-identical copies of this guard still live in
   `lib/estimation/extract.ts`, `lib/aircon/plan-extract.ts` and
   `lib/commercial-painting/extract.ts`; they had already drifted apart, and that drift
   is how `ROOFING_VISION_MODEL=claude-sonnet-5` turned two call sites into hard 400s.

See [[Model and Prompt Inventory]] and [[Grounding and Safe Replies]].

## Data, auth and money

| Concern | Package | Notes |
|---|---|---|
| Database client (app) | `@supabase/supabase-js@^2.105.1` | Server routes use the service-role key; RLS is bypassed and tenancy is app-layer. See [[Tenancy and RLS]] |
| Database client (scripts/migrations) | `pg@^8.20.0` + `@types/pg` | `scripts/run-migration-*.mjs` connect over `SUPABASE_DB_URL` |
| Local Postgres for tests | `@electric-sql/pglite@^0.5.8` (devDep) | in-process Postgres, no docker needed |
| Auth | `@clerk/nextjs@^7.5.10`, `@clerk/backend@3.8.5` | see [[Auth and Identity]] |
| Payments | `stripe@^22.1.0` | test mode + Connect Express, see [[Stripe Connect]] |
| SMS / voice telephony | `twilio@^6.0.0` | see [[SMS Channel Overview]] |
| Email | `resend@^6.12.2` | |
| Schema validation | `zod@^4.3.6` | Zod 4 — the API differs from Zod 3 in error shapes |

## Geometry, vision, documents

This is where the dependency list stops looking like a normal SaaS app. Roofing and
solar do real measurement work in-process.

| Package | Version | What it is used for |
|---|---|---|
| `cesium` | `^1.142.0` | 3D globe/terrain. `postinstall` runs `scripts/copy-cesium-assets.mjs` — installing without that step leaves the viewer assetless (`package.json:20`) |
| `maplibre-gl` | `^5.24.0` | 2D map rendering for roof/structure pickers |
| `three` + `@types/three` | `^0.185.1` | 3D model view (Tripo output) |
| `konva` / `react-konva` | `^10.3.0` / `^19.2.5` | canvas editing of roof + paint outlines |
| `geotiff` | `^3.0.5` | Google Solar API data layers arrive as GeoTIFF |
| `pngjs`, `sharp` | `^7.0.0`, `0.34.5` (exact) | raster work; `sharp` is pinned exact because native-binary drift breaks serverless builds |
| `mupdf` | `^1.27.0` | WASM PDF reader for the estimator's tiled-refine pass. **Declared in `serverExternalPackages`** so the bundler does not try to inline the `.wasm` (`next.config.ts:19`) |
| `pdfjs-dist`, `unpdf` | `^6.0.227`, `^1.6.2` | plan-upload text/page extraction |
| `jspdf` | `^4.2.1` | client-side PDF paths; the main quote PDF is Gotenberg HTML→PDF, see [[Quote PDFs and Reports]] |
| `qrcode` | `^1.5.4` | marketing QRs |
| `csv-parse` | `^6.2.1` | the admin trades CSV loader, see [[Trades Registry]] |
| `@huggingface/inference` | `^4.13.23` | FLUX.1-Kontext "after" renders |
| `@tiptap/*` | `^3.27.1` | rich-text editor in the dashboard |
| `lucide-react` | `^1.14.0` | icons |

`outputFileTracingIncludes` ships `./lib/studio/fonts/**` and
`./public/studio/photos/**` into the `/api/studio/render` function bundle, because
files read through `fs` are **not** traced automatically and `next/og` reads them at
runtime on Vercel (`next.config.ts:24-26`). Any new route that reads an on-disk asset
must add itself here or it will 500 in production and work fine locally. See
[[Studio and Marketing Assets]].

## Test tooling

| Tool | Config | Scope |
|---|---|---|
| Vitest 4 | `quotemate-automation/vitest.config.ts` | `environment: 'node'` (no jsdom), includes `lib/**/*.test.ts`, `tests/**/*.test.ts`, `app/**/*.test.ts`. `pnpm test` runs `vitest run --testTimeout=20000` |
| Playwright | `quotemate-automation/playwright.config.ts` | `testDir: ./tests/e2e`, boots `next dev` on port 3100, `retries: 0` |

Two exclusions in `vitest.config.ts` are load-bearing: `tests/e2e/**` (Playwright owns
those) and `**/.claude/**` + `**/worktrees/**` — sibling git worktrees are full
checkouts of feature branches whose `*.test.ts` would otherwise be collected and fail
under this project's module resolution.

Playwright's `HOST` defaults to `localhost`, **not** `127.0.0.1`, on purpose: Clerk
dev-browser handshakes are origin-bound and against `127.0.0.1` the handshake can
307-loop forever, leaving `ClerkProvider` stuck loading and the app un-hydrated —
buttons render but do nothing (`playwright.config.ts:11-15`). `PLAYWRIGHT_HOST`
restores the old behaviour. More in [[Testing Strategy]].

## Open questions

- `pnpm-workspace.yaml` exists at the app root and there is a nested
  `quotemate-automation/quotemate-automation/` directory; whether that nested dir is
  live or a stray artefact is not established here.
- `scripts/web-surface` is excluded from `tsconfig.json` because it holds NestJS
  templates consumed by `scripts/export-receptionist.mjs` via `readFileSync`. Whether
  that carve-out path is still an active plan is a strategy question, not a stack one.

## Related

- [[Environment Variables and Feature Flags]]
- [[Deployment and Hosting]]
- [[Next.js 16 Conventions in This Repo]]
- [[System Architecture]]
- [[Model and Prompt Inventory]]
- [[Observability and Tracing]]
- [[Testing Strategy]]
- [[Repository Layout]]
