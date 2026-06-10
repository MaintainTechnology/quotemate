// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Set up Vapi provider credentials (S3.2 from walkthrough)
//
// Usage:  node --env-file=.env.local scripts/setup-vapi-credentials.mjs
//
// Equivalent to clicking through Vapi → Settings → Provider Keys
// and pasting the Anthropic / Deepgram / ElevenLabs keys.
// Pushes them via Vapi's REST API.
// ═══════════════════════════════════════════════════════════════════

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!VAPI_API_KEY) {
  console.error("Missing VAPI_API_KEY in .env.local");
  process.exit(1);
}

const VAPI_BASE = "https://api.vapi.ai";
const headers = {
  Authorization: `Bearer ${VAPI_API_KEY}`,
  "Content-Type": "application/json",
};

async function vapi(method, path, body) {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

console.log("\n→ Connecting to Vapi API...");

// Step 1: list current credentials
const list = await vapi("GET", "/credential");
if (!list.ok) {
  console.error(`✗ Could not list credentials: HTTP ${list.status}`);
  console.error(`  ${typeof list.data === "string" ? list.data : JSON.stringify(list.data)}`);
  process.exit(1);
}
console.log(`  Found ${list.data.length} existing credential${list.data.length === 1 ? "" : "s"}.`);

const existingProviders = new Set(list.data.map((c) => c.provider));
if (list.data.length) {
  for (const c of list.data) {
    console.log(`    · ${c.provider.padEnd(12)}  id=${c.id}  name="${c.name ?? "(unnamed)"}"`);
  }
}

// Step 2: define the three credentials to add
const targets = [
  {
    label: "Anthropic (Claude)",
    apiKey: ANTHROPIC_API_KEY,
    payload: { provider: "anthropic", apiKey: ANTHROPIC_API_KEY, name: "QuoteMate · Claude" },
  },
  {
    label: "Deepgram (STT)",
    apiKey: DEEPGRAM_API_KEY,
    payload: { provider: "deepgram", apiKey: DEEPGRAM_API_KEY, name: "QuoteMate · Deepgram" },
  },
  {
    label: "ElevenLabs (TTS)",
    apiKey: ELEVENLABS_API_KEY,
    payload: { provider: "11labs", apiKey: ELEVENLABS_API_KEY, name: "QuoteMate · ElevenLabs" },
  },
];

// Step 3: create each missing one
console.log("\n→ Setting up provider credentials...\n");

for (const t of targets) {
  if (!t.apiKey) {
    console.log(`  ⊘ ${t.label.padEnd(22)} skipped (key missing in .env.local)`);
    continue;
  }
  if (existingProviders.has(t.payload.provider)) {
    console.log(`  → ${t.label.padEnd(22)} already exists, skipping`);
    continue;
  }

  const res = await vapi("POST", "/credential", t.payload);
  if (res.ok) {
    console.log(`  ✓ ${t.label.padEnd(22)} created  (id=${res.data.id})`);
  } else {
    const msg = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    console.log(`  ✗ ${t.label.padEnd(22)} HTTP ${res.status}  ${msg.slice(0, 200)}`);
  }
}

// Step 4: re-list to confirm
console.log("\n→ Final state:\n");
const final = await vapi("GET", "/credential");
if (final.ok) {
  for (const c of final.data) {
    console.log(`  · ${c.provider.padEnd(12)}  id=${c.id}  name="${c.name ?? "(unnamed)"}"`);
  }
}

console.log("");
