// Sweep runner: fires each prompt in scripts/sms-sweep-manifest.json
// at the n8n webhook, closes the conversation between each so the next
// test starts fresh, and writes a results JSON.
//
// Run with:
//   node --env-file=.env.local scripts/sms-sweep-runner.mjs --apply [--max N] [--delay-ms 20000]
//
// Without --apply this only prints what it would do.

import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const { Client } = pg;

const APPLY = process.argv.includes("--apply");
const MAX = (() => {
  const i = process.argv.indexOf("--max");
  return i > -1 ? Number(process.argv[i + 1]) : Infinity;
})();
const DELAY_MS = (() => {
  const i = process.argv.indexOf("--delay-ms");
  return i > -1 ? Number(process.argv[i + 1]) : 22000;
})();

const N8N_WEBHOOK = "https://n8n.nomanuai.com/webhook/sms-test-send";
const TEST_FROM = "+61489083371";
const AGENT_TO = "+61481613464";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function closeOpenConversations() {
  await c.query(
    `update sms_conversations set status='closed', updated_at=now()
       where from_number=$1 and to_number=$2 and status<>'closed'`,
    [TEST_FROM, AGENT_TO],
  );
}

async function fireOne(prompt, testId) {
  const r = await fetch(N8N_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt }),
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, body: parsed };
}

try {
  await c.connect();
  const manifest = JSON.parse(readFileSync("scripts/sms-sweep-manifest.json", "utf8"));
  const limited = manifest.slice(0, MAX);

  console.log(`Sweep plan: ${limited.length} prompts, ${DELAY_MS}ms between each.`);
  console.log(`Estimated time: ${Math.round((limited.length * DELAY_MS) / 60000)} min`);
  console.log(`Estimated Twilio cost: ~$${(limited.length * 0.18).toFixed(2)} AUD`);
  if (!APPLY) {
    console.log(`\nDRY RUN — re-run with --apply to actually send.`);
    process.exit(0);
  }

  // Close any open conversations first so the canary doesn't roll into test 1.
  await closeOpenConversations();
  console.log(`\n→ Sweeping...`);

  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < limited.length; i++) {
    const m = limited[i];
    const sentAt = new Date().toISOString();
    let send;
    try {
      send = await fireOne(m.prompt, m.test_id);
    } catch (e) {
      send = { ok: false, error: e.message ?? String(e) };
    }
    results.push({ ...m, sentAt, send });
    const elapsedM = Math.round((Date.now() - t0) / 1000 / 60 * 10) / 10;
    console.log(
      `  [${i + 1}/${limited.length}] ${m.test_id} ${m.trade.padEnd(10)} ${m.service_name.padEnd(42)}  status=${send?.status ?? "ERR"}  t=${elapsedM}m`,
    );
    // Persist incrementally so a crash mid-sweep still gives us partials.
    writeFileSync("scripts/sms-sweep-results.json", JSON.stringify(results, null, 2));

    // Hold for reply, then close the conversation so the next test starts fresh.
    if (i < limited.length - 1) {
      await sleep(DELAY_MS);
      await closeOpenConversations();
    }
  }

  console.log(`\nSweep complete. Wrote scripts/sms-sweep-results.json`);
  console.log(`Next: scripts/sms-sweep-evaluate.mjs to grade the replies.`);
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
