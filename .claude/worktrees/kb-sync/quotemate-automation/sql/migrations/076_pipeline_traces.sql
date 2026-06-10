-- ════════════════════════════════════════════════════════════════════
-- Migration 076 — Phase 7 observability: pipeline_traces table.
--                  (Numbered 076 because an in-flight 075 covers a
--                  separate workpiece — invoice calibration tables.)
--
-- A single structured-log table that every pipeline step writes one row
-- to as it completes. Used by both:
--   • Vercel logs (we still emit a one-line summary via console.log so
--     `[QM` filters keep working)
--   • the new dashboard "Pipeline" tab (Phase 7b) which queries this
--     table to render a step-by-step trace for any intake/quote
--
-- Why a dedicated table rather than reading Vercel's log API:
--   • Vercel logs API is awkward to consume from a Next route + has
--     retention limits we can't control
--   • A typed jsonb column lets us store the exact input/output payloads
--     and grep them deterministically (the duplicate-HWS bug would have
--     been a one-query find with this in place)
--   • Per-tenant filtering / RLS becomes possible (Phase 8+)
--
-- Write pattern (lib/log/pipeline.ts → recordTrace):
--   • Fire-and-forget — never blocks the route on a DB insert
--   • Failures are swallowed silently (logging must never break a quote)
--   • Volume budget: ~10-15 rows per quote × ~50 quotes/day = ~500 rows/day
--     in the pilot. Easily handled by a single index on (intake_id,
--     created_at).
--
-- Idempotent: standard "create table if not exists" + indexes.
-- ════════════════════════════════════════════════════════════════════

begin;

create table if not exists pipeline_traces (
  id uuid primary key default gen_random_uuid(),

  -- Foreign keys are SET NULL on delete so trace history survives a
  -- tenant / intake / quote cleanup. CASCADE would silently wipe the
  -- evidence of bugs we may want to audit weeks later.
  intake_id uuid references intakes(id) on delete set null,
  sms_conversation_id uuid references sms_conversations(id) on delete set null,
  tenant_id uuid references tenants(id) on delete set null,

  -- Step taxonomy. step is the high-level stage (sms_inbound,
  -- extract_slots, dialog, intake_structurer, estimate, dispatch),
  -- substep is the optional fine grain (recipe_merge, validate_grounding,
  -- min_labour_floor, etc.). Both are free-text so we don't need to
  -- migrate every time a new stage lands.
  step text not null,
  substep text,

  -- ok / warn / err — same three states the existing pipelineLog
  -- emits via console.log markers (✓ / ⚠ / ✗).
  status text not null check (status in ('ok', 'warn', 'err')),

  -- Human-readable one-liner — what would have gone into console.log
  -- if this were a regular pipelineLog call. Kept short (<= 500 chars).
  message text,

  -- Structured payloads. JSONB so we can grep / filter from SQL.
  -- inputs:    what arrived at this step (the upstream output, truncated
  --            if huge — see lib/log/pipeline.ts for the budget)
  -- outputs:   what this step produced (the next step's input)
  -- decisions: key choices the step made — "picked assembly X", "recipe
  --            Y fired", "downgraded to inspection because Z", etc.
  --            Mirrors what makes debugging a quote easy: not the data,
  --            the reasoning.
  inputs jsonb,
  outputs jsonb,
  decisions jsonb,

  -- Latency in milliseconds. Useful for the "why was this quote slow?"
  -- question without leaving the dashboard for Vercel logs.
  duration_ms int,

  created_at timestamptz default now()
);

-- Primary query path: "show me every step for intake X, in time order".
-- The dashboard's Pipeline tab uses this exact shape.
create index if not exists pipeline_traces_intake_idx
  on pipeline_traces (intake_id, created_at)
  where intake_id is not null;

-- Secondary: per-step aggregation ("how many estimate steps failed in
-- the last hour?") — operator triage.
create index if not exists pipeline_traces_step_status_idx
  on pipeline_traces (step, status, created_at);

-- Tertiary: SMS-conversation trace path (a single inbound message has
-- multiple steps before the quote even exists).
create index if not exists pipeline_traces_sms_idx
  on pipeline_traces (sms_conversation_id, created_at)
  where sms_conversation_id is not null;

-- RLS — match the Phase-1.5 pattern: RLS on, no policies. Service-role
-- (used by every server route + the dashboard backend) bypasses RLS.
-- A future Phase 8 can add tenant-scoped policies for defense in depth
-- once we wire the dashboard auth path through to RLS.
alter table pipeline_traces enable row level security;

comment on table pipeline_traces is
  'Phase 7 observability (mig 075) — one row per pipeline step. Written by '
  'lib/log/pipeline.ts → recordTrace(). Read by the dashboard Pipeline tab. '
  'Fire-and-forget writes from the route; never blocks the request.';

-- Keep PostgREST schema cache fresh.
notify pgrst, 'reload schema';

commit;
