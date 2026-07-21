-- ════════════════════════════════════════════════════════════════════
-- Migration 180 — tenants.photo_url / photo_path (the tradie's own photo).
--
-- The customer quote's "Your tradie" section (page section 03, and now the
-- downloadable PDF too) shows who is doing the work. Until now it showed only
-- a business name and a placeholder tile. The tradie sets their photo ONCE
-- from the dashboard Account tab and it appears on both surfaces.
--
-- Mirrors the mig-141 logo precedent exactly: a public URL column plus the
-- storage path, written together by POST /api/tenant/photo. The photo lives in
-- the same PUBLIC `tenant-logos` bucket as the logo (same 2 MB cap, same MIME
-- allowlist, same stable-public-URL semantics) under a `photo-` filename
-- prefix — no new bucket, no new storage policy.
--
-- Null is the normal starting state: every customer surface falls back to the
-- placeholder avatar (lib/quote/tradie-profile.ts) and the dashboard Overview
-- shows a nudge to upload one.
--
-- Idempotent + additive. Apply with:
--   node --env-file=.env.local scripts/run-migration-180.mjs
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants add column if not exists photo_url  text;
alter table public.tenants add column if not exists photo_path text;

comment on column public.tenants.photo_url is
  'Public URL of the tradie''s own photo, shown in the "Your tradie" section of the customer quote page AND the quote PDF (mig 180). Set from the dashboard Account tab; null renders the placeholder avatar.';
comment on column public.tenants.photo_path is
  'Storage path in the public tenant-logos bucket backing photo_url (mig 180).';

notify pgrst, 'reload schema';
