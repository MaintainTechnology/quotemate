# QuoteMax — LinkedIn carousel

A 5-slide LinkedIn carousel (1080×1350, 4:5) built from the QuoteMax design system
(`redesign/DesignSystem`). Post the PNGs as a **document post** (PDF) so LinkedIn renders
them as a swipeable carousel, or post `slide-1-hook.png` on its own as a single graphic.

## Slides
1. `slide-1-hook.png` — stat hook (`<1 MIN` quotes · `24/7` answered · `$0` commission)
2. `slide-2-speed.png` — why speed wins (the job goes to whoever quotes first)
3. `slide-3-steps.png` — how it works (numbered 01/02/03 — a real sequence)
4. `slide-4-testimonial.png` — client quote ⚠ **TEMPLATE ONLY**
5. `slide-5-cta.png` — call to action (Get my QuoteMax)

> ⚠ **Slide 4 is a placeholder.** The quote and attribution (`{name}, {trade} · {region}`)
> are invented. The brand bans fabricated reviews — replace with a **real pilot testimonial**
> (and a real name/trade/region, with consent) before posting, or drop the slide.

## Brand grounding
Warm-charcoal `#16120F`, one accent (Caterpillar yellow `#FFC400`, dark ink `#1C1812` on
yellow — never white), Manrope ALL-CAPS display + JetBrains Mono labels, square corners,
borders-not-shadows, film grain, duotone photography. Australian English, no exclamation
marks, no em-dashes in customer copy, no emoji, honest numbers only.

## Regenerate (edit copy → re-export)
1. Open `generator.html` and edit the `SLIDES` array (headlines, stats, cards, quote, CTA).
   Photos live in `img/`; swap `src`/`pos`/`scrim` per slide. `{curly}` words render in accent.
2. Serve the folder and screenshot each slide at 1080×1350:
   ```
   npx serve .        # or any static server
   # open generator.html?slide=0 … ?slide=4, screenshot each at 1080×1350
   ```
   (In this project the slides were rendered via Playwright at 1080×1350; single-slide mode
   auto-scales the slide to fill the capture viewport.)

## How this maps to Impeccable
Register = **brand**. Built with the Impeccable loop: `craft` the templates from the DS,
`polish`/`typeset`/`layout` to fix overflow + rhythm, the design hook (`impeccable hooks`)
scanned every save. Photographic heroes are real images (duotone-treated), not code —
Impeccable does the layout/type/brand; the photos come from `imageSources`.
