---
name: QuoteMax
description: A warm-charcoal command-centre for Australian tradies — one hi-vis Caterpillar-yellow signal, borders not shadows.
colors:
  ink-deep: "#16120F"
  ink: "#1E1813"
  ink-card: "#2B2422"
  ink-line: "#3A322C"
  accent: "#FFC400"
  accent-press: "#E6AC00"
  accent-soft: "#FFD23D"
  accent-ink: "#1C1812"
  text-pri: "#F6F1EA"
  text-sec: "#C3B8AC"
  text-dim: "#A2968A"
  edge-glow: "#6E6354"
  edge-deep: "#4A4136"
  success: "#15803D"
  success-bright: "#34D27B"
  warning: "#B45309"
  warning-bright: "#F59E0B"
  danger: "#B91C1C"
  danger-bright: "#F0816B"
  paper-canvas: "#FAF8F4"
  paper-sunken: "#F3EEE7"
  paper-card: "#FFFFFF"
  paper-line: "#CFC2B0"
  paper-ink: "#241E1B"
  paper-ink-sec: "#5E544E"
  paper-ink-dim: "#6E645C"
typography:
  display:
    fontFamily: "Manrope, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "clamp(2.6rem, 6.5vw, 5.5rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.04em"
    fontFeature: "'ss01', 'cv11'"
  headline:
    fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.25rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.18em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  "2xl": "16px"
  card-product: "14px"
  control-product: "9px"
  pill: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
  "24": "96px"
  "32": "128px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.lg}"
    height: "56px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.accent-press}"
    textColor: "{colors.accent-ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-pri}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 20px"
  card:
    backgroundColor: "{colors.ink-card}"
    textColor: "{colors.text-sec}"
    rounded: "{rounded.2xl}"
    padding: "32px"
  input:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.text-pri}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 16px"
  numbered-card:
    backgroundColor: "{colors.ink-card}"
    textColor: "{colors.text-sec}"
    rounded: "{rounded.2xl}"
    padding: "32px"
---

# Design System: QuoteMax

## 1. Overview

**Creative North Star: "The Command Centre"**

QuoteMax looks like an operations deck, not a SaaS dashboard. The canvas is warm near-black charcoal (`#16120F`) — warm, never blue-black — and across it runs a single hot signal: Caterpillar yellow (`#FFC400`). Everything else is structure. Depth is engineered from borders, lit panel edges, a film-grain overlay and a slow-drifting topographic ridge field — never from soft drop shadows. Type is heavy and left-aligned: ALL-CAPS Manrope for display, JetBrains Mono for the eyebrows, prices and metadata that make the system read as instrumented rather than decorated.

The mood is a licensed Australian tradie who respects your time: direct, engineered, a little dry, confident without shouting. The system's job is trust — the two surfaces that matter most (the marketing landing and the customer quote page) exist to make an automatically-drafted quote feel more premium and defensible than one hand-typed. That means restraint reads as premium here. One accent, square corners, honest numbers doing the talking, and nothing on the page that isn't earning its place.

This system explicitly rejects the generic-SaaS playbook (soft gradients, pill buttons, centered heroes, purple accents, glassmorphism), anything consumer-cutesy or emoji-laden, and the assembled-from-stock-blocks template look. It also retires its own past: the old navy (`#0E1622`) + orange (`#FF5A1F`) "Maintain" identity is deprecated and must not creep back.

**Key Characteristics:**
- Warm near-black charcoal canvas; one accent only — hi-vis Caterpillar yellow.
- Rounded corners (soft scale: buttons/inputs ~8px, cards ~12–16px, dashboard cockpit 14/9px); status dots and avatars are full circles. Full-pill buttons are avoided.
- Depth from borders + lit edges + film grain + topographic overlay, never flat fills or drop shadows.
- ALL-CAPS Manrope display, left-aligned, tight tracking; JetBrains Mono for labels, prices, metadata.
- Big honest numbers as the value prop; Australian English; zero emoji; no exclamation marks.
- Dark is the primary brand; a "warm paper" light theme ships for device preference.

