// ═══════════════════════════════════════════════════════════════════
// AI preview prompts — flexible, customer-driven systemInstruction.
//
// The systemInstruction for every Gemini call is built from data
// captured across the SMS conversation + intake structuring + quote
// estimation. The TEMPLATE is hardcoded scaffolding; every VALUE
// (count, job type, customer name, products, etc.) is interpolated
// at runtime from the database rows, so the same template handles
// downlights / ceiling fans / GPOs / smoke alarms / outdoor lighting
// (and any future job type) with zero per-job branching.
//
// Inputs (assembled by generate.ts and samples.ts):
//   · intake       — the IntakeSchema row (customer's verbatim words,
//                    structured slots, caller, access, property, etc.)
//   · quote        — the estimator's draft (scope_of_works,
//                    assumptions, selected_tier, needs_inspection)
//   · lineItems    — quote_line_items filtered to the selected tier
//                    (gives us the SPECIFIC product names)
//   · corrections  — slot names the customer corrected mid-SMS
//                    (high-signal preferences they cared enough to fix)
//
// Output: { system, user } pair. systemInstruction holds the brief;
// user message is minimal ("Generate the image now…") plus the
// reference photo when present.
// ═══════════════════════════════════════════════════════════════════

// ─── Input types ───

export type PromptIntake = {
  job_type: string
  scope?: {
    item_count?: number | null
    is_new_install?: boolean | null
    existing_wiring?: boolean | null
    indoor_outdoor?: 'indoor' | 'outdoor' | 'both' | 'unknown' | null
    description?: string | null
    specs?: {
      color_temp?: 'warm_white' | 'cool_white' | 'tri_colour' | 'unknown' | null
      dimmable?: boolean | null
      smart?: boolean | null
      weatherproof?: boolean | null
      supplied_by?: 'tradie' | 'customer' | null
    } | null
  } | null
  access?: {
    roof_access?: boolean | null
    ceiling_type?: 'flat' | 'raked' | 'high' | 'unknown' | null
    wall_type?: 'plaster' | 'brick' | 'concrete' | 'tile' | 'unknown' | null
  } | null
  property?: {
    bedrooms?: number | null
    levels?: number | null
  } | null
  caller?: { name?: string | null } | null
  timing?: {
    urgency?: 'emergency' | 'this_week' | 'this_month' | 'flexible' | null
  } | null
}

export type PromptQuote = {
  selected_tier?: 'good' | 'better' | 'best' | null
  scope_of_works?: string | null
  assumptions?: string[] | null
  needs_inspection?: boolean | null
}

export type PromptLineItem = {
  tier: string
  description: string
  quantity?: number | null
  source?: string | null // 'material' | 'labour' | 'call_out'
  // WP4 — the operator catalogue product this line was priced from.
  // image_path is the real product photo passed to Gemini as the
  // "match this EXACT product" reference.
  catalogue_id?: string | null
  image_path?: string | null
  // Operator's own catalogue blurb for this product — fed to Gemini as
  // explicit "what the product IS" context alongside the photo.
  product_description?: string | null
}

export type PromptCorrection = {
  slot: string          // e.g. 'count', 'suburb', 'colour'
  finalValue: string    // the value after the correction
}

export type PromptContext = {
  intake: PromptIntake
  quote?: PromptQuote | null
  lineItems?: PromptLineItem[] | null
  corrections?: PromptCorrection[] | null
}

export type SystemUserPrompt = {
  system: string
  user: string
}

// ─── Helpers ───

function humaniseJobType(jobType: string): { plural: string; singular: string } {
  const plural = (jobType ?? '').replace(/_/g, ' ').trim() || 'fittings'
  const singular = /ss$/i.test(plural) ? plural : plural.replace(/s$/i, '')
  return { plural, singular }
}

// ── Fix #2 — sensible single-item defaults ──────────────────────────
// Inherently single-item job types: customers rarely state "1" out loud
// ("fix my hot water" not "1 hot water unit"). For these, fall back to
// count=1 so the IG prompt still emits a "Render exactly N" line. The
// count VALUE here is a per-job-type CONFIG default — never a per-customer
// hard-code. Customer-stated counts always win over these defaults.
//
// Excludes variable-count jobs (gas_fitting, bathroom_renovation) and
// jobs that always go to inspection (switchboard, oven_cooktop,
// fault_finding) — those don't typically reach the IG path.
const SINGLE_ITEM_DEFAULT_COUNT: Record<string, number> = {
  hot_water: 1,
  blocked_drain: 1,
  tap_repair: 1,
  tap_replace: 1,
  toilet_repair: 1,
  toilet_replace: 1,
  burst_pipe: 1,
  prv_install: 1,
  ev_charger: 1,
}

// ── Per-job-type display nouns (singular / plural agreement) ────────
// job_type names mix "thing installed" (downlights) with "action" (tap_repair).
// For the count enforcement line we want the THING noun, agreeing with count.
const JOB_NOUN: Record<string, { singular: string; plural: string }> = {
  // electrical
  downlights:        { singular: 'downlight',                    plural: 'downlights' },
  smoke_alarms:      { singular: 'smoke alarm',                  plural: 'smoke alarms' },
  power_points:      { singular: 'power point',                  plural: 'power points' },
  ceiling_fans:      { singular: 'ceiling fan',                  plural: 'ceiling fans' },
  outdoor_lighting:  { singular: 'outdoor light',                plural: 'outdoor lights' },
  ev_charger:        { singular: 'EV charger',                   plural: 'EV chargers' },
  switchboard:       { singular: 'switchboard',                  plural: 'switchboards' },
  oven_cooktop:      { singular: 'oven / cooktop',               plural: 'ovens / cooktops' },
  fault_finding:     { singular: 'circuit / repair area',        plural: 'circuits / repair areas' },
  renovation:        { singular: 'space',                        plural: 'spaces' },
  // plumbing — render the THING after the action, not the action
  hot_water:         { singular: 'hot water system',             plural: 'hot water systems' },
  blocked_drain:     { singular: 'drain',                        plural: 'drains' },
  tap_repair:        { singular: 'tap',                          plural: 'taps' },
  tap_replace:       { singular: 'tap',                          plural: 'taps' },
  toilet_repair:     { singular: 'toilet',                       plural: 'toilets' },
  toilet_replace:    { singular: 'toilet',                       plural: 'toilets' },
  burst_pipe:        { singular: 'repaired pipe section',        plural: 'repaired pipe sections' },
  gas_fitting:       { singular: 'gas appliance / fitting',      plural: 'gas appliances / fittings' },
  prv_install:       { singular: 'PRV (pressure-reducing valve)', plural: 'PRVs (pressure-reducing valves)' },
  bathroom_renovation: { singular: 'bathroom',                   plural: 'bathrooms' },
  cctv_inspection:   { singular: 'drain section',                plural: 'drain sections' },
}

/** PURE — customer-noun for the job type, agreeing with count. */
export function displayJobNoun(jobType: string, count: number): string {
  const m = JOB_NOUN[jobType]
  if (m) return count === 1 ? m.singular : m.plural
  const h = humaniseJobType(jobType)
  return count === 1 ? h.singular : h.plural
}

// ── Per-job-type room fallback ──────────────────────────────────────
// When detectRoom() finds nothing in the customer's description (common
// for "fix my hot water" / "blocked drain" intakes), pick a sensible
// location word per job type instead of falling back to "space". Keeps
// scene / subject phrasing concrete.
const DEFAULT_ROOM_BY_JOB: Record<string, string> = {
  hot_water:    'utility area (laundry / garage / external wall)',
  ev_charger:   'garage or driveway',
  switchboard:  'switchboard location',
  burst_pipe:   'leak location',
  blocked_drain: 'drain location',
  gas_fitting:  'gas connection point',
  prv_install:  'water mains inlet',
}

/** PURE — sensible room word for the job type when none was detected. */
export function defaultRoomForJobType(jobType: string): string {
  return DEFAULT_ROOM_BY_JOB[jobType] ?? 'space'
}

