// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Check + wire up Twilio number in Vapi
//
// 1. Lists existing Vapi phone numbers
// 2. Looks for TWILIO_PHONE_NUMBER from .env.local
// 3. If found → confirms assistantId matches; PATCHes if not
// 4. If not found → imports the Twilio number and assigns the assistant
// ═══════════════════════════════════════════════════════════════════

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

for (const [k, v] of Object.entries({
  VAPI_API_KEY, VAPI_ASSISTANT_ID,
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
})) {
  if (!v) { console.error(`Missing ${k} in .env.local`); process.exit(1); }
}

const headers = {
  Authorization: `Bearer ${VAPI_API_KEY}`,
  "Content-Type": "application/json",
};

async function vapi(method, path, body) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let data; try { data = JSON.parse(t); } catch { data = t; }
  return { ok: res.ok, status: res.status, data };
}

console.log(`\n→ Looking for ${TWILIO_PHONE_NUMBER} in your Vapi org...\n`);
const list = await vapi("GET", "/phone-number");
if (!list.ok) {
  console.error(`Could not list phone numbers: HTTP ${list.status}`);
  console.error(typeof list.data === "string" ? list.data : JSON.stringify(list.data));
  process.exit(1);
}

console.log(`  Found ${list.data.length} phone number${list.data.length === 1 ? "" : "s"}:`);
for (const p of list.data) {
  console.log(`    · ${(p.number ?? "?").padEnd(16)}  provider=${p.provider}  assistant=${p.assistantId ?? "(none)"}  id=${p.id}`);
}

const existing = list.data.find((p) => p.number === TWILIO_PHONE_NUMBER);

if (existing) {
  console.log(`\n→ ✓ Number already imported (id=${existing.id})`);
  if (existing.assistantId === VAPI_ASSISTANT_ID) {
    console.log(`  ✓ Already linked to assistant ${VAPI_ASSISTANT_ID}.`);
    console.log(`\n  Nothing to do — calls to ${TWILIO_PHONE_NUMBER} will hit the AI.\n`);
  } else {
    console.log(`  ⚠ Linked to a different assistant (${existing.assistantId ?? "none"}). PATCHing to ${VAPI_ASSISTANT_ID}...`);
    const patch = await vapi("PATCH", `/phone-number/${existing.id}`, { assistantId: VAPI_ASSISTANT_ID });
    if (patch.ok) {
      console.log(`  ✓ Updated. The number now routes to "QuoteMate Receptionist".`);
    } else {
      console.error(`  ✗ Update failed: HTTP ${patch.status} — ${JSON.stringify(patch.data)}`);
      process.exit(1);
    }
  }
} else {
  console.log(`\n→ Number not in Vapi yet — importing now...`);
  const create = await vapi("POST", "/phone-number", {
    provider: "twilio",
    number: TWILIO_PHONE_NUMBER,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    assistantId: VAPI_ASSISTANT_ID,
    name: "QuoteMate AU Line",
  });
  if (create.ok) {
    console.log(`  ✓ Imported. id=${create.data.id}`);
    console.log(`  ✓ Linked to assistant ${VAPI_ASSISTANT_ID}.`);
  } else {
    console.error(`  ✗ Import failed: HTTP ${create.status}`);
    console.error(`    ${typeof create.data === "string" ? create.data : JSON.stringify(create.data, null, 2)}`);
    process.exit(1);
  }
}

console.log(`\n→ Final state:\n`);
const refetch = await vapi("GET", "/phone-number");
for (const p of refetch.data) {
  const me = p.number === TWILIO_PHONE_NUMBER ? " ← yours" : "";
  console.log(`    · ${(p.number ?? "?").padEnd(16)}  assistant=${p.assistantId ?? "(none)"}${me}`);
}
console.log("");