## 2. Colors

A monochrome warm-charcoal system lit by a single hi-vis yellow — the accent is a scalpel, never a wash.

### Primary
- **Caterpillar Yellow** (`#FFC400`): the one accent. A fill for buttons, big mono numbers, highlighted headline words, the marquee bar and the logo tile. Press/active darkens to **Signal Amber** (`#E6AC00`); **Soft Yellow** (`#FFD23D`) carries focus rings and ticks. On any yellow fill, text and icons are **Accent Ink** charcoal (`#1C1812`).

### Neutral
- **Command Charcoal** (`#16120F`): the page canvas — warm near-black, the primary surface.
- **Sunken Charcoal** (`#1E1813`): insets and sunken panels (a step below the canvas).
- **Palette Charcoal** (`#2B2422`): cards and panels — the surface that lifts to catch light.
- **Warm Hairline** (`#3A322C`): the 1px border that draws every structural edge.
- **Bone** (`#F6F1EA`): headlines and primary copy on dark.
- **Warm Grey** (`#C3B8AC`): body and secondary copy.
- **Dim Warm Grey** (`#A2968A`): mono labels, captions, metadata (tuned to ≥4.5:1 on cards).
- **Ridge Glow** (`#6E6354`) / **Ridge Deep** (`#4A4136`): the warm greys that light the topographic ridge lines. A neutral, not an accent.

### State (functional, used sparingly — a rule or a small chip, never a large fill)
- **Success** (`#15803D`, text on dark `#34D27B`), **Warning** (`#B45309`, text on dark `#F59E0B`), **Danger** (`#B91C1C`, text on dark `#F0816B`).

### Light theme — "warm paper" (device preference / manual `[data-theme="light"]` pin)
- Cream canvas **Paper** (`#FAF8F4`) on white cards (`#FFFFFF`), warm hairline (`#CFC2B0` — darkened from the design system's `#E9E3DC`, which was only ~1.25:1 and washed out), ink text (`#241E1B` / `#5E544E` / `#6E645C`). The accent stays yellow for fills; as on-surface *text* it falls back to charcoal (cream cannot carry yellow text), so highlighted words carry a yellow highlighter **underline** (a self-scaling `text-decoration` in the accent — yellow stays a fill) in light mode, since weight alone can't distinguish an already-bold display headline.

### Named Rules
**The One Signal Rule.** Yellow is the only accent — no blues, no violets, no teal, no second colour. On any given screen it marks the single thing that matters next: the CTA, the price, the one highlighted word. Its scarcity is the point; keep it to ≤ ~10% of the surface.

**The Dark-on-Yellow Rule.** Text and icons on a yellow fill are always dark charcoal (`#1C1812`), never white. White-on-yellow fails WCAG (~1.4:1) — it is forbidden.

**The Warm-Not-Blue Rule.** The canvas is warm near-black (`#16120F`); borders, glows and neutrals all lean warm. A cool grey or a blue-black canvas breaks the brand.

## 3. Typography

**Display Font:** Manrope (with ui-sans-serif, system-ui, Segoe UI, Roboto fallback)
**Body Font:** Manrope (same stack)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SF Mono, Menlo, Consolas fallback)

**Character:** One heavy geometric-humanist sans doing display and body across its weight range, paired against a precise monospace for anything instrumented — labels, prices, timestamps, refs. The contrast is sans-vs-mono, not two similar sans; it reads engineered and legible, never decorative.

