-- 172 — Roofing semantic edge analysis, Phase 1
--
-- Creates the source-independent persistence boundary for read-only roof
-- topology evidence. This migration intentionally adds no provider adapter,
-- endpoint, UI, pricing mutation, or public-token access.
--
-- A topology analysis can only reference a recorded, tenant-scoped source
-- approval. This is deliberate: a caller-supplied approval string is not
-- sufficient authority to retain or display source-derived roof geometry.
--
-- Data handling:
--   * generated analysis evidence is immutable, except a lawful retention
--     purge may clear payload and asset keys;
--   * decisions are append-only in the database, not merely by route policy;
--   * quote revisions preserve their rate-card audit snapshot while redacting
--     topology/price payloads when source retention expires; and
--   * all rows are tenant-bound, including their measurement and analysis
--     references, so service-role writes cannot cross tenant boundaries.
--
-- All four tables are tenant-scoped and RLS-enabled with no public policies.
-- Service-role dashboard routes added in later phases must still filter every
-- query by tenant_id and reject tenantless roofing_measurements.
--
-- Apply only after review with:
--   APPLY_ROOF_EDGE_ANALYSIS_MIGRATION=true
--   node --env-file=.env.local scripts/run-migration-172.mjs

-- PostgreSQL needs a matching unique key for tenant-bound foreign keys. A
-- tenantless legacy measurement cannot satisfy the composite reference below.
create unique index if not exists roofing_measurements_id_tenant_unique
  on public.roofing_measurements (id, tenant_id);

-- Internal references and payloads cannot carry provider/signed URLs or
-- common credential shapes. Values are intentionally inspected recursively by
-- casting JSON to text at the storage boundary.
create or replace function public.roof_topology_value_is_safe(value text)
returns boolean
language sql
immutable
strict
as $$
  select value !~* '((https?|gs|s3|ftp|ftps|file|javascript):/{0,2}|data:|(^|[^[:alnum:]_])(//|www\.)|AIza[0-9A-Za-z_-]{20,}|(api[_-]?key|access[_-]?token|secret|authorization)[[:space:]]*[:=])';
$$;

-- Source metadata is an audit projection, not a second evidence payload.
-- Keep it flat and allowlist only provenance/alignment fields so a no-retention
-- or purged record cannot hide geometry, masks, counts, or assets here.
create or replace function public.roof_topology_metadata_is_safe(metadata jsonb)
returns boolean
language sql
immutable
strict
as $$
  select jsonb_typeof(metadata) = 'object'
    and not exists (
      select 1
        from jsonb_each(metadata) as entry(entry_name, entry_value)
       where entry.entry_name not in (
         'geometry_source',
         'geometrySource',
         'approval_id',
         'approvalId',
         'commercial_approval_reference',
         'commercialApprovalReference',
         'geometry_capture_date',
         'geometryCaptureDate',
         'geoscape_capture_date',
         'geoscapeCaptureDate',
         'retention_mode',
         'retentionMode',
         'retention_expires_at',
         'retentionExpiresAt',
         'temporal_review_required',
         'temporalReviewRequired',
         'source_date_delta_days',
         'sourceDateDeltaDays',
         'geoscape_building_id',
         'geoscapeBuildingId',
         'footprint_alignment_m',
         'footprintAlignmentM',
         'source_quality',
         'sourceQuality',
         'attribution_required',
         'attributionRequired',
         'analysis_version',
         'analysisVersion'
       )
          or jsonb_typeof(entry.entry_value) in ('array', 'object')
    );
$$;

-- This record is the durable legal/commercial gate. No seed row is included:
-- an authorised operator must record the written approval or licence before a
-- later source adapter can persist any topology evidence.
create table if not exists public.roof_topology_source_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  geometry_source text not null check (geometry_source in (
    'approved_google_solar',
    'licensed_aerial_dsm',
    'licensed_lidar'
  )),
  approval_reference text not null
    check (btrim(approval_reference) <> '')
    check (public.roof_topology_value_is_safe(approval_reference)),
  -- Internal storage key for the written approval/licence; never a provider URL.
  written_approval_document_key text not null
    check (btrim(written_approval_document_key) <> '')
    check (public.roof_topology_value_is_safe(written_approval_document_key)),
  approval_status text not null default 'active'
    check (approval_status in ('active', 'revoked', 'expired')),
  allows_derived_geometry boolean not null default false,
  retention_policy text not null check (retention_policy in ('none', 'expires', 'perpetual')),
  max_retention_expires_at timestamptz,
  valid_until timestamptz,
  recorded_by_provider text not null check (recorded_by_provider in ('clerk', 'supabase')),
  recorded_by_actor_id text not null,
  revoked_at timestamptz,
  revoked_by_provider text check (revoked_by_provider is null or revoked_by_provider in ('clerk', 'supabase')),
  revoked_by_actor_id text,
  revocation_reason text check (
    revocation_reason is null or public.roof_topology_value_is_safe(revocation_reason)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, tenant_id, geometry_source),
  unique (tenant_id, geometry_source, approval_reference),
  check (
    (retention_policy = 'expires' and max_retention_expires_at is not null)
    or
    (retention_policy in ('none', 'perpetual') and max_retention_expires_at is null)
  ),
  check (
    (approval_status = 'active'
      and revoked_at is null
      and revoked_by_provider is null
      and revoked_by_actor_id is null
      and revocation_reason is null)
    or
    (approval_status in ('revoked', 'expired')
      and revoked_at is not null
      and revoked_by_provider is not null
      and revoked_by_actor_id is not null)
  )
);

