// READ-ONLY — what's in tenants.available_slots right now?
// Mig 062/063 moved slots off the dropped `tradies` table onto `tenants`.
// Usage: node --env-file=.env.local scripts/check-tenant-slots.mjs
import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows } = await c.query(
  `select id, business_name, status, trade, available_slots
     from tenants order by business_name`,
);
const now = Date.now();
for (const r of rows) {
  let slots = [];
  try {
    slots = Array.isArray(r.available_slots)
      ? r.available_slots
      : JSON.parse(r.available_slots ?? "[]");
  } catch {
    slots = [];
  }
  const future = slots.filter((s) => {
    const t = Date.parse(s);
    return Number.isFinite(t) && t > now;
  });
  console.log(
    `${r.business_name} [${r.status}/${r.trade}] (id=${r.id}): ` +
      `${slots.length} slot(s), ${future.length} in the FUTURE`,
  );
  if (slots.length) console.log("   sample:", slots.slice(0, 4));
}
if (rows.length === 0) console.log("(no tenants rows at all)");
await c.end();