### Hierarchy
- **Display** (Manrope 800, `clamp(2.6rem, 6.5vw, 5.5rem)`, line-height `0.95`, tracking `-0.04em`, ALL CAPS): hero and section-opening headlines, left-aligned, one or two words in accent.
- **Headline** (Manrope 800, `clamp(2rem, 4vw, 3.25rem)`, line-height `0.95`, tracking `-0.04em`, ALL CAPS): section heads.
- **Title** (Manrope 700, `1.25rem`/20px, line-height `1.3`, tracking `-0.02em`): card titles and sub-heads (often uppercase).
- **Body** (Manrope 400, `1rem`/16px, line-height `1.6`): sentence-case prose. Cap the measure at 65–75ch.
- **Label** (JetBrains Mono 600, `0.75rem`/12px, tracking `0.18em`, UPPERCASE): eyebrows, KPI labels, "QUOTE REF", timestamps. 12px is the floor.

### Named Rules
**The All-Caps Display Rule.** Display and section headlines are ALL CAPS, weight 800, tight tracking (`-0.04em`), and **left-aligned — never centered**. The accent highlights one or two key words; body stays weight 400.

**The Mono-Label Rule.** Eyebrows, metadata, refs and every price or tabular figure are JetBrains Mono, uppercase for labels, wide tracking (`0.14–0.18em`). Numbers use `tabular-nums`. Prices are mono because the brand lets the numbers do the talking.

## 4. Elevation

This system is flat by intent: there are **no drop shadows on resting surfaces**. Depth is built from four materials instead — a 1px warm hairline border, a lit panel edge (an inset top highlight, not a cast shadow), a ~4.5% film-grain overlay that kills banding, and a slow topographic ridge field behind hero surfaces. Cast shadows exist only for true overlays (dialogs, menus, toasts) and are warm-charcoal tinted, never neutral black.

### Shadow Vocabulary
- **Lit edge / lift** (`box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.06)`): the default "lifted plate" treatment on dark cards — an inner highlight, applied in place of a drop shadow. On the light theme it softens to a whisper cast (`0 1px 2px rgba(43,36,34,0.06)`).
- **Menu** (`box-shadow: 0 16px 40px -12px rgba(11,9,7,0.55)`): dropdowns and popovers.
- **Overlay** (`box-shadow: 0 24px 60px -12px rgba(11,9,7,0.7)`): dialogs and modals that must separate hard from the canvas.

### Named Rules
**The Borders-Not-Shadows Rule.** Structure comes from the 1px warm hairline and the lit edge, not from shadows. Reach for a cast shadow only when an element genuinely floats above the page (overlay), and tint it warm charcoal.

**The Grain Rule.** A ~4.5% fractal-noise film sits fixed over dark surfaces. It is non-negotiable on hero and quote surfaces — a flat dark fill bands and reads as cheap; the grain is what makes near-black look premium.

## 5. Components

> **Register note (radii).** QuoteMax uses **rounded corners across all surfaces** — a product-owner decision (2026-07) that **supersedes the square-cornered spec in `redesign/DesignSystem`**. Brand/marketing surfaces round buttons + inputs to ~8px (`rounded.lg`) and cards/panels to ~12–16px (`rounded.xl` / `rounded.2xl`); the tradie dashboard cockpit uses `14px` cards / `9px` controls (`rounded.card-product` / `rounded.control-product`). Only status dots and avatar discs are full circles; avoid full-pill buttons. Do **not** "square" any surface.

### Buttons
- **Shape:** rounded (buttons/controls ~8px `rounded.lg`; larger CTAs may use `rounded.xl`). Avoid full-pill buttons; only status dots and avatars are circles.
- **Primary:** Caterpillar-yellow fill (`#FFC400`) with dark-charcoal text (`#1C1812`), uppercase, weight 700, tracking `~0.05em`; primary CTA height `56px` on marketing, `44px` in-app.
- **Hover / Focus:** fill darkens to `#E6AC00` (a colour shift, not a scale); focus shows a visible 2px `#FFD23D` ring at 2px offset, always present for keyboard users.
- **Ghost:** transparent with a 1px hairline border and primary text; on hover the border and text shift to accent. Used for secondary actions.

