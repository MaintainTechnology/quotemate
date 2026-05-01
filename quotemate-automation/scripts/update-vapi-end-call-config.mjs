// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Teach the Vapi assistant when to end the call
//
// Wires up four call-ending mechanisms that work together:
//   1. endCall built-in tool — lets the LLM decide to hang up
//   2. endCallPhrases — auto-hangup when caller says farewells
//   3. endCallMessage — final line before hanging up
//   4. silenceTimeoutSeconds — hangup on dead air
//   5. maxDurationSeconds — safety cap for runaway calls
//
// Plus appends a CALL TERMINATION section to the existing system
// prompt instructing the LLM to call `endCall` after the closing summary.
//
// Usage: node --env-file=.env.local scripts/update-vapi-end-call-config.mjs
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
console.log(`\n[1/5] Fetching current assistant ${VAPI_ASSISTANT_ID}...`);
const before = await vapi("GET", `/assistant/${VAPI_ASSISTANT_ID}`);
if (!before.ok) {
  console.error(`✗ Could not fetch assistant: HTTP ${before.status}`);
  console.error(typeof before.data === "string" ? before.data : JSON.stringify(before.data, null, 2));
  process.exit(1);
}
const a = before.data;

console.log(`      Name:                    ${a.name}`);
console.log(`      Current end-call config:`);
console.log(`        endCallMessage:        ${a.endCallMessage ? `"${a.endCallMessage.slice(0, 60)}…"` : "(not set)"}`);
console.log(`        endCallPhrases:        ${Array.isArray(a.endCallPhrases) ? `${a.endCallPhrases.length} phrases` : "(not set)"}`);
console.log(`        silenceTimeoutSeconds: ${a.silenceTimeoutSeconds ?? "(default)"}`);
console.log(`        maxDurationSeconds:    ${a.maxDurationSeconds ?? "(default)"}`);
console.log(`        endCall tool present:  ${(a.model?.tools ?? []).some((t) => t.type === "endCall") ? "yes" : "no"}`);

// ─── 2. Build new end-call config ───────────────────────────────────
console.log(`\n[2/5] Composing new end-call config...`);

const endCallPhrases = [
  // Direct goodbyes
  "goodbye",
  "bye",
  "bye now",
  "see ya",
  "see you later",
  "talk later",
  "talk to you later",
  // Thanks-and-bye combinations
  "thanks bye",
  "thanks goodbye",
  "thanks that's everything",
  "thanks that's all",
  "thanks for that",
  "ta thanks",
  "cheers thanks",
  "alright cheers",
  "alright thanks",
  // Australian wrap-up phrases
  "no worries thanks",
  "no worries cheers",
  "yeah no that's it",
  "yeah that's everything",
  "yeah that's all I needed",
  "nah that's all",
  "nope that's everything",
  // Customer-confirms-end
  "I'll let you go",
  "I have to go",
  "I'll wait for the quote",
  "looking forward to the quote",
  "I'll keep an eye out for it",
];

const endCallMessage =
  "Beauty — your quote will be on its way shortly. Have a good one. Cheers!";

// Silence + duration limits — generous enough that real conversations
// don't get cut off, tight enough that broken/abandoned calls don't run forever.
const silenceTimeoutSeconds = 30; // hangup after 30s of dead air
const maxDurationSeconds = 600;   // hard cap at 10 minutes

// Idle prompts (during silence) — gives the customer one chance to recover
// before the silence timeout fires.
const messagePlan = {
  idleMessages: [
    "Are you still there?",
    "Just checking — are you still on the line?",
  ],
  idleMessageMaxSpokenCount: 2,
  idleTimeoutSeconds: 12,
  silenceTimeoutMessage:
    "Sounds like we got cut off — I'll let you go now. Call back anytime if you'd like to continue.",
};

// ─── 3. Merge tools — keep whatever's there + add endCall ──────────
const existingTools = Array.isArray(a.model?.tools) ? a.model.tools : [];
const hasEndCall = existingTools.some((t) => t.type === "endCall");
const tools = hasEndCall
  ? existingTools
  : [...existingTools, { type: "endCall" }];

