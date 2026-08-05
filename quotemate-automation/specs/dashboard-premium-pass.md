# Dashboard premium pass — `bolder` · `animate` · `harden`

Status: in progress · Branch: `feat/dashboard-premium-pass` · Opened 2026-08-05

Driven by `/impeccable audit` on `/dashboard`, which scored **10/20 (Acceptable —
significant work needed)** and returned a **FAIL** on Implementation Integrity.
Every requirement below traces to a verified audit finding; the audit's evidence
is quoted inline so a reviewer can check the claim without re-running it.

## Objective

The tradie dashboard reads as a premium product. Concretely, three measurable
defects go away:

1. It stops rendering another product's design system in two live tabs.
2. It gains a type scale, so something on each tab leads.
3. It stops showing dead screens while it works or when it fails.

Success is judged against the requirements below, not against "looks better".

## Non-goals

- **No behaviour, data-flow, routing or API changes.** This is a design pass.
  Copy may be added for empty/error states; existing copy keeps its meaning.
- **No new palette, font, or system primitive.** Everything comes from
  `DESIGN.md` / `PRODUCT.md` / `globals.css` tokens.
- **No performance work.** `next/image`, lazy loading and splitting the
  17,000-line client component are real P1s from the audit but belong to
  `/impeccable optimize` — explicitly deferred, not forgotten.
- **No customer-facing surfaces.** `/q/*`, `/r/*`, `/book`, marketing. Dashboard
  and its sub-routes only.

## Scope

`/dashboard` shell (topbar, sidebar rail, mobile tab strip) and every tab:
Overview, Quotes, Chats, Calendar, Follow-ups, Account, Payouts, Pricing,
Services, Billing, Files, Historical quotes, Catalogue, Estimating, Recipes,
Estimator, Solar, Marketing, Flyer, Videos, Aircon, plus the Roofing, Signage
and Painting hubs. Sub-routes: `/dashboard/crm`, `/pricing-wizard`, `/studio`,
`/signage/*`, `/painting`, `/roofing/measure`, `/roofing/measurements/*`,
`/aircon`, `/quote/[token]`, `/job/[trade]`, `/invites`, `/estimator/[runId]`.

---

## Phase 0 — Return to the design system

### R0.1 — `EstimatorChatbot` runs on tokens

