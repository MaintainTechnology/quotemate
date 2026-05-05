// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Make the Vapi receptionist FAST
//
// Goal: cut average call duration ~50% by removing readbacks,
// confirmation handshakes, and the "Sound good?" gate.
//
// Specifically:
//   1. firstMessage drops the "Sound good?" yes/no gate and pivots
//      straight into the first intake question ("what's your name?").
//   2. TONE block stops requiring "Always confirm what you heard" and
//      gains a SPEED RULES section.
//   3. The caller's mobile is taken from caller ID — the assistant is
//      told NEVER to ask "is this the best number" unless the caller
//      first volunteers a different one.
//   4. CLOSING shrinks from a 4-line readback to a single line.
//   5. EMERGENCY drops the "confirm best contact number" step.
//
// All edits are idempotent — re-running is safe.
//
// Usage: node --env-file=.env.local scripts/update-vapi-speed-config.mjs
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
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ─── 1. Fetch current assistant ─────────────────────────────────────
console.log(`\n[1/4] Fetching assistant ${VAPI_ASSISTANT_ID}...`);
const before = await vapi("GET", `/assistant/${VAPI_ASSISTANT_ID}`);
if (!before.ok) {
  console.error(`✗ Could not fetch assistant: HTTP ${before.status}`);
  process.exit(1);
}
const a = before.data;
const sysMsg = a.model?.messages?.find((m) => m.role === "system");
let sys = sysMsg?.content ?? "";
const originalLen = sys.length;
console.log(`      Current system prompt: ${originalLen} chars`);
console.log(`      Current first message: "${(a.firstMessage ?? "").slice(0, 70)}…"`);

// ─── 2. Define surgical replacements ────────────────────────────────
console.log(`\n[2/4] Applying surgical replacements...`);

const edits = [
  // ── A. TONE — drop "Always confirm" + add SPEED RULES ─────────────
  {
    label: "TONE block + SPEED RULES",
    find: `TONE
Friendly, conversational, brief. ONE question at a time. Always confirm
what you heard. Use plain language unless the customer uses trade terms first.`,
    replace: `TONE
Fast and direct. ONE question per turn, no filler. Do NOT echo back what
the customer just said. Only re-ask if the transcript was genuinely
garbled. Plain language unless the customer uses trade terms first.

SPEED RULES (read first — calls must feel fast)
  · The caller's mobile is ALREADY captured from caller ID. NEVER ask
    "what's the best number" or "is this the right mobile to text".
    Assume the calling number is the contact number. Only switch if the
    caller volunteers a different one ("send it to my partner's phone…").
  · No readbacks. Don't say "so that's [X], correct?" — move on.
  · No "let me just confirm" / "just to be sure" / "did I get that right".
  · Drop filler acknowledgements ("perfect, thank you so much for that") —
    a quick "yep" or "righto" between questions is plenty.
  · Skip the "should only take a minute" preamble — start asking.
  · CLOSING is ONE short line, never a recap of what they told you.`,
  },

  // ── B. OPENING — drop name preamble and the "confirm mobile" step ─
  {
    label: "OPENING flow",
    find: `OPENING (after Vapi's first message has played)
"No worries, I'll grab a few quick details so we can get you an accurate
quote. It should only take a minute. First — what's your name?"

Then: name → confirm mobile (Vapi has caller ID) → suburb → "What do you
need done?" → from that, classify job_type.`,
    replace: `OPENING
The firstMessage already asks for the name. Go straight from name to:
suburb → "What do you need done?" → classify job_type.

DO NOT ask the caller to confirm their mobile — caller ID already has it.
DO NOT re-ask name or suburb after they've answered. Move forward.`,
  },

  // ── C. EMERGENCY — drop "best contact number" confirm step ────────
  {
    label: "EMERGENCY confirm-number step",
    find: `4. Skip detailed Q&A. Confirm: name, suburb, best contact number.`,
    replace: `4. Skip detailed Q&A. Get name and suburb only — phone is from caller ID.`,
  },

  // ── D. CLOSING — collapse from 4-line readback to one short line ──
  {
    label: "CLOSING block",
    find: `═══ CLOSING ═════════════════════════════════════════════════════════
Summarise back: "Just to confirm — [N] [job type] in [suburb], [is/is not]
a new install, [photos received / sending now]. [Tradie name] will [send a
quote / call you to book a site visit] within [SLA — an hour for auto-quote,
end of day for inspection]. Anything else I should note?"

Then close: "Great, we'll prepare a quote with a few options. If anything
looks unclear from the photos, we may recommend a quick site visit before
final pricing."`,
    replace: `═══ CLOSING ═════════════════════════════════════════════════════════
ONE short line. No readback of what they told you. Pick the variant:

AUTO-QUOTE 5 + photos already sent:
  "Beauty — quote on its way within the hour. Anything else?"

AUTO-QUOTE 5 + still waiting on photos:
  "Flick those photos through and we'll have the quote out within the
  hour. Anything else?"

INSPECTION-ONLY (switchboard / EV / fault / renovation):
  "We'll book a site visit and quote from there. Anything else?"

EMERGENCY:
  "[Tradie name] will call you back within 15 minutes."

If the caller says "no, that's it" or similar → invoke endCall immediately.
Do not add a second goodbye line — the endCallMessage plays automatically.`,
  },

  // ── E. CALL TERMINATION pattern — clarify endCallMessage is auto ──
  {
    label: "CALL TERMINATION pattern line",
    find: `PATTERN: deliver the CLOSING summary line → say the goodbye line from the
\`endCallMessage\` config → invoke \`endCall\` tool. Three steps, in order,
no pausing.`,
    replace: `PATTERN: deliver the CLOSING line → invoke \`endCall\` immediately.
Vapi plays the endCallMessage automatically on hangup; do NOT say it
yourself. Two steps. No pause between them.`,
  },
];

