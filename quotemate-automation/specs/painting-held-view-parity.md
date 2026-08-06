# Painting: the held-for-review quote page gets the five-section view

Date: 2026-08-06
Status: ready to build
Amends: specs/painting-funnel-parity.md R1 (the held-view carve-out)

## The defect

Painting is review-required, so the page the customer lands on **from the
quote SMS** is almost always the HELD state (priced, `released_at` null).
`paintQuoteViewMode` returns `'long'` for that state
(`lib/painting/quote-view.ts`), and the long-scroll branch
(`app/q/paint/[token]/page.tsx:997+`) has **no `TrustVideo`** — the tradie
video renders only at `:812`, inside the `viewMode === 'five'` block
(`:687`).

Net effect: every painting customer's first (and, until the tradie presses
Send, only) view of their quote is the old-format page with no tradie
video — the exact symptom reported. The funnel-parity spec deliberately
froze the held view to protect the publish gate; that protected prices but
also withheld the trust content, which has nothing to do with prices.

The thanks page is NOT affected — it renders `TrustVideo` unconditionally
(`thanks/page.tsx:181`) — but it is unreachable until after payment.

## Requirements

### R1 — held quotes render the five-section layout

`paintQuoteViewMode` returns `'five'` for the held state as well, so the
layout is: **01 Overview · 02 Job details · 03 Your tradie · 04 Your price
· 05 Next steps**. `?full=1` still forces the long-scroll view for every
state (unchanged escape hatch).

The long-scroll branch is retained for `?full=1` only.

### R2 — the publish gate is fully preserved in the held five-section view

With `released=false`, `paid=false`, `inspection=false`:
- **03 Your tradie** — renders normally: `TrustVideo`
  (`trustVideoTrack(identity, 'welcome', 'painting')`) + `TradiePhoto` +
  blurb. This is the fix.
- **04 Your price** — renders the publish-gate holding message
  (`priceGate.reason`) **instead of** `TierCards`. No prices, no tier
  figures, no deposit or site-visit CTA, no PDF link. Byte-equivalent
  content to today's held `SheetSection`.
- **05 Next steps** — "your painter is finalising this / we'll text you
  the moment it's ready" framing. **No booking CTA and no payment CTA** —
  a held quote is not payable (`resolvePaintMintTier` already 302s a held
  row back to this page; nothing here may invite that).
- **02 Job details** — the existing evidence blocks (StatGrid, surfaces,
  imagery + `RepaintPreviewFigure`, "how we measured") render as they do
  today in the held view. They contain no pricing.
- `showPaintAccept` must remain **false** for held rows — no `AcceptBlock`.
- The sticky bar must remain absent for held rows.

### R3 — no regression to the other states

Released, paid, and inspection-routed rows render exactly as they do today
(this change only moves the held state from `'long'` to `'five'`).

### R4 — constraints

- `lib/painting/publish-gate.ts` untouched; `canShowPaintingPrices` and
  `paintingDepositLocked` semantics unchanged.
- No money-path changes: no mint, checkout, webhook, or `/r/paint/*` edits.
- No changes to roofing / electrical / plumbing / solar / commercial
  painting, and no shared-chrome behaviour changes.
- No new dependencies.

## Definition of done

1. `npx tsc --noEmit` clean; full `npx vitest run` green.
2. `lib/painting/quote-view.test.ts` updated: held → `'five'`; `?full=1`
   → `'long'` for every state; released/paid/inspection unchanged.
3. A test (or explicit review evidence) proving the held five-section view
   renders **no** price figure, **no** payment CTA, **no** PDF link, and
   **does** render the tradie video.
4. Review confirms R1–R4 with file:line evidence.
