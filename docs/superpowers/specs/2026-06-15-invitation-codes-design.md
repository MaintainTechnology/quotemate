# Invitation Codes — Tradie Onboarding Gate & Campaign Attribution

> **Status:** Design approved (brainstorming complete) — 2026-06-15
> **Scope:** Invitation-code system for tradie self-serve onboarding. QR-code marketing for the tradie's *own customer* acquisition is a **coupled follow-up spec** (see [§9 Out of Scope](#9-out-of-scope--follow-up)).
> **Supersedes nothing.** New subsystem layered onto the existing v6 onboarding flow (`/signup → /signup/verify → /onboard`, plus the SMS-initiated intent path).

## 1. Purpose & true job-to-be-done

The initial framing was "a code so bots don't onboard." A sharper reading corrects that:

- **OTP verification is the actual bot wall.** Both onboarding paths already prove a real human with a real phone (web: Twilio OTP at `/signup/verify`; SMS: physical possession of the texting handset). A bot cannot clear that cheaply.
- **The invitation code's real job is therefore `allowlist + campaign attribution`:** controlling *which invited tradies* may onboard, and recording *where each signup came from* (which flyer, which channel, which referrer).

This reframing matters because it sets the security bar correctly (codes gate *who*, not *whether-human*) and explains why quota + campaign metadata are first-class, not nice-to-haves.

## 2. Decisions locked in

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Creation/distribution model | **Hybrid** (admin codes now; campaign + referral codes later, same schema) | Ship admin-mode immediately, no migration when campaigns/referrals arrive. |
| D2 | Reusability | **Reusable with quota** (`quota_total` / `quota_used`) | One code on 500 flyers → ~N signups, with built-in per-campaign attribution. |
| D3 | Scope | **Flexible** — `tenant_id` nullable: `null` = platform-wide, uuid = tenant-scoped | Tradies run their own recruitment/referral codes; QuoteMate runs platform promos. |
| D4 | Validation placement | **Single gate at `/onboard` Step 0**, code captured earlier per-path | One source of truth; closes the SMS-path hole structurally. |

### Four refinements baked in (Opus review, 2026-06-15)

- **R1 — Allowlist framing** (see §1): code is `allowlist + attribution`, OTP is the bot wall.
- **R2 — Authorization split:** a tenant-admin (tradie) may create **only `tenant_id`-scoped** codes. Platform-wide (`tenant_id = null`) codes are **QuoteMate-staff-only**. Prevents privilege escalation.
- **R3 — Unguessable codes:** every code = readable prefix **+ random suffix** (e.g. `JON-JUNE-7K2P`). A code printed on a public flyer still cannot be brute-forced into unlimited signups.
- **R4 — SMS-path gate:** the SMS-initiated onboarding path is gated by capturing the code from the inbound text (see §5.2), validated by the *same* logic as the web path.

## 3. Validation architecture

**Principle: separate _where the code is captured_ (path-specific) from _where it is validated_ (one place).**

| Path | Code captured at | Validated by | Friction |
|---|---|---|---|
| Web | `/signup/verify`, after OTP succeeds | `POST /api/onboard/validate-code` | Type once |
| SMS | Inbound text body (`JOIN <code>`) | `POST /api/onboard/validate-code` (called from inbound handler) | Zero — pre-filled downstream |
| **Both** | **Re-checked at `/onboard` Step 0** (hard gate) | `POST /api/onboard/validate-code` | Locked, pre-filled field |

The `/onboard` Step 0 re-check is the **guaranteed** checkpoint — it runs immediately before the expensive `activate` step (Twilio number purchase + Vapi assistant creation), so no un-allowlisted tradie reaches provisioning regardless of entry path.

**Idempotency note:** validation is a two-phase action. A *check* (read-only: exists / active / not expired / quota remaining) may run many times (on blur, at Step 0). The *consume* (increment `quota_used`, write `code_redemptions` row) happens **once**, atomically, at `activate` time — keyed to the new `tenant.id`. This prevents a tradie who validates, abandons, and retries from burning quota multiple times. See §5.4.

## 4. Data model

### 4.1 New table: `onboarding_codes`

