# QuoteMax launch deck, 20 slides

A swipeable LinkedIn document post announcing that QuoteMax is publicly live. Read in
order: intro, the problem, how it works, your trade, the numbers, the close, with four
section dividers carrying the reader through.

Upload `out/quotemax-launch-carousel.pdf` as a LinkedIn **document** post. The individual
PNGs are there if you want to break slides out as standalone posts later.

## The signature

The reference posts put big type up top and a glowing wireframe mountain range along the
bottom edge. The plates in `gfx/` are the QuoteMax equivalent of exactly that, so a
wireframe terrain band runs along the foot of every content slide and goes full bleed on
the cover, the four dividers and the close. That band, plus the slide counter and the
yellow progress tick, is what makes 20 slides read as one deck rather than 20 posts.

## Structure

| Slides | Part | What it does |
|---|---|---|
| 01 to 03 | Intro | Cover and launch announcement, what it is, who it is for |
| 04 to 06 | 01 · The problem | Quoting is the bottleneck, speed decides it, the unpaid second job |
| 07 to 11 | 02 · How it works | The three-step loop, the intake, whose prices, quote to booked |
| 12 to 14 | 03 · Your trade | Eight trades, eight rate cards, a worked roofing example |
| 15 to 20 | 04 · The numbers | Pricing, what you get, fair questions, getting started, the close |

Eight layouts: `cover`, `section`, `bigtype`, `photo`, `grid`, `steps`, `stats`, `close`.

## What is here

| Path | What it is |
|---|---|
| `out/quotemax-launch-carousel.pdf` | The deliverable. 1x, about 21MB, ready to post. |
| `out/slide-01.png` … `slide-20.png` | 2x masters, 2160x2700. |
| `out/_sheet.jpg` | Contact sheet of all 20, for review. |
| `launch.html` | The design system and the content. Edit `SLIDES`, re-render. |
| `render.mjs` | Renderer. PNGs plus the PDF. |
| `sheet.mjs` | Contact sheet for `gfx/` or `img/`, to pick crops by looking. |
| `gfx/` | 15 wireframe terrain plates from `redesign/DesignSystem/assets/graphics`. |
| `img/` | 15 photographs from `quotemate-automation/public/marketing/`. |
| `logo/quote-max-logo-dark.svg` | The lockup, referenced not transcribed. |

## Rendering

```
node render.mjs                     # 20 slides at 2x + the carousel PDF
node render.mjs --scale 1 --sheet   # 1x plus the review contact sheet, no PDF
node render.mjs --only 1,4,20       # re-shoot specific slides
```

The PDF is built at whatever `--scale` you pass. A 2x PDF is about 74MB, which LinkedIn
accepts but renders slowly, so the shipped one is 1x. To rebuild that pairing: run
`--scale 1` for the lean PDF, then `--no-pdf` at 2x to restore the master PNGs.

## Figma

https://www.figma.com/design/5wk847w3KXLCQdWSTgCntx

- **Launch deck · 20 slides** — all 20 as editable frames, one section
- **Docket set · 15 posts** — the standalone set, same treatment
- **Assets** — the 12 plates, 15 photographs and the lockup component, uploaded

Every frame is real design, not a flattened export: image fills carry a computed CROP
transform matching the CSS `object-position`, scrims are gradient fills, all type is live
Manrope and JetBrains Mono, and colour is bound to the 12-token `QuoteMax Brand` variable
collection. The lockup is a shared component, so replacing it once updates all 35 frames.

## Photography, and why none of it is AI generated

The brief asked for images generated with the Gemini key. It is still returning
`429 "Your prepayment credits are depleted"` on every model, including a plain text call,
so this is billing and not the request. Replicate, which reaches the same
`gemini-3-pro-image` model through a different meter, returns `402 "Insufficient credit"`.
No other image provider is configured in `.env.local`.

The set therefore uses the 15 wireframe plates that were already in
`redesign/DesignSystem/assets/graphics` plus the app's own 15 marketing photographs. Top
up either account and `../linkedin-docket/../linkedin-2026-07/gen-photos.mjs` style
generation can be re-run; the twelve art-directed prompts still exist in git history.

## Decisions worth knowing

- **Photography is now light, not crushed.** The earlier duotone stacked grayscale .48,
  brightness .82 and a 40 per cent charcoal multiply, and those compound: the tradie became
  a silhouette. Both sets now use a gentle desaturation plus the warm accent pass, and the
  contrast for overlaid type is bought by each layout's own scrim instead.
- **One white plate is unused.** `terrain-yellow` is the only white-ground graphic in the
  folder; in a 430px band it rendered as a cream slab and broke the charcoal canvas.
  `wire-abstract` is also avoided in bands because its white polygon shards read as
  off-palette flecks next to the yellow.
- **`wire-site-a` and `wire-site-b` are byte-identical.** Two exports of the same frame.
  Figma dedupes them to one image hash.
- **No testimonials.** No consented customer quotes exist, and inventing one is a
  fabricated review. Nothing in either set is attributed to a named tradie.
