-- QuoteMate - migration 117 - preserve "Not sure" solar power supply
-- (fix 2026-06-17). Migration 116 added electrical_phase but collapsed
-- unknown/not-sure selections into 'single'. The sizing engine still uses a
-- single-phase-safe cap for unknown, but the saved row and quote copy should
-- say "unknown" rather than implying the customer confirmed single-phase.

alter table public.solar_estimates
  add column if not exists electrical_phase text,
  add column if not exists requested_system_kw numeric;

alter table public.solar_estimates
  drop constraint if exists solar_estimates_electrical_phase_check;

update public.solar_estimates
   set electrical_phase =
     case
       when estimate #>> '{context,phase}' in ('single', 'three', 'unknown')
         then estimate #>> '{context,phase}'
       when electrical_phase in ('single', 'three', 'unknown')
         then electrical_phase
       else 'unknown'
     end;

alter table public.solar_estimates
  alter column electrical_phase set default 'unknown',
  alter column electrical_phase set not null,
  add constraint solar_estimates_electrical_phase_check
    check (electrical_phase in ('single', 'three', 'unknown'));

notify pgrst, 'reload schema';