/**
 * PURE — the count the IG prompt should enforce for a given intake.
 * Order of preference:
 *   1. Customer-stated count from the intake JSON (always wins).
 *   2. Sensible single-item default for this job_type.
 *   3. null → no count enforcement line in the prompt.
 */
export function effectiveItemCount(ctx: PromptContext): number | null {
  const stated = ctx.intake.scope?.item_count
  if (typeof stated === 'number' && stated > 0) return stated
  const jt = ctx.intake.job_type
  if (jt && SINGLE_ITEM_DEFAULT_COUNT[jt] != null) {
    return SINGLE_ITEM_DEFAULT_COUNT[jt]
  }
  return null
}

function colorTempHuman(temp?: string | null): string | null {
  if (!temp || temp === 'unknown') return null
  if (/warm/i.test(temp)) return 'warm white (≈2700K–3000K)'
  if (/cool/i.test(temp)) return 'cool white (≈4000K–5000K)'
  if (/tri/i.test(temp)) return 'tri-colour selectable'
  if (/daylight|natural/i.test(temp)) return 'daylight (≈5000K–6500K)'
  return temp
}

function detectRoom(desc?: string | null): string | null {
  if (!desc) return null
  const m = desc.match(/\b(lounge|living\s*room|kitchen|bedroom|bathroom|dining|study|hallway|garage|deck|patio|courtyard|backyard|laundry|alfresco|ensuite)\b/i)
  return m ? m[1].toLowerCase().replace(/\s+/g, ' ') : null
}

function prefLine(label: string, value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined || value === '' || value === 'unknown') return null
  if (typeof value === 'boolean') return `  · ${label}: ${value ? 'yes' : 'no'}`
  return `  · ${label}: ${value}`
}

function humaniseSlot(slot: string): string {
  return slot.replace(/_/g, ' ')
}

// Per-item ordinal position guidance. Image models drift on counts above
// ~4 because "render 6" is interpreted approximately. Listing each item
// by position ("FIRST: front-left, SECOND: front-centre, ...") forces
// the model to tick a discrete list of slots, which empirically
// improves count accuracy from ~60% to >95% on the 5-10 range.
//
// Returns null when the count is too small to need positioning (1-2)
// or the job_type doesn't have a sensible enumerated layout.
export function ordinalPositions(jobType: string, count: number | null): string[] | null {
  if (count === null || count < 1) return null
  const n = Math.min(count, 12) // cap at 12 — beyond that, listing positions starts to harm rather than help

  const ord = (i: number) =>
    ['FIRST','SECOND','THIRD','FOURTH','FIFTH','SIXTH','SEVENTH','EIGHTH','NINTH','TENTH','ELEVENTH','TWELFTH'][i] ?? `#${i + 1}`

  // Specialised geometric layouts — only for count ≥ 3 on the proven job
  // types. For small counts or unlisted job types, fall through to the
  // generic placement helper below (Fix #3 — adds spatial guidance for
  // ALL job types instead of just 5).
  if (n >= 3) {
    switch (jobType) {
      case 'downlights':
      case 'smoke_alarms': {
        // Even ceiling grid. For 6 downlights = 2 rows × 3, for 8 = 2×4, etc.
        const rows = n <= 4 ? 1 : 2
        const cols = Math.ceil(n / rows)
        const positions: string[] = []
        const rowLabels = ['front', 'middle', 'back']
        const colLabels = ['left', 'centre-left', 'centre', 'centre-right', 'right']
        for (let i = 0; i < n; i++) {
          const r = Math.floor(i / cols)
          const c = i % cols
          const rowName = rows === 1 ? '' : `${rowLabels[r]}-`
          const colName = cols >= 4 ? colLabels[c] : (cols === 3 ? ['left','centre','right'][c] : ['left','right'][c])
          positions.push(`${ord(i)} ${jobType === 'downlights' ? 'downlight' : 'smoke alarm'}: ceiling, ${rowName}${colName}`)
        }
        return positions
      }
      case 'power_points':
        // Along walls, even spacing, ~30cm above skirting.
        return Array.from({ length: n }, (_, i) =>
          `${ord(i)} double GPO: position ${i + 1} of ${n} along the wall, ~30cm above skirting, evenly spaced`,
        )
      case 'ceiling_fans':
        return Array.from({ length: n }, (_, i) =>
          `${ord(i)} ceiling fan: position ${i + 1} of ${n}, one per room area, all visible in frame`,
        )
      case 'outdoor_lighting':
        return Array.from({ length: n }, (_, i) =>
          `${ord(i)} outdoor light: position ${i + 1} of ${n} along the deck/eaves/outdoor wall, evenly spaced`,
        )
    }
  }

  // ── Generic fallback — covers small counts AND every unlisted job type.
  // Replaces the previous "return null" which left the prompt with no
  // spatial guidance for 11 of 16 job types. displayJobNoun gives a
  // grammatically correct count-aware noun ("hot water system" not "hot
  // water", "tap" not "tap repair"). Each ordinal item is a single
  // fitting → always use the singular form for the per-item label.
  const singular = displayJobNoun(jobType, 1)
  if (n === 1) {
    return [
      `The ${singular}: installed at the existing connection / mounting point shown in the source photo if replacing, or the obvious mounting location if a new install. The fitting must be clearly visible and centred in frame.`,
    ]
  }
  return Array.from({ length: n }, (_, i) =>
    `${ord(i)} ${singular}: position ${i + 1} of ${n}, evenly spaced and clearly visible in frame.`,
  )
}

// Anti-drift count block. Wraps the count with multiple reinforcements
// and explicit negative values, which Gemini's image models respond
// to more reliably than a single "render N" instruction.
function buildCountBlock(jobType: string, count: number | null, jobLabel: string): string {
  if (count === null) return ''
  const positions = ordinalPositions(jobType, count)
  const lines: string[] = []
  lines.push(`════════════════════════════════════════════════════════════════`)
  lines.push(`COUNT — RENDER EXACTLY ${count} ${jobLabel.toUpperCase()}.`)
  lines.push(``)
  lines.push(`Not ${count - 1}. Not ${count + 1}. Not ${count + 2}. Not "about ${count}".`)
  lines.push(`Exactly ${count}.`)
  lines.push(``)
  if (positions) {
    lines.push(`PLACEMENT — render each one in the position below. Tick them off as you compose the image:`)
    lines.push(``)
    for (const p of positions) lines.push(`  ☐ ${p}`)
    lines.push(``)
  }
  lines.push(`COUNT VERIFICATION — before emitting, count the ${jobLabel} you've drawn out loud: 1, 2, 3${count > 3 ? `… up to ${count}` : ''}. The total MUST equal ${count}.`)
  lines.push(`If you count ${count - 1}, the image is WRONG — add one more.`)
  lines.push(`If you count ${count + 1}, the image is WRONG — remove one.`)
  lines.push(`════════════════════════════════════════════════════════════════`)
  return lines.join('\n')
}

// Pick the single "anchor product" — the headline item the tradie
// quoted for. Used to enforce visual consistency across all 4 Gemini
// calls (Preview, Wide, Close-up, In-use). Without an anchor, each
// call interprets the spec independently and the 3 sample images
// drift apart (e.g. wide shows wall-faced toilet, close-up shows
// close-coupled).
//
// Selection:
//   1. Filter to material line items in the selected tier
//   2. Exclude sundries (terminals, fittings, tape, seals, etc.)
//   3. Prefer the line whose quantity matches the customer's count
//      (typically the headline product — e.g. "8 × Dimmable IP-rated
//      downlight" when customer asked for 8)
//   4. Otherwise pick the first remaining material
//   5. Return null if no anchor can be derived; the prompt then falls
//      back to the generic job-type label.
function pickAnchorLine(ctx: PromptContext): PromptLineItem | null {
  if (!ctx.lineItems || ctx.lineItems.length === 0) return null
  const tier = ctx.quote?.selected_tier ?? 'better'
  const count = ctx.intake.scope?.item_count ?? null
  // Sundries-detection: the previous regex used \bsundr\b which failed to
  // match "sundries" because more word chars follow. Caught with Anna's
  // toilet_replace test - the anchor picker grabbed "Plumbing sundries"
  // instead of the Caroma Liano toilet suite she was being quoted for.
  // The fixed pattern uses substring matching for the unambiguous sundries
  // keywords and a careful word-boundary check for ambiguous ones.
  const isSundries = (desc: string): boolean =>
    /sundri/i.test(desc) ||                  // sundries / sundry
    /\bseals?\b/i.test(desc) ||              // seal / seals
    /\btape\b/i.test(desc) ||
    /\bclip\b/i.test(desc) ||
    /\bterminal\b/i.test(desc) ||
    /^fittings,/i.test(desc)                 // generic "fittings, ..." line

  const materials = ctx.lineItems.filter(li =>
    li.tier === tier &&
    (li.source === 'material' || !li.source) &&
    !isSundries(li.description)
  )
  if (materials.length === 0) return null
  const matchByCount = count !== null
    ? materials.find(m => m.quantity === count)
    : null
  return matchByCount ?? materials[0]
}

