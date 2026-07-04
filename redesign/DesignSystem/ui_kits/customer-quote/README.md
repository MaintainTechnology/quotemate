# UI kit — Customer quote page

The mobile-first public page a customer opens from the SMS link QuoteMax sends ("Your quote from Hartley Electrical →"). No login, no app. Read it, pick a tier, pay the deposit, done. Design width is a phone (430px frame; the page is `max-width: 430px`, centred, hairline-bordered on larger screens).

Same business and job as the dashboard and SMS demo — **Hartley Electrical** quoting **Sarah Whitlam's** 6 lounge downlights — so the three surfaces tell one coherent story.

## Files
- `index.html` — shell. Loads `styles.css`, React + Babel + lucide, `../_shared/kit.jsx`, then `quote.jsx`. Tagged `@dsCard group="Customer quote" viewport="430x920"`.
- `quote.jsx` — one IIFE composing `window.QMUI`. All copy + tier data lives at the top (`BIZ`, `QUOTE`, `TIERS`, `SCOPE`, `ASSUMPTIONS`).

## Sections (top → bottom)
1. **Letterhead** — the tradie's identity (mark, business name, licence) + a tap-to-call button. This is *their* quote, QuoteMax is just the rails.
2. **Quote header** — `Quote QM-1043`, an `Awaiting you` `StatusPill`, an ALL-CAPS headline over the topographic overlay, a plain-English intro, and issued/valid `Badge`s.
3. **Scope of works** — three `NumberedSection`s (`01` the job, `02` included on every option, `03` timing & access).
4. **Good / Better / Best** — three `TierCard`s with per-tier price (inc GST), 30% deposit amount, and a `Pay $NN deposit` CTA. **Better** is recommended.
5. **Good to know** — assumptions / the honest bit (no surprises on the invoice).
6. **Compliance footer** — licence, ABN, insurance, terms; "Quote prepared by QuoteMax" lockup.
7. **Yellow marquee** — the brand's closing punctuation.

## Interactive
- **Pay a deposit** on any tier → that tier flips to a `Deposit paid` state, the others dim and lock (`Confirm to unlock`), and a booked-confirmation note appears. One booking per quote — picking a tier is the conversion.
- **Tap-to-call** and **valid-until** are real affordances; everything else is presentational.

## Composes
`Eyebrow, Btn, Badge, StatusPill, TierCard, Marquee, Topography, Icon, aud` from `window.QMUI`, plus page-local `Letterhead`, `QuoteHead`, `NumberedSection`, `Assumptions`, `Footer`.

## Notes
- **30% deposit** throughout (matches the dashboard's review panel and the `TierCard` default, and the live app's hardcoded `deposit_pct: 30`). Deposit comes off the final invoice. (GST is a separate 10%.)
- Australian English and restrained punctuation: "G'day", "inc GST", CCEW certificate, no exclamation marks, middot separators. No em-dashes in the customer-visible strings.
