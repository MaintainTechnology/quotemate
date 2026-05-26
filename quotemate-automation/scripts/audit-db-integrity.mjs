// READ-ONLY integrity + garbage hunt.
//
// Three checks:
//  1. FK referential integrity — for every FK in public.*, find rows
//     pointing at a parent id that no longer exists.
//  2. Orphan detail — full row dump of every tenant_id IS NULL row on
//     pipeline tables.
//  3. Test/garbage detection — Twilio test numbers, dev numbers,
//     suspicious customer names, stuck-draft quotes, etc.
//
// Run: node --env-file=.env.local scripts/audit-db-integrity.mjs

import pg from "pg";
const { Client } = pg;

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("\n══════════════════════════════════════════════════════════");
console.log("  FK referential integrity check");
console.log("══════════════════════════════════════════════════════════\n");

// Enumerate every FK in public schema.
const { rows: fks } = await c.query(`
  select
    tc.table_name           as child_table,
    kcu.column_name         as child_column,
    ccu.table_name          as parent_table,
    ccu.column_name         as parent_column,
    rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
  join information_schema.constraint_column_usage ccu
    on tc.constraint_name = ccu.constraint_name
  join information_schema.referential_constraints rc
    on tc.constraint_name = rc.constraint_name
  where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
  order by tc.table_name, kcu.column_name
`);

let badFkCount = 0;
const fkResults = [];
for (const fk of fks) {
  const q = `
    select count(*)::int as n
    from "${fk.child_table}" child
    left join "${fk.parent_table}" parent
      on parent."${fk.parent_column}" = child."${fk.child_column}"
    where child."${fk.child_column}" is not null
      and parent."${fk.parent_column}" is null`;
  const { rows } = await c.query(q);
  const n = rows[0].n;
  if (n > 0) badFkCount++;
  fkResults.push({
    child: `${fk.child_table}.${fk.child_column}`,
    parent: `${fk.parent_table}.${fk.parent_column}`,
    rule: fk.delete_rule,
    dangling: n,
  });
}
const broken = fkResults.filter((r) => r.dangling > 0);
if (broken.length === 0) {
  console.log(`OK All ${fkResults.length} FKs intact (no dangling references).\n`);
} else {
  console.log(`FAIL ${broken.length}/${fkResults.length} FK(s) have dangling rows:\n`);
  console.table(broken);
}

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Orphan row detail (tenant_id IS NULL)");
console.log("══════════════════════════════════════════════════════════\n");

const PIPELINE_TABLES = [
  "intakes", "quotes", "calls", "customers", "sms_conversations", "sms_messages",
];
for (const t of PIPELINE_TABLES) {
  const colCheck = await c.query(
    `select column_name from information_schema.columns
       where table_name = $1 and column_name = 'tenant_id'`,
    [t],
  );
  if (colCheck.rowCount === 0) {
    console.log(`  ${t}: no tenant_id column`);
    continue;
  }
  const { rows: orph } = await c.query(`select count(*)::int n from "${t}" where tenant_id is null`);
  console.log(`  ${t}: ${orph[0].n} orphans`);
  if (orph[0].n > 0) {
    // Sample up to 5 rows with key columns to help classify.
    const sampleCols = (
      t === "sms_conversations"
        ? "id, conversation_type, from_number, to_number, status, intake_id, last_message_at, created_at"
        : t === "sms_messages"
          ? "id, conversation_id, direction, from_number, to_number, created_at"
          : t === "intakes"
            ? "id, job_type, address, trade, created_at"
            : t === "quotes"
              ? "id, intake_id, status, created_at"
              : t === "calls"
                ? "id, vapi_call_id, caller_number, created_at"
                : "id, name, phone, created_at"
    );
    const { rows: samples } = await c.query(
      `select ${sampleCols} from "${t}" where tenant_id is null order by created_at desc nulls last limit 5`,
    );
    console.log(`    Sample rows:`);
    for (const r of samples) console.log(`    `, JSON.stringify(r));
  }
}

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Cross-table parent integrity (rows pointing at deleted parents)");
console.log("══════════════════════════════════════════════════════════\n");

// quotes -> intakes: deeper check than the FK above, since FK uses SET NULL on tenant_id but cascades on intake_id.
const quotesBadIntake = await c.query(`
  select count(*)::int as n
  from quotes q
  where q.intake_id is not null
    and not exists (select 1 from intakes i where i.id = q.intake_id)
`);
console.log(`  quotes with non-existent intake_id: ${quotesBadIntake.rows[0].n}`);

