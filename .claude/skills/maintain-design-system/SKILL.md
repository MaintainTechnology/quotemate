---
name: maintain-design-system
description: Apply the Maintain Technology brand design system to any QuoteMate page or component. Deep navy background, vibrant orange accent, bold uppercase display typography, numbered-card layouts, command-center / strikeforce aesthetic. Visual language follows maintain.com.au. Use whenever creating, redesigning, or styling customer-facing pages (/q/[token]/*), tradie-facing portals, marketing pages, or any UI that should feel on-brand with Maintain Technology.
---

# Maintain Technology — Design System

> **Source of truth:** [maintain.com.au](https://maintain.com.au) and the brand collateral in [assets/](../../../assets/).
>
> **When to apply:** any page or component a customer or tradie sees. The current `/q/[token]/*` portal uses a placeholder light-mode look — bring it under this system when next touched.

---

## Brand identity in one line

> **Premium, technical, command-centre. Dark navy canvas, vibrant orange, all caps, no decoration that isn't earning its place.**

Think: a strikeforce ops dashboard, not a SaaS marketing site. The aesthetic comes from defence/government consulting, not from "AI startup." Restraint is the brand.

---

## Colours — copy these tokens verbatim

```css
:root {
  /* ─── INK / SURFACE (dark canvas — 2026 deep slate-navy) ──── */
  --ink-deep:     #0E1622;   /* page background — primary canvas */
  --ink:          #141C29;   /* secondary surface */
  --ink-card:     #1B2433;   /* card / panel */
  --ink-line:     #2D3A4F;   /* subtle border on dark */

  /* ─── ACCENT (the Maintain orange) ──────────────────────── */
  --accent:       #FF5A1F;   /* primary brand accent — buttons, numbers, key words */
  --accent-press: #E8470F;   /* hover / pressed */
  --accent-soft:  #FF7A45;   /* secondary accent */
  --accent-bar:   #FF5A1F;   /* CTA strip / footer accent bar */

  /* ─── TEXT ON DARK ──────────────────────────────────────── */
  --text-pri:     #FFFFFF;   /* headlines + primary copy */
  --text-sec:     #B8C2D1;   /* body / paragraph */
  --text-dim:     #7A8699;   /* metadata, captions, eyebrow */

  /* ─── TEAL GLOW (subtle, used as topographic edge) ──────── */
  --teal-glow:    #14B8A6;
  --teal-deep:    #0F766E;

  /* ─── STATE COLOURS ─────────────────────────────────────── */
  --success:      #15803D;
  --warning:      #B45309;
  --danger:       #B91C1C;
}
```

### Tailwind v4 mapping

```css
@theme {
  --color-ink-deep:    #0E1622;
  --color-ink:         #141C29;
  --color-ink-card:    #1B2433;
  --color-ink-line:    #2D3A4F;
  --color-accent:      #FF5A1F;
  --color-accent-press:#E8470F;
  --color-text-pri:    #FFFFFF;
  --color-text-sec:    #B8C2D1;
  --color-text-dim:    #7A8699;
  --color-teal-glow:   #14B8A6;
}
```

Use as `bg-ink-deep`, `text-accent`, `border-ink-line`, etc.

---

## Typography

### Fonts

```css
/* Primary — display + body */
font-family: 'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

/* Monospace — tags, labels, metadata, code */
font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;
```

Load Manrope (700, 800, 900) + JetBrains Mono (400, 600) from Google Fonts.

### Type scale

| Token | Size | Weight | Letter-spacing | Line-height | Use |
|---|---|---|---|---|---|
| `display-mega` | `clamp(3.5rem, 8vw, 7rem)` | 800-900 | -0.04em | 0.95 | Hero headlines (*"THE STRIKEFORCE BEHIND…"*) |
| `display-lg` | `clamp(2.5rem, 5vw, 4.5rem)` | 800 | -0.035em | 1.0 | Section headlines |
| `display-md` | `clamp(1.75rem, 3vw, 2.5rem)` | 800 | -0.03em | 1.1 | Card titles, sub-headers |
| `body-lg` | `1.125rem` | 400 | 0 | 1.6 | Hero paragraphs |
| `body` | `1rem` | 400 | 0 | 1.55 | Standard body |
| `mono-tag` | `0.7rem` | 600 | 0.12em (UPPERCASE) | 1 | Eyebrow chips, "PROJECT RESCUE" labels |
| `mono-num` | `clamp(2rem, 4vw, 3.5rem)` | 700 | 0 | 1 | Big "01" "02" numbered card markers |

### Headline rules — non-negotiable

1. **Display headlines are ALL CAPS.** Always.
2. **Tight tracking** on display (`-0.03em` to `-0.04em`).
3. **Mix white + orange** for emphasis — orange highlights one or two key words per headline. Example:
   > "THE **STRIKEFORCE** BEHIND AUSTRALIA'S MOST CRITICAL **ENTERPRISE** TRANSFORMATIONS"
4. **Never centre** display headlines. Always left-aligned.
5. **Eyebrow tags** above headline use `mono-tag` style — uppercase, tracked, dim white.

### Body rules

- Body copy is **never bold for emphasis**. Use orange or weight 600 sparingly.
- Maximum line length ~65ch on body, ~22ch on display.
- Body weight is always 400. Ditch 500.

---

## Components

### 1. Buttons

**Primary (orange-fill, the dominant CTA):**

```tsx
<button className="
  inline-flex items-center gap-2
  bg-accent hover:bg-accent-press
  text-white font-semibold
  px-6 py-3
  text-sm uppercase tracking-wider
  rounded-none
  transition-colors
