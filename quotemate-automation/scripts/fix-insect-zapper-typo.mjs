// One-off: fix the "Instal insect zapper" typo on Peppers Plumbing's
// tenant_custom_assemblies row. Cosmetic, tenant-data only, no migration
// file needed (no schema change, single row UPDATE on a specific tenant).

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await c.connect();

  // pre: confirm exactly one row matches the typo
  const { rows: before } = await c.query(
    `select tca.id, tca.name, t.business_name
       from tenant_custom_assemblies tca
       join tenants t on t.id = tca.tenant_id
      where tca.name = 'Instal insect zapper'`,
  );
  if (before.length === 0) {
    console.log("  • no row matches 'Instal insect zapper' — already fixed?");
    process.exit(0);
  }
  if (before.length > 1) {
    console.error(`  ✗ ${before.length} rows match — refusing to fix in bulk without review`);
    process.exit(1);
  }
  console.log(`  ✓ found 1 row: [${before[0].business_name}] id=${before[0].id}`);

  const { rowCount } = await c.query(
    `update tenant_custom_assemblies
        set name = 'Install insect zapper'
      where name = 'Instal insect zapper'`,
  );
  console.log(`  ✓ updated ${rowCount} row(s)`);

  // post: confirm renamed
  const { rows: after } = await c.query(
    `select name from tenant_custom_assemblies where id = $1`,
    [before[0].id],
  );
  console.log(`  ✓ now: "${after[0].name}"`);
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
