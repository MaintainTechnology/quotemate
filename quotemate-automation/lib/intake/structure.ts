import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { IntakeSchema, deriveTradeFromJobType, type Intake } from './schema'

// The structurer's generateObject schema = the canonical intake (minus the
// derived `trade`) PLUS one REQUIRED string holding any product specs the
// caller stated, JSON-encoded. It is REQUIRED on purpose: Anthropic
// generateObject caps OPTIONAL fields at 24 and IntakeSchema is already at
// that limit (see schema.ts), so a required field is the only cap-safe way to
// add capture — and a plain string is a proven shape (an open record is not).
// We parse it server-side into scope.specs.requested_specs below.
//
// R26 / WP5: scope.specs.system_type (electric|gas|heat_pump) is a first-class
// field on the canonical IntakeSchema but is DELIBERATELY OMITTED from the
// generateObject schema here. Adding it as a discrete optional would push the
// schema to 25 optional fields and break generateObject. Instead the model
// emits it inside the REQUIRED requested_specs_json blob (as "system_type" or
// the synonym "energy_source") and we promote it to a typed
// scope.specs.system_type server-side below — the same cap-safe pattern as
// requested_specs. We strip system_type from the specs shape the model sees so
// the optional count stays at exactly 24.
const StructureSpecsSchema = z
  .object({
    color_temp: z.enum(['warm_white', 'cool_white', 'tri_colour', 'unknown']).optional(),
    dimmable: z.boolean().optional(),
    smart: z.boolean().optional(),
    weatherproof: z.boolean().optional(),
    supplied_by: z.enum(['tradie', 'customer']).optional(),
    // system_type intentionally absent — captured via requested_specs_json.
  })
  .optional()
const StructureScopeSchema = IntakeSchema.shape.scope.extend({
  specs: StructureSpecsSchema,
  requested_specs_json: z.string(),
})
const StructureSchema = IntakeSchema.omit({ trade: true }).extend({
  scope: StructureScopeSchema,
})

// Normalise free-text energy-source / system-type wording into the
// scope.specs.system_type enum. Returns undefined for anything we can't
// confidently map — E8: an unrecognised value is NEVER coerced to a guess.
// Pure; exported for unit-testing.
export function normaliseSystemType(raw: unknown): 'electric' | 'gas' | 'heat_pump' | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toLowerCase()
  if (s === '') return undefined
  // Heat pump first — it contains "electric"-adjacent wording and must not be
  // collapsed into plain electric.
  if (s.includes('heat pump') || s.includes('heat_pump') || s === 'heatpump' || s.includes('heat-pump')) {
    return 'heat_pump'
  }
  if (s.includes('gas') || s.includes('lpg') || s.includes('continuous flow') || s.includes('continuous-flow') || s.includes('instant')) {
    return 'gas'
  }
  if (s.includes('electric') || s.includes('storage') || s === 'resistive') return 'electric'
  return undefined
}

// Pull a system_type signal out of the structurer's parsed requested_specs
// map. The model is told to emit it under "system_type"; we also accept the
// long-standing synonym "energy_source" (already used by the SMS slot
// extractor and the requested_specs examples). undefined when neither yields
// a recognised value — the caller then treats hot_water as unknown (E8).
// Pure; exported for unit-testing.
export function deriveSystemType(specs: Record<string, string>): 'electric' | 'gas' | 'heat_pump' | undefined {
  return normaliseSystemType(specs.system_type) ?? normaliseSystemType(specs.energy_source)
}

// Parse the structurer's requested_specs_json blob into a flat string map.
// Robust by construction: any malformed / non-object / non-string-valued input
// degrades to {} and never throws — a capture miss must never break the intake
// or, downstream, trigger a false spec mismatch (degrade-never-block).
export function parseRequestedSpecs(raw: unknown): Record<string, string> {
  if (raw == null) return {}
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (s === '' || s === '{}') return {}
    try {
      obj = JSON.parse(s)
    } catch {
      return {}
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!k) continue
    if (typeof v === 'string') {
      if (v.trim() !== '') out[k] = v.trim()
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v)
    }
    // nested objects / arrays / null are skipped — specs are flat scalars
  }
  return out
}

// Shape the structurer's generateObject returns: the canonical intake minus
// `trade` (we derive it) plus scope.requested_specs_json (we parse it).
type StructuredObject = z.infer<typeof StructureSchema>

