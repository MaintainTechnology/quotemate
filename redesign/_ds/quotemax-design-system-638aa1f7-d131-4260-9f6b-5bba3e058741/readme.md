# QuoteMax — Design System

> **QuoteMax** is an AI quoting assistant for Australian tradies (electricians & plumbers, with solar / roofing / painting rolling out). A customer texts or calls the tradie's dedicated number; QuoteMax asks the right questions, applies the tradie's pricing book, and drafts a clean Good / Better / Best quote in under a minute. The tradie reviews, tweaks and sends. The customer views a mobile quote page and pays a per-tier deposit.

This repository is the **brand + UI design system** for QuoteMax: the colour and type tokens, the signature "command-centre" motifs, the reusable React primitives, and high-fidelity recreations of the three product surfaces. Link `styles.css` and build with the tokens; mount the components from `window.QuoteMaxDesignSystem_638aa1`.

---

## Product surfaces

QuoteMax is one platform with four touch-points. Three are recreated here as UI kits:

1. **Marketing / pricing site** (`/`, `/pricing`) — a dark command-centre landing page that shows the product working (a live SMS-intake demo), plus a three-tier pricing page. → `ui_kits/marketing/`
2. **Tradie dashboard** (`/dashboard`) — the tradie's portal: overview KPIs, the quote-review queue, pricing book, services, chats. CRM + quote review. → `ui_kits/dashboard/`
3. **Customer quote page** (`/q/[token]`) — the mobile-first public page a customer opens from their SMS. Letterhead, scope of works, Good/Better/Best tier cards, per-tier deposit CTAs. → `ui_kits/customer-quote/`
4. **SMS + voice intake** — the conversational front door (not a screen kit; represented by the SMS-demo component used across the marketing kit and `components/`).

---

## Sources

This system was reverse-engineered from the real QuoteMax codebase and brand assets. If you have access, explore these to go deeper — they are the ground truth:

- **Codebase** (Next.js 16 app, read-only mount): `quotemate-automation/`
  - `app/globals.css` — the live brand tokens (source of truth for colour + theme).
  - `app/page.tsx`, `app/_components/site.tsx` — marketing chrome + hero.
  - `app/_components/BrandMark.tsx`, `app/icon.svg` — the logo mark.
  - `app/dashboard/page.tsx` — the tradie portal.
  - `app/q/[token]/page.tsx`, `TradeTiers.tsx` — the customer quote page.
  - `app/_components/pricing-data.ts`, `PricingTiers.tsx` — plans + tiers.
  - `public/brand/README.md` — the brand-asset manifest.
- **GitHub:** <https://github.com/MaintainTechnology/quotemate> — the QuoteMax (Maintain Technology) repository. Browse it for the full app, prompt templates and pipeline. A related KB repo: <https://github.com/MaintainTechnology/mt-filestore-kb>.
- **Brand notes** supplied by the QuoteMax team (palette, type, voice) — captured verbatim in the token files and below.

> **Brand evolution note.** QuoteMax was formerly **"QuoteMate"** and the early identity used a navy canvas + orange accent + a white circle-"Q" mark. The **current** brand — and the one this system encodes — is a **warm-charcoal canvas + Caterpillar-yellow accent**, with the mark being a **dark speech-bubble + tick on a yellow tile**. The live `app/globals.css` and `app/icon.svg` are the current source of truth; the older orange lockup SVGs under `public/brand/` are deprecated and were **not** carried over. A few in-app strings and the `/q` letterhead still show legacy "QuoteMate"/Maintain-orange artefacts — treat yellow + "QuoteMax" as canonical.

---

## CONTENT FUNDAMENTALS

The voice is a **licensed Australian tradie who respects your time** — direct, plain, a little dry. Never a Silicon Valley marketer.

**Person & address.** Talk to the tradie as **"you"**; the product is **"QuoteMax"** (third person, never "we" pretending to be the tradie). On the customer-facing quote page, the customer is "you" and the tradie is "your tradie". Example: *"Drafts your quote before they hang up."* / *"You review, tweak, send."*

**Mood & tense.** Imperative and declarative, present tense. State what happens, in order. *"Customer texts your number. QuoteMax drafts the quote. You review, send, get paid."* No future-tense hedging ("will be able to"), no conditionals where a statement will do.

**Australian English, always.** colour, organise, licence (noun) / license (verb), recognise, "tradie", "sparky", "on the tools", "ute", "mate", "G'day". Spell it the Australian way in every surface. Currency is AUD with no decimals on whole dollars (`$890`, `$49/mo`), GST is "inc GST" / "ex-GST", "10% GST".

