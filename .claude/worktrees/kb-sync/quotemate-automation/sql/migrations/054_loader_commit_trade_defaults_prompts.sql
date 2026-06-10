-- ════════════════════════════════════════════════════════════════════
-- Migration 054 — admin bulk loader: commit/rollback for the rest of a
--                  new-trade bundle — trade_pricing_defaults + trade_prompts
--                  (Phase 2 · spec §4 items 3 & 4)
--
-- Migration 053 taught commit_import_batch the `trades` + `categories`
-- tables. A complete new-trade bundle (spec §4) ALSO carries:
--   · trade_pricing_defaults — the 8 rate fields + licence (§7.5). Without
--     this row §10 step 2 cannot seed a tenant's pricing_book → every quote
--     for the trade fails (the WP1 failure class). Non-negotiable.
--   · trade_prompts — the §6 prompt pack (estimator / SMS / Voice text).
--
-- Both are keyed by trade_id and resolve it from `trades` by name, so they
-- commit AFTER the trade row (same dependency tier as categories). Both are
-- INSERT-only in a new-trade bundle (row_class NEW) — an UPDATE row is
-- rejected loud, not silent.
--
-- Rollback deletes them in the categories tier — before the trade row, so
-- their FK references are gone first (the trade's `on delete cascade` would
-- also clear them, but explicit reverse-order deletes keep the audit honest).
-- §9 rule 17: neither table has independent downstream usage — the existing
-- `trades` guard (a tenant covering the trade) already protects the bundle.
--
-- create-or-replace only — no schema change, no data change, idempotent.
-- Apply (staging first):
--   node --env-file=.env.staging.local scripts/run-migration-054.mjs
-- then production at ship time, with explicit approval:
--   node --env-file=.env.local         scripts/run-migration-054.mjs
-- ════════════════════════════════════════════════════════════════════

-- ── commit_import_batch ─────────────────────────────────────────────
create or replace function commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_status    text;
  v_row       record;
  v_before    jsonb;
  v_new_id    uuid;
  v_inserts   jsonb := '[]'::jsonb;
  v_updates   jsonb := '[]'::jsonb;
  v_committed int  := 0;
  v_skipped   int  := 0;
