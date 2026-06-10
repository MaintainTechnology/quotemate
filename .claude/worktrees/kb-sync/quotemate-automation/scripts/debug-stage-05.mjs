// Direct invocation of Stage 05 to surface actual errors.
import pg from "pg";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Use tsx loader for TS imports
register("tsx/esm", pathToFileURL("./"));

const { Client } = pg;
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  select i.*, p.* as pricing
  from intakes i, pricing_book p
  where i.id = '603dbe34-72cb-43cb-973b-d8ada81c94e4'
`);
const intake = rows[0];

// Load pricing book separately
const { rows: pbRows } = await client.query(`select * from pricing_book limit 1`);
const pricingBook = pbRows[0];

console.log("\nIntake job_type:", intake.job_type, "scope:", intake.scope);
console.log("Pricing book:", { hourly_rate: pricingBook.hourly_rate, default_markup_pct: pricingBook.default_markup_pct });

const { runEstimation } = await import("../lib/estimate/run.ts");

console.log("\nCalling runEstimation... (this can take 30-90s)");
const t0 = Date.now();
try {
  const result = await runEstimation(intake, pricingBook);
  console.log(`\nElapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("\nResult keys:", Object.keys(result));
  console.log("\nResult JSON (first 2000 chars):");
  console.log(JSON.stringify(result, null, 2).slice(0, 2000));
} catch (err) {
  console.error(`\nElapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.error("\n✗ FAILED:");
  console.error(err.message);
  if (err.cause) console.error("Cause:", err.cause);
  console.error("\nStack:");
  console.error(err.stack?.split("\n").slice(0, 12).join("\n"));
}

await client.end();
