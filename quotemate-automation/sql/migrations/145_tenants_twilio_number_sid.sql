-- 145 — tenants.twilio_number_sid: authoritative real-vs-stub signal for the
-- Tenant Health monitor (spec specs/tenant-health-stub-false-positive.md, BUG-15).
--
-- The health check previously inferred "stub" from the number's SHAPE
-- (/^\+614820\d{5}$/). That band overlaps the live AU mobile band the stub
-- generator (lib/twilio/provision.ts stubNumberFor) deliberately mints into, so
-- a real number like +614820xxxxx was wrongly flagged as a stub and the tenant
-- marked Incomplete (Oculus/Oak Crest — verified live).
--
-- The Twilio Phone Number SID (PN…) is the authoritative signal: a live Twilio
-- provision returns one; a stub never does. Provisioning now stamps it
-- (lib/onboard/run-provisioning.ts), the backfill self-heals existing rows
-- (scripts/backfill-twilio-sid.mjs), and the health check classifies from SID
-- presence, not the digits. NULL = stub or not-yet-verified.
--
-- Additive + idempotent.
-- Apply: node --env-file=.env.local scripts/run-migration-145.mjs

alter table tenants add column if not exists twilio_number_sid text;

notify pgrst, 'reload schema';
