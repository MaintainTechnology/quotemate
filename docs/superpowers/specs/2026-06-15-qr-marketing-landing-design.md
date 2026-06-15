# QR Marketing + Per-Tenant Landing Page

> **Status:** Design approved (brainstorming) — 2026-06-15. Sections 1–2 approved explicitly; 3–5 approved via "do what is recommended."
> **Relationship:** This is the **tradie→customer** half of the original two-part ask, deferred by [the invitation-codes spec §9](2026-06-15-invitation-codes-design.md). Invitation codes = QuoteMate acquiring tradies (built). This = a tradie acquiring *customers* via printed QR flyers.

## 1. Purpose

A tradie prints a flyer with a QR code. A homeowner scans it and is taken to **either** the tradie's SMS line **or** a new branded landing page where they upload a job photo and get an AI-drafted quote texted back. The tradie sees scan counts per flyer and every resulting quote in their existing dashboard.

Two coupled pieces, built in this order (the QR needs somewhere to point):
1. **Per-tenant landing page** + web intake channel (the destination).
2. **QR generator** + trackable redirect + dashboard "Marketing" area (the tool).

## 2. Decisions locked in

| # | Decision | Choice |
|---|---|---|
| D1 | "Quote page" destination | **New branded per-tenant landing page** `/t/<slug>` (Option A) |
| D2 | Landing-page action | **Photo-first intake** → reuse the existing pipeline (Option A) |
| D3 | Scan tracking | **Trackable short redirect** `/s/<code>` logs the scan, then forwards; destination is **repointable** after printing (Option A) |
| D4 | Pipeline integration | **Web = a new intake channel** reusing `lib/intake/structure.ts` + estimate path (Approach 1) |
| D5 | Per-QR destination | Tradie chooses **SMS** or **landing page** per QR |
| D6 | Dashboard placement | A **"Marketing" area** housing both Invite codes (existing) + QR codes (new), shown with the invites |
| D7 | QR rendering | **Server-side `qrcode` package** → downloadable PNG (print) + SVG (scale) |
| D8 | Abuse protection | Public lead form is rate-limited (per-IP + per-mobile), requires a photo + valid AU mobile, with a honeypot field |

## 3. Architecture & flow

```
Homeowner scans flyer QR  →  GET /s/<shortCode>   (resolve, log scan, route)
   ├─ destination = 'sms'      → interstitial HTML that opens sms:<tenant#>?body=<prefill> + tap button
   └─ destination = 'landing'  → 302 → /t/<slug>?qr=<shortCode>
                                    → branded page: photo + suburb + description + name/mobile
                                    → POST /api/t/<slug>/lead
                                        → upload photos (intake-photos bucket)
                                        → findOrCreateCustomer(tenantId)
                                        → build transcript from form → structureIntake(channel:'web')
                                        → embedIntake → estimate run → routing → customer quote SMS
                                    → confirmation: "We'll text your quote shortly."
Tradie dashboard → Marketing → generate/manage QR codes, set slug, see scan counts
```

