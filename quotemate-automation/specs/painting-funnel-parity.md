# Painting customer funnel parity (five-section view + site-visit path)

Date: 2026-08-05
Status: ready to build

## Objective

Bring the painting customer funnel onto the same current-generation format and
workflow as roofing and electrical/plumbing: the five-numbered-section customer
view (including the "Your tradie" welcome-video section) and a real, payable
site-visit path for inspection-routed jobs — while preserving painting's
review-required publish gate and every money invariant.

## Background — audit findings (verified 2026-08-05; do not re-litigate)

- Painting's pages already use the current shared chrome kit (`QuoteChrome`,
  `parts.tsx`) — they are NOT pre-redesign. What painting never received is
  the **five-numbered-section layout** (Overview / Job details / Your tradie /
  Your price / Book your site visit) that roofing renders once confirmed
  (`app/q/roof/[token]/page.tsx:659-938`, gated `confirmed && sp.full !== '1'`)
  and electrical/plumbing render via the `usesGenericCard` branch
  (`app/q/[token]/page.tsx:1077`, welcome video at `:878`).
- The painting **thanks page is already at parity** with roofing's — same
  section order, same `TrustVideo` call shape
  (`trustVideoTrack(identity, 'thankyou', 'painting')`,
  `app/q/paint/[token]/thanks/page.tsx:180-186`), same `BookedSummary` /
  `AddToCalendar` / PDF-link structure. Roofing's extra `HouseShowcase` (3D)
  block is roofing-only data and stays absent from painting.
- The painting **book page is already at parity** (shared `BookingCalendar`,
  `toCalendarDays`, webhook-race guard). Its one structural difference —
  `?tier` for per-tier deposits — is intentional.
- The **quote page has no "Your tradie" video section at all** (no
  `TrustVideo`/`trustVideoTrack` import in `app/q/paint/[token]/page.tsx`).