">
  Explore our capabilities <ArrowRight className="w-4 h-4" />
</button>
```

**Secondary (white outline):**

```tsx
<button className="
  inline-flex items-center gap-2
  bg-white hover:bg-text-sec
  text-ink-deep font-semibold
  px-6 py-3
  text-sm uppercase tracking-wider
  rounded-none
">
  Hire talent
</button>
```

**Rules:**
- **No rounded corners** on primary buttons. Square / minimally-rounded only.
- **Trailing arrow** on the primary CTA where action implies forward motion.
- **UPPERCASE label**, weight 600, tracked +0.05em.

### 2. Numbered cards (the signature pattern)

```tsx
<article className="bg-ink-card border border-ink-line p-6 md:p-8">
  <div className="flex items-start gap-6">
    <span className="font-mono text-5xl md:text-6xl font-bold text-accent leading-none">
      01
    </span>
    <div>
      <h3 className="text-white font-extrabold text-lg md:text-xl uppercase tracking-tight mb-2">
        Baseline Reality
      </h3>
      <p className="text-text-sec text-sm md:text-base leading-relaxed">
        Map the gap between what was planned and what is true.
      </p>
    </div>
  </div>
</article>
```

**Rules:**
- Number is always Maintain orange, monospace, very large.
- Title is white, uppercase, weight 800.
- Body is `text-text-sec`, sentence case, body weight.
- Card background is `--ink-card` with `--ink-line` border.
- No rounded corners (or minimal — max `rounded-sm`).

### 3. Tag / chip / eyebrow

```tsx
<span className="
  inline-flex items-center
  bg-accent text-white
  px-3 py-1
  font-mono text-[0.7rem] font-bold uppercase
  tracking-[0.12em]
">
  Project Rescue
</span>
```

For dimmer eyebrows (above headlines):

```tsx
<span className="font-mono text-xs uppercase tracking-[0.12em] text-text-dim">
  PROJECT RESCUE
</span>
```

### 4. CTA accent bar (footer-style)

```tsx
<div className="bg-accent text-white text-center py-4 px-6">
  <span className="font-mono text-sm uppercase tracking-[0.15em]">
    Book a diagnostic now · maintain.com.au
  </span>
</div>
```

The orange accent bar is the closing punctuation on most pages. Use it at the very bottom of marketing-style content as a visual full-stop.

### 5. Hero section pattern

```tsx
<section className="bg-ink-deep text-white min-h-screen relative overflow-hidden">
  {/* Topographic background — see Imagery section */}
  <TopographicBackground />

  <div className="relative z-10 max-w-7xl mx-auto px-6 py-24 md:py-32 grid md:grid-cols-[2fr_1fr] gap-12">
    <div>
      <span className="font-mono text-xs uppercase tracking-[0.12em] text-text-dim">
        Project Rescue
      </span>
      <h1 className="mt-6 font-extrabold uppercase text-[clamp(3.5rem,8vw,7rem)] leading-[0.95] tracking-[-0.04em]">
        The <span className="text-accent">strikeforce</span> behind Australia's most critical
        <span className="text-accent"> enterprise</span> transformations
      </h1>
    </div>
    <aside className="text-text-sec text-base leading-relaxed">
      Maintain Technology is a trusted consulting partner to Australian
      government agencies and mid-to-large private companies, delivering
      enterprise transformation, digital strategy, and project delivery,
      rescue, and assurance across mission-critical programs.
    </aside>
  </div>
</section>
```

### 6. Card / panel surface

```tsx
<div className="bg-ink-card border border-ink-line p-6 md:p-8">
  {/* card content */}
