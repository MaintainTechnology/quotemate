# Per-Tenant Feature Toggles — Spec

> **Reconciled architecture (2026-06-22).** Initial exploration missed that the
> codebase *already* uses `tenants.trades[]` as the per-tenant feature set, with
> a catalog (`lib/admin/trades.ts` `KNOWN_TRADES`) and an **audited** admin
> toggle grid at `/admin/customers/[id]` (writes `trades[]` + `admin_audit_log`).
> The original plan (new `features`/`tenant_features` tables) would have built a
> second, conflicting store. Per the user's decision, this spec reuses
> `trades[]` as the single runtime gate and adds only a thin **provenance** layer
> for plan-tier seeding. The previous table-based draft is superseded.

## Objective
Give the admin team granular, per-tenant control over which platform features each tradie can access, so new tradies start with only the feature(s) relevant to their trade and the team can unlock more as tenants grow or upgrade. Today the intended `trades[]`-driven gating is only half-wired — `buildNav()` honors `trades[]` for **roofing only**; signage, painting, commercial painting, aircon, solar, and the estimator are shown to every tenant. This wires the gating fully (nav + dedicated routes + tradie-facing APIs), adds plan-tier seeding with manual-override precedence, and reuses the existing audited admin console as the toggle UI.

Who it's for: the QuoteMate admin/operations team, and indirectly tradies (a focused dashboard scoped to what they've been granted).

## Context / background
- Multi-tenant Next.js 16 App Router + Supabase app in `quotemate-automation/`.
- `tenants.trades[]` (text[], migration 017) is the per-tenant feature set. `lib/admin/trades.ts` `KNOWN_TRADES` is the catalog: `electrical, plumbing, roofing, signage, painting, commercial_painting, aircon, solar`.
- `/admin/customers/[id]` (page + `/api/admin/customers/[id]` PATCH `update_trades`) is an admin-gated, audited grid that toggles `trades[]`. Audit via `lib/admin/audit.ts` (`writeAuditLog`/`admin_audit_log`, migration 135). Admin auth via `resolveAdminUserId` (`lib/admin-loader/route-auth.ts`).
- `/admin/customers/[id]/subscription` changes the Stripe plan; the tenant `subscription_*` columns are a **mirror** synced by `/api/stripe/webhook` (`applyTenantSubscription`). `subscription_plan ∈ {starter,pro,crew}`.
- Dashboard (`app/dashboard/page.tsx`) is one client page; `buildNav()` builds the tab list, gating only `roofing` via `tenantHasRoofingTrade()`. Feature tabs: `roofing, signage, painting, commercial-painting, aircon, estimator, solar`. Dedicated tool routes exist: `/dashboard/{painting, roofing/measure, aircon, signage(+queue/studios/shots/audit), estimator/[runId]}`. Solar + commercial-painting are tab-only hubs.
- Onboarding (`/api/onboard/activate`) already sets `trades[]` to the tradie's selected trades.
- Legacy one-off: `/admin` renders `RoofingActivation` → `/api/admin/tenants/[id]/toggle-roofing` (trades[] mutation only). Superseded by the customers console.

