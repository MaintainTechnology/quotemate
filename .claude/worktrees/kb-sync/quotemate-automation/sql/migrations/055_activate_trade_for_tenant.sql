-- ════════════════════════════════════════════════════════════════════
-- Migration 055 — activate_trade_for_tenant() (Phase 2 · spec §10)
--
-- §10 — when an existing tenant turns on a new trade the system MUST,
-- ATOMICALLY:
--   1. append the trade to tenants.trades[] (keep the legacy scalar
--      `trade` consistent);
--   2. create a pricing_book row for (tenant, trade), seeded from
--      trade_pricing_defaults — WITHOUT this row every quote for the
--      trade fails (the WP1 failure class). Non-negotiable;
--   3. seed tenant_service_offerings — default_enabled services land
--      enabled, opt-in extras disabled.
-- "If any step fails the activation rolls back." A plpgsql function runs
-- in a single implicit transaction, so atomicity is by construction.
--
-- §10 step 4 (the per-tenant Vapi re-provision) is DELIBERATELY NOT here:
-- §9 rule 14 — Vapi re-provision is tenant-triggered, external, and
-- non-fatal; the API route fires it AFTER this function returns.
--
-- Idempotent — re-activating a trade the tenant already has tops up any
-- missing offering rows and never clobbers configured rates or toggles.
--
-- ADDITIVE — new function only, no schema/data change. Depends on
-- migrations 046 (trades), 047 (categories), 048 (trade_pricing_defaults),
-- 051 (shared_assemblies.retired_at).
-- Apply (staging first):
--   node --env-file=.env.staging.local scripts/run-migration-055.mjs
-- then production at ship time, with explicit approval:
--   node --env-file=.env.local         scripts/run-migration-055.mjs
-- ════════════════════════════════════════════════════════════════════

create or replace function activate_trade_for_tenant(
  p_tenant_id uuid,
  p_trade     text
)
returns jsonb
language plpgsql
as $$
declare
  v_trade            record;
  v_defaults         record;
  v_tenant           record;
  v_pb_exists        boolean;
  v_pb_seeded        boolean := false;
  v_offerings_seeded int := 0;
begin
  -- The trade must exist, be active, and be install/job-based (§2.1).
  select * into v_trade from trades where name = p_trade;
  if not found then
    raise exception 'trade "%" does not exist', p_trade;
  end if;
  if not v_trade.active then
    raise exception 'trade "%" is not active', p_trade;
  end if;
  if not v_trade.is_job_based then
    raise exception
      'trade "%" is not install/job-based — §2.1 puts it out of scope', p_trade;
  end if;

  -- Lock the tenant row against a concurrent activation.
  select * into v_tenant from tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'tenant % not found', p_tenant_id;
  end if;

  -- §10 step 2 keystone — without pricing defaults there is nothing to
  -- seed the pricing_book from, and a tenant carrying the trade with no
  -- book fails every quote. Hard requirement.
  select tpd.* into v_defaults
    from trade_pricing_defaults tpd
    join trades t on t.id = tpd.trade_id
   where t.name = p_trade;
  if not found then
    raise exception
      'trade "%" has no trade_pricing_defaults row — cannot seed the tenant pricing_book',
      p_trade;
  end if;

  -- ── step 1 — append to tenants.trades[] (idempotent) ──────────────
  if not (p_trade = any(v_tenant.trades)) then
    update tenants
       set trades = array_append(trades, p_trade),
           -- keep the legacy scalar consistent: only fill it when empty,
           -- never overwrite the tenant's existing primary trade.
           trade  = case when coalesce(trade, '') = '' then p_trade else trade end
     where id = p_tenant_id;
  end if;

  -- ── step 2 — pricing_book row, seeded from trade_pricing_defaults ──
  -- Explicit existence check (not ON CONFLICT): the (tenant_id, trade)
  -- unique index is PARTIAL on some databases and PostgREST/Postgres
  -- cannot always infer it as a conflict target. An existing row is left
  -- AS-IS — re-activating must never clobber configured rates.
  select exists(
    select 1 from pricing_book
     where tenant_id = p_tenant_id and trade = p_trade
  ) into v_pb_exists;
  if not v_pb_exists then
    insert into pricing_book (
      tenant_id, trade, hourly_rate, call_out_minimum, apprentice_rate,
      senior_rate, default_markup_pct, risk_buffer_pct, min_labour_hours,
      gst_registered, licence_type)
    values (
      p_tenant_id, p_trade,
      v_defaults.hourly_rate, v_defaults.call_out_minimum,
      v_defaults.apprentice_rate, v_defaults.senior_rate,
      v_defaults.default_markup_pct, v_defaults.risk_buffer_pct,
      v_defaults.min_labour_hours, v_defaults.gst_registered,
      v_defaults.licence_label);
    v_pb_seeded := true;
  end if;

  -- ── step 3 — seed tenant_service_offerings ────────────────────────
  -- A NEW service with default_enabled = true lands enabled; opt-in
  -- extras land disabled. An existing offering keeps its current toggle
  -- (on conflict do nothing) — never silently re-enables a service.
  with ins as (
    insert into tenant_service_offerings (tenant_id, assembly_id, enabled)
    select p_tenant_id, sa.id, coalesce(sa.default_enabled, false)
      from shared_assemblies sa
     where sa.trade = p_trade
       and sa.retired_at is null
    on conflict (tenant_id, assembly_id) do nothing
    returning 1
  )
  select count(*) into v_offerings_seeded from ins;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', p_tenant_id,
    'trade', p_trade,
    'pricing_book_seeded', v_pb_seeded,
    'offerings_seeded', v_offerings_seeded);
end;
$$;

notify pgrst, 'reload schema';