</div>
```

No drop-shadows. Borders only. Shadows feel SaaS-y; borders feel command-centre.

---

## Imagery direction

Maintain Technology uses **dark, atmospheric, geological** imagery. Never stock-photo people-on-laptops. Never sun-flare hero shots.

| Use this | Don't use this |
|---|---|
| Mountain ridges, topographic line maps, lava-cracked stone, deep canyons | Smiling office workers |
| Volcanic / industrial scenery with orange-glow accents | Bright sunlit offices |
| Abstract dark gradients with teal/orange edge glows | Chrome 3D renders, gradient blobs |
| Hand-drawn topo-line SVG overlays | Stock illustrations of "data flow" |

### Topographic background SVG (signature pattern)

The mountain-line topography is a recurring visual motif. Implement as a low-opacity SVG overlay:

```tsx
<svg
  className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
  viewBox="0 0 1920 1080"
  preserveAspectRatio="xMidYMid slice"
>
  {/* Stylised mountain line topography — teal stroke */}
  <path
    d="M0,800 Q200,600 400,700 T800,650 T1200,700 T1600,600 T1920,650"
    stroke="var(--teal-glow)"
    strokeWidth="1"
    fill="none"
  />
  {/* repeat with offsets */}
</svg>
```

For a faster build, source from [Heropatterns](https://heropatterns.com) "topography" pattern with a dark navy background.

---

## Layout patterns

### Spacing scale

Use Tailwind's default spacing scale, but lean **generous**: prefer `py-24 md:py-32` over `py-12`. Sections breathe. White space is part of the brand.

### Grid

- Max content width: `max-w-7xl` (~80rem / 1280px)
- Hero: 2fr_1fr asymmetric grid (large headline / aside paragraph)
- Numbered cards: 1-column on mobile, full-width cards stacked vertically (the brand prefers vertical lists over multi-column grids)
- Marketing pages: alternating dark/dark-card panels with the orange CTA bar between major sections

### Borders + dividers

```tsx
<hr className="border-0 h-px bg-ink-line" />
```

Only ever use horizontal lines. Never vertical separators. Never decorative borders.

---

## Tone of voice (when writing copy in this style)

- **Direct, declarative.** "Map the gap." Not "We help you understand…"
- **Imperative verbs** for headlines: "Regain. Triage. Map. Define."
- **Restrained punctuation.** One exclamation in an entire page is too many.
- **Australian English.** Colour, organisation, postcode, mobile, sparky. Never American spellings.
- **No marketing fluff.** Avoid "leverage," "synergy," "amazing," "unlock potential." Trust the reader to be sharp.

---

## DO + DON'T quick reference

### DO

- ✅ Deep slate-navy `#0E1622` background with white type
- ✅ ALL-CAPS bold headlines, left-aligned
- ✅ Orange highlight on 1-2 key words per headline
- ✅ Numbered cards with big mono numbers in orange
- ✅ Monospace for tags, eyebrows, metadata
- ✅ Generous vertical spacing between sections
- ✅ Topographic SVG overlay as background texture
- ✅ Square / minimal-radius corners on buttons + cards
- ✅ Orange accent bar at end of marketing flows

### DON'T

- ❌ Light/white page backgrounds (current `/q/[token]` portal uses this — needs to flip)
- ❌ Centred headlines or copy
- ❌ Rounded pill buttons (`rounded-full`) — wrong for this brand
- ❌ Drop shadows (`shadow-lg`) — borders only
- ❌ Sentence-case headlines (always uppercase)
- ❌ Stock photography of people / offices
- ❌ Multiple gradients on one screen
- ❌ Soft blue/violet accents — the brand is orange + teal-glow only
- ❌ Sans-serif tags (always monospace for tags)
- ❌ Multiple exclamation marks anywhere

---

## Reference implementation — quote portal redesign starter

If applying this skill to redesign `app/q/[token]/page.tsx`:

1. Wrap the page in `<main className="bg-ink-deep text-white min-h-screen">`
2. Replace `bg-zinc-50` / `bg-white` panels with `bg-ink-card`
3. Replace `text-zinc-900` with `text-white`, `text-zinc-600` with `text-text-sec`
4. Replace tier card heading style with the numbered-card pattern (orange tier number + bold uppercase tier name)
5. Replace blue accents (`text-blue-600`, `border-blue-300`) with `text-accent`, `border-accent`
6. Replace rounded buttons with square buttons matching the primary/secondary spec above
7. Add the topographic SVG overlay to the page background
8. Add the orange CTA accent bar at the bottom of the page footer

---

## Where to find the source

- **Live site:** [maintain.com.au](https://maintain.com.au)
- **Brand collateral images:** `assets/` folder of this repo (when added)
- **This skill:** `.claude/skills/maintain-design-system/SKILL.md`

When in doubt, open the live site and match what's there. The brand canon is the live site.
