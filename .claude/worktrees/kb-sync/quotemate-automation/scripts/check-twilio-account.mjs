// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Diagnose which Twilio account our creds belong to,
// and whether the WhatsApp sandbox join was received on it.
//
// Usage:  node --env-file=.env.local scripts/check-twilio-account.mjs
// ═══════════════════════════════════════════════════════════════════

import twilio from "twilio";

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
if (!sid || !token) {
  console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  process.exit(1);
}

const client = twilio(sid, token);

console.log(`\n→ Verifying account ${sid}...\n`);
const account = await client.api.v2010.accounts(sid).fetch();
console.log(`  Friendly name: ${account.friendlyName}`);
console.log(`  Status:        ${account.status}`);
console.log(`  Type:          ${account.type}`);
console.log(`  Date created:  ${account.dateCreated}`);

console.log(`\n→ Looking for inbound WhatsApp messages on this account...\n`);
const inbound = await client.messages.list({
  to: 'whatsapp:+14155238886',
  limit: 20,
});

if (inbound.length === 0) {
  console.log(`  (no inbound WhatsApp messages found on this account)`);
  console.log(`\n  This is the smoking gun — if your "join house-title" message`);
  console.log(`  was sent from your PH WhatsApp, it should appear here.`);
  console.log(`  If it's not here, you joined the sandbox on a DIFFERENT Twilio`);
  console.log(`  account (probably the old one before credentials were rotated).`);
} else {
  console.log(`  Found ${inbound.length} inbound WhatsApp message(s):\n`);
  for (const m of inbound) {
    const ts = m.dateCreated.toISOString().slice(0, 19).replace('T', ' ');
    console.log(`  ${ts}  from ${m.from}`);
    console.log(`              "${(m.body ?? '').slice(0, 80)}"`);
  }
}

console.log(`\n→ Looking for the most recent outbound WhatsApp from sandbox...\n`);
const outbound = await client.messages.list({
  from: 'whatsapp:+14155238886',
  limit: 5,
});

if (outbound.length === 0) {
  console.log(`  (no outbound WhatsApp sandbox sends found)`);
} else {
  for (const m of outbound) {
    const ts = m.dateCreated.toISOString().slice(0, 19).replace('T', ' ');
    const err = m.errorCode ? `err=${m.errorCode}` : '';
    console.log(`  ${ts}  to ${m.to}  status=${m.status}  ${err}`);
    if (m.errorMessage) console.log(`              ${m.errorMessage}`);
  }
}

console.log();