**Casing.**
- **Display headlines: ALL CAPS**, left-aligned, heavy, tight tracking. One or two words highlighted in accent. *"DRAFTS YOUR `QUOTE` BEFORE THEY `HANG UP`."*
- **Eyebrows / labels / metadata: UPPERCASE mono**, wide tracking ("HOW IT WORKS", "LIVE EXAMPLE · SMS INTAKE", "QUOTE REF").
- **Body: sentence case.** Calm, readable, never shouty.
- **Buttons: Title or sentence case**, often uppercase-tracked on the marketing site ("Get my QuoteMax", "See how it works", "Pay deposit").

**Restrained punctuation.** **No exclamation marks.** **No em-dashes in customer-visible copy** (a known AI tell — the team deliberately strips them; use a full stop, a comma, or a middot `·` separator instead). Middots separate metadata ("Electrical NSW · Plumbing QLD"). The arrow `→` and chevrons `›` mark list items and forward motion.

**No marketing fluff.** Banned: "leverage", "synergy", "unlock", "seamless", "revolutionary", "supercharge", "game-changing". Banned: fake stats, fabricated logos, invented reviews. Proof is **honest** — real pilot status ("Electrical pilot · NSW"), the real stack ("Runs on Twilio"), concrete numbers ("< 1 min", "$0 cut of your jobs", "$99 site visit").

**Numbers do the talking.** Big mono figures carry the value prop: `< 1 MIN` per quote, `24/7` line answered, `$0` cut, `$99` site visit. Stats are specific and defensible, never round-for-effect.

**Emoji: none.** The brand uses zero emoji. "Icons" are Lucide line glyphs or mono characters (`→ › ○ ★ ·`). Don't introduce emoji anywhere.

**Microcopy samples (lift the cadence, not the words):**
- Hero sub: *"Customers text your QuoteMax number. QuoteMax asks the right questions, applies your pricing book, and drafts a clean quote in under a minute. You review, tweak, send."*
- Quote page: *"G'day {name}, here's your {job} quote. Three options below, all prices include 10% GST. Pay a 30% deposit on any tier to lock it in."*
- FAQ: *"Do I lose control of my pricing? No. QuoteMax only ever uses your pricing book."*
- Closing bar: *"Lock in your option · 30% deposit"*

---

## VISUAL FOUNDATIONS

The look is **"command-centre, not SaaS"**: a warm near-black charcoal canvas, one hot accent, heavy all-caps type, square corners, and depth built from **borders + lit edges + film grain + a topographic overlay — never drop shadows.**

