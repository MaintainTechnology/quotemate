# RLS design — closing the C8 multi-tenant security debt

> Status: **Phase 1 APPLIED 2026-05-20 via migration 040.** Anon-role
> smoke test (`scripts/smoke-test-rls-anon.mjs`) confirms 0 rows visible
> to the public anon key across all 13 previously-leaking tables.
> Phase 2 + Phase 3 still on paper.
> See [scripts/audit-rls-state.mjs](../scripts/audit-rls-state.mjs) for the
> live audit script that produced the table inventory below.

## TL;DR

The repo's CLAUDE.md known-debt entry says

> "RLS is `ENABLED` on `calls/intakes/quotes/...` but **0 policies** exist
> on any table, and `tenants/customers/sms_*/tenant_*` have RLS **off**."

Audit confirms this. **The dangerous tables are the ones with RLS OFF, not on**:
the Supabase anon key ships to every browser (it's *meant* to be public —
it's the key used by `lib/supabase/client.ts` for auth flows). Any anon
caller can today read **all** of `tenants`, `customers`, `sms_messages`,
`sms_conversations`, `tradie_signup_intents`, and every `tenant_*` table
just by pointing the public anon key at the project URL.

The RLS-on tables with 0 policies are actually fine in practice: the app
reaches them exclusively via `SUPABASE_SERVICE_ROLE_KEY` from server
routes (service role bypasses RLS), and anon callers get a deny-by-default.

So the urgent fix is the opposite of what the punch list initially said:
**turn RLS ON for the tables that currently leak**, and ship one positive
policy per table sized to today's access pattern (almost entirely
service-role-only). Defence-in-depth on the existing RLS-on tables is a
nice-to-have for a later session.

## Access model (what's actually wired today)

Audited 2026-05-20 across `app/**`, `lib/**`, and `scripts/**`:

- **Server components + every `/api/*` route**: import `@supabase/supabase-js`
  with `process.env.SUPABASE_SERVICE_ROLE_KEY`. **All RLS is bypassed.**
  Tenant scoping is enforced in application code via explicit
  `.eq('tenant_id', …)` filters (the `lib/estimate/pricing-book.ts` resolver
  is a representative example — WP1 memory entry `project_wp1_pricing_book_fix`).
