// Backfill tenant_id on orphan rows via FK propagation ONLY.
// Conservative: never invents attribution; only copies from a parent that
// already has tenant_id set.
//
// Propagation paths:
//   intakes.tenant_id ← sms_conversations.tenant_id (via sms_conversations.intake_id)
//   intakes.tenant_id ← calls.tenant_id (via intakes.call_id → calls.id)
//   quotes.tenant_id  ← intakes.tenant_id (via quotes.intake_id)
//
// What is NOT touched:
//   • calls.tenant_id NULL — most are historical (pre vapi_assistant_id
//     stamping on tenants). Would need Vapi API access to attribute.
//   • sms_conversations.tenant_id NULL — mostly the dev shared SMS number
//     +61481613464 traffic OR tradie_registration (NULL by design until
//     activation). Can't safely attribute either.
//   • customers.tenant_id NULL — 4 rows; will be healed in-place by the
//     2026-05-20 findOrCreateCustomer fix next time each customer texts/calls.
//
// Output is a before/after diff + the count of rows that remain unresolvable.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const APPLY = process.argv.includes("--apply");

async function counts() {
  const { rows } = await c.query(`
    select 'calls' t, count(*) filter (where tenant_id is null)::int n, count(*)::int total from calls union all
    select 'customers', count(*) filter (where tenant_id is null)::int, count(*)::int from customers union all
    select 'sms_conversations', count(*) filter (where tenant_id is null)::int, count(*)::int from sms_conversations union all
    select 'intakes', count(*) filter (where tenant_id is null)::int, count(*)::int from intakes union all
    select 'quotes', count(*) filter (where tenant_id is null)::int, count(*)::int from quotes`);
  return rows;
}

try {
  await c.connect();

  console.log("─── BEFORE ──────────────────────────────────────────────");
  const before = await counts();
  for (const r of before)
    console.log(`  ${r.t.padEnd(22)} NULL ${String(r.n).padStart(4)} / ${r.total}`);

  if (!APPLY) {
    // Dry-run: COUNT what WOULD be updated, no UPDATEs run.
    const { rows: intakeFromSms } = await c.query(`
      select count(*)::int n from intakes i
        join sms_conversations sc on sc.intake_id = i.id
       where i.tenant_id is null and sc.tenant_id is not null`);
    const { rows: intakeFromCall } = await c.query(`
      select count(*)::int n from intakes i
        join calls ca on ca.id = i.call_id
       where i.tenant_id is null and ca.tenant_id is not null`);
    const { rows: quoteFromIntake } = await c.query(`
      select count(*)::int n from quotes q
        join intakes i on i.id = q.intake_id
       where q.tenant_id is null and i.tenant_id is not null`);

    console.log("\n─── DRY RUN (no --apply) — would resolve: ──────────────");
    console.log(`  intakes  ← sms_conversations:  ${intakeFromSms[0].n}`);
    console.log(`  intakes  ← calls:              ${intakeFromCall[0].n}`);
    console.log(`  quotes   ← intakes:            ${quoteFromIntake[0].n}`);
    console.log("\n  Re-run with --apply to write the UPDATEs.");
    process.exit(0);
  }

  console.log("\n→ Applying FK-propagation backfill (transactional)...");
  await c.query("begin");

  // 1. intakes ← sms_conversations (SMS path)
  const r1 = await c.query(`
    update intakes i
       set tenant_id = sc.tenant_id
      from sms_conversations sc
     where sc.intake_id = i.id
       and i.tenant_id is null
       and sc.tenant_id is not null`);
  console.log(`  ✓ intakes ← sms_conversations: ${r1.rowCount} rows`);

  // 2. intakes ← calls (voice path; runs second so SMS attribution wins on conflict)
  const r2 = await c.query(`
    update intakes i
       set tenant_id = ca.tenant_id
      from calls ca
     where ca.id = i.call_id
       and i.tenant_id is null
       and ca.tenant_id is not null`);
  console.log(`  ✓ intakes ← calls:             ${r2.rowCount} rows`);

  // 3. quotes ← intakes (always last; needs steps 1+2 first)
  const r3 = await c.query(`
    update quotes q
       set tenant_id = i.tenant_id
      from intakes i
     where i.id = q.intake_id
       and q.tenant_id is null
       and i.tenant_id is not null`);
  console.log(`  ✓ quotes  ← intakes:           ${r3.rowCount} rows`);

  await c.query("commit");

  console.log("\n─── AFTER ───────────────────────────────────────────────");
  const after = await counts();
  for (const r of after) {
    const b = before.find((x) => x.t === r.t);
    const delta = b.n - r.n;
    console.log(
      `  ${r.t.padEnd(22)} NULL ${String(r.n).padStart(4)} / ${r.total}  (was ${b.n}, -${delta})`,
    );
  }

  console.log("\n─── Remaining NULL — why ────────────────────────────────");
  console.log(`  calls:           all historical — pre vapi_assistant_id on tenants`);
  console.log(`  customers:       findOrCreateCustomer fix (2026-05-20) heals on next contact`);
  console.log(`  sms_convs:       legacy dev-shared-number traffic + tradie_registration (NULL by design)`);
  console.log(`  intakes/quotes:  parent call/sms is itself orphan — no source to propagate from`);
  console.log("\nOK — backfill complete.");
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