// The headline product NAME (text anchor — unchanged behaviour).
export function pickAnchorProduct(ctx: PromptContext): string | null {
  return pickAnchorLine(ctx)?.description ?? null
}

// WP4 — the headline product's real PHOTO (URL or storage path), when
// the line was linked back to an operator catalogue product. null when
// there's no anchor or no photo (→ today's text-only render, no
// regression). generate.ts / samples.ts resolve the bytes and attach
// it to Gemini as the "match this EXACT product" reference.
export function pickAnchorImagePath(ctx: PromptContext): string | null {
  const a = pickAnchorLine(ctx)
  const p = a?.image_path
  return typeof p === 'string' && p.trim() !== '' ? p.trim() : null
}

// WP4 — the anchor product's operator-written blurb (e.g. "Firefly Pro
// Series LED bulb, E27, frosted, warm white"). Surfaced in the render
// directive + anchor block so Gemini knows WHAT the product is, not
// just how it looks from the photo. null when there's no blurb.
export function pickAnchorDescription(ctx: PromptContext): string | null {
  const a = pickAnchorLine(ctx)
  const d = a?.product_description
  return typeof d === 'string' && d.trim() !== '' ? d.trim() : null
}

// ─── RENDER DIRECTIVE — declarative key/value block ───
// Sits between MASTER RULES and the narrative context. The whole point
// is to expose every customer-specific JSON value Gemini needs as a
// flat, unambiguous list — no prose to parse, no narrative for the
// model to drift in. Empirically this dramatically reduces "the model
// missed the count / wrong room / picked the wrong product" failures.
//
// Every value below is interpolated from the database row for THIS
// customer's quote. The KEYS are scaffolding (fixed); the VALUES are
// 100% dynamic.
type RenderShot = {
  /** Plain English label for view_type field (e.g. "WIDE-ANGLE OVERVIEW"). */
  role: string
  /** 'edit_customer_photo' when the user message includes a reference
   *  photo we want Gemini to edit. 'text_to_image' for pure generation. */
  mode: 'edit_customer_photo' | 'text_to_image'
}

function buildRenderDirective(ctx: PromptContext, shot: RenderShot): string {
  const { intake, quote } = ctx
  const desc = (intake.scope?.description ?? '').trim()
  const callerName = intake.caller?.name?.trim() || null
  const room = detectRoom(desc)
  const { plural: jobLabelPlural } = humaniseJobType(intake.job_type)
  const count = (intake.scope?.item_count && intake.scope.item_count > 0)
    ? intake.scope.item_count
    : null
  const specs = intake.scope?.specs ?? {}
  const access = intake.access ?? {}
  const trade = (intake as { trade?: string }).trade ?? null
  const anchor = pickAnchorProduct(ctx)
  const anchorDesc = pickAnchorDescription(ctx)
  const tier = quote?.selected_tier ?? null

  // Helper: emit a "key: value" line only when value is meaningful.
  const kv = (key: string, value: unknown): string | null => {
    if (value === null || value === undefined || value === '' || value === 'unknown') return null
    if (typeof value === 'boolean') return `  ${key.padEnd(26)} ${value ? 'yes' : 'no'}`
    return `  ${key.padEnd(26)} ${value}`
  }

  // Map the booleans into plain-English values so Gemini doesn't
  // misinterpret "true" as a string token.
  const installType =
    intake.scope?.is_new_install === true ? 'new install'
    : intake.scope?.is_new_install === false ? 'replacing existing'
    : null

  const directiveLines = [
    // ── How to read the user message ──
    kv('render_mode:',           shot.mode),
    kv('reference_photo:',       shot.mode === 'edit_customer_photo' ? 'ATTACHED in user message' : 'not attached'),
    kv('view_type:',             shot.role),

    // ── Customer identity ──
    kv('customer_name:',         callerName),
    kv('trade:',                 trade),

    // ── What to render ──
    kv('job_type:',              intake.job_type),
    kv('quantity:',              count),
    kv('product_to_render:',     anchor),
    kv('product_details:',       anchorDesc),
    kv('selected_tier:',         tier),

    // ── Where ──
    kv('room:',                  room),
    kv('indoor_outdoor:',        intake.scope?.indoor_outdoor),

    // ── Install state ──
    kv('install_type:',          installType),
    kv('existing_wiring:',       intake.scope?.existing_wiring),

    // ── Product spec ──
    kv('colour_temp:',           colorTempHuman(specs.color_temp)),
    kv('dimmable:',              specs.dimmable),
    kv('smart_wifi:',            specs.smart),
    kv('weatherproof:',          specs.weatherproof),
    kv('supplied_by:',           specs.supplied_by),

    // ── Surface ──
    kv('ceiling_type:',          access.ceiling_type),
    kv('wall_type:',             access.wall_type),

    // ── Customer's own words ──
    kv('verbatim_customer:',     desc ? `"${desc.slice(0, 300)}"` : null),
  ].filter((l): l is string => l !== null)

  const lines: string[] = []
  lines.push(`════════════════════════════════════════════════════════════════`)
  lines.push(`RENDER DIRECTIVE — these are the EXACT values from this customer's quote.`)
  lines.push(`Read each line as "this image MUST honour this value". No interpretation,`)
  lines.push(`no approximation, no substitution.`)
  lines.push(`════════════════════════════════════════════════════════════════`)
  lines.push(``)
  for (const l of directiveLines) lines.push(l)
  lines.push(``)
  lines.push(`HOW TO USE THIS BLOCK:`)
  if (shot.mode === 'edit_customer_photo') {
    lines.push(``)
    lines.push(`  ★ "render_mode" = edit_customer_photo ★`)
    lines.push(`     The user message contains the customer's ACTUAL photo of`)
    lines.push(`     their own ${room ?? 'space'}, attached as inline binary data.`)
    lines.push(`     You are NOT generating from scratch. You are EDITING that`)
    lines.push(`     photo to show the AFTER state — the same room but with`)
    lines.push(`     the proposed work installed.`)
    lines.push(``)
    lines.push(`     RULES for editing:`)
    lines.push(`       · Keep the walls, floor, furniture, decor, perspective,`)
    lines.push(`         camera angle, and lighting from the customer's photo.`)
    lines.push(`       · The ONLY thing that changes is the fixture area.`)
    lines.push(`       · For "install_type: replacing existing" — REMOVE the`)
    lines.push(`         old fittings shown in the photo, install the NEW`)
    lines.push(`         "product_to_render" in their place. The output MUST`)
    lines.push(`         look visibly DIFFERENT from the input photo.`)
    lines.push(`       · For "install_type: new install" — add the new fittings`)
    lines.push(`         in the appropriate position. The space is otherwise`)
    lines.push(`         unchanged.`)
    lines.push(`       · The customer should INSTANTLY recognise their own`)
    lines.push(`         space when they see the output.`)
  } else {
    lines.push(``)
    lines.push(`  ★ "render_mode" = text_to_image ★`)
    lines.push(`     No customer photo is attached. Generate a contemporary`)
    lines.push(`     Australian residential ${room ?? 'space'} from scratch and`)
    lines.push(`     install the "product_to_render" in it. Neutral walls,`)
    lines.push(`     blonde-oak flooring, minimal furniture. Photoreal.`)
  }
  lines.push(``)
  lines.push(`  Other fields:`)
  lines.push(`    · "quantity" — render EXACTLY this many. No more, no fewer.`)
  lines.push(`    · "product_to_render" — render THIS specific product, brand and style.`)
  lines.push(`    · "product_details" — the operator's own description of that EXACT product (material, finish, shape, key features). Render the product to match this.`)
  lines.push(`    · "view_type" — frame the shot for THIS view.`)
  lines.push(`    · "verbatim_customer" — what the customer literally typed. Match it.`)
  lines.push(`    · Any value listed as "yes" / "no" — depict that state in the image.`)
  lines.push(`    · Any field NOT in this directive was NOT specified by the customer.`)
  lines.push(`      Use neutral defaults for those — do NOT invent features.`)
  lines.push(`════════════════════════════════════════════════════════════════`)
  return lines.join('\n')
}

