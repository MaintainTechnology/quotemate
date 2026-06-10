-- Migration 087 · Signage Compliance (HQ / franchisor MVP)
--
-- A new, isolated product surface that mirrors the roofing tool: a
-- franchisor (an `org`, e.g. F45 HQ) runs photo-compliance "sweeps" across
-- many `studios`; each studio uploads guided photos via a tokenised link;
-- a Claude-vision pass scores them against the versioned `signage_rules`
-- registry; a deterministic backstop downgrades anything ungrounded to
-- "needs HQ review"; HQ works a review queue.
--
-- Deliberately does NOT touch the existing `tenants` table (tradie
-- businesses). A studio-compliance org is its own tenancy. All tables are
-- additive + idempotent.
--
-- Highest applied migration before this is 086.

-- ── orgs — the franchisor (the paying customer + isolation unit) ──────
create table if not exists public.orgs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  brand_slug      text not null default 'f45',   -- white-label hook for later
  owner_user_id   uuid,                           -- the HQ admin (Supabase auth user)
  owner_email     text,                           -- self-heal link target (mirrors tenants)
  created_at      timestamptz not null default now()
);
create index if not exists orgs_owner_user_id_idx on public.orgs (owner_user_id);
create index if not exists orgs_owner_email_idx   on public.orgs (lower(owner_email));

-- ── studios — a franchisee location under an org (no auth) ────────────
create table if not exists public.studios (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  name           text not null,
  region         text,                            -- 'APAC' / 'AU-NSW' — fleet filtering
  contact_phone  text,
  contact_email  text,
  status         text not null default 'open',    -- prospect | open | closed
  created_at     timestamptz not null default now()
);
create index if not exists studios_org_id_idx on public.studios (org_id);
create index if not exists studios_region_idx on public.studios (org_id, region);

-- ── signage_rules — the versioned, approved rule registry (ref data) ──
create table if not exists public.signage_rules (
  id                uuid primary key default gen_random_uuid(),
  brand_slug        text not null default 'f45',
  rule_set_version  int  not null default 1,
  rule_key          text not null,
  rule_text         text not null,
  rule_group        text not null default 'other',
  modality          text not null default 'must',          -- must|should|optional|process
  applicability     text not null default 'human_review_only',
                    -- auto_vision|needs_scale_reference|needs_metadata_or_context|human_review_only
  confidence        text not null default 'low',            -- high|medium|low (registry prior)
  mvp_tier          text not null default 'human_queue',
  required_shots    text[] not null default '{}',
  check_hint        text,
  source_citation   text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (brand_slug, rule_set_version, rule_key)
);
create index if not exists signage_rules_lookup_idx
  on public.signage_rules (brand_slug, rule_set_version, applicability)
  where active;

-- ── signage_sweeps — an HQ-initiated compliance campaign ──────────────
create table if not exists public.signage_sweeps (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  rule_set_version  int  not null default 1,
  name              text not null,
  studio_filter     jsonb not null default '{}'::jsonb,     -- {region, status}
  required_shots    text[] not null default '{}',
  status            text not null default 'sent',           -- draft|sent|collecting|review|closed
  created_by        uuid,
  created_at        timestamptz not null default now()
);
create index if not exists signage_sweeps_org_idx on public.signage_sweeps (org_id, created_at desc);

-- ── signage_requests — one per (sweep × studio): the tokenised ask ────
create table if not exists public.signage_requests (
  id              uuid primary key default gen_random_uuid(),
  sweep_id        uuid not null references public.signage_sweeps(id) on delete cascade,
  studio_id       uuid not null references public.studios(id) on delete cascade,
  org_id          uuid not null,                            -- denormalised for scoping
  public_token    text not null,                            -- the franchisee link
  state           text not null default 'pending',          -- pending|reminded|submitted|assessed|expired
  required_shots  text[] not null default '{}',
  reminded_count  int not null default 0,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists signage_requests_public_token_idx
  on public.signage_requests (public_token);
create index if not exists signage_requests_sweep_idx on public.signage_requests (sweep_id);
create index if not exists signage_requests_org_idx   on public.signage_requests (org_id, state);

-- ── signage_photo_submissions — one row per guided photo ──────────────
create table if not exists public.signage_photo_submissions (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.signage_requests(id) on delete cascade,
  studio_id     uuid not null,
  org_id        uuid not null,
  shot_slot     text not null,                              -- storefront|logo_wall|...
  storage_path  text not null,                              -- intake-photos/<...>
  captured_meta jsonb not null default '{}'::jsonb,         -- {ts, geo?} (phase-2 integrity)
  created_at    timestamptz not null default now()
);
create index if not exists signage_submissions_request_idx on public.signage_photo_submissions (request_id);

-- ── signage_assessments — one per request: run + per-rule verdicts ────
create table if not exists public.signage_assessments (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid not null references public.signage_requests(id) on delete cascade,
  studio_id             uuid not null,
  org_id                uuid not null,
  rule_set_version      int  not null default 1,
  status                text not null default 'scoring',    -- scoring|report_ready|hq_review|resolved
  overall               text,                               -- pass|fix_needed|needs_review
  verdicts              jsonb not null default '[]'::jsonb,  -- RuleVerdict[] (denormalised)
  counts                jsonb not null default '{}'::jsonb,  -- {compliant, fix, review}
  hq_decision           text,                               -- approved|needs_changes|escalated
  hq_reviewed_by        uuid,
  hq_note               text,
  reference_render_paths text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists signage_assessments_org_idx on public.signage_assessments (org_id, status, created_at desc);
create unique index if not exists signage_assessments_request_idx on public.signage_assessments (request_id);

-- ── RLS — enable on every new table (per migration 060 convention) ────
-- No positive policies: every reach goes through service-role API routes
-- with app-layer org scoping (same posture as the tenant model). The anon
-- key sees nothing.
alter table public.orgs                     enable row level security;
alter table public.studios                  enable row level security;
alter table public.signage_rules            enable row level security;
alter table public.signage_sweeps           enable row level security;
alter table public.signage_requests         enable row level security;
alter table public.signage_photo_submissions enable row level security;
alter table public.signage_assessments      enable row level security;

-- CRITICAL: refresh PostgREST's schema cache so supabase-js (every API
-- route) can immediately read/write the new tables. Skipping this is what
-- made the roofing receptionist silently lose writes (PGRST204).
notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n
    from information_schema.tables
   where table_schema='public'
     and table_name in ('orgs','studios','signage_rules','signage_sweeps',
                        'signage_requests','signage_photo_submissions','signage_assessments');
  raise notice 'Migration 087: % / 7 signage tables present', n;
end $$;
