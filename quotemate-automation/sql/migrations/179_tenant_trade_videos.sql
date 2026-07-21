-- ════════════════════════════════════════════════════════════════════
-- Migration 179 — tenants.trade_videos (PER-TRADE trust videos).
--
-- Until now a tenant had ONE welcome + ONE thank-you video for the whole
-- business (mig 175 scalar columns, mig 178 slot-keyed state), and they were
-- only surfaced on the roofing pages. A multi-trade tradie needs one pair PER
-- TRADE they have switched on, so an electrical customer hears the electrical
-- intro and a roofing customer hears the roofing one.
--
-- One jsonb keyed trade -> slot -> entry (url + generation state together):
--
--   { "roofing":    { "welcome":  { "url": "https://…/roofing/welcome-….mp4",
--                                   "status": "idle|generating|ready|failed",
--                                   "operation": "<Gemini LRO name>",
--                                   "script": "...", "error": null,
--                                   "updated_at": "...", "source": "auto|dashboard" },
--                     "thankyou": { … } },
--     "electrical": { … } }
--
-- Trade keys are the canonical KNOWN_TRADES slugs (underscored, e.g.
-- commercial_painting) — lib/videos/trade-videos.ts normalises every other
-- spelling onto them.
--
-- NO backfill on purpose: the mig-175 scalar pair stays as the fallback
-- (lib/quote/tenant-identity.ts tradeVideoUrls), so every existing tenant keeps
-- a working video on every surface until their per-trade ones generate.
--
-- Idempotent + additive.
-- Apply with: node --env-file=.env.local scripts/run-migration-179.mjs
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants add column if not exists trade_videos jsonb;

comment on column public.tenants.trade_videos is
  'Per-trade AI trust videos (mig 179): trade slug → welcome/thankyou → {url, status, operation, script, error, updated_at, source}. Overrides the tenant-wide intro_video_url / thankyou_video_url pair for that trade.';

notify pgrst, 'reload schema';
