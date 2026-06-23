# Design — `03 · Onboard as a tradie` signup QR codes

> Date: 2026-06-23
> Surface: `/dashboard/invites` (the Marketing page)
> Builds on the QR-marketing system from `docs/superpowers/specs/2026-06-15-qr-marketing-landing-design.md` (migration 113).

## Objective

Add a QR code on `/dashboard/invites` that, when scanned, sends a prospective
tradie to the QuoteMax signup page (`https://www.quotemax.com.au/signup`). It is
presented as a new numbered section **`03 · Onboard as a tradie`**, distinct from
the existing customer-facing QR section (`01`) and invitation codes (`02`).

The signup QR is **managed and tracked** like the existing SMS/landing QRs:
generate, list, download (PNG/SVG), copy link, pause/resume, archive, and scan
counting all reuse the existing `marketing_qrs` pipeline. The encoded link
carries a `?ref=<short_code>` attribution parameter.

## Decisions (settled with the requester)

1. **Managed & tracked**, not a single static image — reuse the existing QR
   system by adding a third `destination_type`, `signup`.
2. **Attribution**: the redirect target is
   `https://www.quotemax.com.au/signup?ref=<short_code>`.
3. **Hero stat strip** gains a 4th stat, **"Tradie scans"**, totalling scans of
   signup QRs.

## Architecture

A scanned signup QR encodes the same public `/s/<short_code>` link as every
other QR. The `/s/<short_code>` handler resolves the row, logs the scan
(non-blocking, unchanged), and 302-redirects to the signup URL with the `?ref`
attribution param. Nothing about the QR *image* changes — it already encodes
`/s/<short_code>` for any row.

```
scan → GET /s/<short_code>
        → resolveDestination(row) → { kind: 'signup', url }
        → 302 https://www.quotemax.com.au/signup?ref=<short_code>
```

## Components / changes

### R1 — DB migration 139 (allow `signup` destination)

- `sql/migrations/139_qr_signup_destination.sql`: idempotently drop & re-add the
  `marketing_qrs_destination_type_check` constraint to permit
  `('sms','landing','signup')`. Ends `notify pgrst, 'reload schema'`.
- `sql/migrations/139_down.sql`: revert the constraint to `('sms','landing')`.
  Safe only when no `signup` rows exist — note this in the file.
- `scripts/run-migration-139.mjs`: mirror `run-migration-113.mjs`; verify the
  constraint accepts a `signup` value (e.g. assert the check clause text or a
  trial insert/rollback).

Idempotency: `drop constraint if exists` then `add constraint` converges to the
correct state on repeated runs.

### R2 — `lib/marketing/qr.ts`

- `export const SIGNUP_URL = process.env.SIGNUP_URL ?? 'https://www.quotemax.com.au/signup'`.
- `export function signupUrlWithRef(shortCode: string): string` — append
  `ref=<shortCode>` using `?` or `&` depending on whether `SIGNUP_URL` already
  has a query string. Use the `URL` API so encoding is correct.
- Extend `QrRow.destination_type` to `'sms' | 'landing' | 'signup'`.
- Extend `ResolvedDestination` with `{ kind: 'signup'; url: string }`.
- `resolveDestination`: add a `signup` branch →
  `{ kind: 'signup', url: signupUrlWithRef(qr.short_code) }`. Independent of
  tenant slug / sms number.

### R3 — `/s/[shortCode]/route.ts`

- Handle `dest.kind === 'signup'` next to `landing` → `Response.redirect(dest.url, 302)`.
- Scan logging is destination-agnostic; no change there.

### R4 — `POST /api/dashboard/marketing/qr`

- Add `'signup'` to the `destination_type` Zod enum.
- `signup`: skip the SMS-number guard and the slug guard; `destination_config`
  is `{}`. Generation/insert path is otherwise identical.

### R5 — `PATCH /api/dashboard/marketing/qr/[id]`

