# QuoteMax — LinkedIn banners

`banner.html` is the source. One file serves both LinkedIn sizes: type and spacing scale off
the frame, with a `vw` cap so the headline never runs into the margin on the narrower format.
Six variants, selected with `?slide=0…5` — three taglines on dark, the same three on light.

Rendered PNGs live in `out/` at 2x.

## Re-render

```bash
cd redesign/banners
node ../../.claude/skills/quotemax-infographics/scripts/render.mjs \
  --gen ./banner.html --format li-banner-company --scale 2 --no-pdf --out ./out
node ../../.claude/skills/quotemax-infographics/scripts/render.mjs \
  --gen ./banner.html --format li-banner-profile --scale 2 --no-pdf --out ./out
```

Playwright resolves from the repo root via junctions in `node_modules/` pointing at
`quotemate-automation/node_modules/{playwright,playwright-core}`. Recreate them with:

```powershell
New-Item -ItemType Junction -Path node_modules\playwright -Target quotemate-automation\node_modules\playwright
New-Item -ItemType Junction -Path node_modules\playwright-core -Target quotemate-automation\node_modules\playwright-core
```

## Editing

- Taglines: the `VARIANTS` array at the foot of `banner.html`. `{curly braces}` render in the accent.
  `theme: 'light'` on an entry flips it to warm paper.
- Backdrops, copied from `redesign/DesignSystem/assets/graphics/`: `img/ridge.jpg`
  (Wireframe_mountain_peaks) for dark, `img/ridge-light.jpg` (Yellow_wireframe_terrain_background)
  for light. Both are squashed vertically on purpose (`background-size: 100% 190%`) so the terrain
  reads as a distant range across the full width instead of one lone spike.
- Mark: `quote-max-logo-4.svg` inlined. Its charcoal glyph would vanish on the dark canvas, so
  `--mark-1` flips to cream there; light uses the file's colours as supplied.
- **Light theme contrast:** cream cannot carry yellow text (≈1.6:1). The accent line therefore
  becomes a yellow *fill* with `#1C1812` ink on it, and the eyebrow's lead word leans on weight
  instead of colour. Do not set yellow type on the cream canvas.
- The left 22% is kept flat and empty: LinkedIn overlays the company logo (or profile avatar) there.
