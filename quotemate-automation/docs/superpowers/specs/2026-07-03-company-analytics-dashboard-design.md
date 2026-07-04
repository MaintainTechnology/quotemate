# Company Performance / Usage Analytics Dashboard — design spec

> Status: approved for build 2026-07-03. Owner: (Jeph). Origin: founder request —
> "a company performance dashboard: how many quotes were processed, how many people
> asked, how many people are using it — analytics of QuoteMax across all tradies,"
> paired with a First-90-Days targets table.

## 1. Problem & audience

QuoteMax has **no cross-tenant analytics surface today**. `/admin` is a navigation hub;
`/admin/customers` lists tenants but shows no aggregate activity. Each tradie's
`/dashboard` shows only *their own* KPIs. The founder needs a single internal page that
answers, in ten seconds: **"Is QuoteMax healthy this week, and how much is each tradie
actually using it?"**

Audience = **internal operators/founders only** (the existing `/admin` admin-gated area).
This is NOT a customer-facing (tradie) analytics view — that is a possible v2.

## 2. Scope (v1)

A new admin page at **`/admin/metrics`** ("Company health"), gated by the existing admin
auth, laid out as three stacked zones:

- **Zone A — Scorecard vs 90-day targets.** Traffic-light cards mapping 1:1 to the
  founder's targets table (active tradies, new sign-ups, quotes requested WoW, avg
  turnaround, acceptance, weekly repeat usage). The four metrics that are **not captured
  anywhere in the app** (customer satisfaction, referrals, founder conversations, and
  real-money acceptance) render as explicit **"Not tracked yet — needs instrumentation"**
  placeholder cards. v1 shows **no fabricated numbers.**
- **Zone B — Activity & trends.** All-time running counters (quotes processed, intakes /
  requests, unique consumers, calls, SMS conversations, tradies) + last-N-week trend bars
  (quotes/week, intakes/week, new sign-ups/week) + a channel split (voice / SMS / portal)
  and a trade split.
- **Zone C — Per-tradie usage table.** One row per tradie: business, trade(s), joined,
  quotes (total), quotes (last 7d), unique consumers, last active, and a New/Active/Dormant
  status. This is the founder's literal "how much each tradie is using the platform" ask.

**Controls:** a week-range selector (default 8 weeks) and a **"Real only"** toggle
(default ON) that hides seed/test tenants.

## 3. Explicitly OUT of scope (v1)

Instrumenting satisfaction / referrals / founder-conversations · making acceptance real
(quote-view + acceptance events) · real-time/live updates (v1 fetches on load + manual
refresh) · CSV export · per-tradie drill-down detail pages · Stripe revenue analytics
(money path is test-mode). All are clean v2 additions and must not be half-built here.

## 4. Data foundation (verified against sql/init.sql + migrations)

All operational tables carry `tenant_id` (migration 015) and `created_at`. Legacy pre-launch
test rows have `NULL tenant_id` — these bucket as **"unattributed"** and are excluded from
per-tradie and active-tradie counts.

| Table | Columns used |
|---|---|
| `tenants` | `id, business_name, owner_email, trade, trades, status, subscription_plan, created_at, activated_at` |
| `quotes` | `id, tenant_id, intake_id, created_at, sent_at, accepted_at, paid_at, status, total_inc_gst, routing_decision, needs_inspection` |
| `intakes` | `id, tenant_id, created_at, call_id, customer_id, job_type` |
| `calls` | `id, tenant_id, created_at` |
| `customers` | `id, tenant_id, created_at` |
| `sms_conversations` | `id, tenant_id, intake_id, created_at, conversation_type` |

**Seed/test detection:** a tenant is "test" if `owner_email` ends with a known test domain
(`@quotemate.dev` — the migration-015 pilots `Pilot Sparky` / `Pilot Plumber` — plus
`example.com`/`example.org`), or its `business_name` starts with Pilot/Test/Demo. It
deliberately does **not** key off `status`: a genuine new tradie sits at `status='onboarding'`
until activation, so hiding non-active tenants would zero out the "New sign-ups this week"
metric. The "Real only" toggle (default ON) filters test tenants out; all row-level metrics
honour it.

**Volumes are tiny** (hundreds of rows) → the route fetches rows with a plain `select` and
does **all** aggregation in pure TypeScript. No GROUP BY SQL, no materialized views (YAGNI).
If volumes grow past ~100k rows this moves to SQL aggregation (documented v2 concern).

## 5. Metric definitions (exact)

All week math is in **Australia/Sydney** local time via `Intl.DateTimeFormat` (no tz library).
Week starts **Monday**. `now` is injected (deterministic tests).

**Zone A scorecard** (current week unless noted):
- **Active tradies** = distinct `tenant_id` appearing in `intakes` OR `quotes` with
  `created_at` in the current week. Target 10. Green if ≥ target.
