-- Rollback for migration 139 — remove the 'signup' QR destination type.
-- SAFE ONLY when no marketing_qrs rows have destination_type='signup'
-- (the re-added check would otherwise reject existing rows). Archive or
-- repoint any signup QRs before rolling back.
alter table marketing_qrs
  drop constraint if exists marketing_qrs_destination_type_check;

alter table marketing_qrs
  add constraint marketing_qrs_destination_type_check
  check (destination_type in ('sms', 'landing'));

notify pgrst, 'reload schema';