create table if not exists public.roof_edge_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  measurement_id uuid not null,

  -- 1-based, matching existing roofing selection helpers.
  structure_index integer not null check (structure_index >= 1),
  building_id text not null,

  status text not null check (status in ('available', 'needs_review', 'unavailable')),
  analysis_version text not null,
  geometry_source text not null check (geometry_source in (
    'approved_google_solar',
    'licensed_aerial_dsm',
    'licensed_lidar'
  )),
  source_approval_id uuid not null,
  commercial_approval_reference text not null
    check (btrim(commercial_approval_reference) <> '')
    check (public.roof_topology_value_is_safe(commercial_approval_reference)),

  -- Versioned immutable envelope: candidates, summary, permitted overlay metadata.
  -- It becomes NULL only when no retention is allowed or after a lawful purge.
  candidate_payload jsonb
    check (candidate_payload is null or jsonb_typeof(candidate_payload) = 'object')
    check (candidate_payload is null or public.roof_topology_value_is_safe(candidate_payload::text)),
  -- Direct evidence may name only the source approved for this analysis. A
  -- fused candidate is interpreted as this source plus Geoscape context; it
  -- cannot introduce a second provider without a future multi-source model.
  check (
    candidate_payload is null
    or geometry_source = 'approved_google_solar'
    or not jsonb_path_exists(
      candidate_payload,
      '$.candidates[*].evidence.source ? (@ == "approved_google_solar")'
    )
  ),
  check (
    candidate_payload is null
    or geometry_source = 'approved_google_solar'
    or not jsonb_path_exists(
      candidate_payload,
      '$.candidates[*].evidence.geometrySource ? (@ == "approved_google_solar")'
    )
  ),
  check (
    candidate_payload is null
    or geometry_source = 'licensed_aerial_dsm'
    or not jsonb_path_exists(
      candidate_payload,
      '$.candidates[*].evidence.source ? (@ == "licensed_aerial_dsm")'
    )
  ),
  check (
    candidate_payload is null
    or geometry_source = 'licensed_aerial_dsm'
    or not jsonb_path_exists(
      candidate_payload,
      '$.candidates[*].evidence.geometrySource ? (@ == "licensed_aerial_dsm")'
    )
  ),
  check (
    candidate_payload is null
    or geometry_source = 'licensed_lidar'
    or not jsonb_path_exists(
      candidate_payload,
      '$.candidates[*].evidence.source ? (@ == "licensed_lidar")'
    )
  ),
  check (
    candidate_payload is null
    or geometry_source = 'licensed_lidar'
    or not jsonb_path_exists(
      candidate_payload,
      '$.candidates[*].evidence.geometrySource ? (@ == "licensed_lidar")'
    )
  ),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object')
    check (public.roof_topology_metadata_is_safe(source_metadata))
    check (public.roof_topology_value_is_safe(source_metadata::text)),

  -- Internal object-storage keys only. Provider URLs and signed URLs are rejected.
  retained_asset_keys jsonb not null default '[]'::jsonb
    check (jsonb_typeof(retained_asset_keys) = 'array')
    check (public.roof_topology_value_is_safe(retained_asset_keys::text)),

  retention_mode text not null check (retention_mode in ('none', 'expires', 'perpetual')),
  retention_expires_at timestamptz,
  purge_state text not null default 'not_required'
    check (purge_state in ('not_required', 'pending', 'purging', 'purged', 'failed')),
  purged_at timestamptz,
  purge_error text check (purge_error is null or public.roof_topology_value_is_safe(purge_error)),

  requested_by_provider text not null check (requested_by_provider in ('clerk', 'supabase')),
  requested_by_actor_id text not null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (id, tenant_id),
  unique (id, tenant_id, measurement_id),
  foreign key (measurement_id, tenant_id)
    references public.roofing_measurements (id, tenant_id)
    on delete cascade deferrable initially deferred,
  foreign key (source_approval_id, tenant_id, geometry_source)
    references public.roof_topology_source_approvals (id, tenant_id, geometry_source)
    on delete no action deferrable initially deferred,
  check (
    (retention_mode = 'none'
      and retention_expires_at is null
      and purge_state = 'not_required'
      and purged_at is null
      and candidate_payload is null
      and retained_asset_keys = '[]'::jsonb
      and status = 'unavailable')
    or
    (retention_mode = 'perpetual'
      and retention_expires_at is null
      and (
        (purge_state = 'not_required'
          and purged_at is null
          and candidate_payload is not null
          and status in ('available', 'needs_review'))
        or
        (purge_state in ('pending', 'purging', 'failed')
          and purged_at is null
          and candidate_payload is not null
          and status in ('available', 'needs_review'))
        or
        (purge_state = 'purged'
          and purged_at is not null
          and candidate_payload is null
          and retained_asset_keys = '[]'::jsonb
          and status = 'unavailable')
      ))
    or
    (retention_mode = 'expires'
      and retention_expires_at is not null
      and (
        (purge_state in ('pending', 'purging', 'failed')
          and purged_at is null
          and candidate_payload is not null
          and status in ('available', 'needs_review'))
        or
        (purge_state = 'purged'
          and purged_at is not null
          and candidate_payload is null
          and retained_asset_keys = '[]'::jsonb
          and status = 'unavailable')
      ))
  ),
  check ((purge_error is null) = (purge_state <> 'failed'))
);

