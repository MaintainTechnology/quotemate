-- ════════════════════════════════════════════════════════════════════
-- 011 — Multi-photo AI preview paths.
--
-- Originally quotes.preview_image_path was a single text column — one
-- generated preview per quote, regardless of how many photos the
-- customer uploaded. Tester feedback: when 2-3 photos are uploaded,
-- the AI section should show 2-3 generated previews (one per
-- customer photo), not just one.
--
-- This migration adds a parallel preview_image_paths array column.
-- Going forward, generate.ts writes ONE preview per uploaded photo
-- and stores all paths in the array. The legacy singular column
-- stays for backwards compat — readers prefer the array, fall back
-- to the singular if the array is empty.
-- ════════════════════════════════════════════════════════════════════

alter table public.quotes
  add column if not exists preview_image_paths text[] not null default '{}';

comment on column public.quotes.preview_image_paths is
  'AI preview image paths in storage — one per uploaded customer photo. Re-sign on render via refreshSignedUrl(). Reader fallback: when empty, use preview_image_path (legacy singular).';
