# Trade hub dashboard polish

## Goal

Turn every enabled `/dashboard` trade hub (Electrical, Plumbing, Roofing, Signage, Painting, Commercial painting, Air-conditioning, and Solar) into a full-canvas dashboard workspace where all existing sections remain available, the section filters are the first organised control row, and the layout has no horizontal overflow at 375, 768, 1024, or 1440 pixels.

## Role

Act as the principal product designer and design engineer for QuoteMax. Audit the existing authenticated trade-hub surface, make the smallest production code change that resolves the layout and hierarchy issues, and verify the real responsive interaction path.

## Context

- Job shape: **polish** an existing UI, audit-first.
- Surface: the `TradeHub` experience rendered from `quotemate-automation/app/dashboard/page.tsx` for every `hub-*` trade tab.
- User: an Australian tradie moving between quotes, tools, pricing, services, catalogue, recipes, and estimating while working from a phone, tablet, or laptop.
- Current issue: the trade hub reads as content placed inside the general dashboard content container. Its title, filters, and selected section do not form a strong dashboard-level hierarchy, and the available canvas is underused.
- Scope assumption: “each Tradies tab” means the content surface opened by each trade entry in the existing Trades sidebar. The sidebar items, labels, enabled-trade rules, section contents, data paths, and save behaviour stay intact.
- Breakpoints: 375px mobile, 768px tablet, 1024px compact desktop, and 1440px desktop.
- Quality bar: flagship product polish for an authenticated daily-use surface.

## Design Decisions

1. **Design-system source:** QuoteMax Command Centre, reconciled from `.claude/skills/quotemax-infographics/references/DESIGN.md`, repository `DESIGN.md`, `.impeccable/design.json`, and `C:\Users\dalig\Downloads\DesignSystemQM`. Use warm charcoal `#16120F`, Caterpillar yellow `#FFC400`, dark ink `#1C1812` on yellow, Manrope UI/display, JetBrains Mono labels and figures, warm hairlines, lit edges, and no resting drop shadows. The attached brief explicitly requires square corners, so the new trade-hub frame and section rail use square corners as a scoped override; shared radius tokens and unrelated product surfaces are not rewritten.
2. **Build engine:** `/design-taste-frontend-v1`, audit-first, because this is an existing interface that needs hierarchy, spacing, responsive, and anti-card-overuse correction without changing behaviour.
3. **UX lens:** `/bencium-controlled-ux-designer`, because this authenticated daily-work surface must stay tightly on brand and preserve predictable, high-frequency interactions.
4. **Generated imagery:** no. This is a data-dense dashboard surface; generated art would add noise and does not improve the job.
5. **Iteration owner:** the requested `/ralph-loop:ralph-loop` runtime is not installed in this workspace. Run the same Draft → Polish → Verify iterations directly against this spec, fixing findings before completion.

## Task

1. Preserve every trade hub, section, count, control, component, and existing data/save path.
2. Let trade hubs use the full content column beside the existing sidebar rather than the general centred content container.
3. Build a clear full-width trade header with the existing breadcrumb, trade name, description, and truthful live metadata derived from the existing section list and quote count.
4. Move the complete section filter rail to the top of the hub, directly under the header context. Keep every section visible; wrap controls instead of hiding them behind overflow or a menu.
5. Give every filter a consistent Lucide icon, at least a 44px hit target, visible selected/hover/focus/pressed states, and a selected treatment that uses yellow with dark ink.
6. Render the selected existing section beneath the rail with responsive page padding and no new outer card/container.
7. Reuse current tokens and components. Do not add dependencies, routes, shared abstractions, generated assets, or unrelated refactors.

## Constraints

- Do not remove, rename, reorder out of existence, collapse, or hide any existing trade-hub section or its content.
- Do not change API calls, state ownership, save handlers, trade enablement, default Quotes selection, or business logic.
- Do not rewrite global design tokens or the shared sidebar as part of this scoped change.
- One accent only. No retired navy/orange palette, purple, gradient text, glassmorphism, emoji icons, decorative motion, or resting drop shadows.
- Yellow fills always use `text-accent-ink`, never white.
- Use the existing `lucide-react` dependency and the current 1.75px product stroke convention.
- Motion is limited to existing 150–300ms state transitions and must respect reduced-motion behaviour already scoped by `.qm-dash`.
- No test-only production bypass, fake dashboard state, or hard-coded screenshot data.
- Preserve unrelated dirty-worktree changes.

## Acceptance criteria & gates

### Beautiful criteria

- **Anti-slop:** Manrope and JetBrains Mono remain the visible type system; hierarchy is deliberate; no generic gradient, template card stack, extra accent, or decorative art is introduced.
- **Accessible:** normal text meets WCAG AA; selected state is conveyed by text/`aria-pressed` as well as colour; focus is visibly ringed; all filters remain keyboard-operable; every filter target is at least 44px high.
- **Responsive:** no page-level horizontal scroll or broken grid at 375, 768, 1024, or 1440px; one consistent full-width content-column rhythm is used; filters wrap and remain visible at every width.
- **Craft:** Lucide icons only, pointer cursor on controls, stable hover/pressed states with no layout shift, and 150–300ms transitions.
- **Coherent:** all colour, typography, border, and spacing choices use existing QuoteMax tokens or the established 4/8px spacing scale.

### Functional acceptance

- Every enabled trade renders the same polished hub frame.
- Quotes remains the default section.
- Tools appears only for trades that already support it.
- Quote counts remain accurate and visible.
- Clicking each section changes only the selected section and retains the existing component behaviour.
- No section content is clipped by the new frame or toolbar.

### Repository gates

Run from `quotemate-automation`:

- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test`
- Production build: `npm run build`
- Existing browser suite: `npm run test:e2e`

This change is layout/styling over existing section state, so it does not introduce new component logic and does not require a new TDD test. Existing tests must still pass.

### Visual and interaction gates

- Drive the changed trade-hub flow in the browser and capture screenshots at 375, 768, 1024, and 1440px.
- At each width, verify `scrollWidth <= clientWidth`, filters are visible and wrapped, the selected filter is apparent, and content begins below the filter rail.
- Verify keyboard focus and `aria-pressed` changes on at least two section filters.
- Run the `/ui-ux-pro-max` pre-delivery checklist: no emoji-as-icons, consistent Lucide icons, no hover layout shift, pointer cursors, 150–300ms transitions, visible focus, both light/dark token contrast, no hidden fixed-nav content, responsive at all four widths, no horizontal scroll, and reduced motion respected.
- Review the final diff against this spec. There must be no blocker or major finding before completion.

## Examples

- On Electrical, the header and full filter rail span the available dashboard column beside the sidebar. Quotes, Tools, Pricing, Services & brands, Catalogue, Recipes, and Estimating are all visible and remain interactive.
- On Plumbing, the same frame renders without a Tools filter because Plumbing does not currently ship that tool. Nothing else changes.
- At 375px, filters form a readable multi-row grid with 44px targets; they do not become a clipped horizontal scroller or hidden menu.
- At 1440px, the hub uses the available canvas, with the heading context and truthful section/quote metadata balancing the top area and the selected section filling the workspace below.