- **New sign-ups** = `tenants` with `created_at` in the current week. Target band 2–3.
- **Quotes requested** = count of `intakes` this week; show delta vs last week (WoW arrow).
  Target: strictly increasing WoW.
- **Avg turnaround** = mean of `quote.created_at − intake.created_at` (joined on
  `quote.intake_id`) over quotes created this week; drop non-finite/negative deltas. Target <2h.
- **Acceptance rate** = `count(accepted_at not null) / count(sent_at not null)` all-time;
  if denominator 0, render "pre-revenue" (no colour), never a fake %.
- **Weekly repeat usage** = of tradies active *last* week, the % also active *this* week.
  Target >70%. If last-week active set is empty, render "—".
- **Not-tracked cards:** Customer satisfaction, Referrals, Founder conversations — static
  placeholder tone, label "Not tracked yet".

**Zone B activity:**
- Counters (all-time, filtered): total quotes, total intakes, unique consumers
  (`distinct customer_id` across intakes, falling back to distinct `customers.id` by tenant),
  total calls, total SMS conversations, total tradies.
- Weekly trends (last N weeks): quotes/week, intakes/week, sign-ups/week — bar charts.
- **Channel split** of intakes: `voice` = `call_id not null`; `sms` = `intake_id` present in
  the set of `sms_conversations.intake_id`; `portal` = neither.
- **Trade split** = quotes grouped by their tenant's `trade` (fallback intake/quote trade).

**Zone C per-tradie table** (real tenants, sorted by quotes-total desc):
- `business_name`, `trade`/`trades`, `created_at` (joined), quotes-total, quotes-7d,
  unique consumers, last-active (max of intake/quote `created_at`), and status:
  **New** (joined ≤7d, no activity) · **Active** (activity ≤14d) · **Dormant** (no activity 14d).

## 6. Architecture & files

Pure logic is isolated from I/O so it is unit-testable without a database.

- **`lib/admin/metrics.ts`** — pure, DB-free. Input row types + `buildMetrics(input, opts)`
  composing `computeScorecard`, `computeActivityTotals`, `computeWeeklyTrends`,
  `computeChannelSplit`, `computeTradeSplit`, `computeTenantUsage`, plus helpers
  `isTestTenant`, `sydneyWeekStart`, `weekKey`. Returns a single `PlatformMetrics` object.
- **`lib/admin/metrics.test.ts`** — vitest unit tests over fixtures: week bucketing across a
  DST boundary, seed filtering, active/dormant thresholds, empty-data (no NaN/Infinity),
  acceptance-rate zero-denominator, WoW delta, turnaround outlier clamping.
- **`app/api/admin/metrics/route.ts`** — `GET`, `dynamic='force-dynamic'`. Gate with
  `resolveAdminUserId(supabase, req)` → 403. Parse `?weeks` (clamp 4–26, default 8) and
  `?includeTest` (default false). Fetch the six selects in parallel, call `buildMetrics`,
  return `{ ok: true, metrics }`. Mirrors `app/api/admin/customers/route.ts` exactly.
- **`app/admin/metrics/page.tsx`** — `'use client'`. Bearer-token fetch (same pattern as
  `app/admin/page.tsx`), week/real-only controls, renders the three zones. Maintain design
  system tokens. Local KPI/Pill/bar components matching `dashboard/page.tsx` styling.
- **`app/_components/MetricCharts.tsx`** — shared, dependency-free `TrendBars` (weekly bars)
  + `SplitBars` (channel/trade/job-type split). Generalized to `{label,value}` / `{label,count}`
  so the tradie Overview analytics reuses the same primitives (2026-07-03).
- **`app/admin/page.tsx`** — add a prominent primary "Company health" tile → `/admin/metrics`;
  renumber tiles so numbering stays sequential.

## 7. Definition of done

1. `/admin/metrics` loads for an admin, 403s for non-admin/anon (server-gated).
2. All three zones render with **real** data from the live tables; the four un-instrumented
   metrics show "Not tracked yet", never a number.
3. "Real only" toggle (default ON) hides `@quotemate.dev` pilots; toggling updates every zone.
4. Week-range selector changes the trend charts and scorecard window.
5. Empty/zero data produces no `NaN`/`Infinity`/crash (covered by tests).
6. `pnpm vitest run lib/admin/metrics.test.ts` passes; `pnpm tsc --noEmit` clean.
7. A "Company health" entry links from `/admin`.

## 8. Risks / notes

- **Turnaround & acceptance read low/zero today** (pre-real-traffic). That is correct and
  honest — the cards show the true current number, not a target-flattering one.
- **`customers` is globally unique by phone**, so "unique consumers per tradie" is computed
  from `distinct intake.customer_id` per tenant, not from `customers.tenant_id` alone.
- **Channel split** depends on `sms_conversations.intake_id` being populated; unlinked SMS
  intakes fall to "portal" — acceptable approximation, noted in the UI methodology line.