## Requirements
1. **Catalog = `KNOWN_TRADES`** (no new catalog). `tenants.trades[]` remains the single per-tenant source of truth for feature access. No new runtime feature store is introduced.
2. **Tab→feature map** (`lib/features/catalog.ts`, pure + unit-tested): `roofing→roofing`, `signage→signage`, `painting→painting`, `commercial-painting→commercial_painting`, `aircon→aircon`, `solar→solar`, `estimator→electrical` (the estimator is the electrical-plan take-off; gated by the `electrical` slug — resolves the prior open question). All other tabs (`overview, quotes, followups, chats, files, account, payouts, billing, pricing, services, catalogue, estimating, recipes, invites`) are core and always shown.
3. A pure `tenantHasFeature(trades, slug)` helper in `lib/features/catalog.ts` is the single gating predicate used by nav, page guards, and API guards.
4. `buildNav()` emits a feature tab only when its gating slug is in the tenant's `trades[]`. (Extend the existing roofing-only gate to all feature tabs.) The in-page content switch renders a "feature not enabled" state if the active tab is a disabled feature, and the deep-link initializer (`?tab=`) does not land on a disabled feature tab.
5. A lightweight `GET /api/tenant/features` returns `{ ok, trades, features }` for the authed tenant (features = `trades[]` ∩ catalog), so client page guards don't need the heavy `/api/tenant/me`.
6. Each toggleable feature's **dedicated dashboard route** (`/dashboard/painting`, `/dashboard/roofing/measure`, `/dashboard/aircon`, `/dashboard/signage` + sub-pages, `/dashboard/estimator/[runId]`) blocks access when the gating slug is absent: render a "feature not enabled" panel (link back to `/dashboard`) instead of the tool. A shared client `FeatureGate`/hook implements this.
7. Each **tradie-facing** feature API rejects requests from a tenant lacking the gating slug with HTTP 403 `{ ok:false, error:'feature_not_enabled' }`, via a shared server guard `requireFeature(req, slug)` (`lib/features/guard.ts`). **Customer-facing public token routes are NOT gated** (`/api/*/q/[token]`, `/api/signage/request/[token]`, `/api/solar/confirm/[token]`, `/api/solar/redraft/[token]`) — a customer viewing an already-sent quote must keep working.
8. **Admin toggle UI** = the existing `/admin/customers/[id]` grid (relabelled "Features"). Toggling a feature continues to write `trades[]` + an `admin_audit_log` row (existing `update_trades` action) AND now stamps provenance `source='manual'` (with `updated_by`) for added slugs, so plan-seeding can't later strip an admin grant.
9. A **provenance** table `tenant_feature_sources (tenant_id uuid, feature text, source text check in ('manual','plan','onboarding'), updated_by uuid null, updated_at timestamptz, primary key (tenant_id, feature))` records why each slug is enabled. Migration 138 creates it (idempotent) + a `138_down.sql` + `scripts/run-migration-138.mjs`, and **backfills** every existing tenant's current `trades[]` as `source='manual'` (so no current grant is ever stripped by a future plan downgrade). `sql/init.sql` updated.
10. **Onboarding** (`/api/onboard/activate`) stamps `source='onboarding'` provenance for the tenant's selected trades (best-effort, non-fatal).
11. A **plan→features map** (`lib/features/plan.ts`, pure + tested): `starter` → core trade only (no additions); `pro` → adds `signage, painting, commercial_painting, aircon, solar`; `crew` → adds those + `roofing`. (Contents flagged for sign-off; the mechanism ships with this default.)
12. **Applying the plan map** (`lib/features/access.ts`): adds the plan's granted slugs to `trades[]` (stamped `source='plan'` when no prior provenance) and, on downgrade, removes only slugs whose provenance is `source='plan'` — never `manual`/`onboarding`, never the base trades `electrical`/`plumbing`. Idempotent. Invoked best-effort from the Stripe webhook's `applyTenantSubscription` whenever `subscription_plan` changes; a failure never fails the webhook.
13. **Remove the superseded one-off**: drop the `RoofingActivation` panel from `/admin`, its component, and `/api/admin/tenants/[id]/toggle-roofing` (verified to have no other callers first).

## Non-goals
- No new runtime feature store (no `features`/`tenant_features` tables). `trades[]` is authoritative.
- No change to the quote pipeline's trade routing, pricing, or seeding logic. No call to the staging-only `activate_trade_for_tenant()`.
- No gating of customer-facing public token routes, nor of inbound SMS/voice intake.
- No tradie self-service unlocking; admin-only. No Stripe/billing change; plan is read from the existing mirror. No plan-management UI.
- No destructive data migration; provenance backfill only inserts rows. Existing tenants keep every feature they currently see.