// Pure post-processing: turn the model's raw StructureSchema object into the
// canonical intake. Three jobs, all deterministic (no LLM, no DB):
//   1. parse requested_specs_json → scope.specs.requested_specs
//   2. promote a stated hot-water fuel → typed scope.specs.system_type
//      (E8: unknown fuels are NEVER coerced into a guess)
//   3. E8 BACKSTOP — a plumbing hot_water job with no captured system_type
//      is forced to inspection at LOW confidence so no electric/gas/heat-pump
//      assembly is ever fabricated from an unknown fuel.
// Exported for unit-testing; structureIntake() calls this after generateObject.
// Returns the canonical Intake (schema.ts) — finaliseIntake's whole job is to
// turn the model's raw StructureSchema object into a valid intake row.
export function finaliseIntake(object: StructuredObject): Intake {
  // Strip the raw JSON blob and attach the parsed map under scope.specs.
  // Only attach when non-empty so an intake with no stated spec keeps its
  // scope.specs exactly as before (no behaviour change for the common case).
  const { requested_specs_json, ...scopeRest } = object.scope
  const requested_specs = parseRequestedSpecs(requested_specs_json)

  // R26 / WP5 — promote a stated hot-water system_type into a typed
  // scope.specs.system_type field. The model emits it inside
  // requested_specs_json (system_type or the energy_source synonym) because
  // IntakeSchema is at the 24-optional cap and it has no discrete slot in the
  // generateObject schema. deriveSystemType returns undefined for anything we
  // can't confidently map — E8: an unknown fuel is never coerced to a guess.
  const systemType = deriveSystemType(requested_specs)

  // Merge requested_specs + system_type into scope.specs, dropping the
  // raw blob. specs stays absent when there is genuinely nothing to attach,
  // so a spec-free intake is byte-identical to the old behaviour.
  const mergedSpecs = {
    ...(scopeRest.specs ?? {}),
    ...(Object.keys(requested_specs).length > 0 ? { requested_specs } : {}),
    ...(systemType ? { system_type: systemType } : {}),
  }
  const scope =
    Object.keys(mergedSpecs).length > 0
      ? { ...scopeRest, specs: mergedSpecs }
      : scopeRest

  const trade = deriveTradeFromJobType(object.job_type)

  // ★ E8 BACKSTOP — server-side, deterministic, never trusts the model alone.
  // For a plumbing hot_water job with NO captured system_type, the energy
  // source is unknown. We must NOT guess a fuel (that would ground the quote
  // on the wrong HWS assembly). Force inspection_required=true and drop
  // confidence to LOW with a reason that names the missing field, so the
  // dialog/clarifying layer (R29) can ask for it and, failing that, the job
  // safely escalates rather than fabricating an electric/gas/heat-pump line.
  if (trade === 'plumbing' && object.job_type === 'hot_water' && !systemType) {
    const reason = 'hot_water energy source (electric/gas/heat pump) not stated — cannot select HWS assembly without it'
    // Keep the model's own reason only if it already names the missing fuel;
    // otherwise replace it so the gap is explicit for the dialog/CRM layer.
    const modelReason = (object.confidence_reason ?? '').toLowerCase()
    const alreadyNamesGap =
      modelReason.includes('system_type') ||
      modelReason.includes('energy source') ||
      modelReason.includes('fuel') ||
      (modelReason.includes('hot') && (modelReason.includes('electric') || modelReason.includes('gas') || modelReason.includes('heat pump')))
    return {
      ...object,
      scope,
      trade,
      inspection_required: true,
      confidence: 'LOW' as const,
      confidence_reason: alreadyNamesGap ? object.confidence_reason : reason,
    }
  }

  return { ...object, scope, trade }
}

// v5 multi-trade: caller passes the trade detected from earlier dialog
// signals (SMS extract-slots job_type, or 'electrical' for the voice
// receptionist which is electrical-only). The structurer prompt branches
// on this hint so Opus is grounded in the right trade's vocabulary and
// risk model. If unknown, defaults to electrical (the NSW/NECA pilot).
export type TradeHint = 'electrical' | 'plumbing'