`app/dashboard/_components/EstimatorChatbot.tsx:22-27` declares its own palette:
`ACCENT '#FF5F00'`, `PANEL '#16202b'`, `PANEL_2 '#0f1722'`, `BORDER '#243140'`,
`TEXT '#e6ebf0'`, `MUTED '#94a3b8'`. That is a cool blue-black surface with a
burnt-orange accent. `DESIGN.md` bans both by name ("Don't reintroduce the
retired navy + orange", "never use a cool-grey or blue-black canvas"). It is
live in **Commercial Painting** (`CommercialPaintingTab.tsx:917`) and
**Estimator** (`RunWorkspace.tsx:487`).

**Done when:** all six constants resolve to design tokens
(`--accent`, `--ink-card`, `--ink`, `--ink-line`, `--text-pri`, `--text-dim`);
`grep -E '#(FF5F00|16202b|0f1722|243140|e6ebf0|94a3b8)' EstimatorChatbot.tsx`
returns nothing; the component still renders in both host tabs.

### R0.2 — The 41 side-tabs are gone

The bundled detector reports **42 anti-patterns**, 41 of them `border-l-4`
across 15 files, plus one `border-t-2` on a rounded card
(`_components/quote-ui.tsx:182`). Detector verdict: "the most recognizable tell
of AI-generated UIs".

Replace each with the system's own accent language — the lit edge (`edge-lit`),
a 1px `border-ink-line` hairline, and/or a mono uppercase eyebrow. Preserve the
semantic each carried (a warning strip stays legible as a warning).

**Done when:** `node .claude/skills/impeccable/scripts/detect.mjs
quotemate-automation/app/dashboard` reports **0** `side-tab` and **0**
`border-accent-on-rounded` findings.

### R0.3 — Chrome colours return to the palette; data-viz gets a brand ramp

Two different problems, two different fixes.

**(a) Chrome — remove outright.** These are not encoding data:
| File | Value | Violation |
|---|---|---|
| `roofing/measurements/[id]/topology/TopologyEvidencePanel.tsx` | `#0A1628` panel fill | blue-black canvas |
| `invites/page.tsx:125` | `#2D3A4F` grid lines | cool grey |
| `flyer/_components/FlyerCanvasEditor.tsx:68,187` | `#33415A` borders | cool grey |
| `page.tsx` (dashboard) | `text-[#FF375F]` | second accent |
| `roofing/measure/page.tsx:1198-1199` | `#14B8A6` gradient | second accent |

**(b) Data-viz — replace the ramp, do not delete it.** `RoofMap.tsx` (roof edge
types), `FloorPlanOverlay.tsx` (room types), `PlanOverlay.tsx` (pin categories)
legitimately need categorical hues — eight room types cannot be encoded in one
yellow. Their current palettes (`#3a86ff`, `#8338ec`, `#ef476f`, `#2ec4b6`,
`#06d6a0`, `#ff6b35`…) are a generic bright rainbow that clashes with warm
charcoal.

Define **one** categorical ramp in `globals.css` as
`--viz-1` … `--viz-8`: warm ochres, rusts, clays and bones, anchored by the
accent at `--viz-1`, with a single cool value permitted for maximum separation.
Every value must clear 3:1 against `--ink-card`. All three components consume it.

**Done when:** the ramp exists as tokens, the three components reference tokens
rather than literals, the chrome literals in (a) are gone, and no dashboard file
outside the ramp definition introduces a non-token hue.

---

## Phase 1 — `bolder`

### R1.1 — ~~A type scale exists and is used~~ REVERTED on product-owner call

**Built, shipped, then reverted.** The scale was applied across 796 sites; the
product owner reviewed the running dashboard and rejected it — the cockpit came
back visibly heavier and read as shouting. All 697 `text-micro`/`text-meta`/
`text-section`/`text-metric` sites were mapped back through the codemod's own
forward table (exact originals restored, not approximated) and the four tokens
were removed from `globals.css`.

**What went wrong, so it is not repeated:** the scale collapsed nine
near-identical sizes between 8.8px and 11.2px into one 11px step. Each
individual jump looked negligible (`0.6rem` → 11px is +1.4px), but ~265 of the
~430 sub-11px labels moved **up**, and in a dense uppercase wide-tracked UI
raising the entire label layer at once makes every panel louder. The
`--text-micro` deviation note below correctly identified the *layout* risk
(overflow) but missed the *visual weight* risk, which is what actually bit.

**Rule for any future attempt:** a consolidating step must sit at or below the
**weighted mean** of the sizes it absorbs. 11px was above it. And hierarchy is
not bought by lifting the label layer — it is bought by making exactly one
element per tab genuinely large (R1.3) and leaving the rest alone.

Everything below is retained as the record of what was tried.

---

#### Original requirement (superseded)

Audit evidence: ~700 arbitrary sizes across ~18 near-identical values —
`text-[0.6rem]`×123, `[0.7rem]`×114, `[0.65rem]`×92, `[0.62rem]`×81,
`[0.78rem]`×68, `[0.72rem]`×60, `[0.55rem]`×38, `[0.66rem]`×31, `[0.68rem]`×29,
`[0.58rem]`×19 — nine of them between 8.8px and 11.2px. Against 856 uses of
`text-sm`/`text-xs` and 94 above 16px. Differences nobody can perceive, so they
buy no hierarchy while costing all consistency.

Define a **seven-step dashboard scale** in `globals.css`. It extends, and does
not replace, `DESIGN.md`'s five brand steps — `label` (12px), `body` (16px) and
`title` (20px) are carried over unchanged; the rest serve cockpit density.

| Token | Size | Role |
|---|---|---|
| `--text-micro` | 11px | dense chips, table headers inside constrained cells |
| `--text-label` | 12px | mono uppercase eyebrows — `DESIGN.md`'s label |
| `--text-meta` | 13px | secondary sans metadata |
| `--text-body` | 14px | default dashboard UI text |
| `--text-lede` | 16px | `DESIGN.md`'s body — intro and emphasis |
| `--text-title` | 20px | `DESIGN.md`'s title — card headings |
| `--text-section` | 28px | tab headers |
| `--text-metric` | `clamp(2rem, 3vw, 3rem)` | the one focal number per tab |

Mapping: ≤12px → `micro` or `label`; 12.5–13.4px → `meta`; 13.5–15px → `body`;
16px → `lede`; 18–20px → `title`; 24–30px → `section`; >30px → `metric`.

> **ASSUMPTION — flagged for the reader.** `DESIGN.md` states "12px is the
> floor" for mono labels. This spec introduces `--text-micro` at **11px** as a
> documented deviation. Raising all ~430 sub-12px instances straight to 12px is
> a 25–36% size increase across nav labels, badges and fixed-width table
> headers, and Clerk auth gates the dashboard so the overflow cannot be visually
> verified in this session. 11px keeps dense cells intact while still removing
> the 8.8px and 9px labels, which are the genuinely illegible ones. If the
> reader would rather take the layout risk and go to a hard 12px floor, that is
> a one-line change to the mapping table.

**Done when:** the tokens exist; zero `text-[<n>rem]`/`text-[<n>px]` arbitrary
values remain in `app/dashboard/**/*.tsx` except where a token is referenced;
no rendered text is below 11px; typecheck passes.

### R1.2 — Cards stop being flat

Audit evidence: **290 `rounded-card` against 24 `edge-lit`** — the system's own
"default lifted plate treatment on dark cards" is on 8% of surfaces. Billing 5/0,
Solar 8/0, Files 4/0.

Establish two card ranks:
- **Primary panel** — `edge-lit`, `bg-ink-card`, `border-ink-line`.
- **Supporting panel** — `bg-ink` or `bg-ink-deep`, hairline only, no lit edge.

Depth must separate ranks; it is not applied uniformly (uniform lift is the same
flatness at a different offset).

**Done when:** every top-level card in every tab carries a rank; `edge-lit`
count rises from 24 to cover all primary panels; nested cards inside a primary
panel do not double-lift.

### R1.3 — One focal element per tab

Every tab currently opens with an even field of same-weight cards. Each tab gets
exactly one largest element — the number or action that matters most on it —
set at `--text-metric` or as the single accent-filled CTA, with everything else
stepping down.

**Done when:** each tab in scope has exactly one element at `--text-metric` or
one accent-filled primary action, documented in a table in this spec's
completion notes. The `bolder` skeleton test applies: with copy stripped, the
hierarchy alone still says what the tab is for.

---

## Phase 2 — `animate`

### R2.1 — Motion reaches tab interiors

The shell already moves (press feedback, tab swap, sidebar tick, busy sheen,
skeleton shimmer — shipped previously and verified). Tab *interiors* are static.

Per `emil-design-eng` and `impeccable/animate`, every addition must explain
feedback, state, relationship or hierarchy. Decoration is animation debt.

- Card grids and list/table bodies stagger in via the existing `.qm-stagger`
  (45ms step, capped at child 7).
- The focal metric from R1.3 counts up on first paint only — never on re-render,
  never on tab revisit.
- Section reveals on long tabs (Account, Pricing, Services) use the existing
  `.qm-tab-panel` vocabulary rather than a new one.

**Done when:** every tab in scope has at least one motivated entrance; all
motion is `transform`/`opacity` only; `prefers-reduced-motion` removes movement
(not merely shortens it); no animation gates interaction — content is clickable
the frame it paints.

---

## Phase 3 — `harden`

### R3.1 — Every tab has real empty, loading and error states

Audit: empty states exist in 27 of 77 files, error branches in 22, and 32
`Loading…` labels were converted to a breathing text placeholder in the prior
pass — a stopgap, not a skeleton.

For every tab in scope:
- **Loading** — a `.qm-shimmer` skeleton shaped like the incoming content.
  A breathing word is the fallback only where the shape is genuinely unknowable.
- **Empty** — says what the surface is for and offers the one action that
  populates it. Not "No data".
- **Error** — states what failed in the tradie voice (present tense, plain,
  Australian English, no exclamation marks) and offers a working retry control.
  A red sentence with no way forward does not satisfy this.

**Done when:** each tab in scope renders all three; every error state has a
retry that re-issues the failed request; no `catch` swallows an error into a
blank panel.

### R3.2 — ~~The WCAG-A alt failures are fixed~~ WITHDRAWN — false positive

**This requirement was based on a faulty measurement and is withdrawn.**

The audit claimed 14 of 22 `<img>` in `app/dashboard` ship with no `alt`, and
graded it P1 / WCAG 1.1.1 Level A. The detection was
`grep -rn '<img' | grep -v 'alt='`, which only inspects the line the tag opens
on. JSX routinely puts attributes on the following lines:

```jsx
<img
  src={photoUrl}
  alt="Uploaded property photo"   ← invisible to a single-line grep
/>
```

Re-run with a parser that reads each tag through to its closing `>`, the count
of `<img>` without `alt` in `app/dashboard` is **0**. Every one of the
originally-named sites is fine — `PhotoVerify.tsx` has
`alt="Uploaded property photo"`, `StreetView.tsx` has
`` alt={`Street View of ${address ?? 'the property'}`} ``. The only three
remaining matches are the literal string `<img>` inside explanatory comments.

**Verification method for anyone re-checking:** parse the tag, do not grep the
line. Accessibility findings asserted from single-line greps over JSX are not
trustworthy in either direction.

**Status:** no work required. Accessibility for images was already correct; the
audit was wrong, not the code.

---

## Constraints (apply to every phase)

- **C1** Design system only: warm-charcoal canvas, single Caterpillar-yellow
  accent, Manrope + JetBrains Mono, rounded corners (14px card / 9px control),
  borders and lit edges over shadows. No second accent outside the R0.3 viz ramp.
- **C2** Australian English. No emoji. No exclamation marks. No em-dashes in
  user-visible copy.
- **C3** WCAG 2.1 AA: body ≥4.5:1, large ≥3:1, dark-charcoal on any yellow fill
  (never white), visible 2px focus ring preserved.
- **C4** Both themes must work. Every change is verified in dark *and* light.
- **C5** No behaviour change. Existing props, handlers, routes and state
  machines are untouched.

## Definition of done

1. Every requirement R0.1 → R3.2 met.
2. `npx tsc --noEmit` clean.
3. Full suite green — baseline is **7,498 passed / 22 skipped**. No new failures.
4. `eslint app` introduces no new findings over the 117 pre-existing ones.
5. Detector reports **0** findings on `app/dashboard`.
6. `/impeccable audit` re-run scores **≥16/20** with Implementation Integrity
   **≥3** and a PASS verdict.
7. Every phase reviewed by `/review` against this spec, then by `code-reviewer`.

## Verification path

The dashboard is behind Clerk, but `.claude/skills/verify/SKILL.md` documents a
proven recipe for driving it end-to-end: resolve the tenant owner by email
through the Clerk API, mint a single-use sign-in token, and drive an
own-launched chromium to `/sign-in?__clerk_ticket=…` then `/dashboard`. Visual
verification therefore runs at the rendered-pixel level, not only at the token
level.

Per that skill's gotchas: mint one token per browser run (single-use), navigate
the sidebar by exact trimmed `textContent` (a `has-text("Quotes")` locator hits
the search palette placeholder and opens a click-intercepting modal), and allow
~6s for lazily-fetched Overview widgets.

Each phase is verified in **both themes** (C4) and at **mobile + desktop**
widths before its review gate.
