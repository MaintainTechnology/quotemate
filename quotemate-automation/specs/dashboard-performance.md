# Dashboard performance: fast sign-in, instant tab switching, fast quote opening, branded boot banner

## Title
Make /dashboard fast — eliminate the sign-in dead window, tab-switch remount lag, and quote-open
waterfalls — and show a QuoteMax boot banner (white background, centered glowing logo) until the
dashboard is ready.

## Goal
Post-sign-in, a tradie sees the branded loading banner immediately (no blank screen), the Overview
paints without the current multi-second waterfall, switching between dashboard tabs re-renders from
cache with zero refetch inside 15s, and opening a quote paints feedback instantly — measured by the
acceptance gates below. Why: the dashboard is the daily surface for every tenant; today it is one
669KB client bundle behind a serial auth+mega-payload waterfall with no loading state at all.

## Role
Principal engineer for this repo. Reason before acting; make real edits with tools; never guess a
parameter — open the file first. Act directly on reversible edits; confirm before destructive ones.

## Context (grounded — every claim verified in code during investigation, 2026-07-09)
- `app/dashboard/page.tsx` is ONE 16,224-line / 669KB `'use client'` module (line 10) containing
  ~124 components, 261 `useState`, 45 `useEffect`, 61 `fetch()` sites. All tab components are
  statically imported (lines ~36–156). Zero `next/dynamic` in the file. No `loading.tsx` exists
  anywhere under `app/`.
- Boot waterfall (`page.tsx:528-566`): hydrate 669KB bundle → wait `clerkLoaded` → `await getToken()`
  → optional `supabase.auth.getSession()` fallback → `await refresh(token)` (line 560) →
  `fetch('/api/tenant/me')` (line 681, `cache: 'no-store'`). Until it resolves, `if (!data)` at
  line 920 renders `DashboardSkeleton` (line 1212) — which itself only exists after hydration.
- `/api/tenant/me` (`app/api/tenant/me/route.ts:51-581`) returns up to 100 quotes with full
  `good/better/best` jsonb AND an embedded SMS/voice transcript per quote; the `sms_messages` query
  (lines ~365-369) has NO `.limit()` (60/convo cap applied in JS after transfer); after an initial
  `Promise.all` it runs a 5-step sequential Supabase waterfall (intakes → sms_conversations →
  sms_messages → calls → customers, lines ~309-444).
- Tab switching: `const [tab, setTab] = useState<Tab>('overview')` (`page.tsx:483`); the content
  wrapper `<div key={tab} …>` (~line 983, comment at 980 admits the key exists only to replay a
  fade-in) force-remounts the active tab's subtree on every switch, re-firing every mount fetch
  (ChatsTab `/api/tenant/chats` ~14410; QuotesTab `/api/tenant/trade-jobs` ~8190). `key={section}`
  repeats the pattern inside TradeHub (~16110).
- Every mutation ends with `await refresh(token)` (`page.tsx:721` + ~742, 765, 784, 799, 831, 887),
  re-downloading the entire mega-payload.
- Sign-in: `app/sign-in/[[...sign-in]]/page.tsx:43` renders bare `<SignIn />` — no
  `fallbackRedirectUrl`, so Clerk redirects to `/` (marketing page) and the tradie manually clicks
  through to /dashboard. (`.env.local` is not readable in-session; the code-level prop takes
  precedence over the env fallback and still yields to `redirect_url` deep-links, so it is safe.)
- Quote open: `app/dashboard/quote/[token]/page.tsx:34-73` runs 4–7 sequential Supabase awaits
  before first byte with no `loading.tsx`; the report iframe `/api/q/[token]/html`
  (`app/api/q/[token]/html/route.ts:39-59` → `lib/quote/pdf.ts:216-312`) re-fetches the same
  context in a second 5-query waterfall including a duplicate read of the same quotes row.
- QuotesTab recomputes the full filter/sort pipeline + 5 chip counts in render with no `useMemo`
  (~8273-8316) — every search keystroke re-runs ~13 full-array passes.
- Cross-page import: `page.tsx:156` imports `ErrorBanner, Field, INPUT` FROM `../signup/page`,
  welding the whole signup page module into the dashboard chunk.
- Brand assets: `public/brand/quotemax-logo-horizontal-light.svg` (0.9KB, lockup for LIGHT
  backgrounds per `public/brand/README.md`), `quotemax-icon.svg`, dark variant available. Logo
  palette: orange `#FF5A1F` tile, navy `#0E1622` wordmark.