console.log(`      Tools after merge: ${tools.length} total (${hasEndCall ? "endCall already present" : "endCall added"})`);

// ─── 4. Append CALL TERMINATION instructions to system prompt ───────
const existingSystem = a.model?.messages?.find((m) => m.role === "system")?.content ?? "";
const terminationMarker = "═══ CALL TERMINATION";

const terminationBlock = `

═══ CALL TERMINATION ════════════════════════════════════════════════
After delivering your CLOSING summary above, call the \`endCall\` tool to
hang up. Do not wait for the customer to say goodbye — customers expect
the call to end immediately after the closing line. Hesitating creates
awkward silence that triggers the silence-timeout safety net.

ALSO call \`endCall\` immediately if:
  · The customer says any farewell ("bye", "thanks bye", "no worries",
    "yeah that's everything", "ta cheers", "see ya", etc.)
  · You've answered all the required questions for this job_type AND
    the customer has nothing more to add
  · The customer says "I'll wait for the quote" or similar — they're
    signalling they're done
  · An EMERGENCY OVERRIDE has fired and you've delivered the dispatch
    line — emergency calls should end fast so the tradie can call back

DO NOT call \`endCall\` if:
  · A required question for the job_type's flow is still unanswered
  · The customer is mid-sentence asking something else
  · You haven't yet sent the photo-capture SMS for jobs that need photos
  · The customer just objected or is confused — clarify first, end after

PATTERN: deliver the CLOSING summary line → say the goodbye line from the
\`endCallMessage\` config → invoke \`endCall\` tool. Three steps, in order,
no pausing.`;

// Only append if not already there (idempotent)
const newSystem = existingSystem.includes(terminationMarker)
  ? existingSystem
  : existingSystem + terminationBlock;

const promptUpdated = newSystem !== existingSystem;
console.log(`      System prompt: ${promptUpdated ? "appending CALL TERMINATION block" : "already has CALL TERMINATION block"}`);

// ─── 5. PATCH the assistant ─────────────────────────────────────────
console.log(`\n[3/5] PATCHing assistant with new config...\n`);

const payload = {
  endCallMessage,
  endCallPhrases,
  silenceTimeoutSeconds,
  maxDurationSeconds,
  messagePlan,
  model: {
    ...a.model,
    tools,
    messages: [
      // Replace the system message with the new one (which may contain the new block)
      { role: "system", content: newSystem },
      // Preserve any other messages (rare, but safe)
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

// ─── 6. Verify ──────────────────────────────────────────────────────
console.log(`[4/5] Verifying...`);
const after = await vapi("GET", `/assistant/${VAPI_ASSISTANT_ID}`);
const v = after.data;

const checks = [
  ["endCallMessage set", !!v.endCallMessage, v.endCallMessage?.slice(0, 50) + "…"],
  ["endCallPhrases populated", Array.isArray(v.endCallPhrases) && v.endCallPhrases.length >= 10, `${v.endCallPhrases?.length ?? 0} phrases`],
  ["silenceTimeoutSeconds set", v.silenceTimeoutSeconds === silenceTimeoutSeconds, `${v.silenceTimeoutSeconds}s`],
  ["maxDurationSeconds set", v.maxDurationSeconds === maxDurationSeconds, `${v.maxDurationSeconds}s`],
  ["endCall tool registered", (v.model?.tools ?? []).some((t) => t.type === "endCall"), "yes"],
  ["system prompt has CALL TERMINATION", v.model?.messages?.[0]?.content?.includes(terminationMarker), "block present"],
];

for (const [name, ok, detail] of checks) {
  console.log(`      ${ok ? "✓" : "✗"} ${name.padEnd(38)} ${detail}`);
}

console.log(`\n[5/5] Summary:`);
console.log(`      ${v.endCallPhrases?.length ?? 0} farewell phrases · ${v.silenceTimeoutSeconds}s silence cap · ${v.maxDurationSeconds}s max duration`);
console.log(`      "${v.endCallMessage}"`);
console.log(`\n✓ Assistant now knows when to end the call.`);
console.log(`  Test by dialling ${process.env.TWILIO_PHONE_NUMBER ?? "+61 7 4518 0330"} and saying "thanks, that's everything" mid-call.\n`);
