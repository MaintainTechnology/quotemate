---
name: quotemax-design
description: Use this skill to generate well-branded interfaces and assets for QuoteMax, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## What's here
- **`readme.md`** — the design guide: product context, content fundamentals (voice, casing, Australian English, banned words), visual foundations (colour, type, texture, motion, borders), iconography, and a full repository index. Read this first.
- **`styles.css`** — the single global entry point. Link it and everything (tokens + webfonts + motif classes) comes with it. Token files live in `tokens/`; signature classes (`.qm-card`, `.qm-edge-lit`, `.qm-grain`, `.qm-marquee`, `.qm-display`, `.qm-duotone`) live in `base.css`.
- **`components/`** — 13 React primitives (`Button`, `Badge`, `StatusPill`, `Card`, `NumberedCard`, `Marquee`, `TierCard`, `SmsThread`, `Eyebrow`, `Stat`, `Avatar`, `SegmentedToggle`, `TextField`). Each has a `.prompt.md` with usage. In a project that bundles this system they mount from `window.QuoteMaxDesignSystem_638aa1`; for standalone HTML, copy `ui_kits/_shared/kit.jsx` (inline-styled mirrors on `window.QMUI`).
- **`ui_kits/`** — full-screen recreations of the three surfaces (marketing, dashboard, customer-quote). Read these to see the components composed correctly, then copy the patterns.
- **`assets/`** — the logo mark (`logos/`), the AU flag (`icons/`), partner/stack logos (`partners/`), and duotone-ready trade photography (`photos/`). Copy what you need; never redraw the mark or invent icons.

## The brand in one breath
Warm-charcoal "command-centre" canvas (`#16120F`), one accent only — Caterpillar yellow (`#FFC400`, dark text on yellow, never white). Manrope for ALL-CAPS display + body, JetBrains Mono for eyebrows/prices/metadata. Square corners (radius 0), borders not shadows, depth from lit edges + film grain + a topographic overlay. Numbered cards and a yellow marquee bar are signatures. Voice: a licensed Aussie tradie who respects your time — direct, present-tense, Australian English, no exclamation marks, no em-dashes in customer copy, no emoji, no marketing fluff.
