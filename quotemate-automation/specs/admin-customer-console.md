# Admin Customer Console — Spec

## Objective
QuoteMate's internal team (e.g. Jon, Jeph) has no single place to see and manage every tradie business ("tenant") on the platform. Today they can only inspect one master account at a time and there is no cross-tenant view. This spec defines an **admin customer-management console**: a cross-tenant list of all tenants showing their business name, enabled trades/features, subscription plan, and account status, plus a per-tenant detail page from which an admin can manage the account (suspend/reactivate, comp billing, toggle trades, and change/start a Stripe subscription). It is an internal operations surface, distinct from the customer-facing `/dashboard` that individual tradies see.

## Context / background
This is **not greenfield** — most of the foundation already exists in `quotemate-automation/`:

- **Existing admin area.** `app/admin/page.tsx` is a "command-centre" landing page with numbered tiles (01 Bulk loader → `/admin/loader`, 02 Agents → `/admin/agents`, etc.). This console adds a new tile + route under the same surface and visual language (Maintain design system).
- **Existing admin auth.** Admin identity is an allowlist row in the `admin_users` table (one column: `user_id`, from migration 050). Server helpers already exist:
  - `isAdminUser(supabase, userId)` — `lib/admin-loader/auth.ts` (queries `admin_users`; fails closed).
  - `resolveAdminUserId(req)` — `lib/admin-loader/route-auth.ts` (validates the Bearer token AND `admin_users` membership; returns `null` → caller responds 403).
  - Client pattern: call admin APIs with the Supabase access token as a Bearer header; `/api/admin/whoami` is the reference.
  A regular tenant owner authenticates via `auth.users` but has **no** `admin_users` row. There is no role hierarchy — flat allowlist only.
