// Find recent quotes by phone number or name.
import pg from "pg";
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const i = process.argv.indexOf("--phone");
const phone = i >= 0 ? process.argv[i + 1] : "+61489083371";

const { rows } = await client.query(
  `select q.id, q.share_token, q.created_at, q.status, q.needs_inspection,
          q.samples_status, (q.samples_prompt is not null) as has_samples_prompt,
          i.caller, i.job_type, i.trade, i.scope
     from quotes q
     join intakes i on i.id = q.intake_id
     join sms_conversations c on c.intake_id = i.id
     where c.from_number = $1
     order by q.created_at desc limit 5`,
  [phone],
);

for (const r of rows) {
  console.log(`\n${r.created_at.toISOString()}  ${r.share_token}`);
  console.log(`  caller: ${JSON.stringify(r.caller)}`);
  console.log(`  trade: ${r.trade}  job_type: ${r.job_type}`);
  console.log(`  scope desc: ${(r.scope?.description ?? '').slice(0, 100)}...`);
  console.log(`  status: ${r.status}  needs_inspection: ${r.needs_inspection}  samples: ${r.samples_status}  prompt_stored: ${r.has_samples_prompt}`);
}
await client.end();
