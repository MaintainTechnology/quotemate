// Adds the `send_sms_photo_link` server-side tool to the QuoteMate Vapi
// assistant. Idempotent — re-running with the tool already registered
// detects it and exits without modification.
//
// Pre-requisite: the route at TOOL_URL must already be deployed and
// returning 405 (or 200) on POST. If it 404s, Vapi will not be able to
// invoke the tool during a real call.
//
// Usage:  node --env-file=.env.local scripts/update-vapi-add-photo-tool.mjs

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error("Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in env");
  process.exit(1);
}

// Vapi calls this URL during a live phone call — must point at the
// publicly reachable production deployment, NOT localhost (which is what
// .env.local's APP_URL is during dev). Override with PROD_APP_URL env if
// you ever rename the prod deployment.
const PROD_APP_URL = process.env.PROD_APP_URL ?? "https://quote-mate-rho.vercel.app";
const TOOL_URL = `${PROD_APP_URL}/api/vapi/tools/send-sms-photo-link`;

// Vapi `function` tool schema. The model will speak the SMS confirmation
// after the tool returns, so the description tells it what the tool does
// and when to call it.
const PHOTO_TOOL = {
  type: "function",
  async: false,
  function: {
    name: "send_sms_photo_link",
    description:
      "Send the customer an SMS with a tap-to-upload link for job photos. Call this whenever you ask the customer to send photos of their job (downlights ceiling, switchboard, install location, etc.). The system handles the SMS automatically — you just need to invoke this tool, then briefly tell the customer you've sent the link.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description:
            "Brief list of what the customer should photograph, e.g. ['ceiling area', 'existing fitting', 'wall switch']. Optional — does not change SMS content but is logged for context.",
          items: { type: "string" },
        },
      },
      required: [],
    },
  },
  server: {
    url: TOOL_URL,
    timeoutSeconds: 20,
  },
};

console.log(`→ Verifying tool URL is reachable: ${TOOL_URL}`);
const probe = await fetch(TOOL_URL, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
console.log(`  HTTP ${probe.status} (anything but 404 means the route is deployed)`);
if (probe.status === 404) {
  console.error("✗ Route returned 404 — has Vercel finished deploying? Re-run after the deploy completes.");
  process.exit(1);
}

console.log(`\n→ Fetching current assistant ${VAPI_ASSISTANT_ID}`);
const fetchRes = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
  headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
});
if (!fetchRes.ok) {
  console.error(`✗ Failed to fetch assistant: HTTP ${fetchRes.status}`);
  console.error(await fetchRes.text());
  process.exit(1);
}
const existing = await fetchRes.json();
const existingTools = existing.model?.tools ?? [];
console.log(`  Existing tools: ${existingTools.map((t) => t.type === "function" ? t.function?.name : t.type).join(", ") || "(none)"}`);

const alreadyRegistered = existingTools.some(
  (t) => t.type === "function" && t.function?.name === "send_sms_photo_link"
);

let updatedTools;
if (alreadyRegistered) {
  console.log("  → tool already registered; updating its config in place");
  updatedTools = existingTools.map((t) =>
    t.type === "function" && t.function?.name === "send_sms_photo_link" ? PHOTO_TOOL : t
  );
} else {
  console.log("  → tool not present; appending it to model.tools");
  updatedTools = [...existingTools, PHOTO_TOOL];
}

const updatedModel = { ...existing.model, tools: updatedTools };

console.log(`\n→ PATCHing assistant model.tools (${updatedTools.length} tool(s) total)`);
const patchRes = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${VAPI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ model: updatedModel }),
});

const text = await patchRes.text();
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = text; }

if (!patchRes.ok) {
  console.error(`\n✗ PATCH failed: HTTP ${patchRes.status}`);
  console.error(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));
  process.exit(1);
}

const finalTools = parsed.model?.tools ?? [];
console.log(`\n✓ Assistant updated`);
console.log(`  Tools now registered:`);
for (const t of finalTools) {
  if (t.type === "function") {
    console.log(`    - ${t.function?.name}  → ${t.server?.url ?? "(no server url)"}`);
  } else {
    console.log(`    - ${t.type} (Vapi built-in)`);
  }
}

console.log(`\nNext step — make a real test call to your Vapi number:`);
console.log(`  Ask Jeff for an electrical job (e.g. "6 downlights"). When Jeff`);
console.log(`  asks for photos, your phone should buzz with a tap-to-upload`);
console.log(`  link DURING the call (not after).`);
