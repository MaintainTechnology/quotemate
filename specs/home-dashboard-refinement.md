# Home & Dashboard Refinement — QuoteMax (Command Centre, for Tradies)

> Status: **Phase 1 — Evaluate (checkpointed).** This spec supersedes the pasted draft. The blue/orange/Inter `DESIGN.md`/`PRODUCT.md` blocks in the original prompt were generic placeholders and are **discarded** — they are literally the "Generic SaaS" anti-reference. The authoritative brand is the **Command Centre** system (`redesign/DesignSystem` → `DESIGN.md`): warm charcoal `#16120F` + one Caterpillar-yellow `#FFC400` accent, Manrope + JetBrains Mono, square corners (brand register), borders-not-shadows. Impeccable *may suggest* improvements on top of it.

## Goal

- `/impeccable critique` heuristics **≥ 90%** equivalent per targeted surface (all P0/P1 resolved; Nielsen total ≥ 36/40; audit ≥ 18/20), reported honestly per surface.
- **Zero** hits from `node .claude/skills/impeccable/scripts/detect.mjs` (no anti-slop violations) on targeted surfaces.
- WCAG **AA** contrast (body ≥ 4.5:1, large ≥ 3:1, placeholder ≥ 4.5:1) at 375 / 768 / 1024 / 1440 px, no horizontal scroll.
- **No rebuild** — polish existing surfaces only. No new pages or components.

## Role

Principal Product Designer + Design Engineer, orchestrating impeccable commands to polish existing UI in a technical, tradie-first brand — without rebuilding.

## Scope (Phase 1 — confirmed)

| Surface | Register | Target files |
|---|---|---|
| Home | brand | `quotemate-automation/app/page.tsx` + `app/_components/` |
| Customer quote page (+ 12 trade variants) | brand | `app/q/[token]/page.tsx`, `app/q/_chrome/parts.tsx`, `app/q/[token]/TradeTiers.tsx`, variants `app/q/{paint,roof,solar,aircon,commercial-paint,choose,plan}/[token]/` |
| Dashboard shell | product | `app/dashboard/page.tsx` (shell/nav/tabs + Overview/KPI; sample the 5 tabs) |

**Phase 2 (deferred):** `/admin` (13 routes), `/onboard` (5), auth (8), `/account`, `/docs/*`, remaining customer surfaces (`/m`, `/p`, `/paint-request`, `/upload`, `/studio`).

## Tooling reality (corrected from the draft)

- Detector: `node .claude/skills/impeccable/scripts/detect.mjs --json <paths>` (there is **no** `npx impeccable detect`). Exit 0 = clean, 2 = findings.
- Critique: `/impeccable critique` is a heuristic **scored review**, not a CI number. "≥ 90" = all P0/P1 resolved + Nielsen ≥ 36/40 + audit ≥ 18/20, reported per surface.
- Build gate = **pnpm**: `pnpm build` (`next build`), `pnpm lint` (eslint), `pnpm typecheck` (`tsc --noEmit`), `pnpm test` (vitest), `pnpm test:e2e` (playwright). Run from `quotemate-automation/`.
- ⚠ `next build` and Playwright screenshots need a working local env (`.env.local`, Clerk keys, Cesium assets, `pnpm dev` on `:3000`). If the local env can't build/serve, the **visual + detector gates become authoritative** and the build gate is reported as "not runnable locally" rather than silently skipped.

## Execution mode — **checkpointed** (confirmed)

Evaluate → present scored backlog + command ledger → apply in reviewable batches with breakpoint screenshots → re-run critique/detect → report. **No autonomous 20-iteration Ralph loop.** No command runs without a concrete finding; every applied finding maps to exactly one axis command; every skipped command is justified with evidence.

## Task flow