## Constraints
- Next.js 16 App Router; follow `quotemate-automation/AGENTS.md`.
- DB change via `sql/migrations/138_*.sql` + `138_down.sql` + `scripts/run-migration-138.mjs`; idempotent (`IF NOT EXISTS`, on-conflict-do-nothing); keep `sql/init.sql` representative.
- Admin paths reuse `resolveAdminUserId` + `writeAuditLog`; fail closed.
- Server routes use the service-role key; tenancy enforced in the app layer.
- Reuse existing helpers (`KNOWN_TRADES`, `isKnownTrade`, audit, route-auth). Match existing route/page conventions and the Maintain design system.
- Do not delete tenant-owned data on disable; disabling a feature only removes the slug from `trades[]` (gating) — pricing/overlays/quotes are untouched (already the case).

## Edge cases to handle
- Tenant whose `trades[]` predates provenance → backfill stamps each as `manual`, so plan changes never strip it.
- Plan upgrade adding an already-present slug → idempotent, no duplicate provenance, no error.
- Plan downgrade where a slug was admin-granted (`source='manual'`) → kept; only `source='plan'` slugs are removed.
- Deep-link `/dashboard?tab=solar` for a tenant without `solar` → initializer ignores it (stays on overview); if forced, content shows the not-enabled panel.
- Direct navigation to `/dashboard/painting` without the `painting` slug → not-enabled panel, no tool, no data fetch leak.
- Tradie-facing feature API called without the slug → 403 `feature_not_enabled`. Customer token route for the same feature → still works (not gated).
- Admin disables a tenant's only trade → allowed (no crash); the scalar `tenants.trade` FK handling already in `update_trades` is unchanged.
- Estimator tab for a non-electrical tenant → hidden (gated on `electrical`).

## Definition of done
- [ ] Migration 138 creates `tenant_feature_sources` (idempotent), backfills all existing tenants' `trades[]` as `source='manual'`; `138_down.sql` + `scripts/run-migration-138.mjs` exist; `sql/init.sql` updated.
- [ ] `lib/features/catalog.ts` exports the tab→slug map + `tenantHasFeature(trades, slug)`, with unit tests.
- [ ] `lib/features/plan.ts` exports the plan→features map + a pure `computePlanFeatureUpdate(currentTrades, provenance, newPlan)`, with unit tests covering upgrade, downgrade-strips-plan-only, manual-survives-downgrade.
- [ ] `buildNav()` shows each feature tab only when its slug is in `trades[]`; core tabs always shown. The content switch + `?tab=` initializer guard disabled feature tabs.
- [ ] `GET /api/tenant/features` returns `{ ok, trades, features }` for the authed tenant; 401 unauthenticated.
- [ ] Every dedicated feature route renders a not-enabled panel (no tool) when the slug is absent (verified by deep-link for at least painting + aircon + roofing/measure).
- [ ] Every tradie-facing feature API returns 403 `feature_not_enabled` when the slug is absent; customer token routes remain ungated (verified for painting/estimate gated, solar `q/[token]` ungated).
- [ ] `/admin/customers/[id]` grid (relabelled "Features") toggles `trades[]`, writes `admin_audit_log`, and stamps `tenant_feature_sources` `source='manual'`.
- [ ] Onboarding stamps `source='onboarding'` for selected trades.
- [ ] Stripe webhook applies the plan map on `subscription_plan` change (best-effort), never stripping manual/onboarding slugs.
- [ ] `RoofingActivation` + `/api/admin/tenants/[id]/toggle-roofing` removed; no remaining references.
- [ ] Project typecheck/build passes; existing tests pass; new unit tests pass.

## Open questions
- Exact plan→feature map contents for `pro`/`crew` (shipped default above) — needs Jon's sign-off.
- Whether `commercial_painting` and `estimator` should be first-class catalog slugs vs derived (currently `commercial-painting` tab → `commercial_painting` slug which IS in `KNOWN_TRADES`; `estimator` tab → `electrical`). Documented mapping; revisit if product wants an independent `estimator` entitlement.
