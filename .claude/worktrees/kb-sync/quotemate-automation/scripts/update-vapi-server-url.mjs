// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Update the Vapi assistant's Server URL (S3.5)
//
// Usage:
//   1. Start ngrok in a terminal:  /c/ngrok/ngrok.exe http 3000
//   2. Copy the https://...ngrok-free.app URL it prints
//   3. Set VAPI_SERVER_URL in .env.local to <that_url>/api/vapi/webhook
//   4. Run: node --env-file=.env.local scripts/update-vapi-server-url.mjs
//
// Or pass it inline:
//   VAPI_SERVER_URL=https://abc.ngrok-free.app/api/vapi/webhook \
//     node --env-file=.env.local scripts/update-vapi-server-url.mjs
// ═══════════════════════════════════════════════════════════════════

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const VAPI_SERVER_URL = process.env.VAPI_SERVER_URL;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error("Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env.local");
  process.exit(1);
}

if (!VAPI_SERVER_URL) {
  console.error("Missing VAPI_SERVER_URL.");
  console.error("  Set it in .env.local to your ngrok URL + /api/vapi/webhook");
  console.error("  Example: VAPI_SERVER_URL=https://abc123.ngrok-free.app/api/vapi/webhook");
  process.exit(1);
}

if (!VAPI_SERVER_URL.startsWith("https://")) {
  console.error("VAPI_SERVER_URL must start with https:// (Vapi requires TLS)");
  process.exit(1);
}

if (!VAPI_SERVER_URL.includes("/api/vapi/webhook")) {
  console.error("⚠ Warning: VAPI_SERVER_URL doesn't end with /api/vapi/webhook");
  console.error(`  Got: ${VAPI_SERVER_URL}`);
  console.error("  Vapi will POST to whatever URL you give — make sure it matches your route.");
}

console.log(`\n→ Updating assistant ${VAPI_ASSISTANT_ID}`);
console.log(`  Setting server.url = ${VAPI_SERVER_URL}\n`);

const res = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${VAPI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    server: { url: VAPI_SERVER_URL },
  }),
});

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = text; }

if (!res.ok) {
  console.error(`✗ Failed: HTTP ${res.status}`);
  console.error(typeof data === "string" ? data : JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(`✓ Server URL updated.`);
console.log(`  Assistant: ${data.name} (${data.id})`);
console.log(`  Server URL: ${data.server?.url}`);
console.log(`\nYou can now make a test call to your Vapi-linked phone number.\n`);
