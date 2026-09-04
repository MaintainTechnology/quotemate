---
title: Repository Layout
type: reference
area: platform
tags: [quotemax, repository, file-structure, inventory, next-js, monorepo]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/next.config.ts
  - quotemate-automation/package.json
  - quotemate-automation/app
  - quotemate-automation/lib
  - quotemate-automation/sql/migrations
  - quotemate-automation/scripts
  - quotemate-automation/tests
---

# Repository Layout

Two roots that are easy to confuse:

| Root | What it is |
|---|---|
| `C:\Users\dalig\Downloads\QuoteMate\quoteMate` | The **repository**. Planning docs, strategy, design system, marketing assets, specs, vendored agent tooling. **Not deployed.** |
| `C:\Users\dalig\Downloads\QuoteMate\quoteMate\quotemate-automation` | The **application**. Next.js 16 App Router. This is the product. |

Everything below is enumerated from disk on 2026-09-04, not copied from
`CLAUDE.md`. Where the two disagree, the disk wins.

## Repository root

```
quoteMate/
├── README.md            # public overview — ⚠ materially stale, see below
├── CLAUDE.md            # engineering context; closer to truth, still lags
├── AGENTS.md            # (+ a .bak-20260902-pre-gitnexus copy)
├── PRODUCT.md           # strategic design context (register, users, voice)
├── DESIGN.md            # visual system (palette, type, elevation)
├── LICENSE              # MIT
├── docs/
│   ├── strategy.md      # 1,722 lines — living strategy + iteration history
│   ├── skills-toolkit.md
│   ├── markdown/, superpowers/, deliverables/
│   └── *.html           # build guide, SOPs, walkthroughs, wireframe
├── assets/              # experience map (jpeg), flow SVG, logo, tradie-videos
├── redesign/
│   ├── DesignSystem/    # canonical QuoteMax design system + quotemax-design skill
│   ├── Inspiration/, _ds/, fullQuote/, marketing/, banners/
│   └── QuoteMax Dashboard.dc.html
├── specs/, mockups/, marketing/, marketing-screenshots/, screenshots/
├── .impeccable/         # design.json — machine-readable design tokens
├── .claude/             # vendored skills / agents / commands
├── .gitnexus/           # code-intelligence index (quotemax, 58k symbols)
├── QuoteMax/            # ◀── THIS VAULT
└── quotemate-automation/  # ◀── THE APPLICATION
```

⚠ The repository root also carries ~40 dot-directories for other AI coding
agents (`.aider-desk`, `.codex`, `.cursor`-likes, `.continue`, `.crush`,
`.devin`, `.factory`, `.goose`, `.junie`, `.kilocode`, `.kiro`, `.windsurf`,
`.zencoder`, and more). They are tooling scaffolding, not product code, and
should be ignored when reasoning about the system.

⚠ **Drift** — `README.md` describes a three-trade product as of 2026-05-18
with "no PDF in v1" and Stripe Connect "planned but not yet wired". All of
that is superseded. See [[Platform Overview]] for the corrected picture.

## The application

```
quotemate-automation/
├── AGENTS.md            # "This is NOT the Next.js you know" — READ FIRST
├── CLAUDE.md            # one line: @AGENTS.md
├── DEPLOY.md
├── next.config.ts       # standalone output, Turbopack root pin, Sentry wrap
├── proxy.ts             # bare clerkMiddleware() — gates nothing
├── instrumentation.ts / instrumentation-client.ts
├── sentry.server.config.ts / sentry.edge.config.ts
├── playwright.config.ts, eslint.config.mjs, postcss.config.mjs
├── Dockerfile, railway.json, vercel.json
├── pnpm-workspace.yaml, pnpm-lock.yaml   # pnpm@10.33.2
├── app/                 # 92 page.tsx, 270 api route.ts
├── lib/                 # 58 domain module directories
├── sql/                 # init.sql + migrations (244 files) + seeds
├── scripts/             # 500 entries: 461 .mjs, 14 .ts, 6 .mts, 7 .json, 8 .png
├── tests/               # 26 files incl. tests/e2e (17 Playwright specs)
├── public/, eval/, db-export/, estimation-truth/, estimation-output/
└── .env.local           # ⚠ live secrets — never commit, never quote
```

### `next.config.ts` — the four non-obvious settings

Read `quotemate-automation/next.config.ts` before changing the build:

1. **`output: "standalone"`** — produces `.next/standalone/server.js` so the
   app runs on Railway, Fly, Render or any Docker host. Vercel ignores it, so
   it is safe on both targets.
2. **`turbopack.root`** pinned to the app directory — the repository root has
   an orphaned `package-lock.json` from an accidental `npm install`, and
   without the pin Turbopack picks it up as the workspace root.
3. **`serverExternalPackages: ["mupdf"]`** — mupdf is a WASM package loaded at
   runtime by the estimator's tiled-refine pass; inlining the `.wasm` breaks it.
4. **`outputFileTracingIncludes`** for `/api/studio/render` — bundled woff
   fonts and pre-baked duotone photos are read with `fs`, which Next does not
   trace automatically. Removing this silently breaks studio rendering on
   Vercel only.

