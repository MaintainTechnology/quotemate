# QuoteMax — Design System (infographics)

The visual system for QuoteMax-branded infographics and social graphics. Self-contained:
everything a graphic needs is here. QuoteMax is an AI quoting assistant for Australian
tradies — a customer texts the tradie's number, QuoteMax asks the right questions and drafts
a Good/Better/Best quote in under a minute.

## The brand in one breath

Warm-charcoal "command-centre" canvas (`#16120F`), **one** accent only — Caterpillar
yellow (`#FFC400`, **dark text on yellow, never white**). Manrope for ALL-CAPS display +
body, JetBrains Mono for eyebrows/prices/metadata. Square corners (radius 0), borders not
shadows, depth from lit edges + film grain. Numbered cards and a yellow marquee bar are
signatures. Voice: a licensed Aussie tradie who respects your time — direct, present-tense,
Australian English, no exclamation marks, no em-dashes, no emoji, no marketing fluff.

## Colour

Use the exact values. The whole system is charcoal + one yellow; there is no second accent.

| Token | Hex | Use |
|---|---|---|
| Canvas | `#16120F` | The primary background of every graphic (warm near-black, not blue-black). |
| Surface | `#1E1813` | Secondary panels. |
| Card | `#2B2422` | Cards / boxes lift to this over the canvas. |
| Hairline | `#3A322C` | 1px borders — the structural unit. |
| **Accent** | `#FFC400` | The ONE signal. Fills: buttons, big numbers, one highlighted word per headline, the marquee bar, the logo tile. |
| Accent press | `#E6AC00` | Pressed/darker accent. |
| **Accent ink** | `#1C1812` | Text/icons **on** a yellow fill. **Never white on yellow** (white-on-yellow ≈ 1.6:1, fails WCAG). |
| Text primary | `#F6F1EA` | Headlines, body on dark. |
| Text secondary | `#C3B8AC` | Sub-copy. |
| Text dim | `#A2968A` | Metadata, mono labels. |
| Edge glow | `#6E6354` | Warm grey ridge lines (a neutral, not an accent). |
| State (used sparingly) | success `#15803D` · warning `#B45309` (`#F59E0B` for text on dark) · danger `#B91C1C` | A small chip or rule, never a large fill. |

**The single most important rule:** on a yellow fill, text is `#1C1812`. Highlighted words
inside a dark headline are `#FFC400`. Everywhere else, text is the cream ramp on charcoal.

## Typography

- **Manrope** (400–800) for display and body. **JetBrains Mono** (400–700) for eyebrows,
  tags, prices, and metadata. Load both from Google Fonts; do not substitute.
- **Display = ALL CAPS, weight 800, tight tracking (~-0.035em), line-height ~1.0**,
  left-aligned. The accent highlights one or two key words per headline, no more.
- **Mono labels = UPPERCASE, wide tracking (0.12–0.18em), small (~12–19px), dim.** Eyebrows,
  KPI labels, "QUOTE REF", the marquee.
- **Body = Manrope, sentence case, line-height ~1.3.** Calm, readable, never shouty.
  Prices and tabular figures use mono.
- Minimum sizes: display 24px+; mono labels 12px floor; body ≥16px. On a 1080-wide
  graphic the hero numbers sit around 90px; headlines 80–92px.

## Texture, borders, depth

- **No flat hero fills.** The canvas carries a restrained twin radial glow — a cool
  warm-charcoal lift top-left and one warm yellow ember top-right.
- **Film grain** (~4–5% fractal noise, soft-light) over dark surfaces kills banding.
- **Square corners.** Radius `0` on cards, panels, buttons. The only round things are
  status dots and avatar discs.
- **Borders, not shadows.** A 1px warm hairline (`#3A322C`) is the structural unit; cards
  are card-colour + hairline. Depth comes from a 1px inner top highlight (a lit edge), not a
  cast shadow.
- **Numbered cards** are a signature: a large mono number (`01`, `02`) in accent beside the
  title — but only when the order genuinely carries meaning (a real sequence).

## Photography — duotone

Photos are **duotone-treated** so stock trade shots read as native to the palette:
desaturate + warm, a warm-charcoal **multiply** scrim tints the shadows to the canvas, and a
soft-light pass lifts highlights toward the accent. Then a directional gradient **scrim**
sits over the photo so text stays legible (AA). Warm, friendly, real Australian tradies —
never cold stock. The bundled `assets/img/` photos already suit this; the generator applies
the duotone in CSS. To add your own, drop a JPG in `assets/img/` and reference it.

## Motion

Only relevant if you build an animated/interactive piece (static PNGs need none): motivated
motion only, expo-out easing `cubic-bezier(0.22, 1, 0.36, 1)` over ~640ms for reveals. No
bounce. `prefers-reduced-motion` collapses everything to instant.

## Voice & content rules

The copy is as much the brand as the colour. A licensed Australian tradie who respects your
time — direct, plain, a little dry. Never a Silicon Valley marketer.

- **Australian English, always** — colour, organise, licence (noun) / license (verb),
  "tradie", "sparky", "on the tools". Currency AUD, no decimals on whole dollars (`$890`,
  `$49/mo`); GST is "inc GST" / "ex-GST".
- **Casing:** display headlines ALL CAPS; eyebrows/labels UPPERCASE mono; body sentence case.
- **No exclamation marks. No em-dashes in customer-visible copy** (a known AI tell — use a
  full stop, a comma, or a middot `·`). Middots separate metadata; `→` and `›` mark forward
  motion and list items.
- **No marketing fluff.** Banned: "leverage", "synergy", "unlock", "seamless",
  "revolutionary", "supercharge", "game-changing".
- **Honest proof only.** No fabricated stats, fake logos, or **invented reviews/testimonials**
  — a real quote with consent, or a clearly-marked placeholder. Real, defensible numbers do
  the talking: `< 1 MIN`, `24/7`, `$0 commission`, `$99 site visit`.
- **Emoji: none. Ever.** "Icons" are line glyphs or mono characters (`→ › ○ ★ ·`).

## Absolute bans (match and refuse)

These are the tells that make a graphic read as generic or AI-made. If you're about to write
one, restructure instead.

- **White text on the yellow fill.** Always `#1C1812` on yellow.
- **Side-stripe accent borders** — a thick coloured bar on one side of a card. Use full
  hairline borders instead.
- **Gradient text** (`background-clip:text`). Emphasis via weight, size, or the accent colour
  — one solid colour.
- **Decorative glassmorphism / blur.** Rare and purposeful, or nothing.
- **Numbered `01/02/03` markers where there is no real sequence.** Numbers earn their place
  only when the order carries information.
- **Text that overflows or clips at the frame edge.** Test every headline at the target size;
  shorten copy or reduce the size until it fits with margin.
- **A second accent colour.** Charcoal + yellow only.

## Formats (pixel sizes)

Render at the exact pixel size for the channel:

| Format | Size | Use |
|---|---|---|
| LinkedIn carousel | 1080 × 1350 (4:5) | Swipeable document post (combine slides into one PDF). |
| LinkedIn / FB single | 1200 × 627 | Single share image. |
| Instagram post | 1080 × 1080 | Square. |
| Instagram / FB story | 1080 × 1920 | Full-screen vertical. |
| Flyer A4 | 2480 × 3508 | Print (300 dpi). |
| Deck slide | 1920 × 1080 | 16:9. |

The bundled generator is tuned for the 1080 × 1350 carousel; other sizes render but the type
scale is best re-tuned per size (larger canvases want larger type).
