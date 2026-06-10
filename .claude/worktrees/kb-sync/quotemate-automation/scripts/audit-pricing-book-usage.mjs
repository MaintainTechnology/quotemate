// Audit each pricing_book row for reachability + actual historical use.
//
// Reachability test: a pricing_book row at (tenant_id, trade) is reachable
//   iff the tenant's `trades[]` includes that trade — because intakes can
//   only be created for trades the tenant operates in, and the estimator
//   resolves the book by (intake.tenant_id, intake.trade).
//
// Usage test: count intakes + quotes that point at this exact (tenant, trade)
//   combination via intake.tenant_id + intake.trade.
//
// Run: node --env-file=.env.local scripts/audit-pricing-book-usage.mjs

import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("\n=== Every pricing_book row + its tenant's trades[] ===");
const rows = await client.query(`
  select
    t.business_name,
    t.trade            as primary_trade,
    t.trades           as tenant_trades,
    pb.trade           as book_trade,
    pb.hourly_rate,
    pb.default_markup_pct,
    pb.licence_type,
    pb.licence_state,
    pb.overlays,
    pb.id              as book_id,
    pb.tenant_id,
    case
      when pb.trade = any(t.trades) then 'REACHABLE'
      else 'UNREACHABLE (book_trade not in tenant.trades[])'
    end as reachability
  from pricing_book pb
  join tenants t on t.id = pb.tenant_id
  order by t.business_name, pb.trade
`);
console.table(
  rows.rows.map((r) => ({
    tenant: r.business_name,
    primary_trade: r.primary_trade,
    tenant_trades: JSON.stringify(r.tenant_trades),
    book_trade: r.book_trade,
    rate: r.hourly_rate,
    markup: r.default_markup_pct,
    licence: r.licence_type ?? "(null)",
    state: r.licence_state ?? "(null)",
    early_bird: r.overlays?.early_bird ? "yes" : "no",
    reachability: r.reachability,
  })),
);

console.log("\n=== Historical usage — intakes/quotes per (tenant, trade) ===");
for (const r of rows.rows) {
  const intakeQ = await client.query(
    `select count(*)::int as n
     from intakes
     where tenant_id = $1 and trade = $2`,
    [r.tenant_id, r.book_trade],
  );
  const quoteQ = await client.query(
    `select count(*)::int as n
     from quotes q
     join intakes i on i.id = q.intake_id
     where i.tenant_id = $1 and i.trade = $2`,
    [r.tenant_id, r.book_trade],
  );
  const intakeAnyQ = await client.query(
    `select count(*)::int as n from intakes where tenant_id = $1`,
    [r.tenant_id],
  );
  const tradesUsed = await client.query(
    `select trade, count(*)::int as n from intakes
     where tenant_id = $1 group by trade order by trade`,
    [r.tenant_id],
  );
  console.log(
    `\n${r.business_name} / ${r.book_trade}-book`,
    `(reachability: ${r.reachability.startsWith("REACHABLE") ? "OK" : "DEAD"})`,
  );
  console.log(`  intakes for THIS (tenant, trade): ${intakeQ.rows[0].n}`);
  console.log(`  quotes for THIS (tenant, trade):  ${quoteQ.rows[0].n}`);
  console.log(`  intakes for tenant OVERALL:       ${intakeAnyQ.rows[0].n}`);
  if (tradesUsed.rowCount > 0) {
    console.log(`  per-trade intake split:`);
    for (const t of tradesUsed.rows) console.log(`    ${t.trade}: ${t.n}`);
  }
}

console.log("\n=== Tenants with mismatched trades[] vs pricing_book ===");
const mismatch = await client.query(`
  with book_trades as (
    select tenant_id, array_agg(trade order by trade) as trades_with_books
    from pricing_book group by tenant_id
  )
  select
    t.business_name,
    t.trades                    as tenant_trades,
    bt.trades_with_books        as book_trades,
    case
      when (select count(*) from unnest(bt.trades_with_books) x
            where x != all(t.trades)) > 0 then 'tenant has book(s) for trades NOT in trades[]'
      else 'aligned'
    end as status
  from tenants t
  join book_trades bt on bt.tenant_id = t.id
  order by t.business_name
`);
console.table(mismatch.rows);

await client.end();