// sms_messages -> sms_conversations
const smsBadConv = await c.query(`
  select count(*)::int as n
  from sms_messages m
  where m.conversation_id is not null
    and not exists (select 1 from sms_conversations c where c.id = m.conversation_id)
`);
console.log(`  sms_messages with non-existent conversation_id: ${smsBadConv.rows[0].n}`);

// intakes -> calls (nullable for SMS-only intakes)
const intakesBadCall = await c.query(`
  select count(*)::int as n
  from intakes i
  where i.call_id is not null
    and not exists (select 1 from calls c where c.id = i.call_id)
`);
console.log(`  intakes with non-existent call_id: ${intakesBadCall.rows[0].n}`);

console.log("\n══════════════════════════════════════════════════════════");
console.log("  Test/garbage detection");
console.log("══════════════════════════════════════════════════════════\n");

// Twilio Magic Numbers (https://www.twilio.com/docs/iam/test-credentials)
const testNumPatterns = ["+15005550%", "+15555550%", "+15005551%"];
for (const pat of testNumPatterns) {
  const r = await c.query(
    `select count(*)::int as n from sms_conversations where from_number like $1 or to_number like $1`,
    [pat],
  );
  if (r.rows[0].n > 0) console.log(`  sms_conversations with phone like ${pat}: ${r.rows[0].n}`);
}

// Dev number sweep (the documented +61481613464 dev SMS number).
const devNum = await c.query(
  `select count(*)::int as n from sms_conversations where to_number = '+61481613464' or from_number = '+61481613464'`,
);
console.log(`  sms_conversations on dev number +61481613464: ${devNum.rows[0].n}`);

// Customers with obvious test names.
const testNames = await c.query(`
  select id, full_name, first_name, phone_number, email, created_at from customers
  where lower(coalesce(full_name,'')) similar to '%(test|sample|asdf|qwer|fake|dummy)%'
     or lower(coalesce(first_name,'')) similar to '%(test|sample|asdf|qwer|fake|dummy)%'
     or lower(coalesce(email,'')) similar to '%(test|example|fake)%'
  order by created_at desc
`);
console.log(`  customers with test-looking names/emails: ${testNames.rowCount}`);
if (testNames.rowCount > 0) {
  for (const r of testNames.rows) console.log(`    `, JSON.stringify(r));
}

// Quotes stuck in 'draft' for >7 days with no customer activity.
const staleDrafts = await c.query(`
  select count(*)::int as n
  from quotes
  where status = 'draft'
    and created_at < now() - interval '7 days'
`);
console.log(`  quotes stuck as 'draft' >7 days: ${staleDrafts.rows[0].n}`);

// Intakes with no quote attached (estimator never finished?).
const intakesNoQuote = await c.query(`
  select count(*)::int as n
  from intakes i
  where not exists (select 1 from quotes q where q.intake_id = i.id)
`);
console.log(`  intakes with no quote attached: ${intakesNoQuote.rows[0].n}`);

// tradie_signup_intents that never converted (resulting_tenant_id IS NULL after >7 days)
const staleSignups = await c.query(`
  select id, owner_mobile, created_at, resulting_tenant_id, used_at, expires_at
  from tradie_signup_intents
  where resulting_tenant_id is null
    and created_at < now() - interval '7 days'
`);
console.log(`  unconverted tradie_signup_intents >7 days old: ${staleSignups.rowCount}`);
if (staleSignups.rowCount > 0) {
  for (const r of staleSignups.rows) console.log(`    `, JSON.stringify(r));
}

// Service offerings pointing at deleted assemblies (shouldn't happen with CASCADE).
const danglingOfferings = await c.query(`
  select count(*)::int as n
  from tenant_service_offerings tso
  where not exists (select 1 from shared_assemblies sa where sa.id = tso.assembly_id)
`);
console.log(`  tenant_service_offerings pointing at deleted assemblies: ${danglingOfferings.rows[0].n}`);

// Material preferences pointing at categories that no shared_assembly uses.
const danglingPrefs = await c.query(`
  select tmp.tenant_id, tmp.category, tmp.preferred_brand
  from tenant_material_preferences tmp
  where not exists (
    select 1 from shared_assemblies sa where sa.category = tmp.category
  ) and not exists (
    select 1 from shared_materials sm where sm.category = tmp.category
  )
`);
console.log(`  material_preferences for unknown categories: ${danglingPrefs.rowCount}`);
if (danglingPrefs.rowCount > 0) console.table(danglingPrefs.rows);

await c.end();
console.log("\nOK Integrity audit complete.\n");
