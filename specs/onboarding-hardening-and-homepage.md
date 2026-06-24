# QuoteMax — Onboarding Hardening & Home Page Redesign — Spec

> Status: ready to build. Two independent parts (A: onboarding, B: home page) in one
> spec because they were scoped together. They can be built and reviewed separately.
> App lives in `quotemate-automation/`. **Read `quotemate-automation/AGENTS.md` and the
> relevant `node_modules/next/dist/docs/` guide before writing any Next.js 16 code.**

## Objective

Two goals, both aimed at next week's onboarding of **10 real tradies** (admin-assisted,
mixed trades, **live** Twilio + Vapi):

- **Part A — Onboarding hardening.** Make tradie onboarding produce a *correctly and
  completely* set-up tenant every time, with no silent half-configured states. Add a
  trade-readiness gate (only onboard into trades that are genuinely wired) and an
  admin-facing way to verify and repair any tenant before/after onboarding.
- **Part B — Home page redesign in place.** Raise the visual quality and warmth of the
  existing marketing home page (`/`) by introducing real trade photography (brand-tinted
  duotone) and design-system polish — **without adding any new page or route**, presenting
  the page in the **light** theme (the Maintain light palette) as the primary target — not
  the dark default. Visible product branding reads **QuoteMax**.

This is a *tidy-up + verify + elevate* effort, not a rebuild.

## Context / background

### Onboarding (as built today)
Flow: `/signup` → mobile OTP (`/signup/verify`) → `/auth/callback` → `/onboard` 3-step
wizard → `POST /api/onboard/activate` → provisioning chain → tenant `status='active'`.

- Activation is in [`app/api/onboard/activate/route.ts`]. It inserts the `tenants` row,
  inserts `pricing_book` (one row per trade), upserts `tenant_licences`, seeds
  `tenant_service_offerings` (`lib/onboard/seed-tenant-defaults.ts`), stamps
  `tenant_feature_sources` (`lib/features/access.ts`), consumes the invitation code
  (`lib/onboard/invitation-codes.ts`), marks the SMS intent used
  (`lib/onboard/intent-tokens.ts`), then calls `runProvisioning()`.
- `runProvisioning()` (`lib/onboard/run-provisioning.ts`) buys a Twilio number
  (`lib/twilio/provision.ts`), creates a Vapi assistant (`lib/vapi/provision.ts`),
  registers the number with Vapi (`lib/vapi/register-number.ts`), re-points the Twilio SMS
  webhook back to `/api/sms/inbound` (`lib/twilio/set-sms-webhook.ts`), sets the tenant
  `active`, then fire-and-forgets file-store provisioning + a welcome SMS.
- `POST /api/onboard/retry-provision` is idempotent and finishes whichever provisioning
  half is missing. `GET /api/onboard/preflight` reports env-var/provisioning status.

**Known gaps to fix (from code audit):**
1. Provisioning flags `TWILIO_PROVISIONING_ENABLED` / `VAPI_PROVISIONING_ENABLED` default
   to **false** → silent **stub** numbers (deterministic `+61482…`) and stub assistant ids
   (`vapi-stub-…`) that never ring. Nothing loudly warns when live is expected.
2. The activate chain is **non-transactional**: `seedTenantServiceOfferings`,
   `stampFeatureProvenance`, and `markIntentUsed` failures are swallowed as "non-fatal", so
   a tenant can be marked done while missing its service catalogue or provenance.
3. Provisioning failure returns `{ ok: true, retryable: true, warning }` — tenant is left in
   `onboarding` limbo relying on the tradie clicking retry; if they close the tab it stays
   broken with no operator visibility.
4. The wizard only offers **electrical | plumbing**, but we need to onboard into roofing /
   solar / commercial painting too — with no check that those trades are actually wired.
5. No "is this tenant correctly set up?" verification anywhere.

### Trades (readiness)
Live + fully wired: **electrical** (NSW/NECA), **plumbing** (QLD/QBCC). Partially present:
**roofing** (measure flow, COLORBOND types), **solar**, **commercial painting** (routes
exist, review-required). A trade is only "onboardable" when it has: pricing defaults,
`shared_assemblies` rows, an estimate prompt (`lib/estimate/prompt.ts`), intake handling,
G/B/B framing, and a licence schema. We must verify all five and gate out any that fail.

