# Painting: $99 site visit is the only customer payment (roofing model)

Date: 2026-08-05
Status: ready to build
Supersedes: the "G/B/B handling byte-for-byte unchanged" clause of
specs/painting-funnel-parity.md — a deliberate product decision by the owner
(2026-08-05): painting follows roofing's flow. Everything else in that spec
(five-section layout, publish gate, webhook wiring) stands.

## Product decision (owner, 2026-08-05)

Painting customers must never be asked for the 30% tier deposit. Like
roofing (and the site-visit path on electrical/plumbing), the single
customer payment is the flat **$99 refundable site visit**, framed as a
site visit — NOT "book your job" — and the booking happens AFTER payment.
G/B/B prices remain visible as pricing information; the final price is
confirmed on site.

## Background — current wiring (verified)

- `app/q/paint/[token]/page.tsx:363-372`: released+unpaid quotes build
  `paintAcceptView` with `depositHref = /r/paint/[token]/<featured tier>`
  → the deposit branch of `resolveAcceptView` (30%). Only
  inspection-routed rows reach the 4th branch (mode `'inspection'`,
  `ctaLabel "Accept & book $99 site visit"`, "credited toward your final
  quote" — `lib/quote/accept.ts:161-172`). `showPaintAccept =
  (showTiers && !!featured) || paid` (:372).
- `TierCards` on the page and the sticky bar link each tier to
  `/r/paint/[token]/[tier]` (30% mint).
- `resolvePaintMintTier(tier, routing)` (lib/painting/pay-redirect.ts)
  admits `'inspection'` only for `routing === 'inspection_required'`;
  `mintPaintSiteVisit` 400s anything else. G/B/B mints still create 30%
  deposit Sessions, gated by `paintingDepositLocked`.
- Book page unpaid redirect: inspection-routed → inspection mint;
  otherwise → a G/B/B tier (`paintPayRedirectTier`).
- The Stripe webhook records `paid_tier` verbatim from metadata — the $99
  session already lands correctly (`recordPaintingDeposit`).

## Requirements

### R1 — the quote page offers only the $99 site visit

For every actionable unpaid quote (released OR inspection-routed):
- `paintAcceptView` resolves to the **inspection mode** of the shared
  `resolveAcceptView` (no `depositHref` passed), with
  `inspectionHref = /r/paint/[token]/inspection` — the exact roofing copy
  ("Accept & book $99 site visit", refundable, credited toward the final
  quote).
- `showPaintAccept` shows the block for released-unpaid,
  inspection-routed-unpaid, and paid states. Held-for-review still shows
  nothing (publish gate).
- Section 05 and the sticky bar frame the CTA as the **site visit**
  ($99), never a tier deposit. Tier prices remain visible in section 04 as
  information; any tier-card CTA either disappears (display-only cards) or
  points at the same `/r/paint/[token]/inspection` — no page surface may
  link a 30% mint.
- The long-scroll (`?full=1`) branch gets the same treatment: its accept
  block and booking links follow the new model; the held view is
  byte-identical to today.

### R2 — the mint routes enforce the policy

- `resolvePaintMintTier` gains the released dimension: the `'inspection'`
  tier is valid when `routing === 'inspection_required'` **OR** the row is
  released (`released_at` set). Held/unreleased rows stay invalid.
- `mintPaintSiteVisit` selects `released_at` and passes it to the gate.
  A held row now gets a **302 to `/q/paint/[token]`** (the quote page
  shows the holding message) instead of a bare 400 — old links must land
  somewhere human. A garbage tier string keeps today's 400.
- **G/B/B tier requests (`/r/paint/[token]/good|better|best`) no longer
  mint deposits**: they 302 to `/r/paint/[token]/inspection`. This keeps
  every previously-texted deposit link working while enforcing the new
  policy. The 30% Session-creation path (`createPaintingCheckoutSessionForTier`)
  stays in the codebase but unreachable from these routes; do not delete it.
  `paintingDepositLocked` becomes moot on this route (the redirect happens
  first) — keep the helper untouched (other callers / tests).
- The $99 session-creation (`createPaintingSiteVisitSession`), webhook,
  and `canTakePayment` gating are already correct — unchanged.

### R3 — book page redirect

`paintPayRedirectTier` simplifies: every unpaid actionable row redirects to
the inspection mint (`/r/paint/[token]/inspection`); the tier query param is
ignored for payment routing. Held rows keep whatever the current behaviour
is when unpaid-and-held hits the book page.

### R4 — customer-facing copy audit (minimal)

Audit `lib/painting/quote-dispatch.ts` / the painting quote SMS + the quote
page for wording that promises a tier **deposit** as the payment ("pay your
deposit", "30%"): update only those strings to the $99 site-visit framing.
Do not rewrite messages wholesale.

### R5 — docs

- Append a `docs/strategy.md` iteration entry recording the decision
  (painting adopts the roofing $99-site-visit-first model; 30% deposits
  retired from the customer surface; old links redirect).
- Update the two stale lines in the repo-root `CLAUDE.md`: the known-debt
  bullet "Painting deposits bypass Stripe Connect" (the $99 visit rides
  Connect like roofing; 30% deposit mints are no longer offered) and any
  painting-funnel wording that implies per-tier deposits.

### R6 — constraints

- Publish gate semantics untouched: held quotes show no payment CTA and
  the inspection mint rejects them (via the friendly 302).
- No changes to roofing/electrical/plumbing/solar pages or mints; no
  shared-chrome behaviour changes for other trades (prop additions must be
  backward-compatible); commercial painting untouched.
- Webhook untouched. No new dependencies.

## Definition of done

1. `npx tsc --noEmit` clean; full `npx vitest run` green.
2. Updated/new unit tests: `resolvePaintMintTier` (released ∨ inspection
   admit; held reject), `paintPayRedirectTier` (always-inspection),
   G/B/B-mint redirect behaviour, and the accept-view mode for
   released-unpaid rows (inspection mode, not deposit).
3. AU-posture suite still green (no new Session creators).
4. Review pass verifies R1–R6 with file:line evidence, including: no page
   surface links a G/B/B mint; old tier links redirect to the $99 mint;
   held rows still pay nothing anywhere.
