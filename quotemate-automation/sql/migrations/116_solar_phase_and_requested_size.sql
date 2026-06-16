-- QuoteMate · migration 116 — solar phase + preferred system size
-- (design 2026-06-16). Adds the property's electrical phase and an optional
-- customer/tradie-requested system size to solar_estimates. Both are inputs
-- to the sizing engine; phase scales the DNSP export cap (single ×1, 3-phase
-- ×3), requested size anchors the headline tier. Idempotent / re-entrant.
--
-- Renumbered from 114 → 116: migrations 114 (solar multi-building) and 115
-- (painting quote PDF) were claimed by parallel work in flight.

alter table public.solar_estimates
  add column if not exists electrical_phase text not null default 'single'
    check (electrical_phase in ('single', 'three')),
  add column if not exists requested_system_kw numeric
    check (requested_system_kw is null
           or (requested_system_kw > 0 and requested_system_kw <= 30));

-- Refresh PostgREST's schema cache so supabase-js routes read the new columns
-- immediately (mirrors migrations 100/101/111).
notify pgrst, 'reload schema';
