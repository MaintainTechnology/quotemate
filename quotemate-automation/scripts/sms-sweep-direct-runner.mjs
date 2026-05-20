// Direct-webhook sweep — POSTs to /api/sms/inbound with a valid
// x-twilio-signature header so the receiver accepts the synthetic
// Twilio payload. Bypasses Twilio entirely, so no carrier filter,
// no cost, same agent code path.
//
// Only runs services not already tested in scripts/sms-sweep-results.json
// (i.e. the 27 that hit the AU long-code cliff).
//
// Usage:
//   node --env-file=.env.local scripts/sms-sweep-direct-runner.mjs --apply [--delay-ms 4000]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
const { Client } = pg;

const APPLY = process.argv.includes("--apply");
const DELAY_MS = (() => {
  const i = process.argv.indexOf("--delay-ms");
  return i > -1 ? Number(process.argv[i + 1]) : 4000;
})();
const TARGET_URL = process.env.SMS_INBOUND_URL || "https://quote-mate-rho.vercel.app/api/sms/inbound";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error("Missing TWILIO_AUTH_TOKEN in .env.local");
  process.exit(1);
}

const TEST_FROM = "+61489083371";
const AGENT_TO = "+61481613464";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function signTwilio(url, params) {
  // Algo per Twilio docs: HMAC-SHA1(authToken, url + sorted_key_concat_value)
  const sorted = Object.keys(params).sort();
  const concat = url + sorted.map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", AUTH_TOKEN).update(concat).digest("base64");
}

async function postInbound(body) {
  const params = {
    From: TEST_FROM,
    To: AGENT_TO,
    Body: body,
    MessageSid: `SMtest${crypto.randomBytes(16).toString("hex")}`,
    NumMedia: "0",
  };
  const sig = signTwilio(TARGET_URL, params);
  const formBody = new URLSearchParams(params).toString();
  const res = await fetch(TARGET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-twilio-signature": sig,
      "user-agent": "TwilioProxy/1.1",
    },
    body: formBody,
  });
  return { status: res.status, text: await res.text() };
}

const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function closeOpenConversations() {
  await c.query(
    `update sms_conversations set status='closed', updated_at=now()
       where from_number=$1 and to_number=$2 and status<>'closed'`,
    [TEST_FROM, AGENT_TO],
  );
}

try {
  await c.connect();
  const manifest = JSON.parse(readFileSync("scripts/sms-sweep-manifest.json", "utf8"));
  const prior = existsSync("scripts/sms-sweep-results.json")
    ? JSON.parse(readFileSync("scripts/sms-sweep-results.json", "utf8"))
    : [];

  // Figure out which test_ids actually got through last time
  const { rows: gotThrough } = await c.query(`
    select distinct (regexp_match(m.body, '\\[T(\\d{3})\\]'))[1] as test_id
      from sms_messages m
      join sms_conversations sc on sc.id = m.conversation_id
     where sc.from_number = $1 and sc.to_number = $2 and m.direction = 'inbound'
       and m.body ~ '\\[T\\d{3}\\]'`,
    [TEST_FROM, AGENT_TO]);
  const done = new Set(gotThrough.map((r) => `T${r.test_id}`));
  const todo = manifest.filter((m) => !done.has(m.test_id));

  console.log(`Manifest: ${manifest.length}, already through: ${done.size}, still to test: ${todo.size ?? todo.length}`);
  console.log(`Direct webhook URL: ${TARGET_URL}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — would post ${todo.length} prompts with ${DELAY_MS}ms gap.`);
    for (const t of todo) console.log(`  ${t.test_id} ${t.trade.padEnd(10)} ${t.service_name}`);
    process.exit(0);
  }

  await closeOpenConversations();

  const results = [];
  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    const sentAt = new Date().toISOString();
    let send;
    try {
      send = await postInbound(t.prompt);
    } catch (e) {
      send = { status: 0, error: e.message ?? String(e) };
    }
    results.push({ ...t, sentAt, send });
    console.log(
      `  [${i + 1}/${todo.length}] ${t.test_id} ${t.trade.padEnd(10)} ${t.service_name.padEnd(42)}  http=${send.status}`,
    );
    writeFileSync("scripts/sms-sweep-direct-results.json", JSON.stringify(results, null, 2));
    if (i < todo.length - 1) {
      await sleep(DELAY_MS);
      await closeOpenConversations();
    }
  }
  console.log(`\nDirect sweep complete. Wrote scripts/sms-sweep-direct-results.json`);
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
