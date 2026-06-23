-- Rollback for migration 138 — tenant_feature_sources.
-- Drops the provenance table. trades[] (the runtime gate) is untouched, so
-- rolling back only loses plan-vs-manual provenance, not feature access.
drop table if exists tenant_feature_sources;

notify pgrst, 'reload schema';
