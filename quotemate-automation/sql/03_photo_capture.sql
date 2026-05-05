-- ───────────────────────────────────────────────────────────────────
-- Photo capture flow — caller receives an SMS link, opens it on their
-- phone, snaps photos, photos land in Supabase Storage and on calls.photo_urls.
-- Safe to re-run.
-- ───────────────────────────────────────────────────────────────────

alter table calls add column if not exists photo_request_token text unique;
  -- random URL-safe token, generated when the call ends, used in the
  -- /upload/<token> link sent via SMS.

alter table calls add column if not exists photos_completed_at timestamptz;
  -- set when the customer submits the upload form. null until then.

create index if not exists idx_calls_photo_request_token
  on calls(photo_request_token) where photo_request_token is not null;
