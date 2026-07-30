# QuoteMax video-call backgrounds

Four backgrounds for client and tradie onboarding calls. 1920x1080, 16:9, which
is what Zoom, Teams and Google Meet all want.

## Which one to use

| File | Use it for |
|---|---|
| `out/quotemax-01-studio-dark.png` | **The default.** Client meetings. A lit wall, the lockup, the URL, nothing competing with your face. |
| `out/quotemax-02-studio-mid.png` | Same design, lighter. **Use this one if your room is dim** or your webcam is noisy. |
| `out/quotemax-03-site-office.png` | Wireframe terrain in the margins. A bit more character without becoming busy. |
| `out/quotemax-04-onboarding.png` | Onboarding a tradie. Carries three real product facts in the left column, where they can read them while you talk. |

If you only take one, take 01. If you and your boss are both on the call, take a
different one each so the two tiles do not look like a duplicate.

`out/quotemax-01-studio-dark-GUIDES.png` is not for use. It is the same
background with the safe zones drawn on, so you can see why the middle is empty.

## Installing it

**Zoom** Settings → Background & Effects → hover the thumbnails → **+** → Add
Image. Tick "I have a green screen" only if you actually do.

**Teams** In a call: More → Video effects and settings → Backgrounds → **+ Add
new**.

**Google Meet** In a call: bottom-right **Apply visual effects** → **+** under
Backgrounds.

## Two things that will look like faults and are not

**You will see the logo backwards.** Zoom's "Mirror my video" is on by default
and flips your self-view only. Everyone else sees it the right way round. Do not
flip the file to fix it, or it will be correct for you and backwards for them.

**The middle looks empty.** That is deliberate. You are the middle. Load the
`-GUIDES` file into Zoom once and you will see the red box your head and
shoulders fill.

## Getting a clean result on the call

- **Sit centre and fairly close.** The design assumes head-and-shoulders filling
  roughly the middle third. Sit far left and you will cover the lockup.
- **Light your face from the front,** ideally a window or lamp behind your
  screen. Without a green screen, Zoom's cutout is only as good as the contrast
  between you and your real wall.
- **A plain real wall behind you beats a busy one.** Bookshelves and doorways
  are what produce the flickering halo around hair.
- **Use 02 if your room is dim.** A dark background plus a dark room is what
  makes someone look like a floating head.

## How it is built, and why

A virtual background is not a poster. Someone is standing in the middle of it,
and most of what makes a poster good makes a video background bad. Three rules
drove every decision:

**The centre is not yours.** A webcam head-and-shoulders frame fills roughly
x 600-1320, from y 90 to the bottom edge. All four backgrounds keep that empty.
Brand furniture lives in the left column (x 96-560) and the right margin
(x 1360-1824) only.

**Whatever sits behind the head must be plain.** Zoom's segmentation cuts a
soft, slightly wrong edge around hair and shoulders. Against busy or
high-contrast pixels that edge is obvious; against even mid-tone it disappears.
So on 03 and 04 the texture is masked **out** of the centre entirely, with a
horizontal mask that matches the keep-clear band rather than a radial one.

**It needs real tonal range.** The first build ran from `#1E1813` to `#16120F`,
about three values apart, and looked like an unfinished black rectangle. This one
lights a pool behind the subject at roughly `#4A4137` and falls to `#16120F` in
the corners, which is the range a real lit wall has. Built back to front: base
tone, one broad warm pool where you stand, darkened wings on the outer 560px with
an inner hairline so it reads as a panelled wall, floor falloff across the bottom
third, then texture, then grain.

**Zoom's own name label sits bottom-LEFT** of the tile, so the URL sits
bottom-right. Nothing important goes in the bottom-left corner.

Everything is on-palette from `DESIGN.md` at the repo root: canvas `#16120F`,
surface `#1E1813`, card `#2B2422`, hairline `#3A322C`, edge-glow `#6E6354` as
the light, one accent `#FFC400`. The only non-palette values in the source are
the `#000` alpha stencils in the mask (a mask reads alpha only, the hue never
renders) and the deliberately ugly red and blue of the review overlay, which is
`display:none` and never exported.

Every figure on 04 is real: under a minute to draft a quote, $0 commission,
eight trades live.

## Rebuilding

```bash
node render.mjs                 # 4 backgrounds at 1920x1080
node render.mjs --guides        # same, with the safe-zone overlay drawn on
node render.mjs --scale 2       # 3840x2160, if you ever want 4K
node render.mjs --only 1        # re-shoot one
```

`background.html` holds all four in the `V` array at the bottom. To change the
tagline, the URL sub-line or the three facts, edit that array; the renderer
counts the variants from the source so nothing else needs touching.

Photography plates come from `redesign/DesignSystem/assets/graphics`, copied into
`img/` under readable names. They are 2752x1536, so at 1920x1080 they crop by
0.8%, which is why they can be used without any repositioning.