- Add `'signup'` to the `destination_type` enum for type + DB-constraint
  consistency. The dashboard UI will not surface a "repoint" control for signup
  QRs; rename/pause/resume/archive all work unchanged.

### R6 — `app/dashboard/invites/page.tsx`

- Section `01` QR table filters to `destination_type !== 'signup'` so signup QRs
  don't leak into the customer-QR table.
- New `<Section num="03" title="Onboard as a tradie" blurb=…>`:
  - Blurb: print/share this QR to recruit tradies; a scan opens the QuoteMax
    signup page.
  - Generator `<Panel>`: a single **Label** field + **Generate signup QR**
    button → `POST .../qr` with `destination_type: 'signup'`.
  - `<TableShell>` of signup QRs (filtered `=== 'signup'`). Columns: **Label**
    (with `/s/<short_code>` subline), **Scans**, **Status**, **Actions**
    (PNG, SVG, Copy link, Pause/Resume, Archive). No "Sends to" / "Repoint".
  - Reuses existing `loadQrs`, `generateQr`-style handler, `patchQr`,
    `Section`, `Panel`, `Field`, `TableShell`, `StatusPill`, `ActionBtn`.
- Hero stat strip: add a 4th `<Stat>` **"Tradie scans"** =
  sum of `scan_count` over signup QRs. Existing "QR codes" / "Total scans"
  tallies continue to include signup QRs.
- The generate handler must be parameterised (or a second handler) so the
  signup generator posts `destination_type:'signup'` while section 01 keeps its
  sms/landing dropdown. Keep the section-01 generator behaviour unchanged.

### R7 — Tests (`lib/marketing/qr.test.ts`)

- `resolveDestination` with a `signup` row →
  `{ kind: 'signup', url: 'https://www.quotemax.com.au/signup?ref=<code>' }`.
- `signupUrlWithRef` appends `?ref=` to a bare URL and `&ref=` when the base URL
  already has a query string.

## Edge cases

- **E1** Bare `SIGNUP_URL` (no query string) → `?ref=`; with query string →
  `&ref=`. Covered by R7.
- **E2** A signup QR has no slug and no SMS number — generation must not require
  either (R4) and resolution must not depend on tenant fields (R2).
- **E3** Paused/archived signup QR follows the same `/s/` behaviour as other
  types (archived → home, paused → "not active" notice). No new handling.
- **E4** Section 01 and section 03 tables must be mutually exclusive by
  `destination_type` so no row appears twice (R6).
- **E5** Repeated migration runs converge (R1 idempotency).

## Constraints

- Money/auth conventions untouched. Ownership checks on PATCH unchanged.
- Maintain design system: square corners, borders-not-shadows, mono eyebrows,
  numbered cards — reuse existing primitives, introduce no new visual style.
- No new required env var; `SIGNUP_URL` is optional with a branded default.

## Out of scope (explicitly not built)

- **Persisting `ref` into the signup flow** — capturing which QR converted a
  *completed* signup. The QR carries `?ref` and every scan is counted via the
  existing `qr_scans` ledger, but wiring `/signup` to read/store the ref is a
  separate change.
- Per-QR campaign tagging UI for signup QRs beyond the existing `campaign`
  column (not surfaced in the new section).
- Any change to QR image rendering (already destination-agnostic).

## Definition of done

- [ ] Migration 139 + down + runner exist and the prod constraint accepts
      `signup`.
- [ ] `resolveDestination` returns a `signup` redirect with `?ref`; `/s/<code>`
      302-redirects signup QRs to the signup URL.
- [ ] POST creates a `signup` QR with no slug/number requirement; PATCH supports
      it for rename/status.
- [ ] `/dashboard/invites` shows a `03 · Onboard as a tradie` section that
      generates, lists, downloads, copies, pauses, and archives signup QRs,
      on-brand, with section 01 and 03 tables mutually exclusive.
- [ ] Hero strip shows a "Tradie scans" stat.
- [ ] `lib/marketing/qr.test.ts` covers the signup branch and `signupUrlWithRef`;
      `vitest` passes.
