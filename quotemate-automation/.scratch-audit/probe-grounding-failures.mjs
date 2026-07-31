import pg from 'pg'

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()

// The 3 all-time grounding-failure lines whose unit is 'hr' — what are they,
// and did min_labour_floor fire on the same intake?
const r = await c.query(`
  select p.intake_id, p.created_at,
         fail->>'tier' as tier,
         fail->>'line_index' as line_index,
         fail->>'description' as description,
         fail->>'price' as price,
         fail->>'expected' as expected,
         exists (
           select 1 from pipeline_traces q
           where q.intake_id = p.intake_id and q.substep = 'min_labour_floor'
         ) as floor_fired
  from pipeline_traces p,
       lateral jsonb_array_elements(coalesce(p.outputs->'failures','[]'::jsonb)) fail
  where p.substep = 'validate_grounding' and p.status = 'err'
    and fail->>'unit' ilike 'hr'
  order by p.created_at
`)
console.log('== all-time grounding failures on an hr line:', r.rows.length)
for (const x of r.rows) {
  console.log('---', x.created_at.toISOString(), String(x.intake_id).slice(0, 8),
    'floor_fired=' + x.floor_fired)
  console.log('   ', x.tier + '#' + x.line_index, '$' + x.price, '|', x.description)
  console.log('    expected:', String(x.expected).slice(0, 200))
}

await c.end()
