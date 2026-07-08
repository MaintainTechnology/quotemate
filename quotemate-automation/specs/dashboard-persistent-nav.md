# Persistent dashboard navigation on every tradie sub-view

## Title
Add a persistent "Dashboard" navigation bar to every `/dashboard/*` sub-route so the tradie can always return to the main dashboard.

## Goal
From any tradie-facing view under `/dashboard/*`, one always-visible control returns the tradie to `/dashboard`. Jon (pilot tradie) got stuck in the quote detail view ("View PDF" on a customer quote) with no way back — the fix must be structural so future sub-pages can't reintroduce the bug.

## Role
Principal engineer on QuoteMate. Act autonomously on reversible edits; follow the repo's Command Centre design system and its pure-helper + colocated-vitest test idiom. Minimal diff, root-cause fix.

## Context (grounded in code opened during spec work)
- **No `app/dashboard/layout.tsx` exists** (only `app/layout.tsx`, `app/admin/layout.tsx`, `app/legal/layout.tsx`). Every sub-page hand-rolls its own back-link — or forgets it. This is the root cause.
- Sub-routes **with no link back to `/dashboard` at all** (grep `href="/dashboard"` over `app/dashboard`):
  - `app/dashboard/quote/[token]/` — `QuoteReportViewerClient.tsx` has zero nav (no header, no back, no breadcrumb). This is Jon's exact failing flow: dashboard quotes list → "View PDF" → stuck.
  - `app/dashboard/aircon/page.tsx`
  - `app/dashboard/signage/page.tsx`, `signage/audit/`, `signage/queue/`, `signage/shots/`, `signage/studios/`
- Sub-routes that already hand-rolled a link (keep them; do not remove): `crm/page.tsx:230`, `painting/page.tsx:901`, `invites/page.tsx:135`, `studio/page.tsx:123`, `pricing-wizard/page.tsx` (×3), `roofing/measure/page.tsx` (×2), estimator via `_components/estimator/RunWorkspace.tsx` breadcrumb (`/dashboard?tab=…`).
- The root `/dashboard` page renders its own full sticky topbar (`app/dashboard/page.tsx:1290-1304`): `sticky top-0 z-30`, `border-b border-ink-line bg-ink-deep/90 backdrop-blur-md`, brand mark linking to `/dashboard`. The new bar must NOT render on the root page (it would double the chrome).
- Two sub-route elements are `sticky top-0` and would collide with a sticky layout bar:
  - `app/dashboard/quote/[token]/QuoteReportViewerClient.tsx:148` — toolbar, `sticky top-0 z-30`.
  - `app/dashboard/studio/page.tsx:111` — page header, `sticky top-0 z-10`.
  (`app/dashboard/page.tsx:8368` is also `sticky top-0` but lives on the root page where the bar is hidden — no change.)
- Test idiom: vitest is **node-only, no jsdom/RTL** (`vitest.config.ts` — `environment: 'node'`, includes `app/**/*.test.ts`). Component render tests are not possible; the repo pattern is a pure decision helper + colocated test (e.g. `app/dashboard/_components/saved-jobs-mode.ts` + `.test.ts`).
- Design tokens in use: `ink-deep`, `ink-line`, `text-dim`, `text-sec`, `text-pri`, `accent`; micro-label style `font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim hover:text-text-pri` (see `invites/page.tsx:135`). Australian English, no emoji.
- Gates: `npm test` (vitest run), `npm run typecheck` (tsc --noEmit). There is **no `npm run check`** in this repo. Playwright e2e exists (`tests/e2e/*.spec.ts`, `npm run test:e2e`); the repo also has a `/verify` skill purpose-built for driving the Clerk-authed dashboard.