let applied = 0;
let alreadyApplied = 0;
for (const { label, find, replace } of edits) {
  if (sys.includes(replace)) {
    console.log(`      = ${label.padEnd(38)} already applied`);
    alreadyApplied++;
    continue;
  }
  if (!sys.includes(find)) {
    console.log(`      ✗ ${label.padEnd(38)} TARGET NOT FOUND — skipping`);
    continue;
  }
  sys = sys.replace(find, replace);
  console.log(`      ✓ ${label.padEnd(38)} applied`);
  applied++;
}
console.log(`      ${applied} applied, ${alreadyApplied} already in place`);
console.log(`      Prompt length: ${originalLen} → ${sys.length} chars`);

// ─── 3. New first message — drop the "Sound good?" gate ─────────────
const newFirstMessage =
  "G'day, QuoteMate AI quoting line. I'll grab a few quick details for " +
  "your electrical job and we'll send a quote through. Call may be " +
  "recorded. First up — what's your name?";

const firstMessageChanged = a.firstMessage !== newFirstMessage;
console.log(`\n      First message: ${firstMessageChanged ? "updating" : "already set"}`);

// ─── 4. PATCH the assistant ─────────────────────────────────────────
console.log(`\n[3/4] PATCHing assistant...`);

const payload = {
  firstMessage: newFirstMessage,
  model: {
    ...a.model,
    messages: [
      { role: "system", content: sys },
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

// ─── 5. Verify ──────────────────────────────────────────────────────
console.log(`\n[4/4] Verifying...`);
const after = await vapi("GET", `/assistant/${VAPI_ASSISTANT_ID}`);
const v = after.data;
const verifiedSys = v.model?.messages?.find((m) => m.role === "system")?.content ?? "";

const checks = [
  ["TONE no longer says 'Always confirm'", !verifiedSys.includes("Always confirm")],
  ["SPEED RULES block present", verifiedSys.includes("SPEED RULES")],
  ["caller-ID rule present", verifiedSys.includes("ALREADY captured from caller ID")],
  ["OPENING no longer asks to confirm mobile", !verifiedSys.includes("confirm mobile (Vapi has caller ID)")],
  ["EMERGENCY drops 'best contact number'", !verifiedSys.includes("best contact number")],
  ["CLOSING is the new compact version", verifiedSys.includes("ONE short line. No readback")],
  ["First message has no 'Sound good?' gate", !v.firstMessage?.includes("Sound good?")],
  ["First message asks for name directly", v.firstMessage?.includes("what's your name")],
];

for (const [name, ok] of checks) {
  console.log(`      ${ok ? "✓" : "✗"} ${name}`);
}

console.log(`\n✓ Receptionist tuned for speed.`);
console.log(`  Prompt: ${originalLen} → ${verifiedSys.length} chars`);
console.log(`  First message:\n    "${v.firstMessage}"\n`);
console.log(`  Test by dialling +61489083371. Expected flow:`);
console.log(`    AI: "G'day… what's your name?"`);
console.log(`    YOU: "Jeph"`);
console.log(`    AI: "Righto Jeph, what suburb?" (NO mobile-confirm step)`);
console.log(`    …`);
console.log(`    AI: "Beauty — quote on its way within the hour. Anything else?"`);
console.log(`    YOU: "Nah that's it"`);
console.log(`    [endCall fires immediately]\n`);