### Cards / Containers
- **Corner Style:** rounded ~12–16px (`rounded.xl` / `rounded.2xl`).
- **Background:** palette charcoal (`#2B2422`) on the charcoal canvas.
- **Shadow Strategy:** none at rest — a 1px warm hairline plus the lit edge (see Elevation). On hover a 2px accent "card-sweep" line can draw across the top edge.
- **Border:** 1px `#3A322C` hairline (the structural unit).
- **Internal Padding:** `24px` mobile, `32px` desktop.

### Inputs / Fields
- **Style:** 1px hairline border, sunken charcoal background (`#1E1813`), rounded corners (~8px `rounded.lg`), primary text; a mono uppercase label sits above.
- **Focus:** border shifts to accent and the 2px `#FFD23D` focus ring appears at 2px offset.
- **Error / Disabled:** error borrows the danger rule colour on the border; disabled drops to ~0.6 opacity with no pointer.

### Navigation
- Sticky, blurred bar (`background: rgba(22,18,15,0.85)` + backdrop-blur) with a 1px hairline bottom border. Links are body-weight; active/hover draws a left-to-right underline or shifts to accent. Mobile collapses to a sheet; the wordmark (mark + "QUOTEMAX", Manrope 800, one colour) anchors the left.

### Numbered Card (signature)
A large JetBrains Mono number (`01`, `02`) in accent sitting beside an uppercase Manrope-800 title, over warm-grey body copy — the brand's default way to sequence a "how it works" or a scope of works.

### Yellow Marquee Bar (signature)
A full-width Caterpillar-yellow bar with dark-charcoal mono text scrolling on a slow linear ticker — the brand's closing punctuation at the foot of marketing pages and the quote page ("Lock in your option · 30% deposit").

### SMS Thread (signature)
The live intake demo: dark bubbles with a 3-dot typing bounce and pop-in arrivals, showing QuoteMax answering a customer text and drafting the quote. It is the product proving itself on the page.

## 6. Do's and Don'ts

### Do:
- **Do** build depth from borders, the lit edge, film grain and the topographic overlay — never a drop shadow on a resting surface.
- **Do** use the rounded corner scale consistently (buttons/inputs ~8px, cards ~12–16px, dashboard 14/9px); only status dots and avatar discs are full circles. Avoid full-pill buttons.
- **Do** use Caterpillar yellow (`#FFC400`) as a fill on ≤ ~10% of a screen, always with dark-charcoal text (`#1C1812`) on it.
- **Do** set display headlines in ALL-CAPS Manrope 800, left-aligned, tight tracking, with one or two words in accent.
- **Do** use JetBrains Mono (uppercase, wide-tracked) for eyebrows, prices, refs and metadata, with `tabular-nums` on figures.
- **Do** write in Australian English, present tense, tradie voice; let big honest numbers carry the value prop.
- **Do** run photography through the duotone pass so trade photos read as native to the palette.

### Don't:
- **Don't** reintroduce the retired navy (`#0E1622`) + orange (`#FF5A1F`) "Maintain" identity. Yellow + warm charcoal is canonical.
- **Don't** ship generic SaaS: no soft gradients, pill buttons, centered heroes, purple/violet accents, or glassmorphism.
- **Don't** go consumer-cutesy or playful: no illustrated/toy-like treatments or oversized bubbly radii, and zero emoji, ever.
- **Don't** look like a cheap template: no Wix/Squarespace/Framer stock blocks; bespoke structure and honest proof only.
- **Don't** put white text on a yellow fill (fails WCAG ~1.4:1) — dark charcoal only.
- **Don't** add a second accent colour, a gradient button, or any neon.
- **Don't** use exclamation marks or em-dashes in customer-visible copy; use a full stop, a comma, or a middot (`·`).
- **Don't** center display headlines, and never use a cool-grey or blue-black canvas.