create table if not exists public.roof_edge_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  analysis_id uuid not null,

  -- NULL only for a tradie-drawn manual run.
  candidate_id text,
  action text not null check (action in ('approve', 'reject', 'retype', 'edit', 'add_manual')),
  kind text check (kind is null or kind in ('ridge', 'hip', 'valley', 'eave', 'unknown')),
  -- Candidate geometry stays only in the purgeable analysis payload. A decision
  -- may retain geometry only when it is explicitly entered by the tradie.
  geometry_origin text not null default 'none'
    check (geometry_origin in ('none', 'manual')),
  geometry jsonb check (geometry is null or jsonb_typeof(geometry) = 'object')
    check (geometry is null or public.roof_topology_value_is_safe(geometry::text)),
  plan_length_m numeric(10,3),
  surface_length_m numeric(10,3),
  note text check (note is null or public.roof_topology_value_is_safe(note)),

  actor_provider text not null check (actor_provider in ('clerk', 'supabase')),
  actor_id text not null,
  created_at timestamptz not null default now(),

  foreign key (analysis_id, tenant_id)
    references public.roof_edge_analyses (id, tenant_id)
    on delete cascade deferrable initially deferred,
  unique (id, analysis_id, tenant_id),
  check ((candidate_id is null) = (action = 'add_manual')),
  check (
    (geometry is null and geometry_origin = 'none')
    or
    (geometry is not null and geometry_origin = 'manual')
  ),
  check (action <> 'add_manual' or (kind is not null and geometry is not null)),
  check (action <> 'retype' or kind is not null),
  check (
    action <> 'edit'
    or geometry is not null
    or plan_length_m is not null
    or surface_length_m is not null
  ),
  -- Approve/reject reference the immutable analysis candidate; they do not copy geometry.
  check (
    action not in ('approve', 'reject')
    or (kind is null and geometry is null and plan_length_m is null and surface_length_m is null)
  ),
  check (plan_length_m is null or (plan_length_m >= 0 and plan_length_m::text <> 'NaN')),
  check (surface_length_m is null or (surface_length_m >= 0 and surface_length_m::text <> 'NaN'))
);