// ─── The customer-prefs block ───
function buildCustomerPrefsBlock(ctx: PromptContext): string {
  const { intake, quote, lineItems, corrections } = ctx
  const desc = (intake.scope?.description ?? '').trim()
  const callerName = intake.caller?.name?.trim() || null
  const callerLabel = callerName ?? 'the customer'
  const room = detectRoom(desc)
  const { plural: jobLabelPlural, singular: jobLabelSingular } = humaniseJobType(intake.job_type)

  const count = (intake.scope?.item_count && intake.scope.item_count > 0)
    ? intake.scope.item_count
    : null

  const specs = intake.scope?.specs ?? {}
  const access = intake.access ?? {}
  const property = intake.property ?? {}

  const prefLines = [
    prefLine('Job', jobLabelPlural),
    prefLine('Quantity', count),
    prefLine('Room', room),
    prefLine('Indoor or outdoor', intake.scope?.indoor_outdoor),
    prefLine('New install or replacing existing',
      intake.scope?.is_new_install === true ? 'new install'
      : intake.scope?.is_new_install === false ? 'replacing existing'
      : null),
    prefLine('Existing wiring already in place', intake.scope?.existing_wiring),
    prefLine('Colour temperature', colorTempHuman(specs.color_temp)),
    prefLine('Dimmable', specs.dimmable),
    prefLine('Smart / Wi-Fi / app-controlled', specs.smart),
    prefLine('Weatherproof / IP-rated', specs.weatherproof),
    prefLine('Fitting supplied by', specs.supplied_by),
    prefLine('Ceiling type', access.ceiling_type),
    prefLine('Wall type', access.wall_type),
    prefLine('Property bedrooms', property.bedrooms),
    prefLine('Property levels', property.levels),
    prefLine('Customer urgency', intake.timing?.urgency),
  ].filter((l): l is string => l !== null)

  const lines: string[] = []

  // ── Role / framing ──
  const tierLabel = quote?.selected_tier
    ? `, then accepted the tradie's "${quote.selected_tier}"-tier quote`
    : ''
  // v5 multi-trade: derive trade-flavour from intake so the Gemini scene
  // framing matches the right trade (electrical fitting render vs plumbing
  // fixture render). Falls back to "trade" if intake.trade is unset.
  const tradeFlavour =
    (intake as { trade?: string }).trade === 'plumbing' ? 'plumbing'
    : (intake as { trade?: string }).trade === 'electrical' ? 'electrical'
    : 'trade'
  lines.push(`You are rendering an image for ${callerLabel}, a real Australian customer who requested ${tradeFlavour} work via an SMS conversation with the QuoteMate team${tierLabel}. ${callerName ?? 'They'} confirmed every preference below on SMS — your job is to render exactly what ${callerName ?? 'the customer'} asked for, nothing more.`)
  lines.push(``)

  // ── Verbatim customer words ──
  lines.push(`WHAT ${callerName ? callerName.toUpperCase() : 'THE CUSTOMER'} SAID (verbatim from the SMS conversation):`)
  if (desc) {
    lines.push(`  "${desc.slice(0, 600)}"`)
  } else {
    lines.push(`  (no free-text description — see confirmed preferences below)`)
  }
  lines.push(``)

  // ── ANCHOR PRODUCT — visual consistency across all 4 images ──
  const anchor = pickAnchorProduct(ctx)
  const anchorDesc = pickAnchorDescription(ctx)
  if (anchor) {
    lines.push(`════════════════════════════════════════════════════════════════`)
    lines.push(`ANCHOR PRODUCT — render THIS exact product in this image:`)
    lines.push(``)
    lines.push(`   ▶ ${anchor}`)
    if (anchorDesc) {
      lines.push(``)
      lines.push(`   Operator's description of this exact product (render it to match):`)
      lines.push(`   "${anchorDesc.slice(0, 400)}"`)
    }
    lines.push(``)
    lines.push(`This is the SPECIFIC product ${callerName ?? 'the customer'} is being quoted for.`)
    lines.push(`Every image in this 4-image quote set (Preview + Wide sample +`)
    lines.push(`Close-up sample + In-use sample) MUST depict the SAME product —`)
    lines.push(`the one named above. Do not substitute. Do not swap to a generic`)
    lines.push(`alternative. Do not show a different style or model. If the`)
    lines.push(`anchor is "Wall-faced toilet suite (Caroma Liano)", do NOT render`)
    lines.push(`a close-coupled toilet. If the anchor is "Dimmable IP-rated`)
    lines.push(`downlight", do NOT render a plain basic downlight. Match the`)
    lines.push(`exact product name, brand, and style described above.`)
    lines.push(`════════════════════════════════════════════════════════════════`)
    lines.push(``)
  }

  // ── Structured preferences ──
  if (prefLines.length > 0) {
    const possessive = callerName ? `${callerName.toUpperCase()}'S` : `THE CUSTOMER'S`
    lines.push(`${possessive} CONFIRMED PREFERENCES (each one was verified back to ${callerName ?? 'the customer'} via the SMS handshake and they replied "yes, that's right"):`)
    for (const p of prefLines) lines.push(p)
    lines.push(``)
    lines.push(`Any preference NOT listed above was not specified by ${callerName ?? 'the customer'} during the SMS conversation. For those, use neutral defaults — do not invent or imply features ${callerName ?? 'they'} did not ask for.`)
    lines.push(``)
  }

  // ── Customer corrections (high-signal) ──
  if (corrections && corrections.length > 0) {
    lines.push(`PREFERENCES ${callerName ?? 'THE CUSTOMER'} CORRECTED MID-CONVERSATION (they cared enough to fix these — render them precisely):`)
    for (const c of corrections) {
      lines.push(`  · ${humaniseSlot(c.slot)}: customer corrected to "${c.finalValue}"`)
    }
    lines.push(``)
  }

  // ── Quote / estimator context ──
  if (quote && !quote.needs_inspection) {
    const tierPlain = (quote.selected_tier ?? 'better').toUpperCase()
    lines.push(`QUOTE BUILT BY THE ESTIMATOR — selected tier: ${tierPlain}`)
    if (quote.scope_of_works) {
      lines.push(`Scope of works (the estimator's plain-English description of the job):`)
      lines.push(`  "${quote.scope_of_works.slice(0, 500)}"`)
    }
    const materialItems = (lineItems ?? []).filter(li =>
      li.tier === (quote.selected_tier ?? 'better') &&
      (li.source === 'material' || !li.source)
    )
    if (materialItems.length > 0) {
      lines.push(`Specific products to render (from the ${tierPlain} tier line items):`)
      for (const li of materialItems) {
        const qty = li.quantity && li.quantity > 1 ? `${li.quantity} × ` : ''
        lines.push(`  · ${qty}${li.description}`)
      }
    }
    if (quote.assumptions && quote.assumptions.length > 0) {
      lines.push(`Estimator's assumptions (may have visual relevance):`)
      for (const a of quote.assumptions.slice(0, 6)) {
        lines.push(`  · ${a}`)
      }
    }
    lines.push(``)
  }

  // ── Count anchor ──
  if (count !== null) {
    const jobLabel = count === 1 ? jobLabelSingular : jobLabelPlural
    const countBlock = buildCountBlock(intake.job_type, count, jobLabel)
    if (countBlock) {
      lines.push(countBlock)
    }
  }

  return lines.join('\n')
}

