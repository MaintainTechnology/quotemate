-- 169 — AI "after repaint" preview cache on painting_measurements.
-- Mirrors roofing_measurements.preview_image_path / preview_status
-- (migration 086). Written by lib/painting/paint-after.ts; served by the
-- token-gated /api/painting/q/[token]/after-image proxy.

alter table public.painting_measurements
  add column if not exists preview_image_path text,
  add column if not exists preview_status text;

comment on column public.painting_measurements.preview_image_path is
  'intake-photos bucket path of the cached Gemini "after repaint" render.';
comment on column public.painting_measurements.preview_status is
  'null|generating|ready|failed — CAS-guarded by lib/painting/paint-after.ts.';