- ⚠ Design flag (surface in PR, do not block): the requester explicitly wants a PLAIN WHITE banner;
  the canonical dashboard canvas is warm charcoal, so there will be a light→dark handoff. Honour
  the white-background request; keep the handoff CLS-free.
- Next 16 caveat (AGENTS.md): read the relevant `node_modules/next/dist/docs/` guide before writing
  Next-specific code (loading.tsx conventions, next/dynamic).
- Existing test idioms: pure-logic unit tests in `lib/dashboard/*.test.ts`
  (`quote-queue.test.ts`), `app/dashboard/_components/dashboard-nav.test.ts`,
  `saved-jobs-mode.test.ts` — vitest, node environment, no DOM. Follow this: extract pure logic,
  test it. Playwright config exists (`npm run test:e2e`).

## Task (ordered: smallest diff × biggest perceived win first)
1. **R1 — Sign-in lands on /dashboard.** `app/sign-in/[[...sign-in]]/page.tsx`: add
   `fallbackRedirectUrl="/dashboard"` to `<SignIn />` (and the matching prop on `<SignUp />` if a
   sibling sign-up page renders one). Deep-links via `redirect_url` must still win (Clerk
   semantics: fallback only applies when no redirect_url is present).
2. **R2 — Boot banner (the QuoteMax loading screen).** New `app/dashboard/loading.tsx` (server,
   zero client JS): plain white (`#FFFFFF`) full-viewport screen, `quotemax-logo-horizontal-light.svg`
   centered via `<img src="/brand/quotemax-logo-horizontal-light.svg">`, glow = CSS keyframe
   pulsing `filter: drop-shadow(…)` in the brand orange, wrapped in `motion-safe:` /
   `prefers-reduced-motion` guard. Extract the banner markup into a shared component (e.g.
   `app/dashboard/_components/BootBanner.tsx`) and ALSO render it in the `if (!data)` branch of
   `DashboardPage` (page.tsx:920-926, replacing or overlaying `DashboardSkeleton`) so the
   loading.tsx → hydration → data-fetch handoff shows one continuous banner with no flash/CLS.
3. **R3 — Kill the remount-per-switch.** Remove `key={tab}` from the tab content wrapper
   (~page.tsx:983) and `key={section}` in TradeHub (~16110); replay the fade with CSS only (or drop
   it). Tabs remain conditionally rendered; the fix removes the forced identity change.
4. **R4 — Per-tab data cache (SWR-lite).** New `lib/dashboard/tab-cache.ts`: module-level
   `Map<string, {data, fetchedAt}>` + the existing 15s `shouldRefresh` throttle idiom from
   `lib/dashboard/quotes-refresh.ts`. Wire into the tab mount-fetches (QuotesTab trade-jobs
   ~8190, ChatsTab ~14410, TradeHub sections): render from cache instantly, revalidate in
   background. Pure logic goes in the lib file with unit tests.
5. **R5 — Slim `/api/tenant/me`.** (a) Remove embedded per-quote `messages` transcripts from the
   list payload (grep ALL consumers of `quote.messages` first — NotificationsBell, ChatsSplitView,
   QuoteDetail — and repoint QuoteDetail to lazy-fetch its one conversation on open, reusing
   `/api/tenant/chats` shape or a minimal `/api/tenant/quotes/[id]/messages`). (b) Bound the
   `sms_messages` query in SQL for any remaining use. (c) Collapse the 5-step sequential waterfall
   to ≤2 `Promise.all` levels (intakes first; then conversations ∥ calls ∥ customers).
6. **R6 — Stop full refresh after mutations.** At page.tsx:721 (+ ~742, 765, 784, 799, 831, 887):
   merge the mutation response row into state instead of `await refresh(token)` (pattern exists:
   `lib/dashboard/service-toggle` applyOptimistic/reconcile). Audit each mutation route's response
   shape first; keep full refresh only for the focus-return path.
7. **R7 — Code-split the tabs.** Wrap the heavy statically-imported tabs (CommercialPaintingTab,
   SolarTab, CalendarTab, FilesTab, HistoricalQuotesTab, FlyerDesignerTab, RoofRatesEditor,
   PaintRatesEditor, EstimatorBetaTab, BillingTab) in `next/dynamic(() => import(…), { loading })`.
   Move `ErrorBanner, Field, INPUT` out of `app/signup/page.tsx` into a shared
   `app/_components/form.tsx` and update both importers. Record `/dashboard` first-load JS from
   `next build` output before and after.