// ─── MASTER RULES — top-priority instructions ───
// These come BEFORE the customer-prefs block so they frame how Gemini
// interprets everything below. Numbered to help the model track them.
// Hard imperatives only (MUST / NEVER, not "should"). Every rule has
// an explicit failure-mode statement so the model knows what counts
// as a rejection.
function masterRules(): string {
  return [
    `════════════════════════════════════════════════════════════════`,
    `MASTER RULES — NON-NEGOTIABLE. READ FIRST. APPLY ALWAYS.`,
    `════════════════════════════════════════════════════════════════`,
    ``,
    `You are generating an image for a real Australian customer's`,
    `quote. The instructions below are not guidelines — they are`,
    `hard rules. Violating any one means the output is REJECTED and`,
    `you must redraft.`,
    ``,
    `  1. EXACT COUNT.`,
    `     The image MUST contain exactly the quantity stated in`,
    `     the COUNT line below. Not one more, not one less.`,
    `     FAILURE: image contains a different number of fittings.`,
    ``,
    `  2. EXACT PRODUCT (ANCHOR PRODUCT).`,
    `     The image MUST depict the specific product named in the`,
    `     ANCHOR PRODUCT block below — exact brand, exact style.`,
    `     Do NOT substitute. Do NOT swap to a similar product.`,
    `     Do NOT improvise.`,
    `     FAILURE: wrong product (e.g. close-coupled when anchor is`,
    `     wall-faced, plain LED when anchor is tri-colour, generic`,
    `     basin tap when anchor is a Phoenix wall-mounted mixer).`,
    ``,
    `  2b. PRODUCT REFERENCE PHOTO — REPLICATE IT EXACTLY. HIGHEST`,
    `      PRIORITY when present.`,
    `     If the user message includes a PRODUCT REFERENCE photo (it`,
    `     is explicitly labelled and is the FINAL attached image), that`,
    `     photo is the EXACT real product the customer is being quoted`,
    `     and will receive. The installed/fitted product you render`,
    `     MUST replicate it precisely — same brand, model, shape,`,
    `     colour, finish and proportions. It is NOT a style hint; it`,
    `     is the literal product. Do NOT generalise it to a similar`,
    `     fitting. The customer will visually compare the two.`,
    ``,
    `     ★ OVERRIDE RULE: the product in the reference photo WINS over`,
    `       the generic job-type label and over the COUNT/PLACEMENT`,
    `       blocks below. If the job says "downlights" but the`,
    `       reference photo is (e.g.) a bulb, a pendant, a batten`,
    `       fixture or a panel, you install THAT product's exact form`,
    `       — do NOT fall back to a generic recessed downlight just`,
    `       because the job is labelled "downlights". Honour the count`,
    `       (how many) but the FIXTURE ITSELF must be the reference`,
    `       product, mounted the way that product is actually fitted.`,
    `     FAILURE: a generic fixture is shown when a reference photo`,
    `     was supplied; the rendered fixture's shape/type differs from`,
    `     the reference; the job label overrode the reference product.`,
    ``,
    `  3. CUSTOMER'S OWN WORDS WIN.`,
    `     Where the verbatim SMS or CONFIRMED PREFERENCES specify`,
    `     a value (room, style, colour, finish, count), match it.`,
    `     Where nothing is specified, use neutral defaults — do`,
    `     NOT invent features.`,
    `     FAILURE: adding features the customer didn't ask for`,
    `     (dimmable, smart, weatherproof, premium finishes, etc.).`,
    ``,
    `  4. VIEW TYPE DISCIPLINE.`,
    `     The "Series role" or shot-context line specifies the view`,
    `     type: PREVIEW edit / WIDE / CLOSE-UP / IN-USE-DUSK. Match`,
    `     it precisely. A close-up is NOT a wide; a wide is NOT a`,
    `     close-up. Do not blend.`,
    `     FAILURE: producing a wide when CLOSE-UP was asked,`,
    `     producing a daytime shot when IN-USE-DUSK was asked.`,
    ``,
    `  5. NO PEOPLE / TEXT / LOGOS.`,
    `     No humans, hands, body parts, pets, captions, annotations,`,
    `     brand logos, or text overlays anywhere in the image. The`,
    `     ONLY allowed text is the small approved watermark named`,
    `     in the per-shot context.`,
    `     FAILURE: a person, a hand, text on a wall, a visible`,
    `     brand label, a caption.`,
    ``,
    `  6. PHOTOREALISM + AUSTRALIAN AESTHETIC.`,
    `     Magazine-quality interior photography. Modern Australian`,
    `     residential look. NOT cartoon, NOT illustration, NOT`,
    `     3D-render-looking, NOT staged-stock-photo.`,
    `     FAILURE: cartoonish, plastic-looking, or unrealistic.`,
    ``,
    `  7. PHOTO FIDELITY — PREVIEW EDIT SHOTS ONLY.`,
    `     When the Series role is "PREVIEW edit" and a customer photo`,
    `     is attached, the output MUST be an EDIT of THAT photo —`,
    `     not a freshly-generated lookalike room. Preserve the`,
    `     customer's actual walls, paint colour, flooring, cabinets,`,
    `     furniture, decor, perspective, camera angle, and ambient`,
    `     lighting EXACTLY as in the source image. The ONLY pixels`,
    `     allowed to change are the fittings being installed or`,
    `     replaced. The customer must recognise their own space the`,
    `     moment the image loads.`,
    `     FAILURE: rendering a different room that "looks like" the`,
    `     customer's photo. Changing wall colour, flooring, furniture,`,
    `     or layout. Shifting the camera angle or perspective. Any`,
    `     non-fitting pixel that differs from the source.`,
    `     (This rule does NOT apply to WIDE / CLOSE-UP / IN-USE`,
    `     sample shots — those use the photo as style reference only`,
    `     and may re-frame the room from new angles.)`,
    ``,
    `  8. FINAL OUTCOME — render the JOB COMPLETED.`,
    `     The image MUST depict the install or repair FULLY`,
    `     APPLIED — the after state, day-of-handover, ready`,
    `     for the customer to walk into and use. Show the`,
    `     finished result, NOT work-in-progress, NOT a concept`,
    `     mock-up, NOT a "during install" scene. No tools, no`,
    `     ladders, no exposed wiring or pipes mid-fit, no open`,
    `     packaging or product boxes, no tradies in frame. The`,
    `     room should look like the install was completed`,
    `     yesterday and tidied up.`,
    `     FAILURE: tools in frame, mid-install state, packaging`,
    `     visible, exposed connections still being made, a`,
    `     tradesperson working on the install.`,
    ``,
    `  9. SELF-VERIFY BEFORE EMITTING.`,
    `     Before committing the image, mentally run through every`,
    `     rule above and the FINAL CHECKLIST at the bottom of`,
    `     this prompt. If any single check fails, redraft.`,
    `════════════════════════════════════════════════════════════════`,
  ].join('\n')
}

