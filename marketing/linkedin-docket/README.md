# QuoteMax LinkedIn, the docket set

15 standalone LinkedIn posts, 1080x1350. A second, independent visual system, built from
scratch and sharing nothing with the earlier `linkedin-2026-07/` set except the brand
itself.

## The idea

A QuoteMax post should look like a QuoteMax **document**. The product makes quotes, so
each graphic borrows a quote's furniture: a header rail carrying the lockup and a
reference code, ruled line items with the value set right, and a signed-off footer band.
That gives the set a structure the photography sits inside, rather than a photograph with
type laid over the top of it.

Seven layouts, chosen per message:

| Layout | What it is | Posts |
|---|---|---|
| `figures` | Hard numbers in a ruled table, values set right | 01, 10, 14 |
| `statement` | One line said plainly, thin photo strip at the foot | 02, 05 |
| `contrast` | The usual struck through on charcoal, the fix on a yellow fill | 03, 04 |
| `sequence` | A real sequence on a spine, photo band beneath | 06, 08 |
| `ledger` | Line items with the answer set right, like a priced quote | 07, 09, 11 |
| `portrait` | Hard vertical split, type left, photo as a column right | 12, 13 |
| `offer` | The close, the only full-bleed frame in the set | 15 |

The `contrast` layout is the one worth pushing. A yellow panel with dark ink against a
struck-through charcoal panel argues the product in a single glance, and it is the only
place in the system where the accent is used as a surface rather than a highlight.

## What is here

| Path | What it is |
|---|---|
| `out/post-01.png` … `post-15.png` | The 15 finished graphics. Post these. |
| `out/_sheet.jpg` | Contact sheet of all 15, for review. |
| `captions.md` | Caption copy, hashtags, run order, per post. |
| `docket.html` | The design system and the content. Edit `POSTS`, re-render. |
| `render.mjs` | Renderer. Serves the folder, screenshots each post. |
| `img/` | 15 photographs, from `quotemate-automation/public/marketing/`. |
| `logo/quote-max-logo-dark.svg` | The lockup, referenced not transcribed. |

## Rendering

```
node render.mjs                     # 15 posts at 1080x1350, 2x, into out/
node render.mjs --scale 1 --sheet   # 1x plus the review contact sheet
node render.mjs --only 3,7          # re-shoot specific posts
node render.mjs --size 1080x1080    # square, or any other output size
```

The post count is read out of `docket.html`, so adding a post to the `POSTS` array is the
only change needed.

## Decisions worth knowing

- **Logo.** Uses `quote-max-logo-dark.svg` as supplied, at 52px high in the header rail.
  It is a complete lockup (mark plus stacked QUOTE/MAX wordmark, bone `#F6F1EA` with the
  gold `#E3C13C` notch), so there is no separate wordmark text beside it. It is served
  from `logo/` rather than inlined, so the graphics track the canonical file.
- **Photography is the app's own.** All 15 photographs come from
  `quotemate-automation/public/marketing/`, one distinct photo per post. Nothing is
  borrowed from the infographics skill's bundled set.
- **Strips need landscape sources.** Posts 02, 05, 06 and 08 put a photo in a 236 to 264px
  band. A portrait source crops to an unreadable sliver there, which is how the first pass
  of 02, 05 and 08 failed. Those four now use the landscape files only.
- **Every post carries a photograph.** The type-led layouts (`figures`, `contrast`,
  `ledger`) sit over a held-back full-bleed backdrop at 22 per cent. First pass had eight
  of fifteen posts with no imagery at all, which is the wrong answer for a trade brand.
- **No testimonials.** There are no consented customer quotes to use, and inventing one is
  a fabricated review. Posts 02 and 05 are attributed to QuoteMax, a position the brand
  can hold, rather than words put in a tradie's mouth.
- **Brand, not the reference images.** The originally supplied references were Maintain
  Technology's navy and orange. `CLAUDE.md` marks that palette as a retired identity that
  must not be reintroduced, so this set is warm charcoal `#16120F` with Caterpillar yellow
  `#FFC400`, per `DESIGN.md` at the repo root.
- **No carousel PDF.** These are 15 standalone feed posts, not a swipeable document. Add
  one only if they are ever meant to be read in sequence.
