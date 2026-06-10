// Find the most recent downlights quote and dump everything Gemini saw.
import pg from "pg";
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `select q.id, q.share_token, q.created_at, q.selected_tier,
          q.good, q.better, q.best,
          q.samples_prompt,
          i.scope, i.caller, i.job_type
     from quotes q
     join intakes i on i.id = q.intake_id
     where i.job_type = 'downlights'
     order by q.created_at desc
     limit 3`,
);

for (const r of rows) {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`Quote ${r.share_token}  created ${r.created_at.toISOString()}`);
  console.log(`Caller: ${JSON.stringify(r.caller)}`);
  console.log(`Selected tier: ${r.selected_tier}`);
  console.log(`Intake item_count: ${r.scope?.item_count}`);
  console.log(`Intake description: ${(r.scope?.description ?? '').slice(0, 200)}`);
  console.log(`\nLine items per tier:`);
  for (const tier of ['good', 'better', 'best']) {
    const t = r[tier];
    if (!t?.line_items) continue;
    console.log(`  [${tier}] label="${t.label}"`);
    for (const li of t.line_items) {
      console.log(`     qty=${li.quantity ?? '-'}  unit=${li.unit ?? '-'}  ${li.description}`);
    }
  }
  console.log(`\nSamples prompt stored: ${r.samples_prompt ? 'YES (' + r.samples_prompt.length + ' chars)' : 'NO'}`);
  if (r.samples_prompt) {
    // Just dump the COUNT line and ANCHOR PRODUCT block from the stored prompt
    const m = r.samples_prompt.match(/COUNT[^\n]*/);
    if (m) console.log(`COUNT line in prompt: ${m[0]}`);
    const a = r.samples_prompt.match(/ANCHOR PRODUCT[\s\S]+?═══[^\n]+/);
    if (a) console.log(`ANCHOR PRODUCT block:\n${a[0]}`);
    const checklist = r.samples_prompt.match(/\[ \] Count[^\n]+/);
    if (checklist) console.log(`Checklist count: ${checklist[0]}`);
  }
  console.log("");
}
await client.end();