create table if not exists public.roofing_quote_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  measurement_id uuid not null,
  analysis_id uuid not null,

  base_quote_id uuid references public.quotes(id) on delete set null,
  pricing_book_id uuid references public.pricing_book(id) on delete set null,

  mode text not null check (mode in ('candidate_draft', 'approved_topology')),
  state text not null default 'active'
    check (state in ('active', 'reverted', 'superseded', 'purged')),
  -- No customer/share token exists on this table by design.
  is_internal boolean not null default true check (is_internal),

  decision_cutoff_at timestamptz not null,
  decision_cutoff_id uuid,
  -- Exact inputs for a later deterministic reprice; never reload live rates.
  -- The rate card is commercial audit data, not source-derived geometry.
  rate_card_snapshot jsonb not null
    check (jsonb_typeof(rate_card_snapshot) = 'object')
    check (public.roof_topology_value_is_safe(rate_card_snapshot::text)),
  topology_measurement jsonb
    check (topology_measurement is null or jsonb_typeof(topology_measurement) = 'object')
    check (topology_measurement is null or public.roof_topology_value_is_safe(topology_measurement::text)),
  price_snapshot jsonb
    check (price_snapshot is null or jsonb_typeof(price_snapshot) = 'object')
    check (price_snapshot is null or public.roof_topology_value_is_safe(price_snapshot::text)),

  -- A revision is never created for a source that permits no retained
  -- topology. Expiring revisions redact their source-derived summaries.
  retention_mode text not null check (retention_mode in ('expires', 'perpetual')),
  retention_expires_at timestamptz,
  purge_state text not null default 'not_required'
    check (purge_state in ('not_required', 'pending', 'purging', 'purged', 'failed')),
  purged_at timestamptz,
  purge_error text check (purge_error is null or public.roof_topology_value_is_safe(purge_error)),
  actor_provider text not null check (actor_provider in ('clerk', 'supabase')),
  actor_id text not null,
  created_at timestamptz not null default now(),

  foreign key (measurement_id, tenant_id)
    references public.roofing_measurements (id, tenant_id)
    on delete cascade deferrable initially deferred,
  foreign key (analysis_id, tenant_id, measurement_id)
    references public.roof_edge_analyses (id, tenant_id, measurement_id)
    on delete cascade deferrable initially deferred,
  foreign key (decision_cutoff_id, analysis_id, tenant_id)
    references public.roof_edge_decisions (id, analysis_id, tenant_id)
    on delete no action deferrable initially deferred,
  check (
    (retention_mode = 'perpetual'
      and retention_expires_at is null
      and (
        (purge_state = 'not_required'
          and purged_at is null
          and state in ('active', 'reverted', 'superseded')
          and topology_measurement is not null
          and price_snapshot is not null)
        or
        (purge_state in ('pending', 'purging', 'failed')
          and purged_at is null
          and state in ('active', 'reverted', 'superseded')
          and topology_measurement is not null
          and price_snapshot is not null)
        or
        (purge_state = 'purged'
          and purged_at is not null
          and state = 'purged'
          and topology_measurement is null
          and price_snapshot is null)
      ))
    or
    (retention_mode = 'expires'
      and retention_expires_at is not null
      and (
        (purge_state in ('pending', 'purging', 'failed')
          and purged_at is null
          and state in ('active', 'reverted', 'superseded')
          and topology_measurement is not null
          and price_snapshot is not null)
        or
        (purge_state = 'purged'
          and purged_at is not null
          and state = 'purged'
          and topology_measurement is null
          and price_snapshot is null)
      ))
  ),
  check ((purge_error is null) = (purge_state <> 'failed'))
);

create index if not exists roof_topology_source_approvals_tenant_source_idx
  on public.roof_topology_source_approvals (tenant_id, geometry_source, approval_status);

create index if not exists roof_edge_analyses_measurement_created_idx
  on public.roof_edge_analyses (measurement_id, created_at desc);

create index if not exists roof_edge_analyses_tenant_created_idx
  on public.roof_edge_analyses (tenant_id, created_at desc);

create index if not exists roof_edge_analyses_expiry_idx
  on public.roof_edge_analyses (retention_expires_at)
  where retention_mode = 'expires' and purge_state <> 'purged';

create index if not exists roof_edge_decisions_analysis_created_idx
  on public.roof_edge_decisions (analysis_id, created_at, id);

create index if not exists roofing_quote_revisions_tenant_measurement_idx
  on public.roofing_quote_revisions (tenant_id, measurement_id, created_at desc);

create index if not exists roofing_quote_revisions_analysis_idx
  on public.roofing_quote_revisions (analysis_id, created_at desc);

create index if not exists roofing_quote_revisions_expiry_idx
  on public.roofing_quote_revisions (retention_expires_at)
  where retention_mode = 'expires' and purge_state <> 'purged';

-- Legal source terms are immutable once an analysis references them. The sole
-- permitted change is an auditable active-to-revoked/expired transition, which
-- immediately queues source-derived records for redaction.
create or replace function public.guard_roof_topology_source_approval_immutability()
returns trigger
language plpgsql
as $$
declare
  is_referenced boolean;
