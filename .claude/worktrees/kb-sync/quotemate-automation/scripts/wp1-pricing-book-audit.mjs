// ════════════════════════════════════════════════════════════════════
// WP1 — pricing_book / tenant audit.
//
//   node --env-file=.env.local scripts/wp1-pricing-book-audit.mjs
//
// Shows the damage BEFORE anything is changed (and is safe to re-run any
// time as a health check). Reports:
//   1. pricing_book rows with NULL tenant_id (orphans).
//   2. pricing_book rows whose tenant_id is not in tenants (dangling).
//   3. Duplicate (tenant_id, trade) rows (should be impossible post-024).
//   4. Active tenants missing a pricing_book row for a trade they run.
//   5. The code sites that could use the wrong book (static checklist).
//
// Exit code: 0 = clean, 1 = at least one problem found. So it doubles as
// a pre-migration gate and a CI/health check.
// ════════════════════════════════════════════════════════════════════

import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

const q = (sql, params) => client.query(sql, params).then((r) => r.rows);
let problems = 0;

try {
  await client.connect();
  console.log("\n══════════ WP1 · pricing_book / tenant audit ══════════\n");

  // ── 1. Orphan rows: tenant_id IS NULL ──────────────────────────────
  const orphans = await q(
    `select id, trade, hourly_rate, default_markup_pct
       from pricing_book where tenant_id is null order by trade, id`,
  );
  console.log(`1. pricing_book rows with NULL tenant_id: ${orphans.length}`);
  if (orphans.length) {
    problems += orphans.length;
    for (const r of orphans) {
      console.log(
        `   ✗ id=${r.id} trade=${r.trade} hourly=${r.hourly_rate} markup=${r.default_markup_pct}%`,
      );
    }
    console.log(
      "   → Attach each to the right tradie, or delete dead rows, BEFORE migration 025.",
    );
  } else {
    console.log("   ✓ none — every pricing_book row is owned by a tenant.");
  }

  // ── 2. Dangling tenant_id (points at a tenant that doesn't exist) ───
  const dangling = await q(
    `select pb.id, pb.tenant_id, pb.trade
       from pricing_book pb
       left join tenants t on t.id = pb.tenant_id
      where pb.tenant_id is not null and t.id is null
      order by pb.trade, pb.id`,
  );
  console.log(`\n2. pricing_book rows with a dangling tenant_id: ${dangling.length}`);
  if (dangling.length) {
    problems += dangling.length;
    for (const r of dangling)
      console.log(`   ✗ id=${r.id} tenant_id=${r.tenant_id} trade=${r.trade} (tenant missing)`);
  } else {
    console.log("   ✓ none — every tenant_id resolves to a real tenant.");
  }

  // ── 3. Duplicate (tenant_id, trade) ────────────────────────────────
  const dupes = await q(
    `select tenant_id, trade, count(*)::int as n
       from pricing_book
      where tenant_id is not null
      group by tenant_id, trade having count(*) > 1
      order by n desc`,
  );
  console.log(`\n3. Duplicate (tenant_id, trade) groups: ${dupes.length}`);
  if (dupes.length) {
    problems += dupes.length;
    for (const r of dupes)
      console.log(`   ✗ tenant_id=${r.tenant_id} trade=${r.trade} has ${r.n} rows`);
    console.log("   → Migration 024's unique index should make this impossible; investigate.");
  } else {
    console.log("   ✓ none — at most one book per (tenant, trade).");
  }

  // ── 4. Active tenants missing a book for a trade they run ──────────
  const tenants = await q(
    `select id, business_name, status, trade, trades
       from tenants where status = 'active' order by created_at`,
  );
  const books = await q(
    `select tenant_id, trade from pricing_book where tenant_id is not null`,
  );
  const have = new Set(books.map((b) => `${b.tenant_id}::${b.trade}`));
  const missing = [];
  for (const t of tenants) {
    const trades = new Set(
      [t.trade, ...(Array.isArray(t.trades) ? t.trades : [])].filter(Boolean),
    );
    for (const tr of trades) {
      if (!have.has(`${t.id}::${tr}`)) {
        missing.push({ id: t.id, name: t.business_name, trade: tr });
      }
    }
  }
  console.log(
    `\n4. Active tenants missing a pricing_book for a trade they run: ${missing.length}` +
      `  (${tenants.length} active tenants checked)`,
  );
  if (missing.length) {
    problems += missing.length;
    for (const m of missing)
      console.log(`   ✗ tenant="${m.name}" (${m.id}) has no ${m.trade} book`);
    console.log(
      "   → These tenants' jobs now route to inspection (WP1 hard rule) until a book is added.",
    );
  } else {
    console.log("   ✓ every active tenant has a book for each trade they run.");
  }

  // ── 5. Code sites that read a pricing_book row ─────────────────────
  console.log("\n5. pricing_book read sites (static checklist):");
  console.log(
    "   ✓ app/api/estimate/draft/route.ts — tenant-scoped + resolvePricingBookForIntake;\n" +
      "     oldest-book fallback REMOVED (WP1). Misconfig → inspection, logged.",
  );
  console.log(
    "   ✓ app/q/[token]/page.tsx — licence/GST now scoped by quote.tenant_id (WP1).",
  );
  console.log(
    "   ✓ app/api/tenant/{me,trades}/route.ts, app/api/quote/[id]/edit/route.ts —\n" +
      "     already filtered by tenant_id (verified, no change needed).",
  );

  // ── Verdict ────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  if (problems === 0) {
    console.log("✓ CLEAN — no orphan/dangling/duplicate/missing pricing books.");
    console.log("  Safe to run: node --env-file=.env.local scripts/run-migration-025.mjs");
  } else {
    console.log(`✗ ${problems} problem(s) found — resolve before migration 025.`);
  }
  console.log("");
} catch (err) {
  console.error("Audit failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}

process.exit(problems === 0 ? 0 : 1);
