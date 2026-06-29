# Move Invitation Codes + Onboard-as-a-Tradie to Admin — Design

**Date:** 2026-06-29
**Status:** Approved (scoping confirmed via brainstorming)

## Problem

The page at `app/dashboard/invites/page.tsx` is internally titled **"Marketing"** and
renders three numbered sections:

- **01 · QR codes** — customer-facing flyer QR → SMS / landing page (genuine tenant marketing)
- **02 · Invitation codes** — gate who can onboard as a tradie (a platform/access function)
- **03 · Onboard as a tradie** — recruitment signup QR (a growth/access function)

Sections 02 and 03 are administrative in nature and belong on the admin side, not on a
tenant-marketing surface.

## Decision (confirmed)

- **Move sections 02 + 03** to admin. **Keep 01 (QR codes)** on the Marketing page.
- **True move** — remove 02 + 03 from the Marketing page (tenants no longer self-serve
  invitation codes / signup QRs from there).
- **New `/admin` sub-page + hub tile** (matches the existing admin pattern:
  loader / customers / tenants are each their own sub-page linked from the `/admin` hub).
- **Extract shared UI primitives** into one module used by both pages (single source of truth).

## Key finding — no API/DB changes required

Both endpoints these sections call are **tenant-scoped off the signed-in user**, not
admin-gated:

- `/api/dashboard/invites/codes` (+ `/[id]`) — resolves the tenant via
  `tenantForUser(user.id)`. `is_platform_admin` only unlocks the "platform-wide" scope
  option; it is not required to use the endpoint.
- `/api/dashboard/marketing/qr` (+ `/[id]`, `/[id]/image`) — resolves the tenant the
  same way; signup QRs use `destination_type: 'signup'`.

An "admin" in this app is a tenant-owner whose `user_id ∈ PLATFORM_ADMIN_USER_IDS`. They
still own a tenant, so the same Bearer-token requests resolve their tenant and behave
identically when issued from an `/admin` page. **This is a pure UI relocation.**

## Components

### 1. Shared module — `app/_components/console-ui.tsx` (new, `'use client'`)

Lift the presentational primitives + tokens + auth helper currently defined inline in
`app/dashboard/invites/page.tsx` so both pages import one copy:

- Token strings: `INPUT`, `EYEBROW`, `PRIMARY`, `GHOST`, `TH`
- `authHeader()` (Supabase session → Bearer + JSON headers)
- Components: `Stat`, `Section`, `Panel`, `Field`, `TableShell`, `StatusPill`, `ActionBtn`

These are pure/presentational (plus the async `authHeader`), so they move verbatim — no
behavioural change.

### 2. New page — `app/admin/invites/page.tsx` (new, `'use client'`)

Maintain-design admin sub-page with admin chrome:

- Breadcrumb `QuoteMax / Admin / Invites & recruitment` and a `← Admin` back link
  (mirrors the Marketing page's `← Dashboard` link).
- Grid/glow backdrop consistent with the Maintain design system.
- Top stat strip: `Invite codes` count · `Tradie scans` (parity with what these sections showed).
- **Section 01 · Invitation codes** — the existing "New code" form (campaign / quota /
  scope-if-admin), Generate button, codes table (Copy / Pause / Resume / Revoke). Uses
  `/api/dashboard/invites/codes`.
- **Section 02 · Onboard as a tradie** — the existing "New signup QR" form, Generate
  button, signup-QR table (PNG / SVG / Copy link / Pause / Resume / Archive). Uses
  `/api/dashboard/marketing/qr` with `destination_type: 'signup'`, list filtered to
  signup QRs.

Sections renumbered **01 / 02** (they are the only two on this page).

### 3. Hub tile — `app/admin/page.tsx` (edit)

Append one tile to `SECONDARY_TILES` (append, not insert, to avoid renumbering 03–09):

- `num: '10'`, eyebrow `Access & recruitment`, title `Invites & onboarding`,
  href `/admin/invites`, blurb covering invitation-code gating + recruitment signup QRs.

### 4. Marketing page slimmed — `app/dashboard/invites/page.tsx` (edit)

- Remove sections 02 + 03 JSX.
- Remove now-dead state/handlers: invitation-code state (`codes`, `isAdmin`, `campaign`,
  `quota`, `scope`, `generating`, `justMade`), `loadCodes` / `generate` / `patchCode`;
  signup-QR state (`signupLabel`, `signupGenerating`), `generateSignupQr`; derived
  `signupQrs` / `signupScans`.
- Import the shared primitives instead of the local copies.
- Hero copy: drop the "Invitation codes control who can onboard" sentence; drop the
  `Tradie scans` and `Invite codes` stats (keep `QR codes` + `Total scans`). Scope
  `Total scans` to customer QRs.
- **Section 01 (QR codes) is unchanged**; the page still loads QRs (it needs the
  customer-QR list + slug).

## Non-goals

- No changes to API routes, DB schema, or auth.
- No changes to QR codes (section 01) behaviour.
- No new admin gating on the invites/QR endpoints (out of scope; they remain
  tenant-scoped as today).

## Verification

- `tsc`/Next build clean (no unused-symbol/type errors after removals).
- Confirm Marketing page renders only section 01 and no dead references remain.
- Confirm `/admin/invites` renders both sections and the hub tile links to it.
- Browser smoke check of both pages where feasible.