begin
  select exists (
    select 1
      from public.roof_edge_analyses
     where source_approval_id = old.id
  ) into is_referenced;

  if not is_referenced then
    return new;
  end if;

  if old.tenant_id is distinct from new.tenant_id
     or old.geometry_source is distinct from new.geometry_source
     or old.approval_reference is distinct from new.approval_reference
     or old.written_approval_document_key is distinct from new.written_approval_document_key
     or old.allows_derived_geometry is distinct from new.allows_derived_geometry
     or old.retention_policy is distinct from new.retention_policy
     or old.max_retention_expires_at is distinct from new.max_retention_expires_at
     or old.valid_until is distinct from new.valid_until
     or old.recorded_by_provider is distinct from new.recorded_by_provider
     or old.recorded_by_actor_id is distinct from new.recorded_by_actor_id
     or old.created_at is distinct from new.created_at then
    raise exception 'referenced roof topology source approval terms are immutable';
  end if;

  if old.approval_status = 'active'
     and new.approval_status in ('revoked', 'expired') then
    return new;
  end if;

  raise exception 'referenced roof topology source approval may only be revoked or expired';
end;
$$;

drop trigger if exists roof_topology_source_approvals_immutable on public.roof_topology_source_approvals;
create trigger roof_topology_source_approvals_immutable
before update
on public.roof_topology_source_approvals
for each row execute function public.guard_roof_topology_source_approval_immutability();

create or replace function public.queue_revoked_roof_topology_for_purge()
returns trigger
language plpgsql
as $$
begin
  if old.approval_status = 'active'
     and new.approval_status in ('revoked', 'expired') then
    update public.roof_edge_analyses
       set purge_state = 'pending',
           purge_error = null
     where source_approval_id = new.id
       and purge_state = 'not_required'
       and candidate_payload is not null;

    update public.roofing_quote_revisions revision
       set purge_state = 'pending',
           purge_error = null
      from public.roof_edge_analyses analysis
     where revision.analysis_id = analysis.id
       and analysis.source_approval_id = new.id
       and revision.purge_state = 'not_required'
       and revision.topology_measurement is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists roof_topology_source_approvals_queue_purge on public.roof_topology_source_approvals;
create trigger roof_topology_source_approvals_queue_purge
after update of approval_status
on public.roof_topology_source_approvals
for each row execute function public.queue_revoked_roof_topology_for_purge();

-- Reject tenantless or cross-tenant measurement references even for service-role
-- writers. The composite foreign key below provides the same protection at the
-- relational layer; this trigger makes the failure explicit.
create or replace function public.guard_roof_edge_tenant_consistency()
returns trigger
language plpgsql
as $$
declare
  measurement_tenant uuid;
begin
  select tenant_id into measurement_tenant
    from public.roofing_measurements
   where id = new.measurement_id;

  if not found or measurement_tenant is null then
    raise exception 'roof edge analysis requires a tenant-scoped roofing measurement';
  end if;

  if measurement_tenant is distinct from new.tenant_id then
    raise exception 'roof edge analysis tenant must match roofing measurement tenant';
  end if;

  return new;
end;
$$;

drop trigger if exists roof_edge_tenant_consistency on public.roof_edge_analyses;
create trigger roof_edge_tenant_consistency
before insert or update of tenant_id, measurement_id
on public.roof_edge_analyses
for each row execute function public.guard_roof_edge_tenant_consistency();

-- A source-derived analysis may only be created against a recorded active
-- approval whose source, tenant, derivative-geometry permission, and retention
-- window all match the row being written.
create or replace function public.guard_roof_edge_source_approval()
returns trigger
language plpgsql
as $$
declare
  approval public.roof_topology_source_approvals%rowtype;
