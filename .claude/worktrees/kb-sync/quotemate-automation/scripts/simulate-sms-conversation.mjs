// ═══════════════════════════════════════════════════════════════════
// QuoteMate · simulate an SMS round-trip against the deployed endpoint
//
// Usage:
//   node --env-file=.env.local scripts/simulate-sms-conversation.mjs
//
// Optional flags:
//   --target=local      hits http://localhost:3000 instead of Vercel
//   --body="custom"     overrides the default test message
//   --from=+61400000111 overrides the simulated customer number
//
// What it does:
//   1. Builds a Twilio-shaped form body for an inbound SMS
//   2. Computes a valid X-Twilio-Signature using TWILIO_AUTH_TOKEN
//   3. POSTs to /api/sms/inbound on the configured target
//   4. Reports HTTP status + any response body
//
// IMPORTANT: this script uses the real auth token to forge a signature
// the webhook will accept. NEVER run it against a public/shared host
// you don't own. Designed for testing your own deployment only.
// ═══════════════════════════════════════════════════════════════════

import { createHmac } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  }),
);

const TARGET = args.target === "local"
  ? "http://localhost:3000"
  : "https://quote-mate-rho.vercel.app";

const ENDPOINT = `${TARGET}/api/sms/inbound`;

const FROM = args.from ?? "+639759483289";         // PH mobile (joined to WhatsApp sandbox via "join house-title")
const TO   = process.env.TWILIO_SMS_NUMBER ?? "+61481613464";
const BODY = args.body ?? "test from simulator";

const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "ACtest";

if (!TOKEN) {
  console.error("Missing TWILIO_AUTH_TOKEN — run with --env-file=.env.local");
  process.exit(1);
}

// Twilio's signature algorithm: sort params, concat key+value into URL, HMAC-SHA1.
function sign(url, params) {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const k of sorted) data += k + params[k];
  return createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

const params = {
  From:       FROM,
  To:         TO,
  Body:       BODY,
  MessageSid: `SMtest${Date.now()}`,
  AccountSid: ACCOUNT_SID,
};

const signature = sign(ENDPOINT, params);

console.log(`\n→ POST ${ENDPOINT}`);
console.log(`   From=${FROM}  To=${TO}`);
console.log(`   Body="${BODY}"`);

const t0 = Date.now();
const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    "Content-Type":       "application/x-www-form-urlencoded",
    "X-Twilio-Signature": signature,
  },
  body: new URLSearchParams(params).toString(),
});
const ms = Date.now() - t0;

const text = await res.text();

console.log(`\n← HTTP ${res.status} in ${ms}ms`);
if (text) console.log(`   body: ${text}`);

if (res.status >= 200 && res.status < 300) {
  console.log(`\n✓ Webhook accepted. Run check-sms-state.mjs to inspect DB.`);
} else if (res.status === 403) {
  console.log(`\n✗ 403 Forbidden — Twilio signature check failed.`);
  console.log(`   Most likely cause: TWILIO_AUTH_TOKEN on Vercel doesn't match`);
  console.log(`   the one in your local .env.local. Re-add it on Vercel and redeploy.`);
} else {
  console.log(`\n✗ Webhook rejected. Check Vercel function logs.`);
}
