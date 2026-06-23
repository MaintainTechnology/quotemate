# QuoteMax — brand assets

The visual identity for **QuoteMax** (formerly QuoteMate). Built on the Maintain
design system: deep navy canvas, vibrant orange accent, bold geometric forms,
square corners, borders over shadows.

## Palette

| Token | Hex | Use |
|---|---|---|
| `ink-deep` (navy) | `#0E1622` | Page background / dark surfaces |
| `accent` (orange) | `#FF5A1F` | Logo tile, CTAs, "MAX" emphasis |
| `accent-press` | `#E8470F` | Hover/active |
| `accent-soft` | `#FF7A45` | Focus rings, soft accent |
| off-white | `#F4F1EB` | Wordmark on dark |
| accent (light theme) | `#B23A0B` | Burnt-orange used on the light theme |

**Typography:** Manrope (display, `font-weight: 800`, uppercase, tight tracking),
JetBrains Mono (mono captions). Both already loaded in `app/layout.tsx`.

## The mark

A white **chat-bubble "Q"** — a rounded speech bubble with a tail, its hole
forming the letter — on the orange tile. It says the product out loud: an AI
receptionist that quotes by text. The same glyph is used everywhere: browser tab,
home screen, in-app nav, and the social card, so the brand is one shape at every size.

---

## Production assets (wired into the deployed site)

These are auto-detected by Next 16's file conventions — no extra config needed.

| File | Size | Where it shows |
|---|---|---|
| `app/icon.svg` | vector | Primary favicon — browser tabs (all modern browsers) |
| `app/favicon.ico` | 16/32/48 | Legacy/Safari favicon, `/favicon.ico` requests |
| `app/apple-icon.png` | 180×180 | iOS "Add to Home Screen" icon |
| `app/opengraph-image.png` | 1200×630 | Default social-share card (link previews) |
| `app/_components/site.tsx` → `Logo()` | inline SVG | In-app nav + footer brand mark |

## Downloadable / marketing assets (in `public/brand/`, served at `/brand/…`)

| File | Use |
|---|---|
| `quotemax-icon.svg` | Standalone app-icon mark (vector) |
| `quotemax-icon-512.png` / `quotemax-icon-1024.png` | High-res icon (stores, decks, avatars) |
| `quotemax-logo-horizontal-dark.svg` | Icon + wordmark lockup — for **dark** backgrounds |
| `quotemax-logo-horizontal-light.svg` | Icon + wordmark lockup — for **light** backgrounds |
| `quotemax-wordmark.svg` | Wordmark only ("QUOTE" + orange "MAX") |
| `quotemax-og.svg` / `quotemax-og.png` | OpenGraph source + raster |
| `concepts/*.png` | AI-generated logo **concepts** (Gemini) — exploration only, not wired in |

> Vector (`.svg`) is the source of truth — crisp at any size. The `.png`/`.ico`
> rasters are all derived from `app/icon.svg`, so they never drift.

---

## Regenerating

```bash
# Rebuild every raster (favicon.ico, apple-icon, OG, icon PNGs) from the SVGs:
node quotemate-automation/scripts/build-brand-assets.mjs

# Regenerate the Gemini AI logo concepts (costs a few image calls):
node --env-file=quotemate-automation/.env.local quotemate-automation/scripts/gen-quotemax-logos.mjs
```

If you change the mark, edit `app/icon.svg` (and the matching `Logo()` in
`app/_components/site.tsx`), then re-run the build script.

## Deploy

Nothing extra to configure. Commit the new files and deploy as usual — Next 16
emits the `<link rel="icon">`, `apple-touch-icon`, and `og:image` tags
automatically from the `app/` files above. Hard-refresh (or bump a query string)
to clear a cached old favicon.
