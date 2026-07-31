# QuoteMax video-call backgrounds

Seven backgrounds for client and tradie onboarding calls, in dark and light.
1920x1080, 16:9, which is what Zoom, Teams and Google Meet all want.

## Which one to use

Four dark, three light. Same design, same identity. Pick by your room.

| File | Use it for |
|---|---|
| `out/quotemax-01-studio-dark.png` | **The dark default.** Client meetings. A lit wall and nothing competing with your face. |
| `out/quotemax-02-studio-dark-lighter.png` | Same, one step lighter. Use if your room is dim. |
| `out/quotemax-03-mountains-dark.png` | The wireframe peaks, sharp enough to actually read. The most distinctive of the seven. |
| `out/quotemax-04-onboarding-dark.png` | Onboarding a tradie. Three real product facts in the left column. |
| `out/quotemax-05-studio-light.png` | **The light default.** Bone wall, warm falloff into the corners. |
| `out/quotemax-06-mountains-light.png` | The same peaks on bone, as warm grey lines rather than gold ones. |
| `out/quotemax-07-onboarding-light.png` | The facts panel, light. |

There is no light version of 02. It exists only to lift a dark wall for a dark
room, and a bone wall has nothing to lift.

**Dark or light?** Dark works better on camera for most people, because you are
usually the brightest thing in the frame and the wall stays out of the way. Go
light if your room is bright, if your webcam gets noisy in low light, or if you
wear dark clothing. Avoid light if you wear a white or cream shirt, because you
will start to merge into the wall.

If you and your boss are both on a call, take a different one each so the two
tiles do not look like a duplicate.

`out/quotemax-03-mountains-dark-GUIDES.png` is not for use. It is the same
background with the safe zones drawn on, so you can see why the middle is empty.

## Installing it

**Zoom** Settings, then Background & Effects, hover the thumbnails, then **+**,
then Add Image. Tick "I have a green screen" only if you actually do.

**Teams** In a call: More, then Video effects and settings, then Backgrounds,
then **+ Add new**.

**Google Meet** In a call: bottom-right **Apply visual effects**, then **+**
under Backgrounds.

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
- **Use 02 or a light one if your room is dim.** A dark background plus a dark
  room is what makes someone look like a floating head.

## How it is built, and why

A virtual background is not a poster. Someone is standing in the middle of it,
and most of what makes a poster good makes a video background bad.

**The centre is not yours.** A webcam head-and-shoulders frame fills roughly
x 600-1320, from y 90 to the bottom edge. All seven keep that empty. Brand
furniture lives in the left column (x 96-560) and the right margin (x 1360-1824)
only.

**Whatever sits behind the head must be plain.** Zoom's segmentation cuts a soft,
slightly wrong edge around hair and shoulders. Against busy or high-contrast
pixels that edge is obvious; against even mid-tone it disappears. So on the two
mountain variants the texture is masked **out** of the centre entirely, using a
horizontal mask that matches the keep-clear band rather than a radial one.

**It needs real tonal range.** The first build ran from `#1E1813` to `#16120F`,
about three values apart, and looked like an unfinished black rectangle. This one
lights a pool behind the subject at roughly `#4A4137` and falls to `#16120F` in
the corners, which is the range a real lit wall has. Built back to front: base
tone, one broad warm pool where you stand, darkened wings on the outer 560px with
an inner hairline so it reads as a panelled wall, floor falloff across the bottom
third, then texture, then grain.

**The mountains are sharp on purpose.** They started at 24px of blur, which hid
them completely. They now run at 6px. That is safe precisely because the mask
deletes the plate across the whole keep-clear band, so no sharp detail ever sits
behind your head. The source hides a teal mesh behind the gold ridge and the
brand allows one accent, so grayscale plus sepia pulls the teal back to warm grey
while the brighter gold survives. `peaks-wire.jpg` was rejected for this
composition: both of its peaks sit dead centre, exactly where the mask has to
delete them.

**Light mode reassigns tokens rather than inventing a palette.** The brand is
dark-first, so the tones that carry text on a dark wall become the light wall
itself, read the other way up:

| Role in light mode | Token | Contrast on bone |
|---|---|---|
| the wall | text-pri `#F6F1EA` | |
| the corners | text-sec `#C3B8AC` | |
| text | accent-ink `#1C1812` | 15.4:1 |
| secondary text | hairline `#3A322C` | 9.8:1 |
| dim text | edge-glow `#6E6354` | 4.7:1, passes AA |

No new colour enters the system, and the accent stays `#FFC400` in both modes,
which is the whole point of having one accent. A pale wall cannot be lifted
further from this palette, so the pool warms with the accent at 10% and the
vignette does all the modelling. The wing hairlines are dropped in light mode:
on a dark wall the vignette swallows their ends and they read as panel edges, but
on bone both ends stay visible and the pair reads as a faint rectangle drawn
around the middle of the frame, which looks like a mistake.

In light mode the peaks are inverted, fully desaturated, warmed back with sepia,
then multiplied, so they land as warm grey lines on bone instead of a dark
rectangle pasted on a pale wall. Full desaturation matters: inverting gold gives
blue, and leaving any of it made the mountains read cool on a warm wall.

**Neither onboarding variant carries a texture.** The facts panel is the interest
in that column, and a blurred plate under it competed with the only thing on the
frame you want read. Each variant does one thing: a plain wall, mountains, or
facts.

**Zoom's own name label sits bottom-LEFT** of the tile, so the URL sits
bottom-right. Nothing important goes in the bottom-left corner.

The only non-palette values in the source are `#0a0908` (the review page around
the artboards, never exported), the `#000` alpha stencils in the masks (a mask
reads alpha only, so the hue never renders) and the deliberately ugly red and
blue of the review overlay, which is `display:none` and never exported.

Every figure on the onboarding variants is real: under a minute to draft a quote,
$0 commission, eight trades live.

## Rebuilding

```bash
node render.mjs                 # 7 backgrounds at 1920x1080
node render.mjs --guides        # same, with the safe-zone overlay drawn on
node render.mjs --scale 2       # 3840x2160, if you ever want 4K
node render.mjs --only 3        # re-shoot one
```

`background.html` holds all seven in the `V` array at the bottom, each spreading
a shared `DARK` or `LIGHT` base. To change the tagline, the URL sub-line or the
three facts, edit that array; the renderer counts the variants from the source so
nothing else needs touching.

The mountain plate comes from `redesign/DesignSystem/assets/graphics`, copied into
`img/` as `peaks-glow.jpg`. It is 2752x1536, so at 1920x1080 it crops by 0.8%,
which is why it needs no repositioning.
