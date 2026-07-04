# UI kit — Marketing / pricing site

The public QuoteMax site: the "command-centre" landing page a tradie lands on before signing up. Dark warm-charcoal canvas, Caterpillar-yellow accent, all-caps display headlines with one or two highlighted words.

## Files
- `index.html` — page shell. Loads `styles.css`, React + Babel + lucide, then `../_shared/kit.jsx` (exposes `window.QMUI`) and `marketing.jsx`. Tagged `@dsCard group="Marketing"`.
- `marketing.jsx` — the whole page, one IIFE composing `window.QMUI`.

## Sections (top → bottom)
1. **Nav** — sticky, blurred; logo, anchor links, theme toggle, sign-in + "Get started".
2. **Hero** — headline "Drafts your **quote** before they **hang up**.", trade duotone tiles, and a live **animated SMS demo** (customer texts → QuoteMax replies → typing → "$890 quote drafted").
3. **Trust strip + Powered by** — pilots, "Runs on Twilio", and the partner logo wall (mono → colour on hover).
4. **How it works** — three `NumberedCard`s on an accent spine.
5. **Trades** — Electrical (NSW) and Plumbing (QLD) panels: what auto-quotes vs what books a `$99` site visit, plus "next in line" trades.
6. **The shift** — usual-vs-QuoteMax comparison rows.
7. **Numbers** — four `Stat`s.
8. **Pricing** — Starter / Pro / Crew, with a Monthly⇄Annual `Segmented` toggle (live price recompute).
9. **FAQ**, **Closing CTA**, **Footer**, and the closing yellow **Marquee**.

## Interactive
- **Theme toggle** — flips `data-theme` dark⇄light (warm-paper) at runtime.
- **Animated SMS demo** — timed reveal on load.
- **Pricing toggle** — Monthly/Annual recomputes every plan's price and savings line.
- Hover states on nav links, cards (accent sweep), partner logos, buttons.

## Composes
`Logo, Nav, Eyebrow, Btn, Badge, StatusPill, Stat, Card, NumberedCard, Segmented, Marquee, Topography, Icon` from `window.QMUI` — all token-driven, so the light theme and any token edit flow through automatically.