8. **R8 — Quote-open path.** New `app/dashboard/quote/[token]/loading.tsx` (reuse BootBanner or a
   light skeleton). In `app/dashboard/quote/[token]/page.tsx`, after the intake read, run the
   independent reads (`resolveCustomerContact`, `pricing_book`) in `Promise.all`. In
   `/api/q/[token]/html` + `lib/quote/pdf.ts:216`, fetch the quotes row once (delete the duplicate
   by-id re-read).
9. **R9 — QuotesTab render hygiene.** `useMemo` the filtered/sorted queue + derive chip counts in
   one grouped pass; `useDeferredValue` on the search term; `React.memo` on `QuoteQueueRow`.

## Constraints
- Do NOT redesign the dashboard, rename tabs, or change any user-visible behaviour beyond what each
  requirement states. No new dependencies (no SWR/react-query — the cache is a tiny lib file).
- Keep diffs minimal and mechanical; do not refactor unrelated code or split page.tsx beyond what
  R7 requires. Do not normalise `quote_line_items` or touch DB schema.
- Money-path invariants untouched: no changes to estimate/validate/routing logic.
- R5 is a payload contract change: grep every consumer before removing fields; the welcome-email
  and admin-whoami probes stay as-is unless R5's payload can carry the booleans with zero extra
  queries (optional, minor).
- White banner is the requester's explicit choice — build it as specified; note the light→dark
  handoff in the final report.
- Before writing Next-specific code, consult `node_modules/next/dist/docs/` (Next 16 conventions
  for loading.tsx / next/dynamic differ from training data).
- Never commit or paste `.env.local` contents; it is deny-listed in-session.

## Acceptance criteria & gates
Run every gate each iteration; a gate not run is a gate failed.
- `npm test` (vitest) passes — including NEW tests: (a) tab-cache unit tests (fresh/stale/revalidate
  paths, 15s throttle); (b) a payload-shape test asserting the `/api/tenant/me` quote-list builder
  emits no `messages` key (extract the payload-assembly into a testable pure helper if needed);
  (c) quotes-filter memo helper test if logic is extracted for R9.
- `npm run typecheck` (tsc --noEmit) passes.
- `npm run lint` passes on touched files.
- UI verification via /verify (Clerk-authed browser drive, /playwright-cli as vehicle):
  1. Sign in → URL lands on `/dashboard` with no intermediate `/` stop (R1).
  2. During load, the white glowing-logo banner is visible (screenshot) and there is no blank
     screen between navigation and dashboard paint (R2).
  3. Switch Quotes → Chats → Quotes within 15s: second Quotes visit renders instantly from cache
     with zero refetch (network log) and no remount flash (R3+R4).
  4. Open a quote from the queue: transcript still displays (lazy-fetched) (R5); "View PDF · Edit"
     paints a loading state immediately (R8).
  5. Save a settings field: exactly one PATCH, zero GET `/api/tenant/me` (R6).
- `next build` completes; record `/dashboard` first-load JS before/after R7 in the report.
- /review maps every R1–R9 to its implementation; /code-review reports no blocker/major findings.

## Examples
<example>
Cache + throttle idiom to follow (R4): lib/dashboard/quotes-refresh.ts exports a pure
shouldRefresh(lastFetchedAt, now) used by page.tsx's focus-return refresh; its unit test is
lib/dashboard/quote-queue.test.ts-style plain vitest with fake timestamps. tab-cache.ts should look
like a sibling of this file, not a framework.
</example>
<example>
Mutation-merge idiom to follow (R6): lib/dashboard/service-toggle's applyOptimistic/reconcilePending
pattern — mutate local state from the response row, reconcile on conflict, no full refetch.
</example>
<example>
Dynamic-import seam (R7): FlyerDesignerTab already lazy-loads konva internally — replicate that
boundary at the page level: const FlyerDesignerTab = dynamic(() => import('./_components/FlyerDesignerTab'), { loading: () => <TabSkeleton /> }).
</example>
<example>
Payload-shape guard (R5): follow lib/vapi/voice-prompt.test.ts style — call the extracted builder
with a fixture row and assert JSON.stringify(result) does not contain '"messages"'.
</example>