### Colour
- **Canvas:** warm near-black charcoal `#16120F` (the brand reads warm, not blue-black). Secondary surface `#1E1813`; cards lift to palette charcoal `#2B2422`; hairline borders stay warm at `#3A322C`.
- **One accent only — Caterpillar yellow `#FFC400`.** Used as a FILL for buttons, big numbers, highlighted words, the marquee bar, the logo tile. Press state `#E6AC00`, soft `#FFD23D`. **Text on a yellow fill is ALWAYS dark charcoal `#1C1812`, never white** (white-on-yellow fails WCAG). There is **no second accent** — no blues, no violets, no teal. (A warm grey `--edge-glow #6E6354` lights the topographic ridges; it is a neutral, not an accent.)
- **Text on dark:** primary `#F6F1EA`, secondary `#C3B8AC`, dim `#A2968A`.
- **Light theme — "warm paper":** cream canvas `#FAF8F4` on white cards `#FFFFFF`, ink text `#241E1B`. The accent stays yellow for fills; as on-surface TEXT it falls back to charcoal (cream can't carry yellow text), so highlighted words rely on weight in light mode. Dark is the **primary** brand; light flips on device preference or a manual `[data-theme="light"]` pin.
- **State:** success `#15803D`, warning `#B45309` (bright `#F59E0B` for text on dark), danger `#B91C1C`. State colour is used sparingly — a left rule, a small chip — never large fills.

### Type
- **Manrope** (400–800) for display and body; **JetBrains Mono** (400–700) for eyebrows, tags, prices and metadata. (Exact Google Fonts the live app loads — no substitution.)
- **Display = ALL CAPS, weight 800, tracking `-0.04em`, line-height `~0.95`**, left-aligned, fluid `clamp()` sizing. The accent highlights one or two key words per headline.
- **Mono labels = uppercase, tracking `0.14–0.18em`**, small (`12px`), dim. Used for eyebrows, KPI labels, "QUOTE REF", timestamps.
- Body is Manrope, sentence case, `line-height 1.6`. Prices and any tabular figure use mono with `tabular-nums`.
- Minimum sizes: 24px+ for slide/marketing display; 12px floor for mono labels; body ≥ 16px.

### Backgrounds & texture
- **No flat fills on hero surfaces.** The marketing canvas carries a restrained **twin radial glow** (a cool warm-charcoal lift + one warm yellow ember) at the top. The dashboard uses a single soft top-of-page lift.
- **Film grain** (`~4.5%` fractal-noise tile, fixed, non-interactive) over dark surfaces — it kills the banding that makes flat dark UIs read as cheap.
- **Topographic SVG overlay** — slow-drifting ridge contour lines (warm grey + one accent ridge) behind the hero and the quote page. The signature "lit field".
- **Photography is duotone-treated** — desaturated + warmed, then a multiply scrim tints shadows to warm charcoal and a soft-light pass lifts highlights toward the accent, so stock trade photos read as native to the palette. Warm, friendly, real Australian tradies — never cold stock. Captions sit on a guaranteed dark gradient for AA contrast.
- **No gradient buttons, no glassmorphism, no neon.** Gradients appear only as the canvas glow and the 2px accent card-sweep line.

### Borders, corners, depth
- **Square corners.** Radius is `0` on cards, panels, inputs and buttons. The only rounded things are status **dots** and **avatar discs** (full circle). No pills, no rounded rectangles.
- **Borders, not shadows.** A `1px` warm hairline (`--ink-line`) is the structural unit. Cards are `bg-ink-card` + hairline border. Depth on dark comes from the **lit edge** (`.qm-edge-lit` — a 1px *inner* top highlight, an inner glow, not a cast shadow). Drop shadows are reserved for true overlays (dialogs, menus, toasts) and are warm-charcoal tinted, never neutral black.
- **Numbered cards** are a signature: a large JetBrains Mono number (`01`, `02`) in accent sitting beside the card title.

### Motion
- **Motivated motion only**, CSS-only. The signature easing is **expo-out `cubic-bezier(0.22, 1, 0.36, 1)`** over `~640–700ms` for hero/reveal, `~320ms` for surface flips.
- Patterns: hero **rise** (fade + 18px up, staggered by `animation-delay`), scroll **reveal** (fade + 22px up), SMS bubble **pop-in** (fade + scale 0.97→1), a 3-dot **typing** bounce, the `pulse-soft` live-status dot, the topography drift, and the marquee ticker. No spinners-as-decoration, no infinite loops on content, no bounce-easing. `prefers-reduced-motion` collapses everything to instant.

### Interaction states
- **Hover:** borders shift to accent (`hover:border-accent/40`) and/or the surface lifts a step (`ink-card → ink`); the `.qm-card-sweep` draws a 2px accent line across the card's top edge; links draw a left-to-right underline; primary buttons darken to `--accent-press`. Hover is a **colour/border** change, not a scale.
- **Focus:** a visible `2px` `--accent-soft` ring at `2px` offset — always present for keyboard users (never removed).
- **Press / active:** fill darkens to `--accent-press`; subtle, no large scale-down.
- **Disabled:** `opacity ~0.6`, no pointer.

### Layout
- Max widths: marketing `88rem`, app content `96rem`, focused single-column (quote, auth) `48rem`. Side gutter `1.5rem` mobile / `2rem` desktop.
- Sticky, blurred nav (`bg-ink-deep/85 backdrop-blur`) with a hairline bottom border. Generous section padding (`6rem` mobile → `8rem` desktop). Sections divided by hairline borders, not whitespace alone.
- The **yellow marquee bar** is the brand's closing punctuation at the foot of marketing pages and the quote page.

---

## ICONOGRAPHY

QuoteMax uses **[Lucide](https://lucide.dev)** line icons, plus a small set of mono characters and one brand mark. It draws **no bespoke decorative SVGs**.

- **Icon set: Lucide React** (`lucide-react` in the app). Line icons, **`strokeWidth` 1.75** in chrome/nav, up to `2` for emphasis; `size` 16–20 inline, larger for feature tiles. Square line-caps suit the brand but Lucide's default round caps are used as-is in the app. In static HTML, load Lucide from CDN (`https://unpkg.com/lucide@latest`) and call `lucide.createIcons()`, or inline the specific SVG. Tints follow text tokens (`--text-dim`/`--text-sec`) or `--accent` for active/emphasis. Representative icons in use: `LayoutDashboard, FileText, MessageSquare, User, DollarSign, Wrench, Package, Calculator, PhoneCall, Copy, Check, CreditCard, Shield, CalendarDays, LogOut`.
- **Mono character "icons".** Forward motion and list markers are JetBrains Mono glyphs, not SVGs: `→` (forward / auto-quoted), `›` (assumptions), `○` (site-visit items), `!` (risk), `★` (pricing wizard), `·` (metadata separator). Keep these mono and small.
- **The brand mark** (`assets/logos/quotemax-mark.svg`) — a **dark speech-bubble with a tail and a tick inside, on a Caterpillar-yellow tile**. Square tile, the bubble + tail in `--accent-ink`, the tick in `--accent`. It says the product out loud: an AI receptionist that quotes by text and approves the job. The same glyph is the favicon, the home-screen icon and the in-app/nav logo. Theme-aware via CSS variables, so it works on both themes. Rasters: `quotemax-mark-512.png`, `quotemax-mark-1024.png` (for avatars/stores/decks).
- **The wordmark** is just the mark + "QUOTEMAX" set in Manrope 800, uppercase, tight tracking, in `--text-pri` (one colour — the live nav does NOT colour "MAX" in the current brand). See `components/brand/`.
- **Flags / partner logos.** The Australian flag (`assets/icons/au-flag.svg`) appears in the "Built for Australian tradies" chip. Partner/stack logos (`assets/partners/` — Anthropic, Gemini, Twilio, ElevenLabs, Deepgram, Vapi, Voyage) render **monochrome** (`filter: brightness(0)` / inverted on dark) at `~60%` opacity, revealing their real colour on hover in the "Powered by" marquee.
- **No emoji. Ever.**

---

## Repository index

The map of this repository. Everything reachable from `styles.css` ships to consumers; components are bundled to `window.QuoteMaxDesignSystem_638aa1`.

### Root
- **`styles.css`** — the global entry point. Consumers link this one file; it is an `@import` manifest only.
- **`base.css`** — element resets + the signature motif classes (`.qm-card`, `.qm-edge-lit`, `.qm-card-sweep`, `.qm-grain`, `.qm-marquee` + `.qm-marquee__track`, `.qm-display`, `.qm-duotone`). Imported last by `styles.css`.
- **`readme.md`** — this guide. **`SKILL.md`** — Agent-Skills frontmatter so the system can be downloaded and used in Claude Code.

### `tokens/` — CSS custom properties (imported by `styles.css`, in order)
`fonts.css` (Manrope + JetBrains Mono via Google Fonts) · `colors.css` (palette + `[data-theme="light"]` resolution) · `typography.css` (families, fluid scale, tracking, leading) · `spacing.css` (4px grid, containers, hit targets) · `effects.css` (radii=0, borders, lit-edge, grain, easing) · `motion.css` (keyframes + `prefers-reduced-motion`).

### `components/` — 13 React primitives → `window.QuoteMaxDesignSystem_638aa1`
Each is `<Name>.jsx` + `<Name>.d.ts` + `<Name>.prompt.md`; one `*.card.html` per directory populates the Components group of the Design System tab.
- **`core/`** — `Avatar`, `Badge`, `Button`, `Eyebrow`, `Stat`, `StatusPill`
- **`forms/`** — `SegmentedToggle`, `TextField`
- **`quote/`** — `SmsThread`, `TierCard`
- **`surfaces/`** — `Card`, `Marquee`, `NumberedCard`

### `foundations/` — 18 specimen cards (Design System tab)
**Brand** (7): logo, wordmark, chips/eyebrows, numbered card, marquee, texture/grain, duotone. **Colors** (5): accent, surfaces, text, state, light theme. **Type** (4): display, body, mono, scale. **Spacing** (2): scale, radii.

### `ui_kits/` — high-fidelity product recreations
- **`marketing/`** `{index.html, marketing.jsx, README.md}` — landing + pricing, live SMS-intake demo.
- **`dashboard/`** `{index.html, dashboard.jsx, README.md}` — tradie CRM + quote review (5 views).
- **`customer-quote/`** `{index.html, quote.jsx, README.md}` — mobile Good/Better/Best quote page.
- **`_shared/kit.jsx`** — inline-styled mirrors of the bundled components (`window.QMUI`) so each kit previews standalone.

### `assets/`
- **`logos/`** — `quotemax-mark.svg` + `-512.png` / `-1024.png` rasters.
- **`icons/`** — `au-flag.svg`.
- **`partners/`** — `anthropic`, `gemini`, `twilio`, `elevenlabs`, `deepgram`, `vapi`, `voyage` (`.svg`, rendered monochrome).
- **`photos/`** — `home-on-the-tools`, `workshop`, `trade-{electrical,plumbing,solar,roofing,painting,carpentry}.jpg` (apply `.qm-duotone` to keep them on-palette).

> `_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json` are **generated** — never edit them by hand.