- **Browser anon client** (`lib/supabase/client.ts` → `getBrowserSupabase()`):
  used in 13 files, but **only two** of them call `.from()` against data
  tables:
  - [app/auth/callback/page.tsx:131-135](../app/auth/callback/page.tsx#L131-L135)
    reads `tenants` filtered by `owner_user_id = auth.uid()`.
  - [app/dashboard/page.tsx](../app/dashboard/page.tsx) — needs re-audit,
    but most data reads go through `/api/tenant/*` routes (service role).
  Every other browser anon call is `auth.signIn / signUp / getUser /
  exchangeCodeForSession` — auth schema, not `public.*`.
- **Edge / cron** (`/api/cron/sms-cleanup`, Stripe webhook, Vapi webhook,
  Twilio webhook): all service-role.

So in the current code, the only positive anon-key `.from('public.*')`
read is the auth-callback `tenants` lookup. Everything else either uses
service role (so RLS doesn't apply) or hits a token-gated `/api/q/*`
route that returns curated JSON.

## Inventory (audit 2026-05-20)

| Table | RLS | Pol. | tenant_id | Notes |
|---|:---:|:---:|:---:|---|
| **tenants** | ✗ | 0 | — | ⚠ **leak**: 27 cols incl. owner_email, owner_mobile, twilio numbers, stripe_connect_account_id, brand_color |
| **customers** | ✗ | 0 | ✓ | ⚠ **leak**: PII (name, contact) |
| **sms_conversations** | ✗ | 0 | ✓ | ⚠ **leak**: 22 cols, includes photo_request_token |
| **sms_messages** | ✗ | 0 | — | ⚠ **leak**: every SMS body + customer phone |
| **tradie_signup_intents** | ✗ | 0 | — | ⚠ **leak**: signup metadata |
| **tradies** (legacy) | ✓ | 0 | — | safe (deny-all); only 1 row, kept for back-compat |
| **tenant_assembly_bom** | ✗ | 0 | ✓ | tenant-private BOMs |
| **tenant_assembly_overrides** | ✗ | 0 | ✓ | tenant-private overrides |
| **tenant_custom_assemblies** | ✗ | 0 | ✓ | tenant-private services |
| **tenant_licences** | ✗ | 0 | ✓ | per-trade licence rows |
| **tenant_material_catalogue** | ✗ | 0 | ✓ | tenant-private products + costs |
| **tenant_material_preferences** | ✗ | 0 | ✓ | tenant brand prefs |
| **tenant_service_offerings** | ✗ | 0 | ✓ | tenant on/off per service |
| **shared_assembly_bom** | ✗ | 0 | — | shared BOMs (not tenant-scoped) |
| calls | ✓ | 0 | ✓ | safe (deny-all) |
| intakes | ✓ | 0 | ✓ | safe (deny-all) |
| quotes | ✓ | 0 | ✓ | safe (deny-all) |
| payments | ✓ | 0 | — | safe (deny-all) |
| pricing_book | ✓ | 0 | ✓ | safe (deny-all) |
| quote_line_items | ✓ | 0 | — | safe (deny-all; table unused per CLAUDE.md) |
| shared_assemblies | ✓ | 0 | — | safe (deny-all) |
| shared_materials | ✓ | 0 | — | safe (deny-all) |

## Proposal — three phases

### Phase 1 (urgent · close the leak) — **APPLIED 2026-05-20 (migration 040)**

Single migration, no app code changes. For each of the 13 tables marked
"⚠ leak" or "tenant-private", enable RLS. Service role still works
unchanged. Anon will get deny-by-default — same posture as the
already-RLS-on tables.

**Apply result**: migration 040 ran clean. All 13 tables flipped RLS off→on.
The `tenants_self_select` policy is in place. Anon-role smoke test
(`scripts/smoke-test-rls-anon.mjs`) reports 0 rows visible across every
target. 22 public tables are now RLS-on in total.

**Still owed**: live browser smoke-test of the post-signup magic-link →
`/auth/callback` → dashboard flow next time a new tradie signs up. The
DB policy is verified; the JS round-trip is not.

```sql
alter table tenants                       enable row level security;
alter table customers                     enable row level security;
alter table sms_conversations             enable row level security;
alter table sms_messages                  enable row level security;
alter table tradie_signup_intents         enable row level security;
alter table tenant_assembly_bom           enable row level security;
alter table tenant_assembly_overrides     enable row level security;
alter table tenant_custom_assemblies      enable row level security;
alter table tenant_licences               enable row level security;
alter table tenant_material_catalogue     enable row level security;
alter table tenant_material_preferences   enable row level security;
alter table tenant_service_offerings      enable row level security;
alter table shared_assembly_bom           enable row level security;
```

**One positive policy needed**: the auth-callback `tenants` read at
[app/auth/callback/page.tsx:131-135](../app/auth/callback/page.tsx#L131-L135)
uses the anon key, so without a policy it breaks the post-signup flow.

```sql
create policy tenants_self_select on tenants
  for select to authenticated
  using (owner_user_id = auth.uid());
```

Everything else continues to work because every other reach is service-role.

**Pre-flight checklist** (run before applying):
1. Re-grep `getBrowserSupabase().from(...)` across `app/` and `components/`
   to confirm no new anon-key data read was added since this doc was written.
2. Smoke-test the live app post-deploy: signup → magic-link → /auth/callback
   → dashboard should redirect correctly (the callback `tenants` SELECT
   is the load-bearing path).

**Rollback**: if anything breaks, `alter table X disable row level security;`
restores the prior state in one statement per table.

### Phase 2 (when scaling past 4 tenants · defence-in-depth)

Add tenant-scoped policies on the per-tenant tables so that even if
someone ever switches an `/api/tenant/*` route to using the anon client
with a user session, the policies enforce isolation.

Pattern (apply to every `tenant_*` table + customers + sms_*):

```sql
create policy "tenant_owner_select" on <table>
  for select to authenticated
  using (tenant_id in (
    select id from tenants where owner_user_id = auth.uid()
  ));
```

Repeat for `insert/update/delete` with the same `using` clause. The
service role bypasses these, so the existing API routes keep working
unchanged.

### Phase 3 (later · positive policies on the RLS-on tables)

The currently RLS-on tables (calls/intakes/quotes/payments/pricing_book/
shared_*) work today because nothing reads them via anon. If we ever want
to surface a tenant's own intakes/quotes in a client-side dashboard chart
(today they're rendered server-side), policies need to exist. Same
pattern as Phase 2.

For shared catalogue tables (`shared_assemblies`, `shared_materials`,
`shared_assembly_bom`) the right call is probably "anyone can SELECT —
these are the catalogue":

```sql
create policy shared_assemblies_anon_read on shared_assemblies
  for select to anon, authenticated using (true);
```

Caveat: this exposes the standard AU electrical/plumbing catalogue prices
to anyone with the anon key. That's effectively public info (it's seeded
in the open-source migrations) so it's probably fine.

## What this doc deliberately does NOT do

- It does **not** propose RLS for `auth.*` schema (Supabase manages that).
- It does **not** change the WP1 application-layer tenant scoping
  (`.eq('tenant_id', …)` filters in lib/). Those stay — RLS is defence-in-depth.
- It does **not** propose moving anything off the service-role pattern.
  That migration is its own multi-week project and not on the v1 critical path.
- It does **not** write the actual migration file. That's the follow-up.

## Open questions before applying Phase 1

1. Does the dashboard load any data via the browser anon client that I
   missed in the audit? (Re-grep at apply time.)
2. Is there any cron/external job that uses the anon key instead of the
   service-role key? (Audit `app/api/cron/*` + any Vercel/Railway env
   variable shadowing.)
3. Is `tradie_signup_intents` ever read by anon? The intent-token route
   `/api/onboard/intent/[token]` should be service-role; confirm.

## When to ship Phase 1

Today: 4 active tenants (Peppers Plumbing, Pilot Plumber, Pilot Sparky,
Sparky — after the 2026-05-20 stub delete in migration 038). Per the v5
strategy note in CLAUDE.md, RLS becomes load-bearing before scaling past
~5. Phase 1 is the smallest possible change that closes the real leak;
ship it next session after a 5-minute apply-time re-grep.