begin
  select * into approval
    from public.roof_topology_source_approvals
   where id = new.source_approval_id
     and tenant_id = new.tenant_id
     and geometry_source = new.geometry_source;

  if not found then
    raise exception 'roof edge analysis requires a matching tenant-scoped source approval';
  end if;

  if approval.approval_status <> 'active'
     or not approval.allows_derived_geometry
     or (approval.valid_until is not null and approval.valid_until <= now()) then
    raise exception 'roof edge analysis source approval is not active for derived geometry';
  end if;

  if new.commercial_approval_reference is distinct from approval.approval_reference then
    raise exception 'roof edge analysis approval reference does not match the recorded approval';
  end if;

  if approval.retention_policy = 'none' and new.retention_mode <> 'none' then
    raise exception 'roof edge analysis source approval permits no retained topology';
  end if;

  if approval.retention_policy = 'expires' and new.retention_mode = 'perpetual' then
    raise exception 'roof edge analysis source approval does not permit perpetual retention';
  end if;

  if approval.valid_until is not null
     and new.retention_mode <> 'none'
     and (
       new.retention_mode <> 'expires'
       or new.retention_expires_at > approval.valid_until
     ) then
    raise exception 'roof edge analysis retention must not outlast source approval validity';
  end if;

  if new.retention_mode = 'expires' and new.retention_expires_at <= now() then
    raise exception 'roof edge analysis retention must expire in the future';
  end if;

  if approval.retention_policy = 'expires'
     and approval.max_retention_expires_at <= now() then
    raise exception 'roof edge analysis source approval retention window has expired';
  end if;

  if approval.retention_policy = 'expires'
     and new.retention_mode = 'expires'
     and new.retention_expires_at > approval.max_retention_expires_at then
    raise exception 'roof edge analysis retention exceeds the recorded approval window';
  end if;

  return new;
end;
$$;

drop trigger if exists roof_edge_analyses_source_approval_guard on public.roof_edge_analyses;
create trigger roof_edge_analyses_source_approval_guard
before insert or update of source_approval_id, tenant_id, geometry_source,
  commercial_approval_reference, retention_mode, retention_expires_at
on public.roof_edge_analyses
for each row execute function public.guard_roof_edge_source_approval();

-- Generated evidence is immutable. The only legal update is the finite purge
-- state machine, which may clear payload and storage keys only when completed.
create or replace function public.guard_roof_edge_analysis_payload()
returns trigger
language plpgsql
as $$
declare
  source_approval_inactive boolean;
begin
  if old.tenant_id is distinct from new.tenant_id
     or old.measurement_id is distinct from new.measurement_id
     or old.structure_index is distinct from new.structure_index
     or old.building_id is distinct from new.building_id
     or old.analysis_version is distinct from new.analysis_version
     or old.geometry_source is distinct from new.geometry_source
     or old.source_approval_id is distinct from new.source_approval_id
     or old.commercial_approval_reference is distinct from new.commercial_approval_reference
     or old.source_metadata is distinct from new.source_metadata
     or old.retention_mode is distinct from new.retention_mode
     or old.retention_expires_at is distinct from new.retention_expires_at
     or old.requested_by_provider is distinct from new.requested_by_provider
     or old.requested_by_actor_id is distinct from new.requested_by_actor_id
     or old.generated_at is distinct from new.generated_at
     or old.created_at is distinct from new.created_at then
    raise exception 'roof edge analysis evidence fields are immutable';
  end if;

  if old.purge_state = 'not_required' and new.purge_state = 'pending' then
    select approval_status <> 'active'
        or (valid_until is not null and valid_until <= now())
      into source_approval_inactive
      from public.roof_topology_source_approvals
     where id = old.source_approval_id;

    if not coalesce(source_approval_inactive, true) then
      raise exception 'perpetual roof edge analysis may purge only after source approval revocation';
    end if;
  elsif old.purge_state is distinct from new.purge_state
     and not (
       (old.purge_state = 'pending' and new.purge_state in ('purging', 'purged', 'failed'))
       or
       (old.purge_state = 'purging' and new.purge_state in ('purged', 'failed'))
       or
       (old.purge_state = 'failed' and new.purge_state in ('pending', 'purging', 'purged'))
     ) then
    raise exception 'roof edge analysis purge state transition is invalid';
  end if;

  if old.status is distinct from new.status
     and not (
       old.status in ('available', 'needs_review')
       and new.status = 'unavailable'
       and new.purge_state = 'purged'
       and new.purged_at is not null
     ) then
    raise exception 'roof edge analysis status is immutable outside a completed purge';
  end if;

  if old.candidate_payload is distinct from new.candidate_payload
     and not (
       old.candidate_payload is not null
       and new.candidate_payload is null
       and new.purge_state = 'purged'
       and new.purged_at is not null
     ) then
    raise exception 'candidate_payload is immutable outside a completed purge';
  end if;

  if old.retained_asset_keys is distinct from new.retained_asset_keys
     and not (
       new.candidate_payload is null
       and new.retained_asset_keys = '[]'::jsonb
       and new.purge_state = 'purged'
       and new.purged_at is not null
     ) then
    raise exception 'roof_edge_analyses.retained_asset_keys may only clear after a completed purge';
  end if;

  return new;
end;
$$;