// ─── Final pre-commit checklist ───
// Sits at the very bottom of the system instruction. Gives the model
// a concrete tick-box loop it can run before emitting the output.
// Empirically this dramatically reduces drift from the brief.
function finalChecklist(ctx: PromptContext): string {
  const count = (ctx.intake.scope?.item_count && ctx.intake.scope.item_count > 0)
    ? ctx.intake.scope.item_count
    : null
  const anchor = pickAnchorProduct(ctx)
  const lines = [
    ``,
    `════════════════════════════════════════════════════════════════`,
    `FINAL CHECKLIST — confirm EVERY box BEFORE emitting the image:`,
    ``,
    count !== null
      ? `  [ ] Count: image contains exactly ${count} ${humaniseJobType(ctx.intake.job_type).plural}.`
      : `  [ ] Count: image matches the quantity stated in this brief.`,
    anchor
      ? `  [ ] Product: image depicts "${anchor}" — correct brand and style.`
      : `  [ ] Product: image depicts the product family stated in the brief.`,
    `  [ ] View type: image matches the Series role (WIDE / CLOSE-UP / IN-USE / PREVIEW edit).`,
    `  [ ] No additions: no features the customer did not request (no premium finishes, no smart features, no IP-rated unless asked).`,
    `  [ ] No people: no humans, hands, pets, body parts anywhere in frame.`,
    `  [ ] No text: no captions, annotations, brand logos, or text — only the approved small watermark.`,
    `  [ ] Photorealism: magazine-quality Australian interior, not cartoon or 3D render.`,
    `  [ ] Photo fidelity (PREVIEW edit only): walls / floor / furniture / perspective match the source photo exactly — only the fittings have changed.`,
    `  [ ] Final outcome: image shows the install FULLY COMPLETED — day-of-handover state, no tools, no packaging, no mid-install work, no tradies in frame.`,
    ``,
    `If ANY box is unchecked, DO NOT emit. Redraft until all pass.`,
    `════════════════════════════════════════════════════════════════`,
  ]
  return lines.join('\n')
}

// ─── Per-shot system-instruction builder ───
// Layout: MASTER RULES → customer prefs (data block) → THIS IMAGE
// (shot-specific context) → FINAL CHECKLIST. The MASTER RULES bracket
// the prompt at the top so Gemini sees the imperatives before it sees
// the data, and the CHECKLIST sits at the bottom so it's the last
// thing the model reads before emitting.
function buildSystemInstruction(ctx: PromptContext, shotContext: string, shot: RenderShot): string {
  return [
    masterRules(),
    ``,
    // Declarative key/value directive — every customer value at a glance,
    // unambiguous, no narrative to misparse. Includes render_mode +
    // reference_photo so Gemini knows up-front whether to edit an
    // attached photo or generate from scratch.
    buildRenderDirective(ctx, shot),
    ``,
    // Narrative customer context block (verbatim words, anchor product
    // explanation, structured prefs, line items, assumptions, count anchor).
    // Kept as supporting context — the RENDER DIRECTIVE above is the
    // authoritative spec.
    buildCustomerPrefsBlock(ctx),
    ``,
    `THIS IMAGE:`,
    shotContext,
    ``,
    finalChecklist(ctx),
  ].join('\n')
}

// ════════════════════════════════════════════════════════════════════
// PREVIEW prompt
// ════════════════════════════════════════════════════════════════════

export function buildPreviewPrompt(ctx: PromptContext): SystemUserPrompt {
  const room = detectRoom(ctx.intake.scope?.description) ?? 'space'
  const { plural: jobLabelPlural } = humaniseJobType(ctx.intake.job_type)
  const callerName = ctx.intake.caller?.name?.trim() || null
  const callerLabel = callerName ?? 'the customer'
  const callerPossessive = callerName ? `${callerName}'s` : `the customer's`
  const isReplacement = ctx.intake.scope?.is_new_install === false
  const anchor = pickAnchorProduct(ctx)

  const shotContext = [
    `  Series role: PREVIEW edit — an EDIT of ${callerPossessive} OWN PHOTO of their ${room}, NOT a freshly-generated lookalike.`,
    ``,
    `  PHOTO FIDELITY (see MASTER RULE 7): the user message includes ${callerLabel}'s actual photo. You MUST edit THAT image. Preserve every non-fitting pixel — walls, paint colour, flooring, cabinets, furniture, decor, perspective, camera angle, lighting direction — exactly as in the source. The ONLY pixels allowed to change are the fittings being installed or replaced. ${callerLabel} must recognise their own ${room} the moment the image loads. If you find yourself rendering a "similar-looking" Aussie ${room} instead of editing the attached one, STOP and start over — that is a failed output.`,
    ``,
    `  If ${callerPossessive} photo already contains existing ${jobLabelPlural} of this job type, REMOVE them and replace with the ANCHOR PRODUCT above — do not keep them and add more on top.`,
    ``,
    isReplacement
      ? `  THIS IS A REPLACEMENT JOB. ${callerPossessive} photo shows their EXISTING fitting (the one being replaced). Your edited image MUST depict the NEW ANCHOR PRODUCT installed in place of the existing one — but every OTHER pixel stays identical to the source. The output MUST look visibly DIFFERENT from the input photo at the fitting location ONLY${anchor ? ` — the new product (${anchor}) has a different style/finish/form from what is currently there, and that visual change MUST be apparent` : ''}. If your output looks IDENTICAL to the customer's input photo, you have failed the task — re-render and show the replacement.`
      : `  This is a NEW INSTALL. ${callerPossessive} photo shows the surface BEFORE installation. Your edited image must depict the ANCHOR PRODUCT newly installed in the appropriate position — everything else in the photo stays exactly as it was.`,
    ``,
    `  Watermark: a small "AI PREVIEW" mark in the bottom-right corner.`,
  ].join('\n')

  // Tight user message — closes the prompt with a verification reminder
  // so the model re-checks its draft before emitting.
  const previewUser = [
    `Generate the AI Preview image now using the attached reference photo.`,
    ``,
    `Before emitting, run the FINAL CHECKLIST from the system instruction:`,
    `  · count matches exactly`,
    `  · ANCHOR PRODUCT (brand + style) is depicted, NOT the existing fitting`,
    `  · photo fidelity — walls, floor, furniture, perspective, lighting all match the source photo; only the fittings have changed`,
    `  · the edited image looks visibly DIFFERENT from the input photo AT THE FITTING LOCATION ONLY (the new product replaces the old)`,
    `  · final outcome — the install is FULLY COMPLETED in the edited photo, day-of-handover state`,
    `  · no extra features the customer did not request`,
    `  · no people, no text, no logos`,
    `  · photorealistic — magazine-quality, not cartoon or 3D render`,
    ``,
    `If any check fails, redraft. Do not return the input photo unchanged, and do not return a generic-looking room that isn't the customer's actual space.`,
  ].join('\n')

  return {
    system: buildSystemInstruction(ctx, shotContext, {
      role: 'PREVIEW edit (in customer\'s own room)',
      mode: 'edit_customer_photo',
    }),
    user: previewUser,
  }
}

// ════════════════════════════════════════════════════════════════════
// PREVIEW prompt — V2 (XML-tag structured, Gemini 2.0+ best practice)
//
// Why: V1 leaned on box-drawing chars, ALL CAPS, and 9 verbose master
// rules in prose. Gemini's instruction-tuning weights XML-tag adherence
// heavily, and image models specifically lose attention after long
// prose blocks. V2 preserves every proven concept from V1 — anchor
// product, ordinal placement list, verbatim customer words, final
// checklist — but wraps them in <task>, <spec>, <must>, <must_not>,
// <verify_before_emit> tags. Output is ~40% shorter for the same
// fidelity signal.
//
// Gated behind PREVIEW_PROMPT_VERSION env var ("v2" → use this,
// anything else → V1). A/B over a small batch before promoting.
// ════════════════════════════════════════════════════════════════════

