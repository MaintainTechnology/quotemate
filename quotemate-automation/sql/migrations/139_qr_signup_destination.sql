-- ════════════════════════════════════════════════════════════════════
-- Migration 139 — allow the 'signup' QR destination type.
--
-- Adds a third destination_type to marketing_qrs so a generated QR can
-- route a prospective tradie to the QuoteMax signup page. Surfaced as the
-- "03 · Onboard as a tradie" section on /dashboard/invites; the /s/<code>
-- redirect resolves it to SIGNUP_URL?ref=<short_code>.
-- See docs/superpowers/specs/2026-06-23-signup-qr-onboard-tradie-design.md.
--
-- Idempotent: drop-if-exists then re-add converges on repeated runs.
-- Apply with: node --env-file=.env.local scripts/run-migration-139.mjs
-- ════════════════════════════════════════════════════════════════════

alter table marketing_qrs
  drop constraint if exists marketing_qrs_destination_type_check;

alter table marketing_qrs
  add constraint marketing_qrs_destination_type_check
  check (destination_type in ('sms', 'landing', 'signup'));

notify pgrst, 'reload schema';