drop trigger if exists roof_edge_analyses_payload_immutable on public.roof_edge_analyses;
create trigger roof_edge_analyses_payload_immutable
before update
on public.roof_edge_analyses
for each row execute function public.guard_roof_edge_analysis_payload();

-- The internal draft never outlives the analysis it derives from. When a
-- completed analysis purge redacts candidate geometry, redact every attached
-- topology/price snapshot in the same database transaction.
create or replace function public.redact_roofing_quote_revisions_for_purged_analysis()
returns trigger
language plpgsql
as $$
begin
  if old.purge_state <> 'purged' and new.purge_state = 'purged' then
    update public.roofing_quote_revisions
       set topology_measurement = null,
           price_snapshot = null,
           state = 'purged',
           purge_state = 'purged',
           purged_at = new.purged_at,
           purge_error = null
     where analysis_id = new.id
       and purge_state <> 'purged';
  end if;
  return new;
end;
$$;

drop trigger if exists roof_edge_analyses_redact_revisions_on_purge on public.roof_edge_analyses;
create trigger roof_edge_analyses_redact_revisions_on_purge
after update of purge_state
on public.roof_edge_analyses
for each row execute function public.redact_roofing_quote_revisions_for_purged_analysis();

-- Analyses are evidence records, not mutable application state. Deletion is
-- allowed only while cascading from an owning record (for example tenant
-- erasure); an ordinary direct delete is rejected.
create or replace function public.guard_roof_edge_analysis_delete()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'roof edge analyses are immutable; use a retention purge instead';
end;
$$;

drop trigger if exists roof_edge_analyses_delete_guard on public.roof_edge_analyses;
create trigger roof_edge_analyses_delete_guard
before delete
on public.roof_edge_analyses
for each row execute function public.guard_roof_edge_analysis_delete();

-- Decisions form an audit log. A cascade from tenant/measurement erasure is
-- permitted, but application or service-role UPDATE/DELETE is not.
create or replace function public.guard_roof_edge_decisions_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'delete' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'roof edge decisions are append-only';
end;
$$;

drop trigger if exists roof_edge_decisions_append_only on public.roof_edge_decisions;
create trigger roof_edge_decisions_append_only
before update or delete
on public.roof_edge_decisions
for each row execute function public.guard_roof_edge_decisions_append_only();

-- A revision is a child of exactly one analysis for exactly one measurement.
-- Its source-retention policy can only be as permissive as that analysis, and
-- optional quote/pricing references must belong to the same tenant.
create or replace function public.guard_roofing_quote_revision_parentage()
returns trigger
language plpgsql
as $$
declare
  analysis_parent record;
  reference_tenant uuid;
begin
  select analysis.measurement_id,
         analysis.retention_mode,
         analysis.retention_expires_at,
         analysis.purge_state,
         analysis.status,
         approval.approval_status as source_approval_status,
         approval.valid_until as source_approval_valid_until
    into analysis_parent
    from public.roof_edge_analyses analysis
    join public.roof_topology_source_approvals approval
      on approval.id = analysis.source_approval_id
   where analysis.id = new.analysis_id
     and analysis.tenant_id = new.tenant_id;

  if not found then
    raise exception 'roofing quote revision requires a tenant-scoped analysis';
  end if;

  if analysis_parent.measurement_id is distinct from new.measurement_id then
    raise exception 'roofing quote revision measurement must match its analysis measurement';
  end if;

  if analysis_parent.status = 'unavailable'
     or analysis_parent.purge_state = 'purged'
     or analysis_parent.source_approval_status <> 'active'
     or (
       analysis_parent.source_approval_valid_until is not null
       and analysis_parent.source_approval_valid_until <= now()
     ) then
    raise exception 'roofing quote revision cannot use unavailable or unapproved topology';
  end if;

  if analysis_parent.retention_mode = 'none' then
    raise exception 'roofing quote revision cannot retain no-retention topology';
  end if;

  if new.retention_mode = 'expires' and new.retention_expires_at <= now() then
    raise exception 'roofing quote revision retention must expire in the future';
  end if;

  if analysis_parent.retention_mode = 'expires'
     and (
       new.retention_mode <> 'expires'
       or new.retention_expires_at > analysis_parent.retention_expires_at
     ) then
    raise exception 'roofing quote revision retention exceeds its analysis retention';
  end if;

  if new.base_quote_id is not null then
    select tenant_id into reference_tenant
      from public.quotes
     where id = new.base_quote_id;
    if not found or reference_tenant is null or reference_tenant is distinct from new.tenant_id then
      raise exception 'roofing quote revision base quote must belong to its tenant';
    end if;
  end if;

  if new.pricing_book_id is not null then
    select tenant_id into reference_tenant
      from public.pricing_book
     where id = new.pricing_book_id;
    if not found or reference_tenant is null or reference_tenant is distinct from new.tenant_id then
      raise exception 'roofing quote revision pricing book must belong to its tenant';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists roofing_quote_revisions_parentage_guard on public.roofing_quote_revisions;