## Task
1. **Pure helper (TDD target):** `app/dashboard/_components/dashboard-nav.ts` exporting `showDashboardNav(pathname: string | null | undefined): boolean` — `true` only for paths strictly under `/dashboard/` (e.g. `/dashboard/quote/abc`, `/dashboard/signage/queue`); `false` for `/dashboard`, `/dashboard/` (trailing slash), and null/undefined. Colocated test `dashboard-nav.test.ts` written first (Red).
2. **Client nav component:** `app/dashboard/_components/DashboardTopNav.tsx` (`'use client'`). Uses `usePathname()` + the helper; returns `null` when hidden. When shown, renders a slim sticky bar: `<nav aria-label="Dashboard">`, `sticky top-0 z-40 h-11 border-b border-ink-line bg-ink-deep/90 backdrop-blur-md`, containing one `next/link` `<Link href="/dashboard">` styled as the micro-label pattern with a leading back-arrow character (`←` or lucide `ArrowLeft`) and the text "Dashboard". Keyboard-focusable with a visible focus style consistent with existing controls.
3. **Layout:** new `app/dashboard/layout.tsx` (server component, pure wrapper): renders `<DashboardTopNav />` then `{children}`. No auth logic, no `<main>` wrapper (pages own their own `<main>`).
4. **Sticky offsets:** change the two colliding sub-route sticky elements to stick below the bar: `QuoteReportViewerClient.tsx:148` `sticky top-0` → `sticky top-11`, `studio/page.tsx:111` `sticky top-0` → `sticky top-11`. No other class changes.
5. Do not edit any other page; existing hand-rolled links stay.

## Constraints
- Do NOT touch customer-facing routes (`app/q/**`) — customers must never see tradie dashboard chrome.
- Do NOT render the bar on the root `/dashboard` page (its own topbar already links to `/dashboard`).
- Do NOT remove or restyle the existing per-page breadcrumbs/back-links (redundancy is acceptable; removal is out of scope).
- No new dependencies. No jsdom. Follow Next 16 App Router conventions (check `node_modules/next/dist/docs/` per AGENTS.md before writing the layout).
- Australian English in any UI copy; no emoji; Command Centre tokens only (no hard-coded hex).

## Acceptance criteria & gates
- **A1:** `showDashboardNav` unit tests pass: `/dashboard` → false, `/dashboard/` → false, `null`/`undefined` → false, `/dashboard/quote/abc123` → true, `/dashboard/aircon` → true, `/dashboard/signage/queue` → true.
- **A2:** `app/dashboard/layout.tsx` exists and renders `DashboardTopNav` above children (structural guarantee for all current and future sub-routes).
- **A3:** On `/dashboard/quote/[token]` the bar is visible with a working link to `/dashboard`, and the viewer toolbar sticks at `top-11` (no overlap). Verified in a real browser (Playwright / `/verify` skill) — this is Jon's reported flow.
- **A4:** On the root `/dashboard`, the new bar does not render (exactly one topbar).
- **A5:** Gates green: `npm test` and `npm run typecheck` both exit 0.
- **A6:** Browser evidence (screenshot or snapshot) of the bar on at least one previously-stranded page (`/dashboard/quote/[token]`, `/dashboard/aircon`, or `/dashboard/signage`).

## Amendments (from the 10-angle code review, iteration 1)
The review found Task 4's sticky inventory incomplete (the grep pattern `sticky top-0` missed responsive variants) and one sizing defect. Three confirmed fixes were applied; they are part of the contract:
- **A7:** `app/dashboard/signage/queue/page.tsx:324` — the detail panel's `lg:sticky lg:top-6` and `scroll-mt-6` (24px) landed its top ~20px under the bar (sticky at lg+; `scrollIntoView` anchor below lg). Fixed to `lg:top-[68px]` / `scroll-mt-[68px]` (44px bar + original 24px gap).
- **A8:** `DashboardTopNav` had `h-11` on an inner div plus `border-b` on the nav ⇒ 45px total vs 44px offsets. Height, border, and padding now live on the single border-box `<nav>` ⇒ exactly 44px.
- **A9:** `app/dashboard/studio/page.tsx:109` — studio is a fit-one-viewport workspace; `min-h-screen` + the in-flow 44px bar overflowed it. Fixed to `min-h-[calc(100vh-2.75rem)]`.

## Examples
<example>
Pure-helper + colocated test pattern to imitate: `app/dashboard/_components/saved-jobs-mode.ts` with `saved-jobs-mode.test.ts` — plain vitest `describe/it/expect`, node environment, no React imports.
</example>
<example>
Back-link styling to imitate: `app/dashboard/invites/page.tsx:135` — `<Link href="/dashboard" className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-text-pri">`.
</example>
<example>
Sticky chrome to match: root topbar `app/dashboard/page.tsx:1290` — `border-b border-ink-line bg-ink-deep/90 backdrop-blur-md sticky top-0 z-30`. The new bar copies this treatment at `h-11 z-40`.
</example>
<example>
Edge case: `app/dashboard/estimator/[runId]` already has a breadcrumb via `RunWorkspace.tsx` linking `/dashboard?tab=…` — the new bar renders above it; both remain, neither is modified.
</example>
