// READ-ONLY — grab one recent quote share_token per active tenant so we
// can smoke-test /q/[token]/book on prod after the rolling-slots fix.
// Usage: node --env-file=.env.local scripts/get-booking-tokens.mjs
import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows } = await c.query(`
  select distinct on (t.id)
    t.business_name, q.share_token, q.paid_at, q.scheduled_at
  from tenants t
  join quotes q on q.tenant_id = t.id
  where q.share_token is not null
    and q.paid_at is null
    and q.scheduled_at is null
  order by t.id, q.created_at desc
`);
for (const r of rows) {
  console.log(
    `${r.business_name}: https://quote-mate-rho.vercel.app/q/${r.share_token}/book`,
  );
}
if (rows.length === 0) console.log("(no unpaid/unscheduled quotes found)");
await c.end();