1. **Ground** — reconcile `DESIGN.md` against live tokens (`app/globals.css`) + `redesign/DesignSystem`. *(Done — see Ground findings below.)*
2. **Evaluate** — `/impeccable critique` (Assessment A) + technical `audit` (5 dims) + `detect.mjs` (Assessment B) on the three surfaces. Persist the scored backlog. *(Detector done; critique/audit fan-out running.)*
3. **Select** — build the command ledger (Apply vs Skip) from the backlog. Early-exit any surface already at the bar with clean detect + 4 breakpoints passing.
4. **Chokepoint** — if many components share ad-hoc hex/duplicated tokens, run `/impeccable extract` to a shared source **before** surface edits; reflect new tokens in `DESIGN.md`.
5. **Iterate (checkpointed)** — apply the top ledger command, then `polish`; verify with a breakpoint screenshot pass (375/768/1024/1440); re-run `critique` + `detect`; run `/code-review`; fix findings. Present each batch for review.
6. **Hooks** — once `detect` is zero across targets, enable `/impeccable hooks on` to lock in intentional brand choices.
7. **Report** — final critique score, detector status, screenshots, AA checklist, applied-vs-skipped ledger.

## Ground findings (Step 1 — complete)

- **Colours aligned** ✅ — live `globals.css` == `DESIGN.md` == `redesign/DesignSystem` (charcoal `#16120F`, yellow `#FFC400`, both themes).
- **Reconciled → `paper-line` `#E9E3DC` → `#CFC2B0`** in `DESIGN.md` (live code darkened it for AA; `#E9E3DC` was ~1.25:1).
- **Documented register-scoped radii** in `DESIGN.md`: brand surfaces are square (radius 0); the **dashboard cockpit intentionally rounds** to 14px/9px. Do not "fix" the dashboard to square.
- **Code-hygiene items (low priority, apply-phase):** `globals.css` header still cites the retired `.claude/skills/maintain-design-system/`; live CSS var names are legacy `--teal-glow`/`--teal-deep` vs the DS's `--edge-glow`/`--edge-deep`. Repoint the comment; leave the var rename for a scoped follow-up (used widely).

## Detector baseline (Step 2 — Assessment B, complete)

| Surface | Hits | Breakdown |
|---|---|---|
| Home | **0** ✅ | clean |
| Quote (+variants) | **22** | Side-tab accent border ×4 (banned side-stripe); Color-outside-DESIGN ×15 (mostly solar/roof map overlays — verify data-viz legitimacy); Broken/placeholder image ×2; Font-outside-DESIGN ×1 |
| Dashboard | **2** | Side-tab accent border ×2 (`page.tsx:2701`, `:8174`) |

## Evaluate results (Step 2 — complete)

| Surface | Critique /40 | Audit /20 | Detect | Slop verdict |
|---|---|---|---|---|
| Home | 30 | 17 | 0 | Not slop — bespoke, high-craft |
| Quote | 29 | 14 | 22 | Not slop — but ships a P0 |
| Dashboard | 32 | 16 | 2 | Not slop — strong, opinionated |

Severity totals: **P0 ×1, P1 ×12, P2 ×20, P3 ×11** (44 findings). Full per-finding detail in the workflow journal (`wf_86dc0d75-032`).

Systemic themes (highest leverage): (1) `text-white` on yellow across all surfaces, rescued only by a global specificity hack — includes the P0; (2) missing focus rings on nav/inputs (all 3); (3) sub-12px mono labels (all 3); (4) rounded corners on brand surfaces vs radius-0 (home/quote; dashboard excepted); (5) off-token colours + `bg-ink-base` typo ×12 + light `--text-dim` sub-AA; (6) stale retired-brand comments.

## Command Ledger (finalized)

