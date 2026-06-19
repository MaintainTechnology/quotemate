# QuoteMate Home — Premium Reinvention (2026-06)

Approved direction: keep the **Maintain Technology** brand DNA (deep navy `#0E1622`,
orange `#FF5A1F`, Manrope + JetBrains Mono, all-caps display, square corners,
borders over shadows) and push it to a premium "command-centre" bar through
**craft, not new colours**. This is an elevation, not a rebrand.

## Craft layer (the anti-slop work)

- **Command-centre depth** — a restrained twin radial glow (cool slate-navy + one
  warm ember) at the top of the canvas via `.marketing-canvas`.
- **Film grain** — a fixed `~4.5%` noise overlay (`.noise-overlay`) kills the flat
  banding that makes dark UIs read as cheap.
- **Lit edges** — panels get a 1px inset top highlight (`.edge-lit`). An inner
  highlight, not a drop shadow, so the brand stays shadow-free.
- **Motivated motion only** — load choreography, scroll reveals, an SMS typing
  indicator, and hover micro-interactions. CSS-only; no new motion dependency.

## Sections (home, end-to-end + new premium sections)

1. **Hero** — split: type-led + the live SMS demo (now with a typing indicator and
   a Best-value tier). Disciplined: eyebrow, headline, short sub, one primary + one
   secondary CTA.
2. **Trust strip (NEW)** — honest framing: Built in Australia, NECA / QBCC pilots,
   Stripe-secured, test-phase, and "runs on Twilio, Stripe and Claude". No fake
   logos or reviews.
3. **How it works** — refined numbered timeline with a connecting spine.
4. **Trades & scope** — elevated panels + a "request your trade" path.
5. **The shift (NEW)** — a pain to fix comparison (whoever quotes first wins the job).
6. **Numbers** — refined stat band.
7. **Pricing (NEW)** — honest test-phase framing ($99 locked site visit, $0 platform).
8. **FAQ (NEW)** — two-column Q&A (no accordion).
9. **Closing CTA** + the signature orange marquee.

## Brand-fidelity decisions (where the design skills conflicted with the brand)

- Kept **Manrope + all-caps + square corners + borders-only** (brand wins over the
  generic "ditch Inter / use rounded pills" defaults).
- Removed **every em-dash** from visible copy (a known AI tell).
- **Thinned eyebrows to 3** across the page (the old page stamped one on every
  section — a templated tell) and varied every section's layout family.
- **Honest proof only** and a **typographic hero** (no generated photography), per
  the approved direction.

Files touched: `app/page.tsx`, `app/globals.css`, `app/AuthNav.tsx`.