create trigger roofing_quote_revisions_parentage_guard
before insert or update of tenant_id, measurement_id, analysis_id, base_quote_id,
  pricing_book_id, retention_mode, retention_expires_at
on public.roofing_quote_revisions
for each row execute function public.guard_roofing_quote_revision_parentage();

-- Revisions may later change business state (active/reverted/superseded), but
-- never their frozen rate card. Source-derived topology and the resulting price
-- snapshot may only be redacted as one completed retention purge.
create or replace function public.guard_roofing_quote_revision_payload()
returns trigger
language plpgsql
as $$
declare
  source_approval_inactive boolean;
begin
  if old.tenant_id is distinct from new.tenant_id
     or old.measurement_id is distinct from new.measurement_id
     or old.analysis_id is distinct from new.analysis_id
     or old.base_quote_id is distinct from new.base_quote_id
     or old.pricing_book_id is distinct from new.pricing_book_id
     or old.mode is distinct from new.mode
     or old.is_internal is distinct from new.is_internal
     or old.decision_cutoff_at is distinct from new.decision_cutoff_at
     or old.decision_cutoff_id is distinct from new.decision_cutoff_id
     or old.rate_card_snapshot is distinct from new.rate_card_snapshot
     or old.retention_mode is distinct from new.retention_mode
     or old.retention_expires_at is distinct from new.retention_expires_at
     or old.actor_provider is distinct from new.actor_provider
     or old.actor_id is distinct from new.actor_id
     or old.created_at is distinct from new.created_at then
    raise exception 'roofing quote revision evidence fields are immutable';
  end if;

  if old.purge_state = 'not_required' and new.purge_state = 'pending' then
    select approval.approval_status <> 'active'
        or (approval.valid_until is not null and approval.valid_until <= now())
      into source_approval_inactive
      from public.roof_edge_analyses analysis
      join public.roof_topology_source_approvals approval
        on approval.id = analysis.source_approval_id
     where analysis.id = old.analysis_id;

    if not coalesce(source_approval_inactive, true) then
      raise exception 'perpetual roofing quote revision may purge only after source approval revocation';
    end if;
  elsif old.purge_state is distinct from new.purge_state
     and not (
       (old.purge_state = 'pending' and new.purge_state in ('purging', 'purged', 'failed'))
       or
       (old.purge_state = 'purging' and new.purge_state in ('purged', 'failed'))
       or
       (old.purge_state = 'failed' and new.purge_state in ('pending', 'purging', 'purged'))
     ) then
    raise exception 'roofing quote revision purge state transition is invalid';
  end if;

  if old.topology_measurement is distinct from new.topology_measurement
     or old.price_snapshot is distinct from new.price_snapshot then
    if not (
      old.topology_measurement is not null
      and old.price_snapshot is not null
      and new.topology_measurement is null
      and new.price_snapshot is null
      and new.purge_state = 'purged'
      and new.purged_at is not null
      and new.state = 'purged'
    ) then
      raise exception 'roofing quote revision topology and price snapshots may only clear after a completed purge';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists roofing_quote_revisions_payload_immutable on public.roofing_quote_revisions;
create trigger roofing_quote_revisions_payload_immutable
before update
on public.roofing_quote_revisions
for each row execute function public.guard_roofing_quote_revision_payload();

-- RLS on with no policies means anon/authenticated callers cannot read these
-- tables. Future service-role routes remain responsible for tenant filtering.
alter table public.roof_topology_source_approvals enable row level security;
alter table public.roof_edge_analyses enable row level security;
alter table public.roof_edge_decisions enable row level security;
alter table public.roofing_quote_revisions enable row level security;

comment on table public.roof_topology_source_approvals is
  'Tenant-scoped recorded written approval/licence gate for source-derived roof topology.';
comment on table public.roof_edge_analyses is
  'Immutable generated roof-edge candidate evidence. Payload changes only when a lawful source-retention purge clears it.';
comment on table public.roof_edge_decisions is
  'Database append-only tradie review log for roof-edge candidate decisions.';
comment on table public.roofing_quote_revisions is
  'Internal-only topology drafts with frozen rate-card snapshots; topology and price payloads redact on source-retention purge.';

notify pgrst, 'reload schema';
