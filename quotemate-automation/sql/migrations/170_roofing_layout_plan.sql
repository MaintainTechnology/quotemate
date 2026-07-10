-- 170 — AI roof layout plan cache on roofing_measurements
-- (spec specs/quote-visual-parity.md R6). Written by
-- lib/roofing/layout-plan.ts (CAS on layout_status); read by /m/[token],
-- /q/roof/[token] and the roofing quote PDF. The plan is zones-as-JSON —
-- labels only, never prices; drawing + quantities are deterministic in code.

alter table public.roofing_measurements
  add column if not exists layout_plan jsonb,
  add column if not exists layout_status text;

comment on column public.roofing_measurements.layout_plan is
  'Parsed LayoutPlan JSON ({header, mode, zones[]}) from lib/roofing/layout-plan.ts.';
comment on column public.roofing_measurements.layout_status is
  'null|generating|ready|failed — CAS-guarded by generateRoofLayoutPlan.';

-- PostgREST must reload its schema cache or writes to the new columns 404.
notify pgrst, 'reload schema';
