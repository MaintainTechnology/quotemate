// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Reset SMS state for a phone number.
//
// Usage:
//   node --env-file=.env.local scripts/reset-sms-state.mjs --phone +61489083371
//
// Drops the customer's conversation history (cascade nukes sms_messages)
// and the customers-table memory row so the next text is treated as a
// fresh first_time customer.
//
// Used for end-to-end testing of the SMS AI Agent so we can re-run
// scripts from a known-clean state.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const phone = getArg("--phone");
if (!phone) {
  console.error("Usage: --phone +61XXXXXXXXX");
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Resetting state for ${phone}...`);

const before = await client.query(
  `select
     (select count(*) from sms_conversations where from_number = $1) as conversations,
     (select count(*) from sms_messages where conversation_id in (select id from sms_conversations where from_number = $1)) as messages,
     (select count(*) from customers where phone_number = $1) as customers`,
  [phone],
);
console.log("BEFORE:", before.rows[0]);

const delConv = await client.query(
  `delete from sms_conversations where from_number = $1`,
  [phone],
);
console.log(`  deleted ${delConv.rowCount} conversation row(s) (sms_messages cascade)`);

const delCust = await client.query(
  `delete from customers where phone_number = $1`,
  [phone],
);
console.log(`  deleted ${delCust.rowCount} customer row(s)`);

const after = await client.query(
  `select
     (select count(*) from sms_conversations where from_number = $1) as conversations,
     (select count(*) from sms_messages where conversation_id in (select id from sms_conversations where from_number = $1)) as messages,
     (select count(*) from customers where phone_number = $1) as customers`,
  [phone],
);
console.log("AFTER:", after.rows[0]);

await client.end();
console.log("Done.");