### Home page (as built today)
`app/page.tsx` (~782 lines), 9 sections (Hero, TrustStrip, HowItWorks `#how`, Trades
`#scope`, Shift, Numbers, Pricing `#pricing`, FAQ `#faq`, ClosingCTA) + sticky `Nav` +
`Footer`. Design system in `app/globals.css` (Maintain): warm charcoal surfaces
(`--ink-deep #16120F`, `--ink-card #2B2422`, `--ink-line #3A322C`), Caterpillar-yellow
accent (`--accent #FFC400`, `--accent-ink #1C1812`), text (`--text-pri #F6F1EA`,
`--text-sec #C3B8AC`, `--text-dim #A2968A`), Manrope (sans) + JetBrains Mono (mono), light
theme via `[data-theme="light"]`. Reusable components in `app/_components/`
(`site.tsx`: Nav/Footer/MarqueeBar/Eyebrow/PrimaryCTA/SecondaryCTA/Arrow/Topography;
`Reveal.tsx`, `BrandMark.tsx`, `PricingTiers.tsx`, `ThemeToggle.tsx`, `AuthNav.tsx`).
The page is **100% SVG/text — no photography**, and **`next/image` is not used anywhere**.

### Image assets
8 stock trade photos in `C:\Users\dalig\Downloads\QuoteMate\imageSources` (outside the app):
electrician at a power box, two plumbers, a roofer with a drill, solar installers, painters,
a wood-worker, a female workshop technician.

---

# PART A — Onboarding hardening

## A. Requirements

1. **Atomic, fully-tracked activation.** Refactor `POST /api/onboard/activate` so the
   tenant is only reported "set up" when every *required* step has succeeded. Each step
   returns an explicit result; required-step failures roll back or leave the tenant in a
   clearly-flagged incomplete state — they are never silently swallowed.
   - **Required** (failure ⇒ tenant not "done"): `tenants` row, one `pricing_book` row per
     selected trade, `tenant_service_offerings` seeded (≥1 row per trade), real Twilio number,
     real Vapi assistant, Twilio number registered with Vapi, Twilio SMS webhook pointing at
     `/api/sms/inbound`.
   - **Non-blocking but recorded** (failure ⇒ logged + visible in health view, does not block
     active): `tenant_licences`, `tenant_feature_sources`, welcome SMS, file-store provisioning.
2. **No silent stub in live mode.** Define an expected provisioning mode. When live is
   expected, the activate route and admin onboarding must **refuse to report success with
   stub artifacts** (Twilio number matching the deterministic stub pattern or
   `vapi_assistant_id` starting `vapi-stub-`). Instead surface a clear, actionable error.
3. **Provisioning is reliable and observable.** `runProvisioning()` and
   `POST /api/onboard/retry-provision` must: (a) be safe to re-run any number of times,
   (b) complete whichever half (Twilio / Vapi) is missing, (c) always re-point the SMS
   webhook to `/api/sms/inbound`, and (d) return a structured per-step status
   (`{ step, ok, detail }[]`) that the admin health view and logs can consume.
4. **Trade-readiness gate.** Add `lib/onboard/trade-readiness.ts` exporting a function that,
   for a given trade, returns `{ trade, ready: boolean, missing: string[] }` by checking:
   pricing defaults exist, `shared_assemblies` has ≥1 row for the trade, an estimate prompt
   resolves for the trade, intake structuring handles the trade, and a licence schema exists.
   - The `/onboard` wizard **and** the admin onboarding path must only offer trades where
     `ready === true`. Non-ready trades are hidden (or shown disabled with the reason).
5. **Trade readiness report.** Add `scripts/check-trade-readiness.mjs` (run with
   `node --env-file=.env.local`) that prints the readiness of all five trades (electrical,
   plumbing, roofing, solar, commercial painting), listing exactly what each non-ready trade
   is missing, so we know what to wire before next week.
