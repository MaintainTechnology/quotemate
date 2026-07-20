-- ════════════════════════════════════════════════════════════════════
-- Migration 177 — public 'tenant-videos' storage bucket.
--
-- The five-sections spec (customer-quote-five-sections R4) shipped the two
-- per-tenant trust-video slots (mig 175) with a face-holder placeholder and
-- no bucket — "adding the bucket now is speculative" until footage existed.
-- Footage now exists: two QuoteMax default placeholder videos (Jon: "we
-- will default it with a quote max video", one per slot). This bucket hosts
-- them at defaults/welcome.mp4 + defaults/thank-you.mp4, and per-tenant
-- files as QuoteMax films each tradie (keyed by tenant id).
--
-- Public (like tenant-logos, mig 141) because the quote page renders the
-- video via a plain <video src> — no signing, no expiry. 60 MB cap fits the
-- current defaults (35 MB / 24 MB) with headroom; video mime types only.
--
-- (177, not 176 — the onboarding workstream claimed 176 concurrently.)
--
-- Idempotent: on-conflict bucket upsert.
-- Apply with: node --env-file=.env.local scripts/run-migration-177.mjs
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-videos',
  'tenant-videos',
  true,
  62914560,
  array['video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
