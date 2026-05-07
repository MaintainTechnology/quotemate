// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Fix stale `access.notes` references in the Vapi prompt
//
// Schema hotfix b3c1856 (2026-05-07) dropped `access.notes` to fit
// Anthropic's 24-param generateObject limit. Two questions in the
// EV_CHARGER section of Jeff's system prompt still route their answers
// to `access.notes`, so the structurer silently drops that data.
//
// This script repoints both questions at `scope.description`, which is
// where access concerns now live per the schema comment.
//
// Idempotent — re-running is safe (skips if no `access.notes` left).
// ═══════════════════════════════════════════════════════════════════

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error("Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env.local");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${VAPI_API_KEY}`,
  "Content-Type": "application/json",
};

async function vapi(method, path, body) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

console.log(`\n[1/4] Fetching assistant ${VAPI_ASSISTANT_ID}...`);
const before = await vapi("GET", `/assistant/${VAPI_ASSISTANT_ID}`);
if (!before.ok) {
  console.error(`✗ HTTP ${before.status}`);
  console.error(typeof before.data === "string" ? before.data : JSON.stringify(before.data, null, 2));
  process.exit(1);
}
const a = before.data;
let sys = a.model?.messages?.find((m) => m.role === "system")?.content ?? "";
const originalLen = sys.length;
console.log(`      Current prompt: ${originalLen} chars`);

console.log(`\n[2/4] Scanning for stale access.notes references...`);
const occurrences = (sys.match(/access\.notes/g) ?? []).length;
console.log(`      Found ${occurrences} occurrence(s) of "access.notes"`);

if (occurrences === 0) {
  console.log(`      = nothing to do — prompt already aligned with schema`);
  process.exit(0);
}

console.log(`\n[3/4] Repointing access.notes → scope.description...`);

// Order matters: replace the comma-pair first so the bare-word regex
// below doesn't half-replace it.
let patched = sys
  .replace(/access\.notes,\s*scope\.indoor_outdoor/g, "scope.description, scope.indoor_outdoor")
  .replace(/access\.notes/g, "scope.description");

const remaining = (patched.match(/access\.notes/g) ?? []).length;
if (remaining > 0) {
  console.error(`      ✗ ${remaining} occurrence(s) still present after patch — aborting`);
  process.exit(1);
}
console.log(`      ✓ replaced ${occurrences} reference(s)`);
console.log(`      Prompt: ${originalLen} → ${patched.length} chars`);

const payload = {
  model: {
    ...a.model,
    messages: [
      { role: "system", content: patched },
      ...((a.model?.messages ?? []).filter((m) => m.role !== "system")),
    ],
  },
};

const patch = await vapi("PATCH", `/assistant/${VAPI_ASSISTANT_ID}`, payload);
if (!patch.ok) {
  console.error(`✗ PATCH failed: HTTP ${patch.status}`);
  console.error(typeof patch.data === "string" ? patch.data : JSON.stringify(patch.data, null, 2));
  process.exit(1);
}

console.log(`\n[4/4] Verifying live assistant...`);
const after = await vapi("GET", `/assistant/${VAPI_ASSISTANT_ID}`);
const v = after.data.model?.messages?.find((m) => m.role === "system")?.content ?? "";

const checks = [
  ["no access.notes remaining",                !v.includes("access.notes")],
  ["EV_CHARGER section intact",                v.includes("EV_CHARGER")],
  ["EV charger distance question routed",      v.includes("Distance from your switchboard")],
  ["EV mounting question routed",              v.includes("Wall-mounted, garage, driveway")],
  ["existing access.* fields intact",          v.includes("access.ceiling_type") || v.includes("access.wall_type") || v.includes("access.roof_access")],
  ["CONFIRMATION PROTOCOL intact",             v.includes("CONFIRMATION PROTOCOL")],
  ["CLARIFICATION PROTOCOL intact",            v.includes("CLARIFICATION PROTOCOL")],
  ["Jeff identity intact",                     v.includes("You are Jeff")],
  ["send_sms_photo_link tool wiring intact",   v.includes("send_sms_photo_link")],
];

let allOk = true;
for (const [name, ok] of checks) {
  console.log(`      ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) allOk = false;
}

console.log(`\n${allOk ? "✓" : "⚠"} EV_CHARGER fields now route to scope.description.`);
console.log(`  Prompt: ${originalLen} → ${v.length} chars\n`);
process.exit(allOk ? 0 : 1);
