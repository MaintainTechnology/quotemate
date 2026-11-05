-- ═══════════════════════════════════════════════════════════════════
-- Migration 224 — the plan takeoff save's request key (TKO-16).
--
-- The takeoff service saves a checked takeoff as one roofing_measurements
-- row keyed by source_request_key ('takeoff:' + the run id), unique per
-- tenant, so a second save finds and returns the same row.
--
-- Migration 201 (the SMS quote contract) adds this key, but 201 isn't on
-- production yet, and it also replaces SMS triggers and functions the
-- takeoff doesn't need. These are 201's statements for this one column and
-- its index, with 201's index name, so 201 still applies cleanly after:
-- both are "if not exists". Every existing row keeps a null key, and nulls
-- never collide in a unique index, so nothing that writes rows today
-- changes.
-- ═══════════════════════════════════════════════════════════════════

alter table public.roofing_measurements
  add column if not exists source_request_key text;

create unique index if not exists roofing_sms_request_key
  on public.roofing_measurements(tenant_id, source_request_key);

notify pgrst, 'reload schema';
