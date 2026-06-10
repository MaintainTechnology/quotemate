// Quick one-shot: dump the FULL system prompt so we can see what to trim.
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const r = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
  headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
});
const a = await r.json();
const sys = a.model?.messages?.find((m) => m.role === "system")?.content ?? "";
console.log(`First message: ${a.firstMessage}\n`);
console.log(`--- SYSTEM PROMPT (${sys.length} chars) ---`);
console.log(sys);
