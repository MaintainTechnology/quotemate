# LinkedIn post: payment terms and deposit-first, refs 66 to 71

A stats-led post arguing that construction's late-payment problem is structural
rather than economic, and that QuoteMax inverts the sequence. Six graphics; the
post itself carries two of them.

Built as a new set. The `quotemax-infographics` skill was not used.

## The two post images

| Slot | File | Ref | Layout |
|---|---|---|---|
| Image 1, the keys and lock | `out/post-66.png` | QM-2607-66 | hero |
| Image 2, the tradie | `out/post-67.png` | QM-2607-67 | split |

Caption, first comment, and the LinkedIn display caveat are in
[caption.md](caption.md). Read the display section before posting: a two-image
post centre-crops both tiles in the feed, which clips the claim line on image
one. `out/quotemax-deposit-first-2pp.pdf` is the same two images as a document
post, where nothing is cropped.

## Build

```bash
node render.mjs                        # 6 graphics, 1080x1350 at 2x, into out/
node render.mjs --scale 1 --sheet      # 1x plus out/_sheet.jpg to review crops
node render.mjs --only 1,2             # re-shoot just the two post images
node render.mjs --only 1,2 --scale 1 --pdf   # the two-page document
```

`payment-terms.html` holds the whole set: two layout frames, six content
entries in the `D` array at the bottom. Adding a graphic means adding one entry.
`render.mjs` counts them from the source, so nothing else needs editing.

## Design

Two frames only, because six graphics posted one at a time need family
resemblance more than they need novelty.

**HERO** puts the photograph full bleed at the top and the argument on a solid
plate below it. The figure is the hero of this post and a number on its own dark
ground survives a thumbnail; a number over a workshop does not. The photo sinks
its last 150px into the plate so the cut reads as one composition. The rail gets
a scrim because the lockup sits on the photograph.

**SPLIT** is the docket frame from `../linkedin-dockets-b`: type on one side on
its own dark ground, photo hard to the other edge. Neither side has to be dimmed
to make the other legible. Four content blocks are defined for the type column
(`steps`, `stat`, `versus`, `pitch`).

Brand is the locked identity from `DESIGN.md` at the repo root: canvas `#16120F`,
one accent `#FFC400`, dark ink `#1C1812` on every yellow fill, Manrope 800
all-caps display, JetBrains Mono for labels and figures, square corners,
hairlines instead of shadows, film grain. Australian English, no em dashes, no
exclamation marks, no emoji.

## The numbers are not ours

Every figure on these graphics is a published third-party statistic, attributed
on the graphic itself, in the words it was given in:

- **24 days**, average time an Australian small business waits to be paid, the
  fastest since tracking began in 2017. Xero Small Business Insights.
- **92%** of construction firms with an overdue invoice in the last 12 months,
  **39%** past 30 days, the highest late-payment rate of any industry.
  CreditorWatch.

QuoteMax claims nothing about them beyond quoting them. If either source
publishes a revision, these graphics have to change with it.

The product claims are real: three options per quote, the tradie's own rate
book, deposit before the calendar opens, domestic jobs only for this sequence.
No testimonials anywhere, because there are no consented ones to quote.

## Photography

Six frames from `../linkedin-posts/7-30-26`, copied into `img/` under readable
names.

| File | Source | Used by |
|---|---|---|
| `padlock-calendar.jpg` | `Brass_padlock_..._0912 (1)` | 66 |
| `padlock-diary.jpg` | `Brass_padlock_..._0911` | 68 |
| `padlock-wall.jpg` | `Brass_padlock_..._0912` | 69 |
| `builder-tablet.jpg` | `Builder_..._0905` | 67, 71 |
| `builder-plans.jpg` | `Builder_..._0906 (1)` | 70 |
| `builder-stage.jpg` | `Builder_..._0906 (2)` | none, see below |

`padlock-calendar.jpg` leads because it carries "JOB #114" and "DUE FRI 25" in
handwriting under a closed lock, which is the post's argument as a photograph
rather than a metaphor for it.

**`builder-stage.jpg` is deliberately unused.** The source frame composites a
second tablet across the subject's hip at an impossible angle. It is obvious once
you look for it, and a public post is the wrong place to ship a visible
generation artefact. 70 uses `builder-plans.jpg` instead and 71 reuses
`builder-tablet.jpg`, which is safe because those two post weeks apart.

All six sources are 1536x2752. Nothing new was generated: image generation is
still blocked on billing (Gemini returns 429 on every model including plain text,
Replicate returns 402).

## Figma

File `5wk847w3KXLCQdWSTgCntx`, page **Post · payment terms (66 to 71)**.

Six editable frames at 1080x1350, built natively rather than as flat exports:
real text nodes, auto-layout, the six photographs as cropped image fills, and
instances of the existing `QuoteMax / lockup (dark)` component (`11:80`).

| Ref | Node |
|---|---|
| 66 | `44:3` |
| 67 | `45:10` |
| 68 | `45:54` |
| 69 | `44:24` |
| 70 | `46:18` |
| 71 | `46:62` |

Two things the CSS does that the Figma build does not: the film grain overlay and
the two background radial gradients. Both are render-time texture worth six heavy
layers per frame in a PNG and not worth it in an editable file. The PNG masters in
`out/` carry them.

Notes for anyone editing these frames:

- Photo crops replicate `object-fit: cover` plus `object-position` as a CROP
  matrix computed from the real column size, not an assumed one. For a
  540x1104 column against a 1536x2752 source that is
  `[[0.87636, 0, 0.06182], [0, 1, 0]]`.
- Figma has no `word-spacing`, so `24 DAYS` gets negative letter-spacing on the
  space character alone. Without it the mono space reads as a double gap.
- A TEXT child of an auto-layout frame hugs its content by default. The hero
  claim overflowed the frame until it was set to `FILL`.
- `query()` attribute selectors silently match nothing when the value contains a
  space. `FRAME[name=DEPOSIT FIRST]` returns empty; use `findOne` with a
  predicate.
