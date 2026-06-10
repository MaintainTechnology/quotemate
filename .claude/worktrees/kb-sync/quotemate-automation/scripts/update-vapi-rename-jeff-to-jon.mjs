// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Rename the receptionist from Jeff to Jon
//
// Replaces every standalone occurrence of "Jeff" with "Jon" across:
//   · the system prompt (ROLE block — name, who-am-I line, AI-honesty)
//   · the firstMessage (Jeff introduces himself when the call connects)
//
// Uses \bJeff\b (word-boundary) so it cannot collide with "[tradie
// name]" placeholders or any unrelated token.
//
// Idempotent — re-running is safe (skips if no "Jeff" remains).
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
const sysOriginal = a.model?.messages?.find((m) => m.role === "system")?.content ?? "";
const firstOriginal = a.firstMessage ?? "";

const JEFF_RE = /\bJeff\b/g;
const sysHits = (sysOriginal.match(JEFF_RE) ?? []).length;
const firstHits = (firstOriginal.match(JEFF_RE) ?? []).length;

console.log(`      System prompt:  ${sysOriginal.length} chars · ${sysHits} "Jeff" references`);
console.log(`      First message:  "${firstOriginal.slice(0, 70)}..." · ${firstHits} "Jeff" references`);

if (sysHits === 0 && firstHits === 0) {
  console.log(`\n[2/4] = nothing to do — no "Jeff" references remain`);
  process.exit(0);
}

console.log(`\n[2/4] Replacing \\bJeff\\b → Jon...`);
const sysPatched = sysOriginal.replace(JEFF_RE, "Jon");
const firstPatched = firstOriginal.replace(JEFF_RE, "Jon");

const sysRemaining = (sysPatched.match(JEFF_RE) ?? []).length;
const firstRemaining = (firstPatched.match(JEFF_RE) ?? []).length;
if (sysRemaining > 0 || firstRemaining > 0) {
  console.error(`      ✗ residual "Jeff" detected post-replace — aborting`);
  process.exit(1);
}
console.log(`      ✓ system prompt: replaced ${sysHits}`);
console.log(`      ✓ first message: replaced ${firstHits}`);

console.log(`\n[3/4] PATCHing assistant...`);
const payload = {
  firstMessage: firstPatched,
  model: {
    ...a.model,
    messages: [
      { role: "system", content: sysPatched },
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
const v = after.data;
const sysLive = v.model?.messages?.find((m) => m.role === "system")?.content ?? "";
const firstLive = v.firstMessage ?? "";

const checks = [
  ["no \"Jeff\" left in system prompt",         !JEFF_RE.test(sysLive)],
  ["no \"Jeff\" left in firstMessage",          !JEFF_RE.test(firstLive)],
  ["ROLE introduces Jon",                        sysLive.includes("You are Jon")],
  ["who-am-I line uses Jon",                     sysLive.includes("I'm Jon, the AI receptionist for QuoteMate")],
  ["firstMessage introduces Jon",                firstLive.includes("Jon here")],
  // Sanity: previous structure preserved
  ["AI-honesty fallback intact",                 sysLive.includes("I'm an AI assistant")],
  ["EV_CHARGER section intact",                  sysLive.includes("EV_CHARGER")],
  ["no stale access.notes",                     !sysLive.includes("access.notes")],
  ["CONFIRMATION PROTOCOL intact",               sysLive.includes("CONFIRMATION PROTOCOL")],
  ["CLARIFICATION PROTOCOL intact",              sysLive.includes("CLARIFICATION PROTOCOL")],
  ["send_sms_photo_link wiring intact",          sysLive.includes("send_sms_photo_link")],
  ["[tradie name] placeholder untouched",        sysLive.includes("[tradie name]") || sysLive.includes("[Tradie name]")],
];

let allOk = true;
for (const [name, ok] of checks) {
  console.log(`      ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) allOk = false;
}

console.log(`\n${allOk ? "✓" : "⚠"} Receptionist is now Jon.`);
console.log(`  Prompt:        ${sysOriginal.length} → ${sysLive.length} chars`);
console.log(`  First message: "${firstLive}"\n`);
process.exit(allOk ? 0 : 1);