```sql
create table if not exists onboarding_codes (
  id           uuid primary key default gen_random_uuid(),

  -- The code string. Prefix + random suffix (R3). Compared case-insensitively
  -- via lower(code); stored canonical upper-case.
  code         text not null unique,

  -- Scope (D3 / R2): null = platform-wide (staff-only to create), uuid = tenant-scoped.
  tenant_id    uuid references tenants(id) on delete cascade,

  -- Attribution metadata (D2).
  campaign     text,            -- slug, e.g. 'june_flyers', 'referral', 'fb_promo'
  description  text,            -- human note, e.g. 'June NSW electrical flyer drop'

  -- Quota (D2).
  quota_total  integer not null check (quota_total > 0),
  quota_used   integer not null default 0,

  -- Lifecycle.
  status       text not null default 'active'
                 check (status in ('active','paused','revoked')),
  expires_at   timestamptz,     -- null = no expiry

  -- Audit.
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint quota_not_exceeded check (quota_used <= quota_total)
);

create unique index if not exists idx_onboarding_codes_code_lower
  on onboarding_codes (lower(code));
create index if not exists idx_onboarding_codes_tenant
  on onboarding_codes (tenant_id);
```

### 4.2 New table: `code_redemptions` (attribution ledger)

A dedicated ledger (rather than only a column on `tenants`) so one code's signups are queryable and a redemption is the atomic unit that increments quota.

```sql
create table if not exists code_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code_id     uuid not null references onboarding_codes(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  channel     text not null check (channel in ('web','sms')),
  redeemed_at timestamptz not null default now(),

  -- One redemption per tenant per code (prevents double-burn on retry).
  unique (code_id, tenant_id)
);

create index if not exists idx_code_redemptions_code on code_redemptions (code_id);
```

### 4.3 `tenants` convenience column

```sql
alter table tenants
  add column if not exists used_onboarding_code_id uuid
    references onboarding_codes(id) on delete set null;
```

Denormalized pointer for quick "which code brought this tenant" lookups; the ledger in §4.2 is the source of truth.

### 4.4 RLS

Per `CLAUDE.md`, API routes use the service-role key (RLS bypassed) and isolation is app-layer. Enable RLS on both new tables with **no public policy** (consistent with migration 040 Phase 1 — anon sees zero rows). Tenant-scoped read policies are deferred to RLS Phase 2.

## 5. API endpoints

### 5.1 `POST /api/onboard/validate-code` — check (read-only)

Called on-blur from `/signup/verify`, and from the SMS inbound handler, and at `/onboard` Step 0.

**Request**
```json
{ "code": "JON-JUNE-7K2P", "channel": "web", "owner_mobile": "+61481234567" }
```
**Response — valid**
```json
{ "ok": true, "code_id": "uuid", "tenant_id": "uuid-or-null",
  "remaining_quota": 49, "last_slot": false }
```
**Response — invalid**
```json
{ "ok": false, "error": "code_not_found | code_expired | quota_exhausted | code_revoked | code_paused",
  "message": "This code expired on 1 July. Ask whoever sent it for a new one." }
```
**Logic:** trim + upper-case; lookup by `lower(code)`; assert `status='active'`, `expires_at` null-or-future, `quota_used < quota_total`. `last_slot = (quota_used === quota_total - 1)`. **No write.** Error strings are codes; `message` is the human-facing string.

### 5.2 SMS capture (inside existing inbound handler)

In `app/api/sms/inbound/route.ts`, when a message starts an onboarding/registration conversation, parse a leading `JOIN <code>` (case-insensitive; bare `<code>` also accepted). Call the §5.1 check. If invalid → reply with the friendly `message` and **do not** issue an intent token. If valid → proceed to issue the intent token as today, stashing `code_id` on the SMS conversation/intent state so `/onboard` pre-fills and locks the field.

### 5.3 `POST /api/dashboard/invites/generate-code` — create

**AuthZ (R2):** resolve caller's tenant. If request asks for platform-wide (`tenant_id` omitted/null) and caller is **not** QuoteMate staff → `403 forbidden_scope`. Tradies may only create codes scoped to their own `tenant_id`.

**Request**
```json
{ "scope": "tenant" | "platform", "quota_total": 200,
  "campaign": "june_flyers", "description": "June NSW flyer drop",
  "expires_at": "2026-07-01T00:00:00Z" }
```
**Code generation:** prefix from business name (tenant) or `QM` (platform) + campaign slug + **random base32 suffix** (4 chars, no ambiguous chars `0/O/1/I`). Retry on unique-index collision (max 5). Returns the created row.

### 5.4 `consumeCode(codeId, tenantId, channel)` — consume (server-internal, at activate)