A `headers()` block sets `Document-Policy: js-profiling` on every response so
Sentry's browser profiling integration can sample. See
[[Observability and Tracing]].

## `app/` — the route surface

Verified counts: **92** `page.tsx`, **270** `route.ts` under `app/api`, **33**
top-level `app/api/*` groups.

### Top-level route directories

| Directory | Audience | What lives there |
|---|---|---|
| `app/page.tsx`, `pricing`, `trades`, `legal`, `watch`, `start` | Public | Marketing site; `trades/` has `_data.ts`, `_template.tsx` and five trade pages (electrical, painting, plumbing, roofing, solar) |
| `q`, `r`, `book`, `upload`, `paint-request`, `solar`, `quote-request`, `p`, `s`, `share`, `t` | Customer | Quote funnels, Stripe mints, photo upload, self-serve intake forms, share/short links |
| `dashboard`, `m`, `studio`, `account`, `onboard` | Tradie | Portal, measurement results page, marketing studio, onboarding |
| `admin` | Platform admin | Tenants, customers, loader, agents, files, metrics, invites, docs |
| `sign-in`, `sign-up` (Clerk) / `signin`, `signup`, `auth`, `forgot-password` (legacy Supabase) | Auth | Two parallel auth stacks |
| `api` | Machine | 270 handlers |
| `_components`, `docs`, `dev`, `app`, `.well-known` | Internal | Shared UI, in-app docs pages, a doc-editor dev tool, a mobile-app catch-all, app-association files |

`app/dev/doc-editor` and `app/docs/*` (five onboarding-architecture pages) are
in-repo documentation surfaces rendered as real pages — they ship with the
app, not with the docs folder.

`app/app/[[...path]]/page.tsx` is a catch-all under `app/app/`, paired with
`lib/mobile-app-associations.ts` and `app/.well-known/` — this is the
mobile-app deep-link surface (`ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS`,
`APPLE_TEAM_ID`).

### `app/api/*` groups (33)

`admin` · `aircon` · `auth` · `billing` · `book` · `captions` ·
`commercial-paint` · `contact` · `cron` · `dashboard` · `email` · `estimate` ·
`filestore` · `health` · `intake` · `onboard` · `paint-request` · `painting` ·
`q` · `quote` · `quote-request` · `roofing` · `signage` · `sms` · `solar` ·
`stripe` · `studio` · `supplier-catalogue` · `t` · `tenant` · `twilio` ·
`upload` · `vapi`

⚠ `CLAUDE.md`'s API list omits `captions`, `contact`, `book`, `email`,
`supplier-catalogue`, `quote-request` and `twilio`. See [[API Overview]].

## `lib/` — 58 domain modules

Enumerated with `find lib -maxdepth 1 -mindepth 1 -type d`:

`admin` · `admin-loader` · `agents` · `aircon` · `auth` · `billing` · `brand` ·
`canva` · `catalogue` · `clerk` · `commercial-painting` · `consent` · `crm` ·
`crypto` · `customers` · `dashboard` · `email` · `estimate` · `estimation` ·
`features` · `felt` · `filestore` · `flyer` · `historical-quotes` ·
`ig-engine` · `intake` · `invoice` · `kb-sync` · `llm` · `log` · `marketing` ·
`onboard` · `opensolar` · `painting` · `pdf` · `phone` · `prompt-template` ·
`push` · `pylon` · `qr` · `quote` · `quote-request` · `roofing` · `routing` ·
`signage` · `sms` · `solar` · `storage` · `stripe` · `studio` · `supabase` ·
`tenant` · `trades` · `twilio` · `util` · `vapi` · `videos` · `voice`

Plus two loose files at `lib/` top level: `mobile-app-associations.ts` and its
test.

⚠ **Drift** — `CLAUDE.md` says "~55 domain modules" and its named list omits
**`brand`, `consent`, `crypto`, `felt`, `llm`, `push`, `quote-request`,
`storage`, `util`, `admin`**. `consent` (cookie banner), `push` (mobile push
notifications, migration 191) and `quote-request` are recent additions the doc
never caught up with.

### The largest modules, by role

| Module | Role | Deep note |
|---|---|---|
| `sms` | Four receptionists, dispatch, grounding, slot extraction | [[SMS Channel Overview]] |
| `estimate` | LLM estimation, RAG, tools, grounding validator | [[Estimate Engine]] |
| `roofing` | Measurement providers, pricing, tokens, 3D | [[Roofing]] |
| `solar` | Deterministic sizing/pricing engine | [[Solar]] |
| `painting` | Area, pricing, release gate, quote dispatch | [[Painting]] |
| `quote` | Quote rows, report HTML, mint-tier resolution | [[Quote Pages]] |
| `stripe` | Checkout, Connect, webhooks | [[Stripe Connect]] |
| `intake` | Opus structuring + Zod schema | [[Intake Structuring]] |
| `routing` | Confidence → auto-send vs inspection | [[Routing Decision]] |
| `trades` / `admin-loader` | Trades-as-data registry + CSV loader | [[Trades Registry]] |
| `ig-engine` | Multi-provider image generation | [[Studio and Marketing Assets]] |
| `log` | `pipeline_traces` structured tracing | [[Observability and Tracing]] |