begin
  -- Idempotency (§9 rule 12) + lock against a concurrent commit.
  select status into v_status from import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'import batch % not found', p_batch_id;
  end if;
  if v_status = 'committed' then
    return jsonb_build_object('ok', true, 'already_committed', true);
  end if;
  if v_status <> 'staged' then
    raise exception 'batch % is %, only a staged batch can be committed',
      p_batch_id, v_status;
  end if;

  -- Dependency order: a new trade is inserted before everything that FKs to
  -- it — categories, trade_pricing_defaults, trade_prompts (all tier 2) — and
  -- before any service that names it (tier 3).
  for v_row in
    select * from import_staged_rows
     where batch_id = p_batch_id
       and validation_status = 'passed'
       and smoke_status in ('passed', 'skipped')
     order by case target_table
                when 'trades' then 1
                when 'categories' then 2
                when 'trade_pricing_defaults' then 2
                when 'trade_prompts' then 2
                else 3
              end, id
  loop
    -- ── trades ──────────────────────────────────────────────────────
    if v_row.target_table = 'trades' then
      if v_row.row_class <> 'NEW' then
        raise exception 'a trades row must be NEW (got %)', v_row.row_class;
      end if;
      insert into trades (name, display_name, is_job_based, active)
      values (
        v_row.payload->>'name',
        coalesce(nullif(v_row.payload->>'display_name', ''),
                 initcap(v_row.payload->>'name')),
        coalesce((v_row.payload->>'is_job_based')::boolean, true),
        true)
      returning id into v_new_id;
      v_inserts := v_inserts ||
        jsonb_build_object('table', 'trades', 'id', v_new_id);
      v_committed := v_committed + 1;

    -- ── categories ──────────────────────────────────────────────────
    elsif v_row.target_table = 'categories' then
      if v_row.row_class <> 'NEW' then
        raise exception 'a categories row must be NEW (got %)', v_row.row_class;
      end if;
      v_new_id := null;
      insert into categories (trade_id, name, grounding_tag)
      select t.id,
             v_row.payload->>'name',
             coalesce(nullif(v_row.payload->>'grounding_tag', ''),
                      v_row.payload->>'name')
        from trades t
       where t.name = v_row.payload->>'trade'
      returning id into v_new_id;
      if v_new_id is null then
        raise exception 'categories row names unknown trade "%"',
          v_row.payload->>'trade';
      end if;
      v_inserts := v_inserts ||
        jsonb_build_object('table', 'categories', 'id', v_new_id);
      v_committed := v_committed + 1;

    -- ── trade_pricing_defaults (spec §7.5) ──────────────────────────
    elsif v_row.target_table = 'trade_pricing_defaults' then
      if v_row.row_class <> 'NEW' then
        raise exception 'a trade_pricing_defaults row must be NEW (got %)',
          v_row.row_class;
      end if;
      v_new_id := null;
      insert into trade_pricing_defaults (
        trade_id, hourly_rate, call_out_minimum, apprentice_rate, senior_rate,
        default_markup_pct, risk_buffer_pct, min_labour_hours, gst_registered,
        licence_label)
      select t.id,
             (v_row.payload->>'hourly_rate')::numeric,
             (v_row.payload->>'call_out_minimum')::numeric,
             (v_row.payload->>'apprentice_rate')::numeric,
             nullif(v_row.payload->>'senior_rate', '')::numeric,
             (v_row.payload->>'default_markup_pct')::numeric,
             (v_row.payload->>'risk_buffer_pct')::numeric,
             (v_row.payload->>'min_labour_hours')::numeric,
             coalesce((v_row.payload->>'gst_registered')::boolean, true),
             nullif(v_row.payload->>'licence_label', '')
        from trades t
       where t.name = v_row.payload->>'trade'
      returning trade_id into v_new_id;
      if v_new_id is null then
        raise exception 'trade_pricing_defaults row names unknown trade "%"',
          v_row.payload->>'trade';
      end if;
      v_inserts := v_inserts ||
        jsonb_build_object('table', 'trade_pricing_defaults', 'id', v_new_id);
      v_committed := v_committed + 1;

    -- ── trade_prompts (spec §6 prompt pack) ─────────────────────────
    elsif v_row.target_table = 'trade_prompts' then
      if v_row.row_class <> 'NEW' then
        raise exception 'a trade_prompts row must be NEW (got %)',
          v_row.row_class;
      end if;
      v_new_id := null;
      insert into trade_prompts (
        trade_id, estimator_system_prompt, sms_scope_blurb, sms_trade_rules,
        voice_greeting, voice_system_prompt)
      select t.id,
             nullif(v_row.payload->>'estimator_system_prompt', ''),
             nullif(v_row.payload->>'sms_scope_blurb', ''),
             nullif(v_row.payload->>'sms_trade_rules', ''),
             nullif(v_row.payload->>'voice_greeting', ''),
             nullif(v_row.payload->>'voice_system_prompt', '')
        from trades t
       where t.name = v_row.payload->>'trade'
      returning trade_id into v_new_id;
      if v_new_id is null then
        raise exception 'trade_prompts row names unknown trade "%"',
          v_row.payload->>'trade';
      end if;
      v_inserts := v_inserts ||
        jsonb_build_object('table', 'trade_prompts', 'id', v_new_id);
      v_committed := v_committed + 1;

    -- ── shared_assemblies (unchanged from migration 052/053) ────────
    elsif v_row.target_table = 'shared_assemblies' then
      if v_row.row_class = 'NEW' then
        insert into shared_assemblies
          (trade, name, description, default_unit, default_unit_price_ex_gst,
           default_labour_hours, default_exclusions, category,
           clarifying_questions, default_enabled)
        values
          (v_row.payload->>'trade',
           v_row.payload->>'name',
           v_row.payload->>'description',
           v_row.payload->>'default_unit',
           (v_row.payload->>'default_unit_price_ex_gst')::numeric,
           (v_row.payload->>'default_labour_hours')::numeric,
           v_row.payload->>'default_exclusions',
           v_row.payload->>'category',
           coalesce(v_row.payload->'clarifying_questions', '[]'::jsonb),
           (v_row.payload->>'default_enabled')::boolean)
        returning id into v_new_id;
        v_inserts := v_inserts ||
          jsonb_build_object('table', 'shared_assemblies', 'id', v_new_id);
      else
        select to_jsonb(sa.*) into v_before from shared_assemblies sa
          where sa.trade = v_row.payload->>'trade'
            and sa.name  = v_row.payload->>'name';
        if v_before is null then
          raise exception 'UPDATE target shared_assemblies (%, %) no longer exists',
            v_row.payload->>'trade', v_row.payload->>'name';
        end if;
        update shared_assemblies set
          description               = v_row.payload->>'description',
          default_unit              = v_row.payload->>'default_unit',
          default_unit_price_ex_gst = (v_row.payload->>'default_unit_price_ex_gst')::numeric,
          default_labour_hours      = (v_row.payload->>'default_labour_hours')::numeric,
          default_exclusions        = v_row.payload->>'default_exclusions',
          category                  = v_row.payload->>'category',
          clarifying_questions      = coalesce(v_row.payload->'clarifying_questions', '[]'::jsonb),
          default_enabled           = (v_row.payload->>'default_enabled')::boolean
         where trade = v_row.payload->>'trade'
           and name  = v_row.payload->>'name';
        v_updates := v_updates || jsonb_build_object(
          'table', 'shared_assemblies', 'id', v_before->>'id', 'before', v_before);
      end if;
      v_committed := v_committed + 1;

    -- ── shared_materials (unchanged from migration 052/053) ─────────
    elsif v_row.target_table = 'shared_materials' then
      if v_row.row_class = 'NEW' then
        insert into shared_materials
          (trade, name, brand, unit, default_unit_price_ex_gst)
        values
          (v_row.payload->>'trade',
           v_row.payload->>'name',
           v_row.payload->>'brand',
           v_row.payload->>'unit',
           (v_row.payload->>'default_unit_price_ex_gst')::numeric)
        returning id into v_new_id;
        v_inserts := v_inserts ||
          jsonb_build_object('table', 'shared_materials', 'id', v_new_id);
      else
        select to_jsonb(sm.*) into v_before from shared_materials sm
          where sm.trade = v_row.payload->>'trade'
            and sm.name  = v_row.payload->>'name';
        if v_before is null then
          raise exception 'UPDATE target shared_materials (%, %) no longer exists',
            v_row.payload->>'trade', v_row.payload->>'name';
        end if;
        update shared_materials set
          brand                     = v_row.payload->>'brand',
          unit                      = v_row.payload->>'unit',
          default_unit_price_ex_gst = (v_row.payload->>'default_unit_price_ex_gst')::numeric
         where trade = v_row.payload->>'trade'
           and name  = v_row.payload->>'name';
        v_updates := v_updates || jsonb_build_object(
          'table', 'shared_materials', 'id', v_before->>'id', 'before', v_before);
      end if;
      v_committed := v_committed + 1;

    else
      raise exception 'unknown target_table: %', v_row.target_table;
    end if;
  end loop;

  select count(*) into v_skipped from import_staged_rows
   where batch_id = p_batch_id
     and not (validation_status = 'passed'
              and smoke_status in ('passed', 'skipped'));

  update import_batches set
    status       = 'committed',
    committed_at = now(),
    changes      = jsonb_build_object('inserts', v_inserts, 'updates', v_updates)
   where id = p_batch_id;

  return jsonb_build_object(
    'ok', true, 'committed', v_committed, 'skipped', v_skipped);
