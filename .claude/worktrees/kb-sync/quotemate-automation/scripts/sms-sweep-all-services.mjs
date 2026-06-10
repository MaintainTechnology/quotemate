// Build the per-service test prompt list and emit a manifest the runner
// will consume. Read-only DB pass — no SMS sent yet.
//
// One customer-style prompt per row in shared_assemblies, scoped to
// (trade='electrical' or 'plumbing'). Prompts deliberately:
//   1. Use natural customer wording (NOT the assembly's exact name)
//   2. Include a unique TEST_ID prefix so replies can be matched back
//   3. Hint at scope (count, room, suburb) to give the AI something to
//      slot-extract and to trigger the mandated clarifying questions

import pg from "pg";
import { writeFileSync } from "node:fs";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

// Customer-style phrasings keyed by the assembly's `name` column. If a
// service has no mapping below we fall back to a generic phrasing.
const PHRASINGS = {
  // ── ELECTRICAL ────────────────────────────────────────────────
  "Install LED downlight": "Need a quote for installing 6 LED downlights in the kitchen ceiling.",
  "Replace double GPO": "Replace 2 double power points in the bedroom — like-for-like.",
  "Install customer-supplied ceiling fan": "We have 3 ceiling fans we bought and need an electrician to install them.",
  "Hardwire 240V smoke alarm": "Need 4 hardwired smoke alarms installed in a 3-bedroom unit.",
  "Install outdoor IP-rated LED light": "Quote for 2 weatherproof LED wall lights on the back deck.",
  "Supply + install AC ceiling fan": "Can you supply and install a ceiling fan in our bedroom?",
  "Install premium DC fan with wall control": "Want a premium DC ceiling fan with wall switch fitted in the lounge.",
  "Install oven (existing wiring)": "Plug-in wall oven that needs hard-wiring — circuit already runs to the spot.",
  "Install cooktop (existing wiring)": "New cooktop swap onto the existing cooktop circuit.",
  "Diagnostic call-out (fault finding)": "Half the power points in my kitchen stopped working — need someone to find the fault.",
  "Hardwire oven": "Need a sparky to hardwire a wall oven we're installing.",
  "Hardwire induction cooktop": "Installing a new 90cm induction cooktop, needs hardwiring.",
  "Install aircon power point": "Need a new dedicated power point for a split-system aircon head unit.",
  "Install EV charger": "Quote for a 7kW home EV charger install — Tesla Wall Connector.",
  "Install bathroom exhaust fan": "Bathroom exhaust fan needs replacing — ducted to the eave.",
  "Install outdoor IP-rated GPO": "Need an outdoor weatherproof power point on the back patio wall.",
  "Install LED strip lighting": "Want about 8 metres of LED strip lighting under the kitchen overheads.",
  "Install wired doorbell or intercom": "Old wired doorbell stopped working — want a replacement or intercom.",
  "Install security camera (single)": "Quote to install a single PoE camera at the front entry.",
  "Install motion sensor flood light": "Need a motion sensor floodlight installed over the garage.",

  // ── PLUMBING ──────────────────────────────────────────────────
  "Hand rod blocked drain": "Kitchen sink drain is blocked, water's not going down at all.",
  "Jet blast blocked drain": "Backyard stormwater drain has been blocked for weeks — probably tree roots.",
  "Install electric HWS": "Need to replace our old electric hot water system — 250L.",
  "Install gas HWS": "Gas hot water unit died, need a new one installed.",
  "Install heat pump HWS": "Looking at swapping to a heat pump hot water system, possible rebate eligible.",
  "Tap washer replacement": "Kitchen tap is dripping constantly — washer probably gone.",
  "Tap replacement": "Bathroom basin mixer needs replacing.",
  "Toilet cistern repair": "Toilet keeps running and won't stop filling.",
  "Toilet suite install": "Buying a new toilet suite — need it installed, old one removed.",
  "CCTV drain inspection": "Need a camera inspection of the drain before settlement.",
  "Gas appliance connection": "Have a new gas cooktop arriving, need it connected to existing gas line.",
  "Pressure reduction valve install": "Water pressure is way too high, getting water hammer — need a PRV.",
  "Disposal and site cleanup": "When you replace the toilet, need to take the old one away.",
  "Install dishwasher": "Need a new dishwasher plumbed in under the kitchen sink.",
  "Install rainwater tank": "Got a 2000L rainwater tank to connect to the downpipe.",
  "Install whole-house water filter": "Want a whole house water filter installed at the mains.",
  "Install external garden tap": "Need a new garden tap installed on the side of the house.",
  "Install washing machine taps": "Washing machine taps are leaking, need them replaced.",
  "Install garbage disposal": "Want a sink garbage disposal unit fitted under the kitchen.",
  "Replace shower head": "Just need the shower head swapped for a new one.",
  "Replace toilet seat": "Toilet seat is cracked, need a new soft-close fitted.",
  "Stormwater drain unblock": "Stormwater drain in the backyard is blocked again, water pooling.",
  "Leak detection": "Wet patch under the bathroom floor — need someone to find the leak.",
};

try {
  await c.connect();
  const { rows: services } = await c.query(`
    select id, trade, name, category, default_unit, default_unit_price_ex_gst, default_labour_hours,
           default_enabled, clarifying_questions
      from shared_assemblies
      where trade in ('electrical', 'plumbing')
      order by trade, name`);

  const manifest = services.map((s, i) => {
    const testId = `T${String(i + 1).padStart(3, "0")}`;
    const phrasing = PHRASINGS[s.name] ?? `Need a quote for: ${s.name.toLowerCase()}.`;
    const prompt = `[${testId}] NEW JOB - ${phrasing}`;
    const q = Array.isArray(s.clarifying_questions) ? s.clarifying_questions.length : 0;
    return {
      test_id: testId,
      trade: s.trade,
      service_name: s.name,
      category: s.category,
      default_enabled: s.default_enabled,
      mandated_questions: q,
      prompt,
    };
  });

  console.log(`Built ${manifest.length} test prompts:`);
  for (const m of manifest)
    console.log(`  ${m.test_id} [${m.trade.padEnd(10)}] ${m.service_name.padEnd(42)} (qs=${m.mandated_questions}) `);

  writeFileSync(
    "scripts/sms-sweep-manifest.json",
    JSON.stringify(manifest, null, 2),
  );
  console.log(`\nWrote scripts/sms-sweep-manifest.json (${manifest.length} prompts).`);
  console.log(`Next: scripts/sms-sweep-runner.mjs --apply to actually send.`);
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
