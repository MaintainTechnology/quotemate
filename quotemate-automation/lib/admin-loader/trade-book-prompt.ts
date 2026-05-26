// Trade-book extraction — prompt + Zod schema (pure, no I/O).
//
// Sent to mt-filestore-kb's POST /v1/search endpoint against an
// already-indexed tradie work-instruction manual / pricing guide. The
// prompt asks Gemini to walk the document and extract every install or
// repair service it describes, returning a structured JSON array that
// matches the live shared_assemblies + shared_materials schema as of
// migration 067 (row_assumptions / always_inspection / inspection_triggers
// columns added).
//
// Pure: this module has no I/O, no env, no DB. It exports the prompt
// builder and the Zod schemas + a parser that handles real-world raw
// model output (handling code fences, leading/trailing prose, mixed
// valid/invalid rows). Tests can exercise the whole module without a
// network call. The HTTP client lives in mt-filestore-kb.ts; the
// orchestrator in trade-book-extract.ts.

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

/** A single material referenced by an extracted service. */
export const ExtractedMaterialSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  unit_price_ex_gst: z.number().positive(),
})
export type ExtractedMaterial = z.infer<typeof ExtractedMaterialSchema>

/** One extracted service row — maps 1:1 to a shared_assemblies row. */
export const ExtractedServiceSchema = z.object({
  trade: z.enum(['electrical', 'plumbing', 'carpentry', 'hvac', 'solar', 'painting', 'locksmith']),
  name: z.string().min(3).max(120),
  description: z.string().optional().nullable(),
  category: z.string().min(1).max(40),
  default_unit: z.enum(['each', 'hr', 'lm', 'metre']),
  default_unit_price_ex_gst: z.number().nonnegative(),
  default_labour_hours: z.number().nonnegative(),
  default_exclusions: z.string().optional().nullable(),
  clarifying_questions: z.array(z.string().min(1)).max(8).optional().default([]),
  row_assumptions: z.record(z.string(), z.unknown()).optional().default({}),
  inspection_triggers: z.array(z.string().min(1)).max(20).optional().default([]),
  properties: z.record(z.string(), z.unknown()).optional().default({}),
  always_inspection: z.boolean().optional().default(false),
  materials: z.array(ExtractedMaterialSchema).optional().default([]),
  source_citation: z.string().min(1),
})
export type ExtractedService = z.infer<typeof ExtractedServiceSchema>

/** Top-level response — a flat array of services. */
export const ExtractedServicesSchema = z.array(ExtractedServiceSchema)
export type ExtractedServices = z.infer<typeof ExtractedServicesSchema>

/** Per-row parse error returned alongside the valid rows. */
export type ExtractionError = {
  index: number
  row: unknown
  issues: string[]
}

export type ParseExtractionResult = {
  rows: ExtractedService[]
  errors: ExtractionError[]
  /** True when at least one row parsed cleanly. False when the response
   *  was so malformed nothing usable came out. */
  hasRows: boolean
}

// ─────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────

export type PromptOptions = {
  /** Optional trade hint — when present, the prompt asks Gemini to
   *  prefer this trade when extracting. Falls back to "extract any
   *  trade you find" when undefined. */
  trade?: string
}

const SCHEMA_HINT = `{
  "trade": "electrical | plumbing | carpentry | hvac | solar | painting | locksmith",
  "name": "Short service name, e.g. 'Install LED downlight (new install)'",
  "description": "1-2 sentence summary of the work",
  "category": "downlight | gpo | smoke_alarm | hot_water | drain | tap | toilet | fan | outdoor_light | strip_light | gas | rcbo | oven_cooktop | ev_charger | security_camera | doorbell_intercom | fault_find | switchboard | cctv | prv | dishwasher | rainwater_tank | water_filter | leak_detection | shower | sundry",
  "default_unit": "each | hr | lm | metre",
  "default_unit_price_ex_gst": 35.00,
  "default_labour_hours": 1.75,
  "default_exclusions": "What is explicitly NOT included",
  "clarifying_questions": ["Question 1 the dialog must ask", "Question 2"],
  "row_assumptions": {
    "switch_within_metres": 5,
    "max_storeys": 1,
    "roof_access_required": true
  },
  "inspection_triggers": ["raked ceiling", "multi-storey", "asbestos"],
  "properties": { "weatherproof": false, "new_install": true },
  "always_inspection": false,
  "materials": [
    { "name": "LED downlight 9W warm white", "brand": "Clipsal", "unit_price_ex_gst": 28.00 }
  ],
  "source_citation": "Page N, Section Y 'Title of the section'"
}`

