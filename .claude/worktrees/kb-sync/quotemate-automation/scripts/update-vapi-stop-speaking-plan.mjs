// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Tune the Vapi assistant's Stop Speaking Plan
//
// Sets the interruption-handling parameters to values tuned for
// Australian homeowner-to-electrician conversations.
//
// Usage:  node --env-file=.env.local scripts/update-vapi-stop-speaking-plan.mjs
// ═══════════════════════════════════════════════════════════════════

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error("Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env.local");
  process.exit(1);
}

const stopSpeakingPlan = {
  numWords: 2,           // customer must say 2 words before AI stops talking
  voiceSeconds: 0.3,     // 0.3 sec of voice activity before triggering interruption
  backoffSeconds: 1.5,   // 1.5 sec wait after interruption before AI resumes
};

console.log("\n→ Updating Stop Speaking Plan");
console.log(`  numWords:        ${stopSpeakingPlan.numWords}     (was 0 — filter brief filler)`);
console.log(`  voiceSeconds:    ${stopSpeakingPlan.voiceSeconds}   (was 0.2 — filter background noise)`);
console.log(`  backoffSeconds:  ${stopSpeakingPlan.backoffSeconds}   (was 1 — give the customer space)\n`);

const res = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${VAPI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ stopSpeakingPlan }),
});

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = text; }

if (!res.ok) {
  console.error(`✗ Failed: HTTP ${res.status}`);
  console.error(typeof data === "string" ? data : JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log("✓ Stop Speaking Plan updated.");
console.log(`  Assistant: ${data.name} (${data.id})`);
console.log(`  Plan now: ${JSON.stringify(data.stopSpeakingPlan)}\n`);
