-- Rollback 182 — drop the column default.
-- The backfilled tokens are intentionally NOT reverted: they are live
-- capability tokens now reachable at /m/[measure_token], and nulling them
-- would break links that tradies may already hold.

alter table public.roofing_measurements
  alter column measure_token drop default;