end;
$$;

-- ── rollback_import_batch ───────────────────────────────────────────
create or replace function rollback_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_status   text;
  v_changes  jsonb;
  v_entry    jsonb;
  v_before   jsonb;
  v_used     int := 0;
  v_reverted int := 0;
  v_deleted  int := 0;
begin
  select status, changes into v_status, v_changes
    from import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'import batch % not found', p_batch_id;
  end if;
  if v_status = 'rolled_back' then
    return jsonb_build_object('ok', true, 'already_rolled_back', true);
  end if;
  if v_status <> 'committed' then
    raise exception 'batch % is %, only a committed batch can be rolled back',
      p_batch_id, v_status;
  end if;

  -- §9 rule 17 — rollback is blocked once a committed row has downstream
  -- usage. shared_assemblies: a tenant_service_offerings row. trades: a
  -- tenant that covers the trade. (Quotes embed numbers with no FK — spec
  -- §11 — so a drafted quote can't be detected here. trade_pricing_defaults
  -- and trade_prompts have no independent downstream usage — the trades
  -- guard protects the whole new-trade bundle.)
  for v_entry in
    select value from jsonb_array_elements(v_changes->'inserts')
    union all
    select value from jsonb_array_elements(v_changes->'updates')
  loop
    if v_entry->>'table' = 'shared_assemblies' then
      select count(*) into v_used from tenant_service_offerings
        where assembly_id = (v_entry->>'id')::uuid;
      if v_used > 0 then
        raise exception
          'rollback blocked: shared_assemblies row % is now offered by a tenant — retire the service instead',
          v_entry->>'id';
      end if;
    elsif v_entry->>'table' = 'trades' then
      select count(*) into v_used
        from tenants t
        join trades tr on tr.id = (v_entry->>'id')::uuid
       where t.trade = tr.name or tr.name = any(t.trades);
      if v_used > 0 then
        raise exception
          'rollback blocked: trade % is now used by a tenant — retire the trade instead',
          v_entry->>'id';
      end if;
    end if;
  end loop;

  -- Revert UPDATEs to their captured before-values. Only shared_assemblies
  -- and shared_materials have an UPDATE path (trades/categories/
  -- trade_pricing_defaults/trade_prompts are NEW-only).
  for v_entry in select value from jsonb_array_elements(v_changes->'updates')
  loop
    v_before := v_entry->'before';
    if v_entry->>'table' = 'shared_assemblies' then
      update shared_assemblies set
        description               = v_before->>'description',
        default_unit              = v_before->>'default_unit',
        default_unit_price_ex_gst = (v_before->>'default_unit_price_ex_gst')::numeric,
        default_labour_hours      = (v_before->>'default_labour_hours')::numeric,
        default_exclusions        = v_before->>'default_exclusions',
        category                  = v_before->>'category',
        clarifying_questions      = v_before->'clarifying_questions',
        default_enabled           = (v_before->>'default_enabled')::boolean
       where id = (v_entry->>'id')::uuid;
    elsif v_entry->>'table' = 'shared_materials' then
      update shared_materials set
        brand                     = v_before->>'brand',
        unit                      = v_before->>'unit',
        default_unit_price_ex_gst = (v_before->>'default_unit_price_ex_gst')::numeric
       where id = (v_entry->>'id')::uuid;
    end if;
    v_reverted := v_reverted + 1;
  end loop;

  -- Delete the INSERTed rows in REVERSE dependency order — services and
  -- materials first, then categories / trade_pricing_defaults / trade_prompts,
  -- then the trade itself, so every FK reference is gone before the trade row.
  for v_entry in
    select value
      from jsonb_array_elements(v_changes->'inserts')
     order by case value->>'table'
                when 'shared_assemblies'       then 1
                when 'shared_materials'        then 1
                when 'categories'              then 2
                when 'trade_pricing_defaults'  then 2
                when 'trade_prompts'           then 2
                when 'trades'                  then 3
                else 1
              end
  loop
    if v_entry->>'table' = 'shared_assemblies' then
      delete from shared_assemblies where id = (v_entry->>'id')::uuid;
    elsif v_entry->>'table' = 'shared_materials' then
      delete from shared_materials where id = (v_entry->>'id')::uuid;
    elsif v_entry->>'table' = 'categories' then
      delete from categories where id = (v_entry->>'id')::uuid;
    elsif v_entry->>'table' = 'trade_pricing_defaults' then
      delete from trade_pricing_defaults where trade_id = (v_entry->>'id')::uuid;
    elsif v_entry->>'table' = 'trade_prompts' then
      delete from trade_prompts where trade_id = (v_entry->>'id')::uuid;
    elsif v_entry->>'table' = 'trades' then
      delete from trades where id = (v_entry->>'id')::uuid;
    end if;
    v_deleted := v_deleted + 1;
  end loop;

  update import_batches set status = 'rolled_back' where id = p_batch_id;

  return jsonb_build_object(
    'ok', true, 'reverted', v_reverted, 'deleted', v_deleted);
end;
$$;

notify pgrst, 'reload schema';
