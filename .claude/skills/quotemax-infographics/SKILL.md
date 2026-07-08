---
name: quotemax-infographics
description: >-
  Generate QuoteMax-branded infographics and social graphics — LinkedIn carousels, Instagram
  posts, stat cards, testimonial cards, how-it-works graphics, marketing tiles — using the
  QuoteMax design system (warm-charcoal #16120F canvas, one Caterpillar-yellow accent #FFC400,
  Manrope + JetBrains Mono, duotone Australian-tradie photography). Renders on-brand PNGs plus a
  ready-to-post carousel PDF from a small content spec. Use this whenever someone wants a
  QuoteMax-branded graphic, infographic, social post, LinkedIn carousel or tile, Instagram post,
  flyer, or "a post for QuoteMax" — even if they don't name the design system or the format.
  Prefer this over hand-rolling CSS so every graphic shares the same styling, layout, and voice.
user-invocable: true
---

# QuoteMax infographics

Produce QuoteMax-branded social graphics that all share one look. The brand is a warm-charcoal
"command-centre" canvas with a single Caterpillar-yellow accent, heavy all-caps Manrope display,
JetBrains Mono labels, square corners, and duotone tradie photography. A bundled HTML engine
renders the design; you supply the content.

## Step 0 — read the design contract (non-negotiable)

**Read [`references/DESIGN.md`](references/DESIGN.md) first.** It holds the exact colours, type
rules, the duotone treatment, the voice, the pixel sizes, and the absolute bans. Skipping it is
the fastest way to ship something off-brand — the single rule that trips people up is *text on
the yellow fill is dark `#1C1812`, never white*.

## How it works

`assets/generator.html` is a JSON-driven engine. It renders a `SLIDES` array — each entry is one
panel — into full-bleed 1080×1350 graphics with the QuoteMax system baked in (fonts, duotone
photos, scrims, marquee, the accent). You edit the `SLIDES` array; the engine does the styling.
`?slide=N` in the URL renders one panel full-frame (used for export).

## Workflow

1. **Read `references/DESIGN.md`.** Internalise the palette, voice, and bans.
2. **Plan the piece.** Pick the format/size (see DESIGN.md — default is the 1080×1350 LinkedIn
   carousel). Decide how many panels and which *kind* each panel is (below). Write the copy in
   the tradie voice: direct, present-tense, Australian English, honest numbers, **no exclamation
   marks, no em-dashes, no emoji, no invented testimonials**.
3. **Author content.** Copy `assets/generator.html` to a working file (e.g. `qm-post.html`) and
   copy `assets/img/` beside it so photo paths resolve. Edit the `SLIDES` array. (Editing the
   asset in place is fine too if it's writable.)
4. **Render.** Run `node scripts/render.mjs --gen ./qm-post.html` (needs Playwright:
   `npm i playwright && npx playwright install chromium`). It writes `slide-1.png … slide-N.png`
   plus `carousel.pdf` to `./out`. *No Playwright?* Serve the folder and screenshot each
   `qm-post.html?slide=N` with your browser tool at the exact format pixel size.
5. **Review against the bans, then fix and re-render.** Check every panel: text fits inside the
   frame (nothing clipped at the edge), no white-on-yellow, no em-dashes, the testimonial (if
   any) is real or clearly a placeholder. Look at the rendered PNGs — don't trust the code alone.

## The `SLIDES` content spec

Every entry shares: `kind`, optional `eyebrow` (array of mono label parts, first shown in accent),
optional `photo` (`{ src, pos, scrim }` or `null`), optional `bar` (yellow marquee items). In any
text, wrap one or two words in `{curly braces}` to render them in the accent colour.

- **Photos** live in `img/`. `src: 'img/hero-main.jpg'`. `pos` is CSS object-position
  (`'center 28%'`, `'right 20%'`). `scrim` darkens the photo for legible text: `'top'` (dark top
  and bottom, best for stats/CTA), `'left'` (best for a quote), `'faint'` (photo mostly hidden,
  as texture). To add your own photo, drop a JPG in `img/` and reference it — the engine applies
  the duotone automatically.

The five panel kinds — pick the one that fits the message:

| Kind | For | Extra fields |
|---|---|---|
| `stat` | A hook of hard numbers | `lines: [[value, label], …]` (value = accent mono, label = white), `sub`, `proof: [strings]` |
| `list` | A breakdown / "why" in bordered cards | `h` (headline), `cards: [[label, body], …]`, `sub` |
| `steps` | An ordered "how it works" (real sequence) | `h`, `steps: [[number, title, body], …]` |
| `quote` | A client testimonial (must be real) | `quote`, `attrib: [strings]` |
| `cta` | The closing call to action | `h`, `sub`, `btn`, `foot: [strings]` |

**Example panel (stat):**
```js
{ kind: 'stat',
  photo: { src: 'img/hero-main.jpg', pos: 'center 28%', scrim: 'top' },
  eyebrow: ['AI QUOTING', 'BUILT FOR AUSTRALIAN TRADIES'],
  lines: [['<1 MIN', 'QUOTES'], ['24/7', 'ANSWERED'], ['$0', 'COMMISSION']],
  sub: 'A customer texts your number. QuoteMax drafts the {quote} before they hang up.',
  proof: ['ELECTRICAL · NSW', 'PLUMBING · QLD', 'SOLAR + ROOFING ROLLING OUT'],
  bar: ['QUOTEMAX', 'YOU REVIEW, TWEAK, SEND', 'MAINTAIN.COM.AU'] }
```

**Example panel (steps — numbers earn their place because it's a real sequence):**
```js
{ kind: 'steps', photo: null,
  eyebrow: ['HOW IT WORKS'],
  h: 'Three steps. {under a minute}.',
  steps: [
    ['01', 'CUSTOMER TEXTS YOUR NUMBER', 'QuoteMax asks the right questions.'],
    ['02', 'IT DRAFTS THE QUOTE', 'Your pricing book. Good, Better, Best.'],
    ['03', 'YOU REVIEW AND SEND', 'Tweak if you want. Send. Get paid.'] ],
  bar: ['QUOTEMAX', 'YOUR PRICING BOOK, EVERY TIME', 'MAINTAIN.COM.AU'] }
```

A good LinkedIn carousel is usually: `stat` hook → `list` problem → `steps` how-it-works →
`quote` proof → `cta` close. But mix to fit the message; a single graphic can be just one panel.

## The bans (full list + the *why* in DESIGN.md)

These are what make a graphic read as generic or AI-made. If you're about to write one,
restructure instead:
- **White text on the yellow fill** — always dark `#1C1812` on yellow.
- **A second accent colour** — charcoal + yellow only.
- **Side-stripe accent borders** (a thick colour bar on one card edge) — use full hairline borders.
- **Gradient text.**
- **Numbered `01/02/03` markers with no real sequence** — numbers must carry order information.
- **Text that clips at the frame edge** — shorten the copy or the size until it fits.
- **Invented testimonials / fake stats / emoji / exclamation marks / em-dashes.**

## Files

- `references/DESIGN.md` — the full design system (read first).
- `assets/generator.html` — the render engine (edit a copy's `SLIDES` array).
- `assets/img/` — bundled duotone-ready tradie photos.
- `scripts/render.mjs` — serve + screenshot each panel → PNG, and assemble `carousel.pdf`.