function buildSpecBlock(ctx: PromptContext, shot: RenderShot): string {
  const { intake, quote } = ctx
  const desc = (intake.scope?.description ?? '').trim()
  const callerName = intake.caller?.name?.trim() || null
  // Use the detected room from the customer's words; if none, fall
  // back to a sensible per-job-type location ("utility area" for HWS,
  // "garage or driveway" for EV chargers etc.) instead of dropping it.
  const room = detectRoom(desc) ?? defaultRoomForJobType(intake.job_type)
  // Fix #2 — sensible single-item defaults so plumbing-style intakes
  // (hot_water etc.) still emit a count enforcement line.
  const count = effectiveItemCount(ctx)
  const specs = intake.scope?.specs ?? {}
  const access = intake.access ?? {}
  const trade = (intake as { trade?: string }).trade ?? null
  const anchor = pickAnchorProduct(ctx)
  const anchorDesc = pickAnchorDescription(ctx)
  const tier = quote?.selected_tier ?? null
  const installType =
    intake.scope?.is_new_install === true ? 'new install'
    : intake.scope?.is_new_install === false ? 'replacing existing'
    : null

  const kv = (key: string, value: unknown): string | null => {
    if (value === null || value === undefined || value === '' || value === 'unknown') return null
    if (typeof value === 'boolean') return `  ${key}=${value ? 'yes' : 'no'}`
    return `  ${key}=${value}`
  }

  const lines = [
    kv('render_mode', shot.mode),
    kv('reference_photo', shot.mode === 'edit_customer_photo' ? 'attached as inline binary in user message' : 'not attached'),
    kv('view_type', shot.role),
    kv('customer_name', callerName),
    kv('trade', trade),
    kv('job_type', intake.job_type),
    kv('quantity', count),
    kv('product_to_render', anchor),
    kv('product_details', anchorDesc),
    kv('selected_tier', tier),
    kv('room', room),
    kv('indoor_outdoor', intake.scope?.indoor_outdoor),
    kv('install_type', installType),
    kv('existing_wiring', intake.scope?.existing_wiring),
    kv('colour_temp', colorTempHuman(specs.color_temp)),
    kv('dimmable', specs.dimmable),
    kv('smart_wifi', specs.smart),
    kv('weatherproof', specs.weatherproof),
    kv('supplied_by', specs.supplied_by),
    kv('ceiling_type', access.ceiling_type),
    kv('wall_type', access.wall_type),
    kv('verbatim_customer', desc ? `"${desc.slice(0, 300)}"` : null),
  ].filter((l): l is string => l !== null)

  return `<spec>\n${lines.join('\n')}\n</spec>`
}

function buildPlacementBlock(ctx: PromptContext): string {
  const count = effectiveItemCount(ctx)
  if (count === null) return ''
  const positions = ordinalPositions(ctx.intake.job_type, count)
  if (!positions) return ''
  const items = positions.map(p => `  - ${p}`).join('\n')
  return `<placement>\nRender each item in the position below. Tick them off as you compose:\n${items}\n</placement>`
}

function buildSystemInstructionV2(ctx: PromptContext, args: {
  task: string
  shot: RenderShot
  subject: string
  scene: string
  /** Optional extra style line, folded into <must>. */
  style?: string
  extraMust?: string[]
  extraMustNot?: string[]
}): string {
  const count = effectiveItemCount(ctx)
  const anchor = pickAnchorProduct(ctx)
  const anchorDesc = pickAnchorDescription(ctx)
  const isEdit = args.shot.mode === 'edit_customer_photo'
  // Singular/plural-aware noun for the job's THING (e.g. "1 hot water
  // system" vs "6 smoke alarms"). Falls back to count=1 form when there
  // is no count, only for the fallback "wrong number" wording below.
  const jobNoun = displayJobNoun(ctx.intake.job_type, count ?? 1)
  const fittingWord = count === 1 ? 'fitting' : 'fittings'
  // No reference photo will be attached when the line item has no
  // image_path. In that case, the renderer leans entirely on the
  // textual JSON cues — name it explicitly so Gemini knows to use them.
  const hasProductPhoto = pickAnchorImagePath(ctx) !== null

  // ── <must> — only high-signal, concrete instructions. No "count out
  //    loud", no "self-verify", no "redraft": an image model renders in
  //    one pass and does not iterate, so reasoning-loop wording from
  //    text-LLM prompting only dilutes attention. The real verification
  //    is the judge→retry loop in generate.ts (lib/ig-engine/judge.ts).
  const mustLines = [
    count !== null ? `Render exactly ${count} ${jobNoun} — no more, no fewer.` : null,
    anchor ? `Install the anchor product: ${anchor}. Match its brand, style, shape and finish exactly — never substitute a generic fitting.` : null,
    anchorDesc ? `The anchor product is specifically: "${anchorDesc.slice(0, 240)}".` : null,
    isEdit
      ? `Edit the attached customer photo. Keep its walls, floor, cabinetry, furniture, decor, perspective, camera angle and lighting pixel-identical — only the fittings change.`
      : `Generate a photoreal contemporary Australian residential scene: neutral walls, blonde-oak flooring, minimal furniture.`,
    `Render the install fully completed — day-of-handover state, tidied up.`,
    `Photoreal, magazine-quality interior photography.`,
    hasProductPhoto
      ? `If a labelled PRODUCT REFERENCE photo is attached (the final image), replicate that exact product — it is the literal product quoted, not a style hint, and it overrides the generic job-type label.`
      : `NO REFERENCE PHOTO IS ATTACHED for this product — render strictly from product_to_render, product_details, and verbatim_customer in <spec>. Do not invent features the customer did not mention.`,
    args.style ?? null,
    ...(args.extraMust ?? []),
  ].filter((l): l is string => l !== null)

  const mustNotLines = [
    count !== null ? `More or fewer than ${count} ${fittingWord}.` : `The wrong number of fittings.`,
    `People, hands, pets, tradies, tools, ladders, packaging, or any mid-install state.`,
    `Text, captions, annotations or brand logos — except the small watermark named in <scene>.`,
    `Features not listed in <spec> — no smart/Wi-Fi, dimmable, IP-rated or premium finishes unless specified.`,
    `Cartoon, illustration, 3D-render or staged-stock-photo aesthetic.`,
    isEdit ? `Changing the room itself — walls, floor, furniture, decor or camera angle.` : null,
    isEdit ? `Returning the photo unchanged — the fitting area MUST visibly differ.` : null,
    ...(args.extraMustNot ?? []),
  ].filter((l): l is string => l !== null)

  const placement = buildPlacementBlock(ctx)

  return [
    `<task>${args.task}</task>`,
    ``,
    buildSpecBlock(ctx, args.shot),
    ``,
    `<subject>${args.subject}</subject>`,
    ``,
    `<scene>${args.scene}</scene>`,
    ``,
    `<must>`,
    ...mustLines.map(l => `- ${l}`),
    `</must>`,
    ``,
    `<must_not>`,
    ...mustNotLines.map(l => `- ${l}`),
    `</must_not>`,
    ...(placement ? ['', placement] : []),
  ].join('\n')
}

export function buildPreviewPromptV2(ctx: PromptContext): SystemUserPrompt {
  const room = detectRoom(ctx.intake.scope?.description)
    ?? defaultRoomForJobType(ctx.intake.job_type)
  const callerName = ctx.intake.caller?.name?.trim() || 'the customer'
  const isReplacement = ctx.intake.scope?.is_new_install === false
  const anchor = pickAnchorProduct(ctx)
  const count = effectiveItemCount(ctx)
  // Singular/plural-aware noun for the count line in <subject>.
  const jobNoun = displayJobNoun(ctx.intake.job_type, count ?? 1)

  const subject = anchor
    ? `${count ?? ''} ${anchor} installed in ${callerName}'s ${room}. Match the anchor product's exact brand, style and finish.`.trim()
    : `${count ?? ''} ${jobNoun} installed in ${callerName}'s ${room}.`.trim()

  const scene = isReplacement
    ? `${callerName}'s actual ${room}, edited from the attached photo. The existing fittings are removed and the new anchor product installed in their place; every other pixel preserved exactly. Watermark: small "AI PREVIEW" bottom-right.`
    : `${callerName}'s actual ${room}, edited from the attached photo. The new anchor product is added in the appropriate position; every other pixel preserved exactly. Watermark: small "AI PREVIEW" bottom-right.`

  const extraMust = isReplacement
    ? [`This is a replacement job — remove the existing fitting shown in the photo; the output must look visibly different from the input at the fitting location.`]
    : []

  const system = buildSystemInstructionV2(ctx, {
    task: 'Edit the attached customer photo to show the proposed install completed.',
    shot: { role: 'PREVIEW edit (in customer\'s own room)', mode: 'edit_customer_photo' },
    subject,
    scene,
    extraMust,
  })

  const user = [
    `Generate the AI Preview now by editing the attached photo.`,
    `Do not return the photo unchanged, and do not generate a generic room — it must be ${callerName}'s actual space with only the fittings changed.`,
  ].join('\n')

  return { system, user }
}

