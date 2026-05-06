-- ════════════════════════════════════════════════════════════════════
-- Phase 4 / photos — add MMS support to sms_messages.
--
-- Customers can now attach photos to inbound SMS. Twilio's webhook posts
-- NumMedia + MediaUrl0..N when MMS is involved. The inbound route
-- downloads each media URL (Basic-authenticated to Twilio), uploads to
-- the existing intake-photos Supabase Storage bucket, and stores the
-- resulting signed URLs in this column.
--
-- /api/intake/structure (SMS branch) reads photo_urls from every message
-- in the conversation and feeds the aggregated list to structureIntake,
-- which already accepts photoUrls from the voice flow.
-- ════════════════════════════════════════════════════════════════════

alter table sms_messages
  add column if not exists photo_urls jsonb not null default '[]'::jsonb;

-- Partial index on conversations that have photo-bearing messages —
-- speeds up the photo-aggregation lookup in the SMS intake branch.
create index if not exists sms_messages_with_photos_idx
  on sms_messages (conversation_id)
  where jsonb_array_length(photo_urls) > 0;
