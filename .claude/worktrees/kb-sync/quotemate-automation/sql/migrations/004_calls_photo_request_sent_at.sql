-- Adds calls.photo_request_sent_at — used to dedupe in-call vs post-call
-- photo-request SMS dispatch.
--
-- Set when the Vapi `send_sms_photo_link` tool fires mid-call, so the
-- post-call dispatcher in /api/intake/structure can skip its own SMS
-- and avoid sending the customer two photo-request links.
--
-- Idempotent — safe to re-run.

alter table calls add column if not exists photo_request_sent_at timestamptz;

-- Optional helper index — not strictly needed since we filter by id, but
-- handy for debugging "which calls had in-call photo requests" queries.
create index if not exists idx_calls_photo_request_sent_at
  on calls (photo_request_sent_at)
  where photo_request_sent_at is not null;