- **Inspection-routed / held painting jobs have zero on-page action**: the
  page deliberately renders `AcceptBlock` only when priced+released or paid
  (`showPaintAccept`, `page.tsx:345`; comment at `:330-336` — "no $99
  checkout exists for painting"). Roofing always offers the $99 refundable
  site-visit accept (`resolveAcceptView` inspection mode,
  `lib/quote/accept.ts:161-172`) minted at `/r/roof/[token]/[tier]` where
  the ONLY valid tier is the literal `'inspection'` (flat fee).
- Painting's mint route `/r/paint/[token]/[tier]` accepts only
  good/better/best (`VALID_PAINT_TIERS`), uses `canTakePayment` and the
  one-payable-session-per-tier pattern.
- Trust-video fallback chain (`lib/quote/tenant-identity.ts`): per-trade
  video → tenant-wide video → QuoteMax stock clip. A missing painting-trade
  row yields the stock clip, not an empty block.
- Painting's five-section trigger cannot be roofing's `confirmed_at` (an SMS
  confirm that painting doesn't have); painting's analogous gates are
  `released_at` (tradie releases prices), `paid`, and
  `routing = 'inspection_required'`.

## Requirements

### R1 — five-section customer view for painting

Rebuild `app/q/paint/[token]/page.tsx`'s primary layout as the numbered
five-section format, mirroring the structure (numbered `Scope` items, section
framing, ordering) of the two reference implementations
(`app/q/roof/[token]/page.tsx:659-938` and the generic branch of
`app/q/[token]/page.tsx`), with painting's own content:

1. **Overview** — greeting, status, headline (existing `QuoteHero` content).
2. **Job details** — painting's existing evidence blocks: `StatGrid`,
   surfaces/scope, property imagery + `RepaintPreviewFigure`, "how we
   measured" notes.
3. **Your tradie** — `TrustVideo` with
   `trustVideoTrack(identity, 'welcome', 'painting')` + tradie photo/intro,
   same framing as the roofing section (roof `page.tsx:772-801`).
4. **Your price** — released/paid: `TierCards` + the existing "How your
   price was built" breakdown + "Materials & time on site".
   Inspection-routed: the site-visit framing instead (see R2) — no tiers.
5. **Book your site visit / your job** — `AcceptBlock` (see R2) or the
   booking link when already paid.

**When the five-section layout renders:** `released` (prices visible) OR
`paid` OR `routing = 'inspection_required'`. A **held-for-review** quote
(priced, not released, not inspection-routed) keeps the CURRENT held view
exactly as it is today (publish-gate reason, no prices, no accept CTA).
Keep roofing's `?full=1` escape hatch to force the long-scroll layout.

Do NOT import roofing-only components or assume roofing-only data
(`RoofMap`, `HouseShowcase`, `RoofLayoutMapFigure`, `StructureBreakdown`,
`confirmed_structure`, `model3d_*`, `layout_plan`). Painting's existing
long-scroll blocks may remain as the `?full=1` / fallback rendering.

### R2 — payable site-visit path for inspection-routed jobs

- Extend `/r/paint/[token]/[tier]` to also accept the literal tier
  `'inspection'`, mirroring the roofing inspection mint: flat $99 refundable
  site-visit deposit, fresh-Session-per-click with the existing
  one-payable-session pattern, `canTakePayment()` gating.
- **Gate**: the inspection tier mints ONLY when the painting row is
  inspection-routed (`routing = 'inspection_required'`). It must NOT be
  reachable for held-for-review priced quotes (that would bypass the
  review-required design) — respond 4xx exactly like an invalid tier.
  The good/better/best handling is byte-for-byte unchanged.
- Paid state must land where the existing book/thanks pages already read it
  (mirror how the roofing inspection payment marks its row / how paint
  deposits confirm via the Stripe webhook + `confirmPaidFromSession`), so
  the existing `/q/paint/[token]/book` → `/thanks` flow works for the visit
  with no page rewrites.
- On the quote page, inspection-routed jobs render `AcceptBlock` in
  inspection mode via the shared `resolveAcceptView` (4th branch,
  `lib/quote/accept.ts:161-172`) with `inspectionHref =
  /r/paint/[token]/inspection` — replacing today's static "we'll be in
  touch" note.
- The book page's unpaid redirect: an inspection-routed, unpaid visitor goes
  to `/r/paint/[token]/inspection` instead of a G/B/B tier (check
  `booking-next.ts` / the book page's `payTier` for where this lands).

### R3 — thanks + book pages: verify-only

No layout work. Verify the thanks page's inspection variant and PDF gating
still behave (`routing !== 'inspection_required'` gates the PDF link) and
that a paid site visit flows book → thanks with `BookedSummary`,
`AddToCalendar`, and the `thankyou` TrustVideo — all already present.

### R4 — constraints (do not break)

- `lib/painting/publish-gate.ts` semantics untouched: no prices, deposit
  links, or PDFs before `released_at`, and `paintingDepositLocked` still
  locks G/B/B mints pre-release. The new inspection tier is exempt from the
  release lock ONLY because it is restricted to inspection-routed rows,
  which are never released.
- `resolveMintDiscount` / `canTakePayment` logic untouched (reuse, don't
  modify). Existing G/B/B mint behaviour byte-identical.
- No changes to roofing / electrical / plumbing / solar pages. Shared-chrome
  edits (if any) must be backward-compatible; prefer none.
- Commercial painting untouched. No 3D pipeline for painting. No new
  dependencies. Currency display stays inc-GST per convention.

## Definition of done

1. `npx tsc --noEmit` clean.
2. Full `npx vitest run` green (existing + new).
3. New unit tests for: the five-section/held/full-escape gate mapping (pure
   helper), the inspection-tier mint gate (inspection-routed only; held rows
   rejected; G/B/B unchanged), and the book-page inspection redirect target.
4. Review pass confirms R1–R4 with file:line evidence, including a check
   that the roofing/electrical/generic pages and shared chrome are unchanged
   (or provably backward-compatible).
