// R1 — deterministic-coverage probe (READ-ONLY, no DB writes).
// Run: node --env-file=.env.local scripts/measure-deterministic-coverage.mjs
//
// Answers the question that sets the initial AUTO_SEND_JOBTYPES allowlist and
// the recipe-authoring backlog: for each job_type by real intake volume, do we
// have a COMPLETE deterministic recipe — i.e. a shared_assembly_bom whose every
// material_category resolves to a priced shared_materials row for the trade?
//
// This is a DB-level coverage proxy (supply vs demand). The precise per-intake
// replay through the live deterministic engine is the eval harness (R15); this
// probe is the cheap, dependency-free decision input for the allowlist.
//
// Spec bar: a job-type needs >=90% deterministic coverage to join the initial
// allowlist (confirm against this output).

import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

// ── DEMAND: intake volume per job_type ───────────────────────────────────
const demand = await c.query(`
  select coalesce(job_type, '(null)') as job_type, trade, count(*)::int as intakes
  from intakes
  group by job_type, trade
  order by count(*) desc
`)
const totalIntakes = demand.rows.reduce((s, r) => s + r.intakes, 0)

// ── SUPPLY: which shared_assemblies are "deterministic-complete" ──────────
// complete = has >=1 shared_assembly_bom line AND every required line's
// material_category is priced (a shared_materials row of the same trade with a
// non-null unit price exists for that category).
const supply = await c.query(`
  with bom as (
    select a.id, a.name, a.trade,
           count(b.*)::int as lines,
           count(*) filter (where b.required) ::int as required_lines,
           count(*) filter (
             where b.required and not exists (
               select 1 from shared_materials m
               where m.trade = a.trade
                 and lower(m.category) = lower(b.material_category)
                 and m.default_unit_price_ex_gst is not null
             )
           )::int as unpriced_required
    from shared_assemblies a
    join shared_assembly_bom b on b.assembly_id = a.id
    group by a.id, a.name, a.trade
  )
  select name, trade, lines, required_lines, unpriced_required,
         (unpriced_required = 0) as deterministic_complete
  from bom
  order by trade, name
`)

console.log(`\n=== DEMAND — intake volume per job_type (total ${totalIntakes}) ===`)
console.table(demand.rows.map(r => ({
  job_type: r.job_type, trade: r.trade, intakes: r.intakes,
  pct: totalIntakes ? `${Math.round(100 * r.intakes / totalIntakes)}%` : '—',
})))

console.log('\n=== SUPPLY — deterministic-complete shared_assemblies ===')
console.table(supply.rows.map(r => ({
  assembly: r.name, trade: r.trade, lines: r.lines,
  required: r.required_lines, unpriced_required: r.unpriced_required,
  complete: r.deterministic_complete ? 'YES' : 'no',
})))

const complete = supply.rows.filter(r => r.deterministic_complete)
const incomplete = supply.rows.filter(r => !r.deterministic_complete)
console.log(`\nSUMMARY: ${complete.length}/${supply.rows.length} shared_assemblies are deterministic-complete.`)
if (incomplete.length) {
  console.log('RECIPE/PRICING BACKLOG (assemblies missing priced recipe lines):')
  for (const r of incomplete) console.log(`  - [${r.trade}] ${r.name}: ${r.unpriced_required} required line(s) unpriced`)
}
console.log('\nNEXT: map the top-volume job_types above to their assembly; a job_type whose assembly is')
console.log('deterministic-complete is an AUTO_SEND_JOBTYPES candidate (confirm >=90% via the R15 eval).')

await c.end()
console.log('\n(done — read-only, no writes)')