export function buildExtractionPrompt(opts: PromptOptions = {}): string {
  const tradeHint = opts.trade
    ? `\nThis document is for a ${opts.trade} tradie. Prefer trade="${opts.trade}" unless a service is clearly out of scope.`
    : ''
  return `You are extracting structured pricing data from a tradie's work-instruction manual or pricing guide.${tradeHint}

For EVERY install or repair service the document describes, return one JSON object matching this schema:

${SCHEMA_HINT}

RULES:
  1. Return a flat JSON array. No prose, no markdown code fences — JUST the array.
  2. Include source_citation pointing back to the PDF page and section where you found each service.
  3. default_labour_hours is the labour PER UNIT (e.g. per downlight, per GPO, per HWS install). Setup time goes in default_exclusions if it's flat-rate.
  4. row_assumptions: ONLY include fields the document explicitly states. Do not invent constraints. Common keys when present: switch_within_metres, max_storeys, roof_access_required, ceiling_type_required, existing_circuit_required, labour_basis (1-line description).
  5. inspection_triggers: list of customer-side phrases that should escalate THIS service to a site visit (e.g. "raked ceiling", "no roof access", "two storey", "pre-1970", "asbestos"). Pull from the document's "Escalate if..." or "Inspection required when..." sections.
  6. always_inspection: true ONLY when the document says the service requires certified compliance / on-site assessment for every job (e.g. gas appliance connection per AS/NZS 5601).
  7. clarifying_questions: questions the dialog must ask before quoting. Pull from the document's "Always confirm with customer" or "Ask first" sections, if any.
  8. materials: list the specific parts the document mentions per service. Brand is optional. unit_price_ex_gst is the document's stated price.
  9. If a service appears multiple times in the document, return ONE row consolidating the labour + materials.
  10. If a field isn't mentioned in the document, OMIT it (or use [] / {} for collections). Never invent values.

OUTPUT: pure JSON array. No explanation before or after.`
}

// ─────────────────────────────────────────────────────────────────────
// Defensive parser
// ─────────────────────────────────────────────────────────────────────

/** Strip the common ways models wrap JSON: triple backticks with or
 *  without a `json` language tag, leading/trailing prose, BOM, etc. */
export function unwrapModelJson(raw: string): string {
  let s = raw.trim()
  // Strip UTF-8 BOM if present.
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1)
  // Strip a leading ```json or ``` fence + matching trailing ```
  const fenceMatch = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenceMatch) return fenceMatch[1].trim()
  // Strip a leading ```json or ``` only (unclosed) — defensive
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
  // If there's still prose around a JSON array/object, slice from first [ or {
  // to the matching last ] or }. Cheap heuristic that handles "Here's the
  // JSON: [...]" style outputs.
  const firstBracket = s.search(/[[{]/)
  const lastBracketArr = s.lastIndexOf(']')
  const lastBracketObj = s.lastIndexOf('}')
  const lastBracket = Math.max(lastBracketArr, lastBracketObj)
  if (firstBracket > 0 && lastBracket > firstBracket) {
    s = s.slice(firstBracket, lastBracket + 1)
  }
  return s.trim()
}

/** Parse a raw model response into validated rows. Tolerates code fences,
 *  prose wrappers, and mixed valid/invalid entries — bad rows are
 *  collected into `errors` and the good rows still come back. */
export function parseExtractionResponse(raw: string): ParseExtractionResult {
  const unwrapped = unwrapModelJson(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapped)
  } catch (e: any) {
    return {
      rows: [],
      errors: [{ index: -1, row: raw, issues: [`response is not valid JSON: ${e?.message ?? String(e)}`] }],
      hasRows: false,
    }
  }

  // Tolerate either an array or a single object (treat single as 1-item array).
  let candidates: unknown[]
  if (Array.isArray(parsed)) {
    candidates = parsed
  } else if (parsed && typeof parsed === 'object') {
    // Some models wrap in { services: [...] } or { results: [...] }. Try common keys.
    const obj = parsed as Record<string, unknown>
    const wrapper = obj.services ?? obj.results ?? obj.rows ?? obj.data
    if (Array.isArray(wrapper)) {
      candidates = wrapper
    } else {
      candidates = [parsed]
    }
  } else {
    return {
      rows: [],
      errors: [{ index: -1, row: parsed, issues: ['response is not an object or array'] }],
      hasRows: false,
    }
  }

  const rows: ExtractedService[] = []
  const errors: ExtractionError[] = []

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const result = ExtractedServiceSchema.safeParse(c)
    if (result.success) {
      rows.push(result.data)
    } else {
      const issues = result.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`)
      errors.push({ index: i, row: c, issues })
    }
  }

  return { rows, errors, hasRows: rows.length > 0 }
}