6. **Admin tenant-health view.** Add a tenant-health surface in the existing `/admin` area
   (e.g. `/admin/tenants` or a panel on `/admin/page.tsx`). For each tenant show a green/red
   status per check:
   - `owner_user_id` present (signin works)
   - `status === 'active'` with `activated_at` set
   - one `pricing_book` row per selected trade, rates non-null/positive
   - `tenant_service_offerings` ≥1 row per trade
   - `twilio_sms_number` present and **not** a stub
   - `vapi_assistant_id` present and **not** a stub
   - Twilio SMS webhook resolves to `/api/sms/inbound`
   - every selected trade passes the readiness gate
   - (info-level) licences, feature provenance, file store present
   - Overall verdict per tenant: **Ready / Incomplete**, with the failing checks named.
7. **Verify/repair script.** Add `scripts/verify-tenant.mjs --tenant <id|email>` (read-only
   report mirroring the health checks) and a repair path (`--apply`, or a separate
   `scripts/repair-tenant.mjs`) that backfills missing required pieces: re-seed service
   offerings, ensure pricing rows, and re-invoke provisioning/retry to replace stubs and fix
   the webhook. Repair must be idempotent and never duplicate rows.
8. **Live-readiness preflight.** `GET /api/onboard/preflight` (and a banner in admin
   onboarding) must clearly report whether live provisioning is correctly configured
   (`TWILIO_PROVISIONING_ENABLED`/`VAPI_PROVISIONING_ENABLED` true **and** required Twilio
   + Vapi credentials present) so the team can't accidentally onboard 10 tradies in stub mode.
9. **owner_user_id guarantee.** Activation must guarantee a non-null `owner_user_id` (from
   the form or a verified auth-user email lookup). If it cannot be resolved, activation fails
   with a clear error rather than creating a sign-in-broken tenant.
10. **Invitation-code quota is concurrency-safe.** Confirm/keep the atomic guarded increment
    so two near-simultaneous activations on the same code cannot over-redeem; a redemption
    that already exists for a `(code, tenant)` is treated as success, not a hard error.

## A. Non-goals
- No rebuild/re-architecture of the onboarding flow or wizard UX.
- Not building Stripe Connect Express or any real funds flow.
- Not adding RLS tenant-scoped policies (Phase 2) — out of scope here.
- Not wiring brand-new trades from scratch *unless* a chosen trade fails readiness; the
  default response to a non-ready trade is to **gate it out**, and surface (via req. 5) what
  it would take to wire it.
- Not changing the customer quote pipeline or estimate prompts beyond what the readiness
  check needs to *read*.

## A. Edge cases to handle
- Provisioning succeeds for Twilio but Vapi fails → tenant stays `onboarding`, health view
  shows Vapi red, retry completes only the Vapi half. → No data loss, no duplicate Twilio buy.
- Vapi registration rewrites the Twilio SMS webhook to `api.vapi.ai` → every activate/retry
  re-points it to `/api/sms/inbound`; health view verifies the live webhook value.
- Flags off / credentials missing on the day → preflight + admin banner block "live"
  onboarding loudly; no stub tenant is silently reported as ready.
- A tradie selects a non-ready trade (e.g. solar not wired) → wizard/admin won't offer it;
  readiness report explains why.
- `seedTenantServiceOfferings` fails mid-activation → tenant flagged Incomplete (not active),
  repair re-seeds; no tenant goes live with an empty catalogue.
- Re-running verify/repair on an already-healthy tenant → reports Ready, makes no changes.
- Duplicate `owner_email` on activate → existing rollback behavior preserved; clear error.
- Concurrent activations on one invitation code at the quota limit → at most `quota_total`
  succeed; the rest get a clear "code exhausted" error, no partial tenants left behind.

## A. Definition of done
- [ ] `node --env-file=.env.local scripts/check-trade-readiness.mjs` prints a ready/not-ready
      line for all five trades with the missing items for any non-ready trade.
