// ═══════════════════════════════════════════════════════════════════
// QuoteMate · customer-record dump (so we can see what the dialog sees)
//
// Usage:
//   node --env-file=.env.local scripts/dump-customer.mjs --phone +61XXXXXXXXX
//
// Prints the full customers row for a phone number, plus a list of
// every conversation tied to that customer with status + timestamp.
// Use this when an SMS conversation is misbehaving and you want to
// know whether the customer-memory hydration has any data to work with.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

// ─── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const phone = getArg("--phone");
if (!phone) {
  console.error("Usage: node scripts/dump-customer.mjs --phone +61XXXXXXXXX");
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// ─── Fetch the customers row ─────────────────────────────────────────
const { rows: custRows } = await client.query(
  `select id, phone_number, first_name, full_name, email, address, suburb,
          notes, preferred_channel, total_quotes, total_bookings,
          first_contacted_at, last_contacted_at, created_at, updated_at
     from customers
     where phone_number = $1`,
  [phone],
);

console.log("\n" + "═".repeat(72));
console.log(`CUSTOMER RECORD  for  ${phone}`);
console.log("═".repeat(72));

if (custRows.length === 0) {
  console.log("(no row in customers table — first-time caller)");
  console.log("\nThis is normal for a brand-new number. The Haiku dialog will");
  console.log("ask for first name + suburb on the first conversation, and the");
  console.log("post-intake updateCustomerFromIntake() will populate this row.");
  await client.end();
  process.exit(0);
}

const c = custRows[0];

// Show every field, marking nulls/empties so the failure mode is visible.
function fmt(v) {
  if (v === null || v === undefined) return "(null)";
  if (typeof v === "string" && v.trim() === "") return "(empty string)";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

console.log(`id:                  ${c.id}`);
console.log(`phone_number:        ${c.phone_number}`);
console.log(`first_name:          ${fmt(c.first_name)}`);
console.log(`full_name:           ${fmt(c.full_name)}`);
console.log(`email:               ${fmt(c.email)}`);
console.log(`address:             ${fmt(c.address)}`);
console.log(`suburb:              ${fmt(c.suburb)}`);
console.log(`notes:               ${fmt(c.notes)}`);
console.log(`preferred_channel:   ${fmt(c.preferred_channel)}`);
console.log(`total_quotes:        ${c.total_quotes}`);
console.log(`total_bookings:      ${c.total_bookings}`);
console.log(`first_contacted_at:  ${fmt(c.first_contacted_at)}`);
console.log(`last_contacted_at:   ${fmt(c.last_contacted_at)}`);
console.log(`updated_at:          ${fmt(c.updated_at)}`);

// ─── KNOWN CUSTOMER MEMORY block preview ─────────────────────────────
// Show what formatCustomerContext() would inject into the dialog prompt.
// If this preview is empty, Haiku will not see any customer-memory hints
// AND must therefore ask for name/suburb in the conversation.
console.log("\n" + "─".repeat(72));
console.log("WHAT THE DIALOG AGENT WILL SEE:");
console.log("─".repeat(72));
const known = [];
if (c.first_name) known.push(`first_name: ${c.first_name}`);
if (c.full_name && c.full_name !== c.first_name) known.push(`full_name: ${c.full_name}`);
if (c.suburb) known.push(`suburb: ${c.suburb}`);
if (c.address) known.push(`address: ${c.address}`);
if (c.email) known.push(`email: ${c.email}`);
if (c.total_quotes > 0) known.push(`total_quotes_with_us: ${c.total_quotes}`);

if (known.length === 0) {
  console.log("\n  (no KNOWN CUSTOMER MEMORY block injected — record is empty)");
  console.log("  Haiku must ask for name + suburb on each conversation.");
} else {
  console.log("\n  KNOWN CUSTOMER MEMORY block contains:");
  for (const k of known) console.log(`    - ${k}`);
}

// ─── Conversations linked to this customer ───────────────────────────
const { rows: convoRows } = await client.query(
  `select id, status, turn_count, created_at, last_message_at, intake_id
     from sms_conversations
     where from_number = $1
     order by created_at desc
     limit 10`,
  [phone],
);

console.log("\n" + "─".repeat(72));
console.log(`SMS CONVERSATIONS  (last ${convoRows.length})`);
console.log("─".repeat(72));
for (const r of convoRows) {
  const created = r.created_at?.toISOString?.().replace("T", " ").slice(0, 19) ?? r.created_at;
  console.log(`  ${created}  status=${r.status.padEnd(11)} turns=${r.turn_count}  intake=${r.intake_id ? r.intake_id.slice(0, 8) + "…" : "(none)"}  id=${r.id}`);
}

// ─── Recent intakes for this customer ────────────────────────────────
const { rows: intakeRows } = await client.query(
  `select i.id, i.job_type, i.confidence, i.caller, i.suburb, i.address, i.created_at
     from intakes i
     where i.customer_id = $1
     order by i.created_at desc
     limit 10`,
  [c.id],
);

console.log("\n" + "─".repeat(72));
console.log(`INTAKES  (last ${intakeRows.length}, linked by customer_id)`);
console.log("─".repeat(72));
for (const r of intakeRows) {
  const created = r.created_at?.toISOString?.().replace("T", " ").slice(0, 19) ?? r.created_at;
  const callerName = r.caller?.name ?? "(null)";
  console.log(`  ${created}  ${r.job_type.padEnd(20)} conf=${(r.confidence ?? "?").padEnd(6)}  caller.name=${String(callerName).padEnd(15)} suburb=${r.suburb ?? "(null)"}`);
}

await client.end();