- **Tenants schema** (`tenants` table; migrations 015/017/132/133). Relevant columns already present:
  - Identity: `id`, `owner_user_id`, `business_name`, `owner_email`, `owner_mobile`, `state`, `abn`, licence fields, `created_at`, `activated_at`.
  - Trades: `trade text` (scalar, CHECK was `electrical`/`plumbing`) and `trades text[]` (the multi-trade array that actually drives dashboard feature visibility).
  - Status: `status text` CHECK in (`onboarding`, `active`, `suspended`).
  - Stripe/billing: `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (Stripe mirror: `trialing`/`active`/`past_due`/`canceled`/`incomplete`/`incomplete_expired`/`unpaid`/`paused`, NULL = never subscribed), `subscription_plan` (`starter`/`pro`/`crew`), `subscription_interval` (`month`/`year`), `subscription_current_period_end`, `trial_ends_at`, `subscription_cancel_at_period_end`, `billing_exempt boolean`.
  - `stripe_connect_account_id` (payout account — out of scope here).
- **Subscription truth.** Stripe is authoritative. `/api/stripe/webhook` mirrors subscription events into the `subscription_*` columns. Stripe prices are keyed by lookup_key `qm_<plan>_<interval>` (e.g. `qm_pro_month`). Therefore admin plan changes must call the Stripe API and let the webhook reconcile the DB — never write `subscription_plan` directly.
- **Trades / feature gating.** The customer `/dashboard` decides which trade tools to show by checking membership in `tenants.trades[]` (e.g. `tenantHasRoofingTrade(trades)` in `lib/roofing/tenant.ts`; tabs `roofing`, `signage`, `painting`, `commercial_painting`, `aircon`, `solar`, plus the base `electrical`/`plumbing`). There is no feature-flag service; editing `trades[]` is the lever. The `tenant_service_offerings` table gates which assemblies appear inside a trade — out of scope for v1.
- **Data access.** Server routes/components read tenant data with a **service-role** Supabase client (`SUPABASE_SERVICE_ROLE_KEY`), which bypasses RLS. Each route currently instantiates its own client (see `app/api/admin/whoami/route.ts`).
- **Next.js 16 App Router.** Per `quotemate-automation/AGENTS.md`, read the relevant `node_modules/next/dist/docs/` guide before writing Next code; Next 16 has breaking changes vs. older knowledge.

## Requirements

### Discovery / navigation
1. Add a new tile to the `/admin` command-centre landing (`app/admin/page.tsx`) linking to `/admin/customers`, matching the existing numbered-tile style and Maintain design system.

### Access control
2. Both the `/admin/customers` pages and every supporting API route must be restricted to admins. API routes authorize via `resolveAdminUserId(req)` and respond `403` (JSON error) when it returns `null`. Page-level access follows the same pattern the other `/admin/*` pages use (client fetches an admin API with the Bearer token; non-admins are denied — never shown tenant data).
3. Non-admin and unauthenticated users must never receive any tenant data from these routes (fail closed).

### Cross-tenant list view (`/admin/customers`)
4. Display a table of **all** tenants (cross-tenant; service-role read), one row per tenant, with at least these columns:
   - **Business name** (`business_name`).
   - **Trades** — the `trades[]` array rendered as readable badges/labels.
   - **Status** (`status`: onboarding / active / suspended) as a visually distinct badge.
   - **Plan** — `subscription_plan` (or "None" when NULL) plus `subscription_status`, and a clear indicator when `billing_exempt = true` (e.g. a "Comped" badge).
   - **Created** (`created_at`, AU-formatted date).
   - **Actions** — a link/control to open that tenant's detail page.
5. Provide a free-text search that filters the list by `business_name` (case-insensitive, substring).
6. Provide filters for `status`, for trade (membership in `trades[]`), and for `subscription_plan`. Filters and search compose (AND).
7. Default sort is newest first (`created_at` desc). The empty/zero-result state renders a clear "no matching customers" message rather than a blank table.

### Per-tenant detail page (`/admin/customers/[id]`)
8. Show the tenant's full profile: identity (business name, owner email/mobile, state, ABN, licence), trades, status, and the full billing block (plan, interval, status, current period end, trial end, cancel-at-period-end, billing_exempt), plus key provisioning ids (twilio numbers, vapi assistant id, stripe customer/subscription ids) for reference (read-only).
9. Surface a reverse-chronological **audit history** for this tenant (rows from `admin_audit_log`, see below): who did what, when, and before→after values.

### Management actions (all from the detail page)
10. **Suspend / reactivate** — toggle `tenants.status` between `active` and `suspended`. (A tenant in `onboarding` may be suspended; reactivation sets `active`.)
11. **Toggle `billing_exempt`** — comp or un-comp a tenant (boolean).
12. **Enable/disable trades** — edit `tenants.trades[]` from the known trade set (`electrical`, `plumbing`, `roofing`, `signage`, `painting`, `commercial_painting`, `aircon`, `solar`). When the change leaves the array non-empty, keep the scalar `trade` column in sync with `trades[0]` (preserve the existing CHECK constraint — do not write a value the constraint rejects; if the constraint blocks a needed value, the migration must widen it and that change is recorded in `sql/`). Disabling a trade must not be allowed to leave `trade` referencing a trade no longer in `trades[]`.
13. **Change subscription plan (existing subscription)** — when the tenant already has a `stripe_subscription_id`, changing plan/interval calls the Stripe API to update the subscription item to the price for lookup_key `qm_<plan>_<interval>`, with proration (`proration_behavior: 'create_prorations'`). The DB `subscription_*` columns are updated **by the existing webhook**, not written directly by this action.
14. **Start subscription (never-subscribed tenant)** — when the tenant has no `stripe_subscription_id`, the admin can start one: ensure a Stripe customer exists (create from `owner_email`/`business_name` and persist `stripe_customer_id` if missing), then create a subscription on the chosen plan/interval price. To avoid immediate-payment failures and broken `incomplete` subscriptions when no payment method is on file, the subscription is created with a trial (default 14 days) so `subscription_status` becomes `trialing`; the customer supplies a payment method before trial end via the existing billing flow. The webhook reconciles the DB columns.
15. Every mutating action (req. 10–14) returns the updated tenant state (or a clear error) so the UI reflects the result without a full reload.

### Safety + accountability
16. Every mutating action requires an explicit confirmation step in the UI before it fires. Money-touching and destructive actions — plan change/start (13, 14) and suspend (10) — require a **typed confirmation** (e.g. typing the business name or the word the dialog asks for), not just a single click.
17. Every successful mutating action writes one immutable row to a new `admin_audit_log` table capturing: acting admin `user_id`, target `tenant_id`, `action` (enum/text, e.g. `suspend`, `reactivate`, `set_billing_exempt`, `update_trades`, `change_plan`, `start_subscription`), `before` and `after` (jsonb of the changed fields), and `created_at`. Rows are insert-only (no update/delete path in the app).
18. If the underlying action partially fails (e.g. Stripe call throws), no audit row claiming success is written, and the admin sees the actual error.

### Database
19. Add a new migration `sql/migrations/NNN_admin_audit_log.sql` (next free number) creating `admin_audit_log`, plus a matching `scripts/run-migration-NNN.mjs` following the repo's existing migration-runner pattern. Keep `sql/init.sql` representative. RLS: enable RLS on the table (consistent with the post-040 baseline); server writes use the service-role key.

## Non-goals
- No changes to the customer-facing `/dashboard` behavior or to how tradies see their own account.
- No Stripe Connect / payouts management (`stripe_connect_account_id` is display-only here).
- No editing of assemblies/materials/service offerings (`tenant_service_offerings`), pricing book, or branding.
- No role hierarchy or per-admin permissions — the flat `admin_users` allowlist is the only gate.
- No bulk/multi-select actions across tenants (actions are per-tenant in v1).
- No tenant creation or hard-deletion from this console (onboarding remains the creation path).
- No new analytics/metrics dashboards or charts.
- No editing of the audit log; it is append-only and read-only in the UI.

## Constraints
- **Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + service-role client), Stripe (test mode), Maintain design system. Match existing `/admin/*` conventions exactly.
- **Auth:** reuse `resolveAdminUserId` / `isAdminUser` and the `admin_users` allowlist — do not invent a new auth mechanism.
- **Money path:** never write `subscription_plan`/`subscription_status` directly as the result of a plan change; mutate Stripe and let `/api/stripe/webhook` mirror. Plan/interval map to Stripe price lookup_key `qm_<plan>_<interval>`.
- **Multi-tenant reads** use the service-role key and are gated behind the admin check (RLS is bypassed by service role, so the admin gate is the only thing protecting the data — it must be airtight).
- **AU formatting** for dates/currency; ex-GST stored, inc-GST displayed where money is shown.
- **Webhook routes fast-ack** convention is unchanged; new admin mutation routes may run synchronously (they are admin-initiated, not provider webhooks) but should surface Stripe errors rather than swallow them.
- Follow `quotemate-automation/AGENTS.md`: consult `node_modules/next/dist/docs/` before writing App Router code.

## Edge cases to handle
- **Non-admin / no token hits any `/admin/customers` API** → `403`, no tenant data in the body.
- **Zero tenants, or filters match nothing** → explicit empty-state message, not a blank/broken table.
- **Tenant with `trades = []`** → list shows a "no trades" indicator; detail page still lets the admin add trades.
- **Disable the last/only trade** → either block it with a clear message or allow an empty `trades[]`; whichever is chosen must keep the `trade` scalar consistent with the CHECK constraint and not crash the customer dashboard. (Default: allow empty `trades[]`, set scalar to a constraint-valid fallback or leave unchanged only if still valid.)
- **Change plan on a tenant with no `stripe_subscription_id`** → the UI must offer "start subscription" (req. 14), not a no-op "change" that silently fails.
- **Start subscription when `stripe_customer_id` already exists but no subscription** → reuse the existing customer; do not create a duplicate.
- **Stripe API error during change/start** (network, invalid price lookup_key, customer in bad state) → action fails atomically: surface the error, write no success audit row, leave DB untouched (webhook never fires for a failed call).
- **Webhook lag** → after a successful Stripe call the DB mirror may not be updated yet; the UI should communicate "change submitted; syncing" rather than asserting the new plan is live, and must not double-write the columns.
- **Suspended tenant** → still fully visible and manageable in the console (suspension is a status, not a hide).
- **`billing_exempt = true` tenant** → plan controls still function, but the UI makes clear the tenant is comped (enforcement is bypassed for them elsewhere).
- **Concurrent admin edits / stale view** → last write wins is acceptable in v1, but the audit log records each action with its own before→after so history is reconstructable.
- **Unknown / future trade value already present in `trades[]`** → render it as a label rather than crashing; the toggle set is the known list but display tolerates extras.

## Definition of done
- [ ] `/admin` landing shows a new tile linking to `/admin/customers`, styled consistently with existing tiles.
- [ ] Visiting `/admin/customers` as an allowlisted admin shows a table of all tenants with columns: business name, trades, status, plan (+ status + comped indicator), created date, and an action to open detail.
- [ ] A non-admin (valid user, not in `admin_users`) and an unauthenticated request both receive `403` from the list/detail/mutation APIs and see no tenant data.
- [ ] Search by business name and filters for status/trade/plan work and compose; an empty result shows the empty-state message.
- [ ] `/admin/customers/[id]` shows the full tenant profile, billing block, provisioning ids, and the tenant's audit history.
- [ ] Suspend/reactivate updates `tenants.status`, requires typed confirmation, and writes an `admin_audit_log` row with before→after.
- [ ] Toggling `billing_exempt` updates the column, requires confirmation, and writes an audit row.
- [ ] Enabling/disabling trades updates `tenants.trades[]`, keeps `trade` scalar consistent with its CHECK constraint, requires confirmation, and writes an audit row; the change is reflected in the customer dashboard's tab visibility for that tenant.
- [ ] For a tenant with an existing subscription, a plan/interval change calls Stripe (price `qm_<plan>_<interval>`, prorated) and does NOT directly write `subscription_plan`; after the webhook fires the DB reflects the new plan.
- [ ] For a never-subscribed tenant, "start subscription" creates/reuses the Stripe customer and creates a trialing subscription on the chosen plan; `stripe_customer_id`/`stripe_subscription_id` end up populated (via webhook) and `subscription_status` becomes `trialing`.
- [ ] A failed Stripe call surfaces the error, changes no DB columns, and writes no success audit row.
- [ ] New migration `sql/migrations/NNN_admin_audit_log.sql` + `scripts/run-migration-NNN.mjs` exist, create the append-only `admin_audit_log` table with RLS enabled, and `sql/init.sql` is updated to stay representative.
- [ ] `npm run lint` / `tsc` (project's existing checks) pass for all new/changed files, and the app builds.

## Open questions
- **Trial / payment-method policy when an admin starts a subscription** (req. 14): default chosen here is a 14-day trial so no immediate payment method is required. Confirm the trial length and whether a payment method should instead be required up front (which would create `incomplete` subscriptions to handle).
- **Proration on plan changes** (req. 13): default is Stripe `create_prorations`. Confirm whether upgrades/downgrades should prorate, charge immediately, or defer to period end.
- **Exact Stripe price ids vs. lookup_keys** — confirm that all six `qm_<plan>_<interval>` prices exist in the test-mode Stripe account so "change/start" can resolve every plan/interval combination.
