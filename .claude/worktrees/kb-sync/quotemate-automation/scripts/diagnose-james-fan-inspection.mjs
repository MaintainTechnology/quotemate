// Find James's ceiling-fan inspection quote in Chandler and surface
// every signal that could have triggered the inspection route — intake
// scope text, dialog assumptions, quote routing decision, picked assembly.
//
// Run: node --env-file=.env.local scripts/diagnose-james-fan-inspection.mjs

import pg from "pg";
const { Client } = pg;

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("\n=== Most recent ceiling_fans intakes in Chandler ===");
const intakes = await c.query(`
  select i.id, i.job_type, i.trade, i.suburb, i.confidence, i.confidence_reason,
         i.scope, i.access, i.property, i.risks, i.timing, i.caller,
         i.tenant_id, t.business_name, i.created_at, i.inspection_required
  from intakes i
  left join tenants t on t.id = i.tenant_id
  where i.job_type = 'ceiling_fans'
    and (i.suburb ilike '%chandler%' or (i.caller->>'first_name') ilike '%james%')
  order by i.created_at desc
  limit 5
`);
for (const r of intakes.rows) {
  console.log(`\n  --- intake ${r.id} ---`);
  console.log(`    created:           ${r.created_at.toISOString()}`);
  console.log(`    tenant:            ${r.business_name}`);
  console.log(`    suburb:            ${r.suburb}`);
  console.log(`    confidence:        ${r.confidence}`);
  console.log(`    confidence_reason: ${r.confidence_reason}`);
  console.log(`    inspection_required (column): ${r.inspection_required}`);
  console.log(`    scope:`, JSON.stringify(r.scope, null, 2).split('\n').join('\n      '));
  console.log(`    access:`, JSON.stringify(r.access));
  console.log(`    property:`, JSON.stringify(r.property));
  console.log(`    risks:`, JSON.stringify(r.risks));
}

if (intakes.rowCount === 0) {
  console.log("No matching intake found. Searching by tenant+job_type recent:");
  const fallback = await c.query(`
    select i.id, i.suburb, i.caller->>'first_name' as name, i.created_at
    from intakes i
    where i.job_type = 'ceiling_fans'
    order by i.created_at desc limit 5
  `);
  console.table(fallback.rows);
}

if (intakes.rowCount > 0) {
  const intakeId = intakes.rows[0].id;
  console.log(`\n=== Quote(s) for that intake ===`);
  const quotes = await c.query(
    `select id, status, scope_of_works, assumptions, risk_flags,
            good, better, best,
            (good->'line_items') as good_lines
     from quotes where intake_id = $1`,
    [intakeId],
  );
  for (const q of quotes.rows) {
    console.log(`\n  quote ${q.id} — status=${q.status}`);
    console.log(`    scope_of_works: ${q.scope_of_works}`);
    console.log(`    assumptions:`, JSON.stringify(q.assumptions, null, 2).split('\n').join('\n      '));
    console.log(`    risk_flags:`, JSON.stringify(q.risk_flags, null, 2).split('\n').join('\n      '));
    console.log(`    good tier:`);
    if (q.good) {
      for (const [k, v] of Object.entries(q.good)) {
        if (k === 'line_items') {
          console.log(`      line_items (${(v ?? []).length}):`);
          for (const li of (v ?? [])) {
            console.log(`        • ${li.description} | source: ${li.source} | $${li.unit_price_ex_gst}`);
          }
        } else {
          console.log(`      ${k}: ${JSON.stringify(v).slice(0, 200)}`);
        }
      }
    } else {
      console.log(`      (null — inspection-only quote)`);
    }
  }

  console.log(`\n=== SMS conversation for that intake ===`);
  const sms = await c.query(
    `select id, status, conversation_state, turn_count, created_at, intake_id
     from sms_conversations
     where intake_id = $1`,
    [intakeId],
  );
  for (const s of sms.rows) {
    console.log(`  conv ${s.id} — status=${s.status}, turns=${s.turn_count}`);
    console.log(`    conversation_state.slots:`, JSON.stringify(s.conversation_state?.slots ?? null, null, 2).split('\n').join('\n      '));
    console.log(`    conversation_state.assumptions:`, JSON.stringify(s.conversation_state?.assumptions ?? null));
  }

  if (sms.rowCount > 0) {
    console.log(`\n=== SMS messages (last 8 turns) ===`);
    const msgs = await c.query(
      `select direction, body, created_at
       from sms_messages
       where conversation_id = $1
       order by created_at desc limit 16`,
      [sms.rows[0].id],
    );
    for (const m of msgs.rows.reverse()) {
      console.log(`  [${m.direction.toUpperCase()}] ${m.body?.slice(0, 200)}`);
    }
  }
}

await c.end();