## `sql/`

```
sql/
├── init.sql                  # representative schema baseline
├── 02_stages_06_10_partial.sql, 03_photo_capture.sql, 04_f3_finish.sql
├── migrations/               # 244 files, numbered to 196
└── seeds/                    # e.g. 2026-07-30-plumbing-repair-boms.json
```

Highest migration: `196_ev_charger_clarifying_questions.sql`. Recent numbers
tell the recent story: `189_painting_quote_sent_at`,
`190_trade_lead_requests`, `191_push_tokens`, `192_ev_charger_bounds`,
`193_quotes_inspection_cause`, `194_quote_chain`, `195_quotes_estimate_number`,
`196_ev_charger_clarifying_questions`.

⚠ `CLAUDE.md` states "migrations/002…182 (216 files)". Both numbers are stale.
See [[Migrations]].

**Convention.** A DB change is a new `sql/migrations/NNN_*.sql` plus a
`NNN_down.sql` plus a `scripts/run-migration-NNN.mjs`, applied against the
production Supabase instance, with `sql/init.sql` kept representative.

## ⚠ The accidental nested duplicate

There is a **committed, git-tracked** path duplication:

```
quotemate-automation/quotemate-automation/
├── scripts/  (2 files, incl. run-migration-087.mjs)
└── sql/migrations/  (1 file: 087_gpo_amperage_backfill.sql)
```

Confirmed tracked: `git ls-files quotemate-automation` inside the app returns
`quotemate-automation/scripts/diag-gpo-dupe.mjs`,
`quotemate-automation/scripts/run-migration-087.mjs` and
`quotemate-automation/sql/migrations/087_gpo_amperage_backfill.sql`.

This matters for two reasons:

1. **Migration number 087 is claimed twice.** The real tree has
   `sql/migrations/087_signage_compliance.sql`; the nested tree has
   `087_gpo_amperage_backfill.sql`. Two different migrations, one number. Any
   tool that resolves migrations by number alone will pick the wrong one.
2. `scripts/run-migration-087.mjs` also exists in the real `scripts/`, so
   there are two runners with the same name pointing at different SQL.

Someone ran a command from the repo root that should have been run from the
app directory, and the resulting files were committed. Nothing appears to
depend on the nested copies. See [[Migrations]] and [[Known Debt Register]].

## `scripts/` — 500 entries

Not ~150. Breakdown by extension: **461 `.mjs`**, 14 `.ts`, 6 `.mts`, 7
`.json`, 8 `.png`, plus a handful of extensionless names.

Run convention: `node --env-file=.env.local scripts/X.mjs`. These are ops and
diagnostic tools that talk to production Supabase via `SUPABASE_DB_URL` with
the `pg` driver — treat every one of them as production-touching until proven
otherwise. See [[Operations Overview]].

## Tests

| Location | Count | Runner |
|---|---|---|
| `lib/**/*.test.ts` (colocated) | **566** | vitest |
| `app/**/*.test.ts(x)` (colocated) | **79** | vitest |
| `tests/*.test.ts` | 9 | vitest |
| `tests/e2e/*.spec.ts` | **17** | Playwright |

That is **654 vitest test files**, not "6400+ tests" as a file count —
`CLAUDE.md`'s number is a test-case count, not files. Commands:
`pnpm test` (`vitest run --testTimeout=20000`), `pnpm test:e2e`,
`pnpm typecheck`, `pnpm lint`.

`tests/internal-route-auth.test.ts` is load-bearing: it fails if a new caller
of an internal route ships without the `Authorization: Bearer ${CRON_SECRET}`
header. Several `tests/*-migration.test.ts` files pin recent schema changes
(`quote-chain`, `estimate-number`, `ev-charger`, `ev-photo`, `push-tokens`).
E2E specs skew heavily to roofing (5 specs) and solar (4). See
[[Testing Strategy]].

`@electric-sql/pglite` is a devDependency — migration tests run against a real
Postgres in-process rather than mocking SQL.

## Reading order for a new engineer

1. `quotemate-automation/AGENTS.md` — Next 16 has breaking changes; read
   `node_modules/next/dist/docs/` before writing route code.
2. This note plus [[System Architecture]].
3. [[The Four Pipelines]] — the single most important conceptual note.
4. The trade you are touching: [[Roofing]], [[Solar]], [[Painting]],
   [[Electrical]], [[Plumbing]].
5. [[Known Debt Register]] before you trust anything.

## Open questions

- Whether the nested `quotemate-automation/quotemate-automation/` files were
  ever applied to production, and which 087 the live database actually has.
- What `eval/`, `db-export/`, `estimation-truth/` and `estimation-output/`
  hold — they are app-root directories not described anywhere in `CLAUDE.md`.

## Related

- [[Platform Overview]]
- [[System Architecture]]
- [[The Four Pipelines]]
- [[Tech Stack]]
- [[Migrations]]
- [[API Overview]]
- [[Testing Strategy]]
- [[Deployment and Hosting]]
