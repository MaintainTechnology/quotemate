-- ════════════════════════════════════════════════════════════════════
-- Migration 039 — quote_followup_events (CRM-style touch log).
--
-- WHY:
--   The follow-ups queue had a binary "followed_up_at" flag — once set,
--   the row parked under Contacted with no record of WHAT happened on
--   the call (left voicemail? spoke? wants callback?). VAs couldn't see
--   prior touches on a lead, and an owner glancing later had no audit
--   trail. This table is the per-touch log: one row = one contact event
--   (call placed, SMS sent, or a manual outcome note).
--
-- KEPT alongside the existing fields:
--   quotes.followed_up_at + followup_note are unchanged — they still
--   drive the "To chase" vs "Contacted" split. When an event is logged
--   via /api/tenant/followups/events, the route ALSO touches those
--   quote fields so the parking behaviour is identical (just richer).
--
-- Tenant-partitioned (tenant_id required) so an RLS policy is one line
-- when we ship RLS proper. Cascade-on-delete from quotes so a deleted
-- quote takes its log with it.
--
-- Idempotent. NOT auto-applied — apply with:
--   node --env-file=.env.local scripts/run-migration-039.mjs --apply
-- ════════════════════════════════════════════════════════════════════

create table if not exists quote_followup_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_id uuid not null references quotes(id) on delete cascade,

  -- Who logged it (null if synthesized server-side, e.g. auto-log on
  -- call/text dispatch). FK kept loose — auth.users is in another
  -- schema and we don't want a hard dependency for analytics later.
  actor_user_id uuid,

  -- What KIND of touch this is:
  --   call    — outbound call was placed (auto-logged by /followups/call)
  --   sms     — outbound SMS was sent    (auto-logged by /followups/text)
  --   note    — manual log entry from the dashboard "Log touch" form
  kind text not null check (kind in ('call', 'sms', 'note')),

  -- The OUTCOME from the VA's perspective. Free for 'call' / 'sms'
  -- (server fills 'call_dialed' / 'text_sent'); required-ish for 'note'.
  -- Open set kept narrow so reporting later is sane.
  outcome text check (outcome in (
    'call_dialed',
    'text_sent',
    'left_voicemail',
    'spoke',
    'no_answer',
    'wants_callback',
    'not_interested',
    'other'
  )),

  -- One-line system summary ("Outbound call dialed", "SMS: <first 120…>")
  -- for the timeline. Distinct from `note` (free-text from the user).
  summary text,
  note text,

  created_at timestamptz not null default now()
);

create index if not exists quote_followup_events_quote_idx
  on quote_followup_events (quote_id, created_at desc);

create index if not exists quote_followup_events_tenant_idx
  on quote_followup_events (tenant_id, created_at desc);
