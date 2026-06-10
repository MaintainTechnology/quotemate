// One-off cleanup for stress testing.
// Wipes all sms_messages + sms_conversations + customers rows tied to
// a given phone number so the next inbound starts from a true
// first_time state. Used between test scenarios.
//
// Usage:
//   node --env-file=.env.local scripts/clear-test-customer.mjs --phone +61489083371

import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const phone = getArg("--phone");
if (!phone) {
  console.error("Usage: node scripts/clear-test-customer.mjs --phone +61XXXXXXXXX");
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const msgRes = await client.query(
  `DELETE FROM sms_messages WHERE conversation_id IN (
     SELECT id FROM sms_conversations WHERE from_number = $1
   ) RETURNING id`,
  [phone],
);
const convRes = await client.query(
  `DELETE FROM sms_conversations WHERE from_number = $1 RETURNING id`,
  [phone],
);
const custRes = await client.query(
  `DELETE FROM customers WHERE phone_number = $1 RETURNING id`,
  [phone],
);

console.log("");
console.log(`Cleared test state for ${phone}:`);
console.log(`  sms_messages       deleted: ${msgRes.rowCount}`);
console.log(`  sms_conversations  deleted: ${convRes.rowCount}`);
console.log(`  customers          deleted: ${custRes.rowCount}`);
console.log("");

await client.end();