- [ ] The `/onboard` wizard and admin onboarding only list trades that pass readiness.
- [ ] Activating a tenant in **live** mode yields, verifiably: non-null `owner_user_id`,
      `status='active'`, `pricing_book` per trade, `tenant_service_offerings` ≥1 per trade,
      a **real** `twilio_sms_number`, a **real** `vapi_assistant_id`, and the SMS webhook
      pointing at `/api/sms/inbound`.
- [ ] With provisioning flags off (or creds missing), activation does **not** report a
      stub tenant as "ready" — preflight + admin banner flag it.
- [ ] A forced failure in any *required* step leaves the tenant **Incomplete** (not active)
      and the reason is visible in the admin health view; retry/repair brings it to Ready.
- [ ] The admin tenant-health view lists every tenant with per-check green/red and an overall
      Ready/Incomplete verdict.
- [ ] `scripts/verify-tenant.mjs --tenant <id>` reports health; the repair path fixes an
      intentionally-broken test tenant to Ready and is safe to run twice (no duplicates).
- [ ] Existing onboarding unit tests still pass; new logic (readiness, step-status,
      stub-detection) has unit coverage. `npm run build`/typecheck pass.

---

# PART B — Home page redesign (in place)

## B. Requirements

1. **Single page, no new routes.** All work happens in `app/page.tsx` and its components /
   styles. Do not add pages, routes, or a second landing page. Keep all 9 existing sections
   (Hero, TrustStrip, HowItWorks, Trades, Shift, Numbers, Pricing, FAQ, ClosingCTA).
2. **Introduce trade photography as brand-tinted duotone.** Bring the `imageSources` photos
   into the site and render them desaturated + tinted toward the brand so they read as native
   to the **light** theme — not dropped-in stock. Tune the duotone for the light cream/white
   background (warm charcoal mid-tones / yellow-warm highlights, lighter overall key than a
   dark-theme treatment would use). Provide a reusable treatment (CSS filter/blend + overlay,
   or pre-processed duotone assets) applied consistently wherever photos appear.
3. **Asset pipeline.** Copy the source photos into the app under `public/marketing/` (web
   names, e.g. `trade-electrical.jpg`), reasonably compressed/sized for web. Render them via
   **`next/image`** (responsive `sizes`, width/height to avoid CLS, `priority` only on the
   hero image). Keep all brand marks (logo, icons, accent lines) as SVG.
4. **Photo placement (intent, builder may refine within the design skills):**
   - **Hero** — a brand-tinted hero/feature image or collage that makes the page feel
     human and welcoming, without hurting the existing headline/CTA hierarchy or the SMS demo.
   - **Trades (`#scope`)** — pair each trade with its photo (electrical → power-box,
     plumbing → plumber, roofing → roofer, solar → solar installers, painting → painters),
     elevating the current plain lists into visual cards.
   - **Supporting section(s)** — use remaining photos (wood-worker, female technician) where
     they add warmth (e.g. HowItWorks, Shift, or a "request your trade" prompt).
   - Every selected trade shown with imagery must correspond to a real supported trade.
5. **On-brand + design-skill quality.** Stay strictly within the Maintain tokens (no new
   arbitrary colors; reuse `--ink-*`, `--accent*`, `--text-*`, Manrope/JetBrains Mono).
   Apply `/design-taste-frontend`, `/frontend-design`, `/ui-typography`, `/ux-designer`,
   `/web-design-guidelines`. Typography must follow `/ui-typography` (real quotes/dashes,
   correct hierarchy, spacing). Result should feel premium, warm, and welcoming.
6. **Branding reads "QuoteMax".** Visible product name on the home page (hero, nav, footer,
   meta/OG where touched) reads **QuoteMax**, consistent with the `public/brand/quotemax-*`
   assets. Do not rename internal code symbols/packages.
7. **Responsive + accessible.** Looks correct from ~360px mobile to wide desktop. All images
   have meaningful `alt`. Respect `prefers-reduced-motion` (existing `Reveal`/animation
   guards). Maintain WCAG AA contrast for any text placed over photos (use overlays/scrims).
   **The light theme is the primary design target** — the page must look polished and fully
   legible in light; the dark theme must remain functional via the existing toggle but is
   secondary (not visibly broken, but not the focus).