| Command | Apply / Skip | Triggering finding (severity) | Notes / evidence |
|---|---|---|---|
| `harden` | **Apply** | Missing focus rings on nav+inputs, all 3 surfaces (P1); optimistic-save not announced to SR (P1); invalid `bg-ink-base` ×12 (P2); branded 404/not-found + null-CTA sticky bar (P1); `text-white`-on-yellow crutch (P0/P2) | Largest bucket (12); systemic a11y |
| `colorize` | **Apply** | White-on-yellow `$99` CTA **P0**; hard-coded greens (P2); dashboard `teal-glow` state (P2); light-theme `--text-dim` sub-AA (P2) | Token enforcement |
| `typeset` | **Apply** | Sub-12px mono labels below brand floor, all 3 (P1/P2); em-dashes in customer copy (P2); accent-word emphasis collapses in light theme (P1) | |
| `clarify` | **Apply** | Contradictory trades live/coming-soon (P1); inconsistent CTA labels (P2); unify deposit-CTA copy (P2); `New quote` mislabel (P2); stale retired-brand comments (P3) | |
| `distill` | **Apply** | Home 15-band redundancy / repeated trades (P1/P3); hero triple preamble (P2); dashboard `Business` nav catch-all (P3) | |
| `layout` | **Apply** | Peak-end: page closes on 'coming soon' (P2); sub-44px touch targets (P3) | |
| `polish` | **Apply (final + radius)** | Rounded corners violate radius-0 on brand surfaces (P1, home+quote); PDF `alert()` fallback (P3); final pass | Dashboard radii excepted |
| `optimize` | **Apply (selective)** | Logo `<img>` CLS (P3); dashboard monolith → dynamic tab imports (P3); gate off-screen marquees/topo (P3) | Perf; cheap wins |
| `animate` | **Apply (small)** | SMS demo timeline not IO-gated / never replays (P3) | |
| `adapt` | **Apply (small)** | Recent-quotes rows don't deep-link to their quote (P2) | Product-logic tweak |
| `extract` | **Skip** | — | Tokens are already centralized in DESIGN.md/globals.css; the problem is call sites BYPASSING them, not duplication. The chokepoint is a global-CSS + call-site enforcement sweep (under harden/colorize), not token extraction |
| `overdrive` | **Skip** | — | No finding requests convention-breaking; brand is deliberate restraint |
| `bolder` | **Skip** | — | 0 findings; critiques praise the existing boldness |
| `quieter` | **Skip** | — | 0 findings; home's issue is redundancy (→distill), not overstimulation |
| `delight` | **Skip** | — | 0 findings; brand is intentionally restrained/technical |
| `onboard` | **Skip (Phase 1)** | — | No first-run/empty-state finding in the three scoped surfaces |

**Chokepoint = Batch 1 (systemic sweep):** one `globals.css` `:focus-visible` rule + delete the `.bg-accent.text-white` crutch + fix `text-accent-ink` at call sites + `bg-ink-base`→`bg-ink` + darken light `--text-dim`. This single batch clears the **P0** and the bulk of the P1 a11y across all three surfaces.

## Acceptance criteria & gates

- **Critique:** per-surface bar met (P0/P1 = 0, Nielsen ≥ 36/40, audit ≥ 18/20); score never decreases across iterations.
- **Detect:** zero anti-slop hits on targeted surfaces (side-stripe borders, gradient text, glassmorphism, identical card grids, per-section eyebrows, scaffold numbering, default system fonts, text overflow).
- **Contrast:** AA at all four breakpoints.
- **Breakpoints:** 375/768/1024/1440 — no horizontal scroll, no layout shift, consistent max-width (brand `88rem`, product `80rem`, focused `48rem`).
- **Design system:** `DESIGN.md` reflects the final token set; no one-off colours/fonts remain (dashboard radii excepted, documented).
- **Build:** `pnpm build` + `pnpm lint` + `pnpm typecheck` pass, OR are reported as not-runnable-locally with the visual/detector gates authoritative.
- **Review:** `/code-review` clean; no lingering findings.
- **Hooks:** impeccable hooks enabled to prevent regression.

## Constraints

- Only the named surfaces are touched; no new pages/components.
- Pure styling changes are verified by screenshots, not TDD; behavioural changes get a test.
- Brand register rules (square corners, one accent) are **not** applied to the product dashboard where they conflict with the documented product-register exceptions.
- `DESIGN.md` remains the single source of truth; any token added during extraction is reflected there.

## Progress log

