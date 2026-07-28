# QuoteMax — brand assets

The visual identity for **QuoteMax** (formerly QuoteMate). Warm-charcoal canvas,
one Caterpillar-yellow accent, bold geometric forms, square corners, borders
over shadows.

> ⚠ The old **Maintain** palette (navy `#0E1622` + orange `#FF5A1F`) is
> **retired** — do not reintroduce it. Yellow + charcoal is canonical.

## Palette

| Token | Hex | Use |
|---|---|---|
| `ink-deep` (warm charcoal) | `#16120F` | Page background / dark surfaces / glyph ink |
| `accent` (Caterpillar yellow) | `#FFC400` | Logo tile, CTAs, "MAX" emphasis |
| off-white (bone) | `#F4F1EB` | Wordmark on dark |
| muted | `#A89F92` | Secondary copy on dark |
| muted-deep | `#6E655B` | Mono captions on dark |

**Typography:** Manrope (display, `font-weight: 800`, uppercase, tight tracking),
JetBrains Mono (mono captions). Both already loaded in `app/layout.tsx`.

## The mark

A **QM monogram** — the Q and M locked into one continuous industrial letterform,
with an angular notch cutting through the Q's counter. It signals the product
name directly while the heavy geometry and single accent read as tools and
trade rather than software.

The vector source of truth is
[`redesign/DesignSystem/assets/logos/`](../../../redesign/DesignSystem/assets/logos/),
which holds the mark in four colourways. Everything in this folder is derived
from it.

The mark is **two-tone, and the two tones swap with the theme** — one set of
paths serves both supplied colourways:

| Surface | Colourway | Body | Notch |
|---|---|---|---|
| Dark canvas (`#16120F`) | `quote-max-logo-3` | yellow `#FFC400` | charcoal `#16120F` |
| Light canvas (`#FAF8F4`) | `quote-max-logo-4` | charcoal `#16120F` | yellow `#FFC400` |

In the app this is driven by `--logo-body` / `--logo-notch` in `globals.css`,
which flip alongside every other theme token — so the mark tracks both the
device preference and the pinned `[data-theme]` toggle with no client JS.

> **Yellow resolves through `--accent` (`#FFC400`), not the source art's
> `#E3C13C`.** The generated artwork carries a duller mustard; left as-is it
> would sit next to `#FFC400` CTAs and the "MAX" wordmark and read as a bug.

Drawn at 397×270, centred on a 699×699 canvas and scaled 1.3× about the centre,
which puts the glyph at ~74% tile width — dense enough to still read "QM" at
16px in a browser tab.

---

## Production assets (wired into the deployed site)

Auto-detected by Next 16's file conventions — no extra config needed.

| File | Size | Where it shows |
|---|---|---|
| `app/icon.svg` | vector | Primary favicon — browser tabs (all modern browsers). **Master source.** |
| `app/favicon.ico` | 16/32/48 | Legacy/Safari favicon, `/favicon.ico` requests |
| `app/apple-icon.png` | 180×180 | iOS "Add to Home Screen" icon |
| `app/opengraph-image.png` | 1200×630 | Default social-share card (link previews) |
| `app/_components/BrandMark.tsx` | inline SVG | In-app nav, footer and page headers — **15+ pages** route through this one component |

`BrandMark.tsx` carries the same path data as `app/icon.svg`, so the nav mark and
the browser-tab icon are the same shape at every size. It renders **transparent
with no tile**, cropped tight to the glyph bbox (`viewBox="151 214 397 270"`).

Size it by **height only** — `h-10 w-auto`, never `h-10 w-10`. The mark is 1.47:1
landscape, so a square box letterboxes it and throws the size away.

## Downloadable / marketing assets (in `public/brand/`, served at `/brand/…`)

| File | Use |
|---|---|
| `quotemax-icon.svg` / `quotemax-mark.svg` | App-icon mark on the warm-paper tile (vector) — mirrors `app/icon.svg` |
| `quotemax-icon-512.png` / `quotemax-icon-1024.png` | High-res icon (stores, decks, avatars) |
| `quotemax-mark-yellow.svg` | `logo-3` — yellow body, charcoal notch. **Dark backgrounds** |
| `quotemax-mark-duo.svg` | `logo-4` — charcoal body, yellow notch. **Light backgrounds** |
| `quotemax-mark-charcoal.svg` | Mono charcoal — single-colour print, light grounds |
| `quotemax-mark-white.svg` | Mono white — single-colour print, dark/photographic grounds |
| `quotemax-og.svg` / `quotemax-og.png` | OpenGraph source + raster |
| `quotemax-logo-horizontal-{dark,light}.svg` | Icon + wordmark lockups. ⚠ **Still on the old mark** — not referenced by live code |
| `quotemax-wordmark*.svg` | Wordmark only, variants a–f + reversed |
| `concepts*/` | Exploration only, not wired in |

> Vector (`.svg`) is the source of truth. Every `.png`/`.ico` raster is derived
> from `app/icon.svg`, so they never drift.

---

## Regenerating

```bash
# Rebuild every raster (favicon.ico, apple-icon, OG, icon PNGs) from the SVGs:
node quotemate-automation/scripts/build-brand-assets.mjs
```

If you change the mark, edit **`app/icon.svg`** and the matching path data in
**`app/_components/BrandMark.tsx`**, then re-run the build script. Those two
files must stay in sync — they are the only two places the glyph is hand-written.

## Deploy

Nothing extra to configure. Commit the new files and deploy as usual — Next 16
emits the `<link rel="icon">`, `apple-touch-icon`, and `og:image` tags
automatically from the `app/` files above. Hard-refresh (or bump a query string)
to clear a cached old favicon.