export async function structureIntake(
  transcript: string,
  photoUrls: string[] = [],
  tradeHint: TradeHint = 'electrical',
  modelId = 'claude-opus-4-8',
) {
  // `trade` is required on the canonical IntakeSchema (v5 multi-trade) but
  // omitted from generateObject so Opus doesn't have to classify it. We
  // derive it from the emitted job_type below — see deriveTradeFromJobType.
  // The voice path will almost always resolve to 'electrical' (Vapi pilot
  // is electrical-only); the SMS path can resolve to either trade based on
  // the customer's described issue.
  const isPlumbing = tradeHint === 'plumbing'
  const { object } = await generateObject({
    model: anthropic(modelId),
    schema: StructureSchema,
    maxRetries: 0, // wrapper handles retries with logging — no double-retry
    // Opus 4.7 ignores temperature (extended-thinking model). The AI SDK
    // warns on every call if it's set, so omit it. Determinism comes from
    // strict system grounding + structured output, not from temperature.
    system: `STRICT GROUNDING — non-negotiable, supersedes everything below
1. ONLY extract what the caller said in the transcript or what is
   visibly present in the photos. Never infer from "what jobs like
   this usually involve."
2. NEVER fill optional fields with assumptions. If the caller didn't
   mention it, leave it null/undefined.
3. NEVER invent caller.name, address, suburb, phone, item_count, or
   any access/property field. Empty string is better than a guess.
4. If a required field (caller.name, suburb, job_type) is missing,
   set it to empty string and drop confidence to LOW with a
   confidence_reason that names the missing field explicitly.
5. risks[] is grounded only in actual customer-stated triggers
   (their words: "burning smell", "tripping", "shocked", etc.).
   Do NOT add risks proactively just because a job type "usually" has them.
6. scope.description must quote or closely paraphrase the caller's
   own wording. Do not add details they didn't mention (e.g. don't
   write "warm-white LEDs" if they only said "downlights").
7. NEVER use placeholder strings like "Unknown", "N/A", "TBD",
   "Not provided", or similar. Empty string is the only acceptable
   placeholder. Numbers/booleans should be omitted entirely if not stated.
8. photo_urls is supplied as image attachments — never describe
   imagined photos in scope.description. If no images are attached,
   the photos contain nothing.
9. scope.specs fields are PRICING-CRITICAL. Extract them when the caller
   mentions them, leave them undefined otherwise.
   ${isPlumbing ? 'For PLUMBING jobs, the ELECTRICAL-ONLY spec fields (color_temp, dimmable, smart, weatherproof) are NOT applicable — leave them undefined; that detail goes into scope.description. BUT two structured fields DO apply to plumbing and MUST be captured when stated: scope.specs.supplied_by (who supplies taps/toilets/HWS/etc.) and the hot-water system_type (electric/gas/heat_pump) — see the PLUMBING SPEC CAPTURE block below.' : 'See "SPEC EXTRACTION" section below for explicit per-job_type rules.'}

${isPlumbing ? `TRADE: PLUMBING (QLD/QBCC pilot — v5)
This is a plumbing intake. Auto-quoteable plumbing job_types:
  blocked_drain     — kitchen/bathroom drain blocked, gurgling, slow
  hot_water         — HWS replacement (electric/gas/heat-pump)
  tap_repair        — dripping/leaking tap (washer)
  tap_replace       — new tap or mixer install
  toilet_repair     — running cistern, internals
  toilet_replace    — new toilet suite install

ALWAYS inspection_required=true for these plumbing job_types:
  burst_pipe           — burst/split pipe (access + make-good unknown)
  bathroom_renovation  — rough-in + fit-off, multi-fixture, multi-visit

Map customer language to job_type:
  "drain is blocked" / "slow drain" / "gurgling" / "water sitting in sink"
    → blocked_drain
  "no hot water" / "HWS died" / "hot water unit broken"
    → hot_water
  "dripping tap" / "leaking tap" / "tap washer"
    → tap_repair
  "new tap" / "replace tap" / "kitchen mixer"
    → tap_replace
  "toilet running" / "cistern leaking" / "won't stop filling"
    → toilet_repair
  "new toilet" / "replace toilet"
    → toilet_replace
  "connect gas appliance" / "gas cooktop connection" / "gas stove connection"
    → gas_fitting + inspection_required=false unless they mention gas smell/leak
  "smell gas" / "gas leak" / "smells like gas"
    → gas_fitting + inspection_required=true + urgency=emergency
  "burst pipe" / "pipe burst" / "water everywhere"
    → burst_pipe + inspection_required=true + urgency=emergency
  "bathroom reno" / "renovating bathroom" / "ensuite renovation"
    → bathroom_renovation + inspection_required=true

PLUMBING SPEC CAPTURE — narrow, structured, pricing-critical
The electrical-only spec fields (color_temp, dimmable, smart, weatherproof)
do NOT apply to plumbing — leave them undefined. But the TWO fields below DO
apply to plumbing and you MUST capture them from the caller's own words:

  scope.specs.supplied_by — WP5, applies to plumbing (taps, toilets,
  shower heads, dishwashers, garbage disposals, water filters, gas
  appliances, hot water units, rainwater tanks):
    "I have my own" / "I'll supply" / "I bought it already"
    "I'm providing the unit"                         → 'customer'
    "you supply" / "can you provide" / "we want one"
    "include the unit" / "with a new one"            → 'tradie'
    not mentioned                                    → omit

  HOT-WATER SYSTEM TYPE — for job_type=hot_water, the energy source of the
  unit (electric vs gas vs heat pump) decides WHICH catalogue assembly prices
  the job, so it is the single most pricing-critical fact for a HWS quote.
  Emit it in the REQUIRED requested_specs_json field (it has no discrete
  scope.specs slot) under the key "system_type":
    "electric hot water" / "electric storage" / "element"   → {"system_type":"electric"}
    "gas hot water" / "gas storage" / "continuous flow" /
      "instant gas" / "LPG"                                 → {"system_type":"gas"}
    "heat pump" / "heat-pump HWS" / "Reclaim/Sanden"        → {"system_type":"heat_pump"}
  ★ E8 — NEVER GUESS THE SYSTEM TYPE ★
  If the caller did NOT state the energy source (just "no hot water" / "HWS
  died" / "hot water unit broken" with no fuel mentioned), you MUST:
    - LEAVE system_type OUT of requested_specs_json (do not write a value), AND
    - set inspection_required=true, AND
    - set confidence=LOW with a confidence_reason that names the missing
      hot-water system_type explicitly
      (e.g. "hot_water energy source (electric/gas/heat pump) not stated").
  Do NOT default to electric, gas, or heat pump. Picking a fuel the caller
  never mentioned would ground the quote on the wrong assembly — exactly the
  hallucination class we forbid. An unknown fuel is an inspection, not a guess.
` : `TRADE: ELECTRICAL (NSW/NECA pilot — v3)

SPEC EXTRACTION — populate scope.specs.* from the caller's own words

Each spec field below maps directly into a SQL filter on the materials/
assemblies library at estimation time. Missing a spec means the
estimation engine has to guess the SKU — which is exactly the
hallucination class we are trying to eliminate.

  scope.specs.color_temp — only for downlights / outdoor_lighting
    "warm white" / "yellow light" / "soft white"  → 'warm_white'
    "cool white" / "daylight" / "white"            → 'cool_white'
    "tri-colour" / "tri colour" / "colour change"  → 'tri_colour'
    caller didn't mention                          → omit (undefined)

  scope.specs.dimmable — for downlights / fans / lighting
    "dimmable" / "I can dim" / "want a dimmer"     → true
    explicitly NOT dimmable                        → false
    not mentioned                                  → omit

  scope.specs.smart — for downlights / GPOs / fans / outdoor_lighting
    "smart" / "Wi-Fi" / "app-controlled" / "Alexa"
    "Google Home" / "smart home" / "remote app"    → true
    "no smart" / "just basic"                      → false
    not mentioned                                  → omit

  scope.specs.weatherproof — for GPOs / outdoor lights
    "outdoor" + "weatherproof" / "IP-rated" / "IP56"
    "exposed to weather" / "uncovered"             → true
    "covered area" / "indoor"                      → false
    not mentioned but indoor_outdoor='outdoor'     → true (implicit)
    not mentioned                                  → omit

  scope.specs.supplied_by — WP5, for ANY job where the customer may
  supply the fitting themselves: ceiling fans, ovens, cooktops, EV
  chargers, bathroom exhaust fans, LED strip, flood lights, doorbells/
  intercoms, security cameras
    "I have my own" / "I'll supply" / "I bought"   → 'customer'
    "I'm providing the X" / "already got one"      → 'customer'
    "you supply" / "can you provide" / "include"   → 'tradie'
    not mentioned                                  → omit

  Brand preferences (e.g. "Clipsal Iconic", "HPM", "Beacon Lucci") and
  access notes go in scope.description verbatim — they're not separate
  structured fields but the estimation engine reads scope.description
  when narrowing the lookup.
`}
REQUESTED_SPECS — required output field scope.requested_specs_json
Emit a COMPACT JSON object STRING of any concrete product specs the caller
stated in their own words, so the exact spec they asked for is never lost
(this captures specs the discrete fields above cannot — e.g. amperage).
Use lowercase snake_case keys. Examples:
  "15 amp point" / "15A"               → {"amperage":"15A"}
  "weatherproof outdoor GPO" / "IP56"  → {"ip_rating":"IP56"}
  "250 litre gas hot water"            → {"system_type":"gas","litres":"250"}
  "heat pump hot water"                → {"system_type":"heat_pump"}
  "electric storage hot water"         → {"system_type":"electric"}
  "double power point"                 → {"poles":"double"}
Combine multiple specs into one object. If the caller stated NO concrete
product spec, emit exactly "{}". NEVER invent a spec they didn't say. This is
a REQUIRED field — always output it (use "{}" when empty).

CONFIDENCE RUBRIC — apply uncompromisingly
  HIGH:    every required field captured, scope.item_count known,
           access fields populated when relevant, no ambiguity
  MEDIUM:  required fields captured but a key access/access detail
           or item_count is missing
  LOW:     any required field empty, OR job_type='other', OR
           scope.description shorter than ~10 chars, OR caller used
           placeholder language (${isPlumbing ? '"just need a plumber"' : '"just need an electrician"'})

You extract structured intake data from ${isPlumbing ? 'plumbing' : 'electrical'} quoting calls.
Be conservative — if unsure, leave fields blank and lower confidence.

${isPlumbing ? `Surface real risks (only when the caller's own words trigger them):
- "smell gas" / "gas leak" → inspection_required=true, urgency=emergency, risks=["suspected gas leak"]
- "burst pipe" / "water everywhere" / "water through ceiling" → inspection_required=true, urgency=emergency
- "sewage backing up" / "raw sewage" → inspection_required=true, urgency=emergency
- water damage to walls/ceiling/floor → add to risks + inspection_required=true
- pre-1970 properties → flag galvanised pipework / lead solder risk on supply lines
- pipe under concrete slab / behind tile → inspection_required=true (access unknown)
- whole-property re-pipe / bathroom rough-in / fit-off → inspection_required=true

Auto-quote candidates (inspection_required=false) when scope is clear:
blocked_drain, hot_water, tap_repair, tap_replace, toilet_repair, toilet_replace,
cctv_inspection (standalone), prv_install (no whole-house re-pipe),
gas_fitting when it is a booked appliance connection with no gas leak/smell.

Always inspection_required=true: gas leak/smell, burst_pipe, bathroom_renovation,
and any plumbing job that mentions hidden pipework, water damage, new/unknown gas
line sizing, or access through concrete/tile.` : `Surface real risks (only when the caller's own words trigger them):
- burning smell, buzzing, sparks → mark inspection_required=true, urgency=emergency
- tripping breakers / recurring faults → inspection_required=false when
  the request is for a diagnostic call-out; repairs are quoted after diagnosis
- water damage near electrical fixtures → add to risks + inspection_required=true
- pre-1970 properties → flag asbestos / lead-paint risk on cabling work
- unknown switchboard age or ceramic fuses → recommend inspection
- difficult access (high ceilings, raked ceilings, no roof access, brick/concrete walls)
- mains, underground cabling, three-phase work → always inspection_required=true

Fault finding / breaker tripping is a priced diagnostic call-out when no
burning, sparks, shock, water, switchboard, mains, or load risk is stated.

Auto-quote candidates (inspection_required=false) when scope is clear and photos look clean:
downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting.

Always inspection_required=true: switchboard, renovation, rewire, mains/underground/
three-phase work, and any oven_cooktop / power_points / outdoor_lighting job that
mentions a new circuit, mains, or switchboard work. EV charger and fault finding
are inspection_required=false when they map to an enabled priced service row and
no explicit safety/load/switchboard risk is stated.`}`,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Transcript:\n${transcript}` },
        ...photoUrls.map(url => ({ type: 'image' as const, image: url })),
      ],
    }],
  })
  // All post-processing (requested_specs parse, system_type promotion, the
  // E8 hot_water backstop, and trade derivation) lives in the pure
  // finaliseIntake() helper above so it is unit-testable without the SDK.
  return finaliseIntake(object as unknown as StructuredObject)
}
