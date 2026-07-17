-- ════════════════════════════════════════════════════════════════════
-- Migration 175 — customer quote five-sections restructure
-- (spec specs/customer-quote-five-sections.md R2 / R3a / R4 / R5).
--
-- 1. quotes.scope_short — the one-line job-details sentence (Section 2).
--    Both estimator prompts already emit scope_short on every draft; the
--    draft route previously handed it to the SMS builder and DISCARDED it
--    (app/api/quote/[id]/edit/route.ts documented the ephemerality). This
--    column ends the discard; the roofing save-as-quote path populates it
--    from the recommended tier's deterministic scope line.
--
-- 2. tenants.intro_video_* / thankyou_video_* — the two per-tenant trust
--    videos (Section 3 + the post-booking thank-you page). QuoteMax films
--    the tradie during onboarding and sets these; there is NO upload UI.
--    Follows the mig-141 precedent exactly: a public URL column plus an
--    optional storage-path column per asset. v1 renders a face-holder
--    placeholder regardless, so both stay null until real footage exists.
--
-- 3. pricing_book data updates for roofing (R3a + R5): tier mode 'single'
--    (one option — pickRecommendedTier resolves selected_tier = better =
--    "Full roof replacement") and quote_display 'summary' (just the price,
--    no itemised breakdown). Data change, not code, so a tenant can be
--    moved back from the dashboard Pricing settings.
--
-- Idempotent + additive (add column if not exists; guarded updates).
-- Apply with: node --env-file=.env.local scripts/run-migration-175.mjs
-- ════════════════════════════════════════════════════════════════════

alter table public.quotes add column if not exists scope_short text;

comment on column public.quotes.scope_short is
  'One-line customer-facing job summary (Section 2 of the quote page, mig 175). LLM-emitted for electrical/plumbing; deterministic tier scope line for roofing.';

alter table public.tenants add column if not exists intro_video_url      text;
alter table public.tenants add column if not exists intro_video_path     text;
alter table public.tenants add column if not exists thankyou_video_url   text;
alter table public.tenants add column if not exists thankyou_video_path  text;

comment on column public.tenants.intro_video_url is
  'Tradie trust video for the quote page (Section 3, mig 175). Filmed by QuoteMax at onboarding; null renders the face-holder placeholder.';
comment on column public.tenants.thankyou_video_url is
  'Tradie thank-you video for the post-booking confirmation page (mig 175). Filmed by QuoteMax at onboarding; null renders the face-holder placeholder.';

-- R3a — roofing shows ONE option (the recommended tier). Both live roofing
-- books are already 'single' (column default since mig 142); this makes the
-- decision explicit and heals any row that was flipped.
update public.pricing_book
   set quote_tier_mode = 'single'
 where trade = 'roofing'
   and quote_tier_mode is distinct from 'single';

-- R5 — roofing price view is "just the price": summary display, no itemised
-- line breakdown on the customer surfaces.
update public.pricing_book
   set quote_display = 'summary'
 where trade = 'roofing'
   and quote_display is distinct from 'summary';

notify pgrst, 'reload schema';