**Batch 1 (systemic sweep) — done, verified.** Global `:focus-visible` ring (globals.css); light `--text-dim` `#837870`→`#6E645C` (AA, synced to DESIGN.md); `bg-ink-base`→`bg-ink` ×12 (dashboard invalid token); warm-tinted caption text-shadow; squared `.link-underline` focus outline. `pnpm typecheck` 0. Home verified @1440/375.

**Batch 2 (type + colour) — done, verified.** 22 home + 14 quote + 14 dashboard edits: 12px mono-label floor (11px + eased tracking in dense spots); customer-visible em-dashes → `·`/full stops; greens → `success-bright`; dashboard `teal-glow` state → `success-bright`/`border-accent`; light-theme accent-word yellow-underline emphasis (globals.css, synced to DESIGN.md). `pnpm typecheck` 0. Quote detector 22→19. *Gap:* shared `_components` + `parts.tsx` extra mono labels + 3 dashboard section eyebrows still sub-12px (polish-pass follow-up).

**Batch 3 (radius + brand fidelity) — done, verified.** Home squared: 34 corners → `rounded-none` across `page.tsx`/`site.tsx`/`PricingTiers.tsx`/`AuthNav.tsx` (3 `rounded-full` status dots kept); verified before→after @1440/375. `QuoteEditChat` migrated off its legacy cool-blue+orange palette (Inter/Courier/`#0b0f14`/`#FF5F00`) → brand tokens, now theme-aware. Cancelled page tokenized. `pnpm typecheck` 0. **All three surfaces 0 detector hits.**

**Batch 4 (clarify / distill / layout) — done, home verified.** Trades unified to all-live (`UpcomingTrade`→clickable `TradeTile`, no "coming soon"); hero eyebrow full-sentence → "AI quoting for Australian tradies"; signup CTAs unified to "Get my QuoteMax"; dead `OnTheTools` section cut; peak-end reorder so `ClosingCta` is the last band; quote deposit CTAs unified to a "Pay … deposit" family; dashboard "New quote" → "Review queue"; 9 em-dashes swept from home/pricing/cookie copy. `pnpm typecheck` 0; detector still 0/0/0.

**Batch 5 (polish) + rounded-corner reversal — done, home verified.** Product-owner decision: **home keeps ROUNDED corners** — reverted the Batch 3 squaring (32 corners restored faithfully via git) and **updated DESIGN.md + sidecar so rounded is the documented brand direction, superseding the square spec in `redesign/DesignSystem`**. All mono labels raised to the strict 12px floor (tracking eased in dense spots; no overflow). Re-critique punch-list cleared: MobileNav 44px tap targets; trade tags → "Live · NSW/QLD" (consistent); `CheckoutButton` now shows an accessible `role=alert` error on genuine failure instead of silently redirecting; PricingTiers em-dash + sub-12px labels; stale navy/orange comments repointed. `pnpm typecheck` 0.

### Documented detector ignores (`.impeccable/config.json` → `detector.ignoreFiles`)
- **Side-tab state/AI-marker rails** (user-confirmed keep+suppress; DESIGN.md State rule sanctions state left-rules): `dashboard/page.tsx`, `q/roof/[token]/page.tsx`, `q/solar/[token]/page.tsx`, `q/[token]/RoofHeroStrip.tsx`.
- **Solar map-viz components** (user-confirmed legit Cesium/canvas data-viz — slate map grey, black shade scrims, satellite `<img>`): `q/solar/[token]/BuildingPicker.tsx`, `q/solar/[token]/SunShadeOverlay.tsx`.

### Pending
- Quote + dashboard **screenshots** at 4 breakpoints (need test `/q/[token]` URL + dashboard login).
- Quote-surface **radius** (`.qm-quote --qm-r-card 16px` etc.) squaring — deferred until quote is screenshot-verifiable.
- Nav chrome radius (ThemeToggle/TradesMenu/MobileNav) — user chose to leave rounded for now.
- Mono-floor follow-up in shared `_components`/`parts.tsx`.
