-- ════════════════════════════════════════════════════════════════════
-- Migration 178 — tenants.trust_video_state (AI trust-video generation).
--
-- Spec specs/tradie-trust-video-generation.md R2. Per-slot generation
-- state for the Veo 3.1 pipeline that produces each tradie's welcome +
-- thank-you videos (slots shipped in mig 175, bucket in mig 177):
--
--   { "welcome":  { "status": "idle|generating|ready|failed",
--                   "operation": "<Gemini LRO name>",
--                   "script": "...", "error": null,
--                   "updated_at": "...", "source": "auto|dashboard" },
--     "thankyou": { ... } }
--
-- The operation name makes jobs RESUMABLE: a serverless timeout mid-poll
-- never strands a generation — the next status read polls the operation
-- and finalises (download → tenant-videos bucket → stamp the URL columns).
--
-- Idempotent + additive.
-- Apply with: node --env-file=.env.local scripts/run-migration-178.mjs
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants add column if not exists trust_video_state jsonb;

comment on column public.tenants.trust_video_state is
  'Per-slot AI trust-video generation state (mig 178): welcome/thankyou → {status, operation, script, error, updated_at, source}. Resumable Veo 3.1 jobs; final URLs land in intro_video_url / thankyou_video_url.';

notify pgrst, 'reload schema';