Called inside `/api/onboard/activate` **after** the `tenants` row is created, **before** Twilio/Vapi provisioning. In one transaction:
1. `insert into code_redemptions (code_id, tenant_id, channel)` — the `unique(code_id, tenant_id)` makes retries idempotent (on conflict: do nothing, treat as already-consumed success).
2. `update onboarding_codes set quota_used = quota_used + 1 where id = $1 and quota_used < quota_total` — guarded so a race cannot exceed quota.
3. `update tenants set used_onboarding_code_id = $codeId`.
If the guarded update in (2) affects 0 rows (quota just exhausted by a concurrent signup) → roll back, return `quota_exhausted` so the wizard shows the friendly error instead of provisioning.

### 5.5 `GET /api/dashboard/invites/codes` & `PATCH /api/dashboard/invites/codes/[id]`

List (tenant's own codes; staff also see platform codes). PATCH updates `status`, `quota_total` (increase only — cannot drop below `quota_used`), `expires_at`. Same R2 authz.

## 6. UI flows

### 6.1 Code entry on `/signup/verify`
After OTP verified, reveal a required **Invitation code** field. On blur → §5.1 check; show inline friendly error or a green "Valid · 49 slots left" / amber "Valid · last slot" note. **Continue** disabled until valid. Carry `code_id` forward to `/onboard` via URL param/session.

### 6.2 `/onboard` Step 0 (new)
A thin gate before today's Step 1 (Trade & licence). If `code_id` arrived validated (web or SMS) → render the code **pre-filled and read-only** with a confirm tick, auto-advance-able. If absent (deep link) → require entry here. Re-runs §5.1 check; consume happens later at activate (§5.4).

### 6.3 Dashboard `/dashboard/invites/codes` (new)
Table of the tradie's codes: `code · campaign · quota_used/quota_total · status · expires`. Row actions: **Copy**, **Share** (pre-built SMS/email snippet), **Edit** (quota↑/expiry/status), **Revoke**. A **Generate code** modal (scope auto-locked to "My campaign" for tradies; "Platform" option visible only to staff). On success: shows the code + **Copy** + a **Create QR code →** affordance that hands off to the follow-up QR spec (§9). Staff see an additional "Platform codes" section.

## 7. Error & edge cases

- Friendly messages map from error codes (§5.1). Never surface `quota_exhausted` raw.
- Whitespace trimmed; comparison case-insensitive; canonical stored upper-case.
- `last_slot` → amber warning at capture time; the authoritative exhaustion check is the guarded consume (§5.4).
- Revoked/paused codes fail the check immediately.
- SMS `JOIN` with no/invalid code → friendly reply, no intent token issued.
- Concurrency: quota can never exceed `quota_total` (DB `check` + guarded update).

## 8. Implementation sequence

**Phase 1 — Foundation (DB + validation core)**
1. Migration `NNN_invitation_codes.sql` (§4) + `scripts/run-migration-NNN.mjs`; keep `sql/init.sql` representative.
2. `validate-code` (§5.1) + `consumeCode` (§5.4) + unit tests (valid / expired / revoked / quota-exhausted / idempotent-retry / concurrent-last-slot).

**Phase 2 — Web path (critical)**
3. `/signup/verify` code field (§6.1). 4. `/onboard` Step 0 gate (§6.2). 5. Wire `consumeCode` into `activate` (§5.4).

**Phase 3 — SMS path**
6. `JOIN <code>` capture in inbound handler (§5.2); stash `code_id`; pre-fill/lock at Step 0.

**Phase 4 — Dashboard (self-serve)**
7. `generate-code` + list + PATCH (§5.3, §5.5) with R2 authz. 8. `/dashboard/invites/codes` UI (§6.3).

MVP = Phases 1–2 (working web gate). Phase 3 closes the SMS hole. Phase 4 makes it self-serve. The **Create QR code** hand-off (§6.3) is the seam to the follow-up spec.

## 9. Out of scope — follow-up

- **Tradie→customer QR marketing** (the user's second ask: flyers whose QR sends a *homeowner* to SMS-intake or the tenant's customer quote view). This is a **different audience** (tradie acquiring customers) from invitation codes (QuoteMate acquiring tradies) and gets its own spec. The seam: the recruitment SMS CTA format `JOIN <code>` (§5.2) and the dashboard **Create QR code** button (§6.3) are the two integration points the QR spec will build on.
- **Referral codes** (tradie shares a personal unlimited-quota code) — supported by the schema (D1/D3) but no UI/reward logic yet.
- **RLS Phase 2** tenant-scoped read policies for the two new tables.

## 10. Open questions

None blocking. Confirm at build time: (a) how "QuoteMate staff" is identified for R2 (env allowlist of `owner_user_id`s vs. a `tenants.is_platform_admin` flag) — recommend a small `app_admins` allowlist table or env var to start; (b) exact base32 suffix length (default 4).
