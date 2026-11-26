# Facebook story: hiring, Senior AI Engineer

One 1080x1920 story frame announcing the Senior AI Engineer role, in the locked
QuoteMax identity. It also posts as an Instagram story (same size and safe zones).

| File | What it is |
|---|---|
| `hiring-story.html` | The source. Layout, styles, and the `ROLES` array that holds the copy |
| `render.mjs` | Renders each role to a PNG after a QA pass |
| `img/builder-tablet.jpg` | The photograph (see *Photography*) |
| `logo/quote-max-logo-dark.svg` | The lockup, the same file every other post uses |
| `out/story-senior-ai-engineer.png` | **The file to post.** 1080x1920. Git-ignored, so render it first |

## Before posting: three things the brief did not say

1. **Currency.** The brief gives "$3,000 to $4,500 per month" with no currency,
   so the frame shows `$3,000–$4,500` exactly as supplied. QuoteMax is an
   Australian brand, so most viewers will read `$` as AUD. If the role is
   employed in Australia, note that AUD 3,000 a month is under the full-time
   national minimum wage ($948.00 a week from 1 July 2025, about $4,100 a
   month; check the current figure at fairwork.gov.au). If the role is remote
   or offshore, name the currency and say so. Either way it is one line:
   `pay` in `ROLES`.
2. **How to apply.** No email or job link was supplied, so the frame says
   *Message us to apply*, which points at the "Send message" bar Facebook puts
   under every story. To use an email or a link instead, change `cta` in
   `ROLES`, or keep the frame and add Facebook's Link sticker when posting.
3. **Work type and location.** Full-time or contract, remote or on-site: not
   stated, so not shown. Candidates filter on these first. Add them to the
   lead or as a third figure once known.

## Build

```bash
cd marketing/facebook-story-hiring
node render.mjs               # out/story-senior-ai-engineer.png at 1080x1920
node render.mjs --guides      # also out/_guides-*.png with Facebook's UI zones drawn on
node render.mjs --scale 2     # a 2160x3840 master
```

Playwright resolves from the repo root, the same as the other marketing
renderers. See `redesign/banners/README.md` for the `node_modules` junctions.

**QA.** Before every shot the page checks itself and `render.mjs` refuses to
export a frame that fails. It fails when a line overruns its box, when any
readable block (lockup, title, lead, figures, stack, requirements, button)
leaves the safe area, when plate blocks overlap, when the photo stops covering
its column, or when a font or the photo did not load. `--force` writes the
frame anyway, for inspecting a failure.

## Design

**Frame.** The SPLIT docket from `../linkedin-dockets-b` and
`../linkedin-payment-terms`, stretched to 9:16: type on its own dark ground on
the left, the photograph hard to the right edge, a details plate underneath.
Neither side is dimmed to rescue the other. The pay cell ends exactly where the
photo column starts, so one vertical line runs from the top of the photo down
through the figures.

**Two reading passes.** A photo story is on screen for about five seconds, so
the glance has to land the employer, the role and the pay: lockup, *NOW
HIRING*, the three-line title with *AI* in the accent, and the pay figure. The
stack, the requirements and how to apply are for a viewer who holds the story
to read it.

**Safe zones.** Facebook draws its progress bar, page name and close button
over roughly the top 250px, and the reply bar and reactions over roughly the
bottom 250px. Everything that has to be read sits between y=250 and y=1670.
Only the photograph and the sign-off (`quotemax.com.au`) extend past them.

**Copy.** Australian English, no em dashes, no exclamation marks, no emoji, none
of the banned fluff words. Every product claim is a real one: QuoteMax answers
by SMS and by voice, drafts the quote in under a minute, and serves Australian
tradies. The stack is the brief's list as given, with "AI" set as *AI agents*,
plus TypeScript, the language the QuoteMax app is written in. The four AI chips
take the accent so the role's focus reads at a glance. "5+ years" is one of the
two figures rather than a bullet, so the requirements add three things the
figures do not say.

## Photography

`img/builder-tablet.jpg` is a 1200x2150 copy of
`../linkedin-payment-terms/img/builder-tablet.jpg` (itself
`../linkedin-posts/7-30-26/Builder_holding_tablet_smiling_2K_202607300905.jpeg`).
The source is 1536x2752 and 2.9 MB, and the story shows it about 525px wide, so
the committed copy is resized to 446 KB rather than duplicated at full size.

It comes from the generated 7-30-26 set. The payment-terms set already vetted
this frame as clean, unlike `builder-stage.jpg`, which has a visible generation
artefact. The source is almost exactly 9:16, so the column shows the whole
frame: the builder, his tablet and his hard hat. It is captioned *Who you build
for* so a viewer reads him as the customer, not the job.

## Editing

Everything editable is in the `ROLES` array at the foot of `hiring-story.html`.
Wrap a word in `{curly braces}` to set it in the accent (title) or at full
strength (lead). Adding a role is adding an entry; `render.mjs` counts them from
the source.
