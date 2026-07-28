# QuoteMax docket set B, posts 31 to 60

Thirty more standalone LinkedIn posts, 1080x1350, in the same split-docket layout as set
A. Reference codes continue the series (`QM-2607-31` to `QM-2607-60`) so a graphic from
either batch is unambiguous when someone asks which one to repost.

## What is different from set A

Set A covered the fundamentals: the offer, the speed argument, the three-step loop,
pricing, the trade list, the standard objections. **None of it is repeated.** Zero
headline overlap, checked mechanically. Set B goes into five areas set A never touched:

| Area | Posts | What it argues |
|---|---|---|
| **Per trade** | 31 to 38 | What auto-quotes and what books a visit, trade by trade, including the review gate on painting and plan-reading on aircon |
| **The business** | 39 to 45 | The owner's problems rather than the tradesman's: the two-van paperwork jump, the Monday backlog, first impressions, cash flow |
| **The guardrails** | 46 to 50 | How the model is actually constrained: it cannot round up, it stops when unsure, the per-trade review gate, whose data it is, how it learns your edits |
| **The hard nos** | 51 to 55 | The objections said out loud: too custom, do not trust AI, my customers prefer to talk, I already use a job book, I am too small |
| **The stance** | 56 to 60 | Who built it, what we will never do, where it is up to, refer a mate, the close |

Posts 51 to 55 are the ones worth boosting. Naming an objection in the headline and
answering it in four lines outperforms another feature post, and those five are the
objections that actually get typed into comments.

## Layout

Identical to set A, which is the point. Rail with lockup and reference code, hairline
under it, hard vertical split at x=540, photo column butted to the frame edge running
full height, yellow sign-off band in dark ink. The tradie is never dimmed to make the
words legible.

Five content blocks in the left column: `pitch` (13), `list` (8), `stat` (3), `steps` (3),
`quote` (5). Eighteen put the photo right, twelve flip it.

## What is here

| Path | What it is |
|---|---|
| `out/docket-01.png` … `docket-30.png` | The 30 graphics at 2160x2700. File numbering is sequential within this batch; the printed reference code on each is 31 to 60. |
| `out/_sheet.jpg` | Contact sheet of all 30. |
| `dockets-b.html` | The design system and the content. Edit `D`, re-render. |
| `_content.js` | The content array on its own, if you want to diff it against set A. |
| `render.mjs`, `sheet.mjs` | Renderer and photo contact sheet. |
| `img/` | 26 photographs from `redesign/DesignSystem/assets/photos`. |
| `logo/quote-max-logo-dark.svg` | The lockup, referenced not transcribed. |

```
node render.mjs                     # 30 at 2x into out/
node render.mjs --scale 1 --sheet   # 1x plus the review sheet
node render.mjs --only 3,17         # re-shoot specific dockets
```

## Figma

https://www.figma.com/design/5wk847w3KXLCQdWSTgCntx → **Docket set B · 30 posts (31-60)**

All 30 as editable frames in one section. Photo fills carry a computed CROP transform
matching the CSS, type is live Manrope and JetBrains Mono, colour binds to the
`QuoteMax Brand` variable collection, and the lockup is the same shared component the
other four pages use.

## Photography

Set B leads with the five frames set A never used (`trade-painting`, `workshop`,
`home-on-the-tools`, `trade-carpentry`, `trade-solar`) and redistributes the other
twenty one against different posts and crops, so the two batches do not read as the same
set twice. Twenty six distinct photos across the sixty posts.

One thing worth knowing: the legacy filenames in `assets/photos` (`trade-electrical.jpg`
and friends) are **not** the same bytes as the identically named files in
`quotemate-automation/public/marketing`. Reusing an image hash across the two folders
silently swaps the photo, so the five new ones were uploaded fresh rather than assumed.

## Accuracy

Every figure is a real product fact: under a minute, 24/7, $0 commission, $99 site visit
credited back, from $49/mo, 14-day trial on Starter Monthly, about three minutes to set
up, eight live trades, SMS and voice and web, Good / Better / Best, per-trade review
gates, tradie edit patterns surfaced for approval. Nothing invented. No testimonials,
because there are no consented ones to quote. Copy passes the ban list clean: zero em
dashes, exclamation marks, emoji or fluff words, dark ink on every yellow fill.

Posts 31 to 38 name real trade behaviour, including that painting is review-required and
solar auto-releases only clean estimates. If those gates change in the product, these
four posts are the ones to revisit.