8. **Default to the light theme.** On first visit (no stored theme preference) the home page
   loads in the Maintain **light** palette. Keep the existing theme toggle and its
   localStorage persistence working; do not remove dark mode. The duotone photo treatment is
   tuned for the light background per req. B2.
9. **Performance.** No regression in load: images optimized via `next/image`, hero image
   `priority`, others lazy. No layout shift from images (explicit dimensions). Lighthouse
   performance and the page's existing Core Web Vitals must not get materially worse.

## B. Non-goals
- No new pages, routes, or a separate "v2" landing page.
- No change to the underlying Maintain design tokens / theme system, nav structure, pricing
  logic (`PricingTiers`), or auth.
- No app-wide QuoteMate→QuoteMax rename (home-page-visible branding only; see Open questions).
- No new copywriting overhaul beyond what's needed to integrate imagery and fix typography.
- Don't use any images other than those from `imageSources` (plus existing brand SVGs).

## B. Edge cases to handle
- Light theme active → duotone treatment still looks intentional and text stays AA-legible.
- `prefers-reduced-motion` → no image-driven motion beyond existing guarded reveals.
- Narrow mobile (~360px) → images scale, no overflow, trade cards stack cleanly.
- Slow connection → `next/image` lazy-loads non-hero images; no CLS while loading.
- A photo whose subject doesn't map to a supported trade (wood-worker) → used only in a
  generic/"request your trade" context, never labelled as a live supported trade.

## B. Definition of done
- [ ] `app/page.tsx` renders the trade photos via `next/image` with a consistent brand
      duotone treatment; no other page/route was added.
- [ ] All 9 original sections still present and functional (anchors `#how`/`#scope`/`#pricing`/
      `#faq` still work).
- [ ] Hero + Trades sections visibly incorporate photography; remaining photos used where
      they add warmth.
- [ ] Every image has a meaningful `alt`; hero image uses `priority`, others lazy.
- [ ] Page is visually correct and legible (AA contrast on text-over-image) at 360px, 768px,
      and ≥1280px in the **light** theme (primary); dark theme remains functional via the toggle.
- [ ] Home page loads in the **light** theme on first visit (no stored preference).
- [ ] Visible branding on the page reads "QuoteMax".
- [ ] `npm run build` succeeds; no console errors; no new layout shift introduced by images.
- [ ] Reviewed against `/web-design-guidelines` and `/ui-typography` with no outstanding
      violations.

---

## Constraints (shared)
- **Stack:** Next.js 16.2.4 App Router, React 19.2, Turbopack, Tailwind, Supabase
  (service-role in API routes), Twilio, Vapi, Stripe (test). Read `quotemate-automation/AGENTS.md`
  + `node_modules/next/dist/docs/` before writing Next code.
- **DB changes** (if any) = new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`
  applied to prod Supabase, keeping `sql/init.sql` representative. Part A should need little
  or no schema change (mostly logic + scripts + admin view) — add migrations only if required.
- **Money-touching LLM steps stay tool-calling only**; don't touch the grounding validator.
- **Multi-tenant scoping** stays app-layer `tenant_id` filtering (service-role bypasses RLS).
- **Secrets:** never commit or print `.env.local`. Scripts run via
  `node --env-file=.env.local scripts/X.mjs`.
- **Brand:** Maintain design system tokens only; product name "QuoteMax".

## Open questions
- **App-wide rename QuoteMate → QuoteMax?** This spec changes only home-page-visible
  branding. If you want a full rename (code, docs, metadata, emails, SMS templates), that's a
  separate spec — confirm whether to scope it.
- **Invitation codes for an admin-assisted batch:** since the team drives onboarding, do we
  still gate on invitation codes, or add an admin "create tenant" path that bypasses codes?
  (Default assumption: keep codes; pre-mint 10.)
- **Roofing / solar / painting wiring:** if the readiness report shows these are *not* fully
  wired, do we (a) wire them before next week, or (b) restrict next week's 10 to ready trades
  only? (Default assumption: gate to ready trades; report the gaps.)