// ════════════════════════════════════════════════════════════════════
// Item 3 — TWO-PASS replacement editing.
//
// Single-pass editing fails badly on "replace the existing fitting":
// the model sees the old fixture in the source photo and treats it as
// scene to PRESERVE, so it leaves the old one and adds the new one on
// top (over-count) or quietly keeps the old one. Asking for
// remove + install + correct-count + correct-product all in one edit
// is too much for one forward pass.
//
// The fix: split into two edits, each with ONE job.
//   · Pass 1 — buildRemovalPrompt: remove the old fitting, leave a
//     clean bare surface. The output of pass 1 becomes the reference
//     photo for pass 2.
//   · Pass 2 — the normal buildPreviewPromptV2: install the new
//     product into the now-empty surface. No old fixture to fight.
//
// Only used when intake.scope.is_new_install === false (a replacement).
// New installs skip pass 1 entirely — there is nothing to remove.
// ════════════════════════════════════════════════════════════════════

/** True when this job replaces an existing fitting (→ needs pass 1). */
export function isReplacementJob(ctx: PromptContext): boolean {
  return ctx.intake.scope?.is_new_install === false
}

/**
 * Pass-1 prompt: strip the existing fittings out of the customer's
 * photo, leaving a clean bare surface. Deliberately tiny and
 * single-purpose — one instruction, no count, no product, no install.
 */
export function buildRemovalPrompt(ctx: PromptContext): SystemUserPrompt {
  const room = detectRoom(ctx.intake.scope?.description)
    ?? defaultRoomForJobType(ctx.intake.job_type)
  // Use the intake's count (or sensible default) to pick singular vs
  // plural noun — "the existing tap" reads better than "the existing
  // tap repairs" when count=1.
  const count = effectiveItemCount(ctx) ?? 1
  const jobNoun = displayJobNoun(ctx.intake.job_type, count)
  const noun = count === 1 ? `the existing ${jobNoun}` : `the existing ${jobNoun}`

  const system = [
    `<task>Edit the attached photo of a ${room}: remove ${noun} so the mounting surface is clean and bare, ready for a new fitting to be installed later.</task>`,
    ``,
    `<must>`,
    `- Remove ${count === 1 ? 'the' : 'every'} existing ${jobNoun} visible in the photo.`,
    `- Leave the mounting surface clean, bare and undamaged — no holes, no scorch marks, no leftover brackets or hardware.`,
    `- Keep everything else pixel-identical: walls, floor, cabinetry, furniture, decor, perspective, camera angle and lighting.`,
    `- Photoreal result — it must look like a real photograph of the room with nothing installed in that spot.`,
    `</must>`,
    ``,
    `<must_not>`,
    `- Installing, adding or drawing any new fitting — this step ONLY removes.`,
    `- People, text, captions, logos, tools or packaging.`,
    `- Changing the room itself in any other way.`,
    `</must_not>`,
  ].join('\n')

  const user = [
    `Remove ${noun} from the attached photo and leave a clean, bare surface.`,
    `Do not install anything new — removal only.`,
  ].join('\n')

  return { system, user }
}

// ════════════════════════════════════════════════════════════════════
// SAMPLE prompts
// ════════════════════════════════════════════════════════════════════

export type SamplePromptSet = {
  wide: SystemUserPrompt
  detail: SystemUserPrompt
  lit: SystemUserPrompt
}

export type SamplePromptOpts = {
  usePhotoReference?: boolean
}

export function buildSamplePrompts(ctx: PromptContext, opts: SamplePromptOpts = {}): SamplePromptSet | null {
  const room = detectRoom(ctx.intake.scope?.description)
    ?? defaultRoomForJobType(ctx.intake.job_type)
  const callerName = ctx.intake.caller?.name?.trim() || null
  const callerLabel = callerName ?? 'the customer'
  const callerPossessive = callerName ? `${callerName}'s` : `the customer's`
  const usingPhoto = opts.usePhotoReference === true
  const mode: RenderShot['mode'] = usingPhoto ? 'edit_customer_photo' : 'text_to_image'

  // Subject is shared across all 3 shots — that's the cross-shot
  // consistency guarantee, expressed as data rather than prose.
  const anchor = pickAnchorProduct(ctx)
  const jobNoun = displayJobNoun(ctx.intake.job_type, effectiveItemCount(ctx) ?? 1)
  // Plural form for "no other ${nounPlural} visible" in the close-up.
  const jobNounPlural = displayJobNoun(ctx.intake.job_type, 2)
  const subject = anchor
    ? `${anchor} installed in ${callerLabel}'s ${room}.`
    : `${jobNoun} installed in ${callerLabel}'s ${room}.`

  const consistencyMust =
    'This is ONE of THREE coordinated sample images (WIDE / CLOSE-UP / IN-USE). All three MUST depict the SAME anchor product — same brand, style, finish — customers view them side by side.'

  // ─── Scenes — short, declarative, V2-ready ──────────────────────────
  const wideScene = usingPhoto
    ? `${callerPossessive} ${room} (reference photo attached), edited to show the install fully completed — day-of-handover. Camera ~3–4 m back, eye-level, daylight ambient. Watermark: small "AI SAMPLE" bottom-right.`
    : `A contemporary Australian ${room}, install fully completed — day-of-handover. Camera ~3–4 m back, eye-level, daylight ambient. Watermark: small "AI SAMPLE" bottom-right.`

  const detailScene = usingPhoto
    ? `Macro close-up of ONE instance of the anchor product, fully installed; fills 60–80% of the frame. Background: heavily-blurred bokeh sampled from ${callerPossessive} attached photo, no other ${jobNounPlural} visible. Watermark: small "AI SAMPLE" bottom-right.`
    : `Macro close-up of ONE instance of the anchor product, fully installed; fills 60–80% of the frame. Background: blurred ${room} bokeh, no other ${jobNounPlural} visible. Watermark: small "AI SAMPLE" bottom-right.`

  const litScene = usingPhoto
    ? `${callerPossessive} ${room} at dusk (reference photo attached) — install fully completed, the product visibly doing its job (lit / running). Twilight outside. Watermark: small "AI SAMPLE" bottom-right.`
    : `A contemporary Australian ${room} at dusk — install fully completed, the product visibly doing its job (lit / running). Twilight outside. Watermark: small "AI SAMPLE" bottom-right.`

  // ─── Tight V2 user message ──────────────────────────────────────────
  const baseUser = [
    `Generate the AI Sample image now${usingPhoto ? ' using the attached reference photo' : ''}.`,
    `Render the install fully completed and depict the SAME anchor product as the other two shots in this series.`,
  ].join('\n')

  return {
    wide: {
      system: buildSystemInstructionV2(ctx, {
        task: usingPhoto
          ? 'Edit the attached photo to show the install fully completed — WIDE-ANGLE OVERVIEW.'
          : 'Generate a wide-angle photo of the install fully completed.',
        shot: { role: 'WIDE-ANGLE OVERVIEW', mode },
        subject,
        scene: wideScene,
        extraMust: [consistencyMust],
      }),
      user: baseUser,
    },
    detail: {
      system: buildSystemInstructionV2(ctx, {
        task: usingPhoto
          ? 'Edit the attached photo to show a MACRO CLOSE-UP of the installed anchor product.'
          : 'Generate a MACRO CLOSE-UP of the installed anchor product.',
        shot: { role: 'MACRO CLOSE-UP', mode },
        subject,
        scene: detailScene,
        extraMust: [
          'ONLY one single instance of the anchor product is visible in this frame — no other fittings.',
          consistencyMust,
        ],
      }),
      user: baseUser,
    },
    lit: {
      system: buildSystemInstructionV2(ctx, {
        task: usingPhoto
          ? 'Edit the attached photo to show the install fully completed and IN USE at dusk.'
          : 'Generate a photo of the install fully completed and IN USE at dusk.',
        shot: { role: 'IN-USE / DUSK', mode },
        subject,
        scene: litScene,
        extraMust: [consistencyMust],
      }),
      user: baseUser,
    },
  }
}