Same architectural DNA as invitation codes: denormalized counter + scan ledger, RLS-on-no-policy, **explicit table grants** (the portability bug from migration 112 — don't repeat it), service-role API routes with Bearer-token tenant resolution.

## 4. Data model — migration 113

### 4.1 `tenants.slug`
```sql
alter table tenants add column if not exists slug text;
create unique index if not exists idx_tenants_slug on tenants (lower(slug)) where slug is not null;
```
Auto-generated from `business_name` (slugified, e.g. `atomic-electrical`), uniqueness-suffixed on collision (`atomic-electrical-2`), editable by the tradie. Powers `/t/<slug>`.

### 4.2 `marketing_qrs`
```sql
create table if not exists marketing_qrs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  short_code         text not null unique,              -- ~6 url-safe chars → /s/<short_code>
  label              text not null,                     -- "June letterbox drop"
  campaign           text,
  destination_type   text not null check (destination_type in ('sms','landing')),
  destination_config jsonb not null default '{}'::jsonb,-- sms: { prefill_body }; landing: { }
  status             text not null default 'active' check (status in ('active','paused','archived')),
  scan_count         integer not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_marketing_qrs_tenant on marketing_qrs (tenant_id);
```
`destination_type` + `destination_config` are **mutable** (repoint after printing).

### 4.3 `qr_scans` (attribution ledger)
```sql
create table if not exists qr_scans (
  id         uuid primary key default gen_random_uuid(),
  qr_id      uuid not null references marketing_qrs(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  user_agent text,
  referrer   text
);
create index if not exists idx_qr_scans_qr on qr_scans (qr_id);
```

### 4.4 RPC + RLS + grants
```sql
create or replace function increment_qr_scan(p_qr_id uuid)
returns void language sql as $$
  update marketing_qrs set scan_count = scan_count + 1 where id = p_qr_id;
$$;

alter table marketing_qrs enable row level security;
alter table qr_scans enable row level security;
-- Explicit grants (migration-112 lesson — don't rely on default privileges):
grant select, insert, update, delete on marketing_qrs to service_role, authenticated;
grant select, insert, update, delete on qr_scans to service_role, authenticated;
grant select on marketing_qrs to anon;
grant select, insert on qr_scans to anon;  -- the public redirect logs scans
```

The `slug`, `marketing_qrs`, `qr_scans` shapes are mirrored into `sql/init.sql`'s representative block only if the genesis schema already carries `tenants` (it does not — so, consistent with migration 112, init.sql is left alone and the migration is the source of truth).

## 5. Components

### 5.1 Public redirect — `app/s/[shortCode]/route.ts` (GET)
- Look up `marketing_qrs` by `short_code`. Missing/`archived` → 302 to `APP_URL` (graceful). `paused` → simple "this code is paused" page.
- Active → fire scan log in `after()` (insert `qr_scans` + `increment_qr_scan` RPC), then route:
  - `landing` → 302 `Response.redirect(/t/<slug>?qr=<short_code>)`.
  - `sms` → return interstitial HTML that auto-launches `sms:<tenant.twilio_sms_number>?&body=<prefill>` + a visible "Text us" button (302-to-`sms:` is unreliable across browsers).
- No auth (public). `export const dynamic = 'force-dynamic'`.

### 5.2 Landing page — `app/t/[slug]/page.tsx` (server) + `LeadForm.tsx` (client)
- Server resolves tenant by `lower(slug)`; inactive/missing → branded 404. Passes `business_name`, `brand_color`, `logo` to the client form.
- `LeadForm`: required job **photo** (≥1, to `intake-photos`), suburb/address, short description, customer **name + mobile** (AU), optional email, **honeypot** field. Submits to the lead endpoint; on success shows a confirmation panel.

### 5.3 Web lead endpoint — `app/api/t/[slug]/lead/route.ts` (POST)
- Validate (Zod) + honeypot + throttle (per-IP and per-mobile, in-memory or a small `lead_throttle` check — see §7). Reject over-limit with a friendly 429.
- Resolve tenant by slug. Upload photos. `findOrCreateCustomer(tenantId)`.
- Build a transcript string from the form (`"Customer wants: <description>. Suburb: <suburb>."`), then run the **shared lib path** in `after()`: `structureIntake({ transcript, photoUrls, tradeHint, sourceChannel:'web' })` → `embedIntake` → estimate run → routing → customer quote SMS. (Mirrors how `/api/intake/structure` composes those libs for voice/SMS; `'web'` is added as a third `sourceChannel`.)
- Fast-ack the form (`{ ok: true }`) before the heavy `after()` work.

### 5.4 QR generation lib — `lib/marketing/qr.ts`
- `generateShortCode()` (unambiguous alphabet, like invitation codes' suffix).
- `slugifyBusinessName(name)` → base slug; caller adds uniqueness suffix.
- `renderQrPng(url)` / `renderQrSvg(url)` using the `qrcode` npm package (new dependency).
- `resolveDestination(qr, tenant)` → the URL or `sms:` string the redirect uses (shared by redirect route + image preview).

### 5.5 Dashboard APIs (Bearer auth, mirror the invites endpoints)
- `GET/POST /api/dashboard/marketing/qr` — list / create (create generates `short_code`, validates destination, writes row).
- `PATCH /api/dashboard/marketing/qr/[id]` — repoint destination, edit label, pause/archive (ownership-checked).
- `GET /api/dashboard/marketing/qr/[id]/image?format=png|svg` — returns the QR image for `/s/<short_code>` (download).
- `GET/PATCH /api/dashboard/marketing/slug` — read/set the tenant slug (uniqueness-checked).

### 5.6 Dashboard UI — `app/dashboard/invites/page.tsx` → retitled "Marketing"
- The existing page becomes two sections: **Invite codes** (existing) + **QR codes** (new). Nav tab label `Invites` → `Marketing` (Megaphone icon already wired).
- QR section: a **slug editor** (set your landing URL), a **Generate QR** form (label, destination picker SMS/landing, optional SMS prefill), and a list of QRs with `scan_count`, destination, status, a **download PNG/SVG** action, **copy `/s/<code>` link**, **repoint**, **pause/archive**.

## 6. Reuse map (no duplication)

| Need | Reuse |
|---|---|
| Photo storage | existing `intake-photos` Supabase bucket + `/upload/[token]` upload pattern |
| Customer row | `findOrCreateCustomer(tenantId)` (`lib/customers/lookup.ts`) |
| Intake structuring | `structureIntake` (`lib/intake/structure.ts`) — add `'web'` to its `sourceChannel` |
| Embedding / quality / estimate / routing / customer SMS | the same libs `/api/intake/structure` composes |
| Dashboard auth | `userFromBearer` + tenant-by-`owner_user_id` (as in `/api/tenant/me`, invites endpoints) |
| Counter + ledger + RPC + grants | the invitation-codes pattern (migration 112) |

## 7. Error handling & abuse

- **Rate limit** the public lead endpoint: max ~3 submissions / mobile / hour and ~10 / IP / hour. v1 = a small `lead_throttle` table (`key`, `window_start`, `count`) checked+upserted per request (no infra exists yet per CLAUDE.md). Over-limit → friendly 429, no LLM call.
- **Honeypot** hidden field — non-empty ⇒ silently drop (bot).
- Required photo + valid AU mobile (Zod) before any LLM spend.
- Redirect route never errors the user: unknown/archived code → 302 home; log failures are non-fatal (`after()`).
- Slug collisions resolved with numeric suffix; slug edit validates uniqueness (409 on clash).
- Inactive tenant landing → branded 404.

## 8. Testing

- **Unit (vitest):** `generateShortCode` (alphabet/length), `slugifyBusinessName` (cases, collisions), `resolveDestination` (sms vs landing URL shapes), throttle counter logic, lead Zod schema (photo/mobile/honeypot).
- **DB-direct (against Supabase, as in the invites build):** migration applies + grants on both DBs; `increment_qr_scan` bumps; scan ledger insert; QR create/list/repoint.
- **Live (dev server):** `/s/<code>` redirects + logs a scan; `/t/<slug>` renders + a lead submission creates an intake and (stub-aware) kicks the pipeline; dashboard QR generate + image download.

## 9. Build sequence

1. **Migration 113** (slug, `marketing_qrs`, `qr_scans`, RPC, RLS, **grants**) + run script; apply to **both** DBs (prod `bobv` + dev `avzr`).
2. **`lib/marketing/qr.ts`** (+ add `qrcode` dep) + unit tests.
3. **Landing page** `/t/[slug]` + `LeadForm` + **`/api/t/[slug]/lead`** (web channel in `structureIntake`) + throttle.
4. **Redirect** `/s/[shortCode]` (+ interstitial for SMS).
5. **Dashboard APIs** (`/api/dashboard/marketing/qr*`, `/slug`) + **Marketing UI** (retitle invites page, add QR section + slug editor).
6. Verify (unit + DB + live), commit per step.

## 10. Out of scope (follow-ups)

- Printable full-flyer templates (v1 = downloadable QR image only).
- Scan analytics beyond a count (device/time charts).
- Captcha (v1 = throttle + honeypot).
- Custom domains / vanity slugs beyond the auto + edit.
- Stripe/booking on the landing page (it hands off to the existing quote flow).
