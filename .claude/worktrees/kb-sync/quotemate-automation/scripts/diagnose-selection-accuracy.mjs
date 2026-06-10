// READ-ONLY, AGGREGATE-ONLY diagnostic for the "is the core gap wrong-product
// selection, or over-conservative inspection bounce, or sparse data?" question.
// No PII — counts and distributions only.
// Run: node --env-file=.env.local scripts/diagnose-selection-accuracy.mjs

import pg from 'pg'
const { Client } = pg

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()

async function q(label, sql) {
  try {
    const r = await c.query(sql)
    console.log(`\n=== ${label} ===`)
    console.table(r.rows)
    return r.rows
  } catch (e) {
    console.log(`\n=== ${label} ===\n  (query failed: ${e.message})`)
    return null
  }
}

// ── 0. Live engine config (from .env.local) ─────────────────────────
console.log('\n=== LIVE ENGINE FLAGS (.env.local) ===')
console.table([
  { flag: 'DETERMINISTIC_BOM', value: process.env.DETERMINISTIC_BOM ?? '(unset → OFF)' },
  { flag: 'SPEC_GUARD_MODE', value: process.env.SPEC_GUARD_MODE ?? '(unset → shadow)' },
  { flag: 'WP9_PRODUCT_OPTIONS', value: process.env.WP9_PRODUCT_OPTIONS ?? '(unset → OFF)' },
  { flag: 'PRICE_HISTORY_HINT', value: process.env.PRICE_HISTORY_HINT ?? '(unset → OFF)' },
  { flag: 'RAG_DISABLED', value: process.env.RAG_DISABLED ?? '(unset → on)' },
  { flag: 'RAG_RERANK_DISABLED', value: process.env.RAG_RERANK_DISABLED ?? '(unset → on)' },
])

// ── 1. Quote outcome distribution (the headline) ────────────────────
await q('QUOTE OUTCOMES (all-time)', `
  select
    count(*)                                                              as total_quotes,
    count(*) filter (where needs_inspection)                             as inspection,
    count(*) filter (where not needs_inspection)                         as auto_quote,
    round(100.0 * count(*) filter (where needs_inspection) / nullif(count(*),0), 1) as inspection_pct,
    count(*) filter (where risk_flags::text ilike '%[grounding]%')       as grounding_stamped
  from quotes
`)

await q('INSPECTION CAUSE SPLIT — grounding-bounce vs other', `
  select
    count(*) filter (where needs_inspection and risk_flags::text ilike '%[grounding]%')     as grounding_driven_inspection,
    count(*) filter (where needs_inspection and risk_flags::text not ilike '%[grounding]%') as other_inspection,
    count(*) filter (where not needs_inspection and risk_flags::text ilike '%[grounding]%') as auto_quote_but_grounding_flag
  from quotes
`)

await q('ROUTING DECISION x needs_inspection', `
  select coalesce(routing_decision,'(null)') as routing_decision,
         needs_inspection, status, count(*)
  from quotes
  group by 1,2,3
  order by count(*) desc
`)

await q('QUOTE OUTCOMES — last 60 days (current behaviour)', `
  select
    count(*)                                                  as total,
    count(*) filter (where needs_inspection)                 as inspection,
    round(100.0 * count(*) filter (where needs_inspection) / nullif(count(*),0),1) as inspection_pct
  from quotes
  where created_at > now() - interval '60 days'
`)

// ── 2. Tiering — are we actually producing 3-tier choices? ──────────
await q('AUTO-QUOTE TIER SHAPE (how many tiers populated)', `
  select
    count(*) filter (where good is not null) as has_good,
    count(*) filter (where better is not null) as has_better,
    count(*) filter (where best is not null) as has_best,
    count(*) filter (where good is not null and better is not null and best is not null) as all_three,
    count(*) filter (where (good is not null)::int + (better is not null)::int + (best is not null)::int = 1) as single_tier
  from quotes
  where not needs_inspection
`)

// ── 3. Intake confidence / inspection signal ────────────────────────
await q('INTAKES by trade / confidence / inspection_required', `
  select trade, confidence, inspection_required, count(*)
  from intakes
  group by 1,2,3
  order by 1,2,3
`)

// ── 4. Per-tenant DATA READINESS (can deterministic paths even run?) ─
await q('PER-TENANT DATA READINESS', `
  select
    t.business_name,
    (select count(*) from tenant_material_catalogue m where m.tenant_id=t.id)                                                            as cat_rows,
    (select count(*) from tenant_material_catalogue m where m.tenant_id=t.id and m.active)                                               as cat_active,
    (select count(*) from tenant_material_catalogue m where m.tenant_id=t.id and m.properties is not null and m.properties::text not in ('{}','null','')) as cat_with_specs,
    (select count(*) from tenant_assembly_bom b where b.tenant_id=t.id)                                                                  as bom_recipes,
    (select count(*) from tenant_tier_ladder l where l.tenant_id=t.id)                                                                   as tier_ladder,
    (select count(*) from tenant_custom_assemblies a where a.tenant_id=t.id)                                                             as custom_asm,
    (select count(*) from tenant_service_offerings s where s.tenant_id=t.id and s.enabled)                                               as services_on
  from tenants t
  order by t.business_name
`)

// ── 5. Shared catalogue spec coverage (spec-guard's fuel) ───────────
await q('SHARED CATALOGUE — spec/property + category coverage', `
  select 'shared_materials' as tbl,
         count(*) as total,
         count(*) filter (where properties is not null and properties::text not in ('{}','null','')) as with_properties,
         count(*) filter (where category is not null and category <> '') as with_category
  from shared_materials
  union all
  select 'shared_assemblies',
         count(*),
         count(*) filter (where properties is not null and properties::text not in ('{}','null','')),
         count(*) filter (where category is not null and category <> '')
  from shared_assemblies
`)

// ── 6. Top job types and their inspection rate ──────────────────────
await q('INSPECTION RATE by job_type (top 12 by volume)', `
  select i.job_type,
         count(q.*) as quotes,
         count(q.*) filter (where q.needs_inspection) as inspection,
         round(100.0 * count(q.*) filter (where q.needs_inspection) / nullif(count(q.*),0),0) as insp_pct
  from quotes q
  join intakes i on i.id = q.intake_id
  group by i.job_type
  order by quotes desc
  limit 12
`)

await c.end()
console.log('\n[done] read-only diagnostic complete — no rows modified.')
