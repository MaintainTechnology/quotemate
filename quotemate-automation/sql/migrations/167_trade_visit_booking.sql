-- 167 · Self-serve visit booking for roofing + painting jobs.
--
-- Electrical/plumbing/solar book a time via quotes.scheduled_at (mig 026/147).
-- The dedicated roofing_measurements + painting_measurements surfaces had NO
-- scheduling storage, so after the $99 site-visit / deposit the customer had no
-- way to pick a time — the page just said "your tradie will be in touch". These
-- columns mirror quotes.scheduled_at + scheduled_window so the SAME SlotPicker +
-- resolveBookingOptions logic can record a chosen half-day (am/pm) window here.
--
-- Idempotent + additive (add column if not exists) — safe to re-run.

alter table public.roofing_measurements
  add column if not exists scheduled_at     timestamptz,
  add column if not exists scheduled_window text;

alter table public.painting_measurements
  add column if not exists scheduled_at     timestamptz,
  add column if not exists scheduled_window text;

comment on column public.roofing_measurements.scheduled_at is
  'Customer-chosen site-visit instant (mig 167). scheduled_window = am|pm half-day tag.';
comment on column public.painting_measurements.scheduled_at is
  'Customer-chosen visit instant (mig 167). scheduled_window = am|pm half-day tag.';
