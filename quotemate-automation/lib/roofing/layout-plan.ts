// ════════════════════════════════════════════════════════════════════
// Roofing — AI work-strategy layout plan (spec specs/quote-visual-parity.md R6).
//
// The vision model acts as an experienced AU roofing tradie: it looks at the
// satellite aerial + the measured structures and proposes colour-coded work
// ZONES as structured JSON ("Install NEW Colorbond sheeting…", "Ground-up
// scaffolding for WHS…"). Doctrine: the LLM only CLASSIFIES/labels — zone
// labels never carry prices or quantities (parseLayoutPlan hard-drops any
// $-labelled zone), geometry drawing is deterministic
// (lib/roofing/layout-overlay-svg.ts) and material quantities come from
// layoutMaterials() below — pure arithmetic over stored metrics.
//
// Cached on roofing_measurements.layout_plan / layout_status (migration 170),
// CAS-claimed like roof-after.ts. Deps injectable (client / fetchAerial /
// generate) — house DI pattern (lib/painting/paint-after.ts).
// ════════════════════════════════════════════════════════════════════

// NOTE: supabase / gemini / google-maps are imported DYNAMICALLY inside the
// orchestrator — the pure parts of this module (palettes, parser, materials)
// are consumed by a client component (/m RoofLayoutSection) and must not
// drag server SDKs into the browser bundle.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeoJSONPolygon, RoofForm } from './types'

export type LayoutMode = 'patch_repair' | 'reroof' | 'upgrade'

export type ZoneColor = 'teal' | 'purple' | 'black' | 'red' | 'yellow' | 'orange' | 'green'

export type ZonePlacement = 'perimeter' | 'ridge' | 'structure' | 'point'

export type LayoutZone = {
  color: ZoneColor
  /** Work description ONLY — parseLayoutPlan drops any $-amount label. */
  label: string
  placement: ZonePlacement
  /** 1-based index into the quote's structures array. */
  structureIndex: number
  /** 'point' zones only: the feature's position as percentages of the aerial
   *  image (0,0 top-left → 100,100 bottom-right), as localised by the vision
   *  model. Drawing clamps them into the structure's projected footprint, so
   *  a mis-localised marker can never land off the roof. */
  x_pct?: number
  y_pct?: number
}

export type LayoutPlan = {
  header: string
  mode: LayoutMode
  zones: LayoutZone[]
}

export const ZONE_COLOR_HEX: Record<ZoneColor, string> = {
  teal: '#14B8A6',
  purple: '#A855F7',
  black: '#111827',
  red: '#EF4444',
  yellow: '#FACC15',
  orange: '#F97316',
  green: '#22C55E',
}

/** Distinct palette per job mode — repairs read warm/urgent, a re-roof reads
 *  as full-coverage works, an upgrade adds the premium/removal accents. */
export const MODE_PALETTES: Record<LayoutMode, readonly ZoneColor[]> = {
  patch_repair: ['yellow', 'orange', 'red', 'black'],
  reroof: ['teal', 'orange', 'red', 'black', 'green'],
  upgrade: ['teal', 'purple', 'orange', 'red', 'black', 'green', 'yellow'],
}

const REPAIR_INTENTS = new Set(['patch_repair', 'flashing_repair', 'leak_trace', 'ridge_cap', 'gutter_replace'])

/** Job intent (+ optionally the customer's selected tier — the roofing rate
 *  card frames Best as the material-upgrade option) → layout mode. */
export function layoutModeForJob(
  intent: string | null | undefined,
  opts: { selectedTier?: 'good' | 'better' | 'best' | null } = {},
): LayoutMode {
  if (intent && REPAIR_INTENTS.has(intent)) return 'patch_repair'
  if (opts.selectedTier === 'best') return 'upgrade'
  return 'reroof'
}

// ── Prompt + schema ──────────────────────────────────────────────────

export type LayoutStructureBrief = {
  index: number
  label: string
  sloped_area_m2: number | null
  form: string
  ridge_lm: number | null
  hips: number | null
  valleys: number | null
  storeys: number | null
}

const MODE_BRIEF: Record<LayoutMode, string> = {
  patch_repair:
    'This is a PATCH/REPAIR job — zone only the areas that need attention (damaged sheeting, flashings, ridge capping, access), not the whole roof.',
  reroof:
    'This is a FULL RE-ROOF — zone the complete works: new sheeting per structure, flashings, safety/scaffolding, ventilation, penetrations.',
  upgrade:
    'This is a MATERIAL-UPGRADE re-roof — zone the complete works including removals (old solar/hot-water units if visible) and the upgraded sheeting spec.',
}

/** PURE prompt builder. The model sees the aerial image alongside this text. */
export function buildLayoutPlanPrompt(args: {
  address: string
  mode: LayoutMode
  structures: LayoutStructureBrief[]
  scopeSummary: string | null
}): { prompt: string } {
  const palette = MODE_PALETTES[args.mode].join(', ')
  const structures = args.structures
    .map(
      (s) =>
        `  ${s.index}. ${s.label} — form ${s.form}, sloped area ${s.sloped_area_m2 ?? '?'} m², ridge ${s.ridge_lm ?? '?'} lm, hips ${s.hips ?? '?'}, valleys ${s.valleys ?? '?'}, storeys ${s.storeys ?? '?'}`,
    )
    .join('\n')
  const prompt = [
    'You are an experienced Australian roofing tradie preparing a work-strategy layout map for a customer quote.',
    `Property: ${args.address}`,
    MODE_BRIEF[args.mode],
    args.scopeSummary ? `Quoted scope: ${args.scopeSummary}` : '',
    'Measured structures (1-based index):',
    structures,
    'Look at the attached aerial photo and propose 3-7 work zones. Each zone is drawn on the map with a colour-coded border and its label shown in a matching callout box.',
    'Each zone: pick a color from this palette ONLY: ' + palette + '.',
    "Each zone's placement is one of: 'perimeter' (around the structure, e.g. scaffolding/edge protection), 'ridge' (along the ridgeline, e.g. whirlybirds/ridge capping), 'structure' (the whole roof surface, e.g. re-sheeting), or 'point' (a localised feature you can actually SEE on the aerial — existing solar panels, a solar hot-water unit, skylights, vents).",
    "For a 'point' zone, also give x_pct and y_pct: the feature's position on the attached image as percentages (0,0 = top-left corner, 100,100 = bottom-right). Only propose a point zone for something clearly visible.",
    "Each zone's structureIndex is the 1-based index of the structure it applies to.",
    'Labels describe the WORK ONLY, tradie-style (materials and method), under 90 characters — do NOT include prices, dollar amounts, or material quantities; those are computed separately.',
    'Also write a one-line friendly header inviting the customer to read the map.',
  ]
    .filter(Boolean)
    .join('\n')
  return { prompt }
}

/** Gemini responseSchema (pattern: lib/painting/material.ts) — colours
 *  constrained to the mode's palette. */
export function layoutPlanSchema(mode: LayoutMode): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      header: { type: 'STRING' },
      zones: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            color: { type: 'STRING', enum: [...MODE_PALETTES[mode]] },
            label: { type: 'STRING' },
            placement: { type: 'STRING', enum: ['perimeter', 'ridge', 'structure', 'point'] },
            structureIndex: { type: 'INTEGER' },
            x_pct: { type: 'NUMBER' },
            y_pct: { type: 'NUMBER' },
          },
          required: ['color', 'label', 'placement', 'structureIndex'],
        },
      },
    },
    required: ['header', 'zones'],
  }
}

const DEFAULT_HEADER = 'Please see the roof layout map below to provide clarity on your quote!'

/** Fence-tolerant parse + hard validation. Drops any zone whose label carries
 *  a $ amount (money-path guard), whose colour is off the mode palette, or
 *  whose structureIndex is out of range. Null when nothing usable survives. */
export function parseLayoutPlan(
  raw: string,
  opts: { mode: LayoutMode; structureCount: number },
): LayoutPlan | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const palette = new Set<string>(MODE_PALETTES[opts.mode])
  const placements = new Set<string>(['perimeter', 'ridge', 'structure', 'point'])
  const pct = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null

  const zones: LayoutZone[] = []
  const rawZones = Array.isArray(obj.zones) ? obj.zones : []
  for (const entry of rawZones) {
    if (entry === null || typeof entry !== 'object') continue
    const z = entry as Record<string, unknown>
    const color = typeof z.color === 'string' ? z.color : ''
    const label = typeof z.label === 'string' ? z.label.trim() : ''
    const placement = typeof z.placement === 'string' ? z.placement : ''
    const idx = typeof z.structureIndex === 'number' ? z.structureIndex : NaN
    if (!palette.has(color)) continue
    if (!label || label.includes('$')) continue
    if (!placements.has(placement)) continue
    if (!Number.isInteger(idx) || idx < 1 || idx > opts.structureCount) continue
    const zone: LayoutZone = {
      color: color as ZoneColor,
      label,
      placement: placement as ZonePlacement,
      structureIndex: idx,
    }
    if (placement === 'point') {
      // A point zone without a usable on-image position can't be drawn.
      const x = pct(z.x_pct)
      const y = pct(z.y_pct)
      if (x === null || y === null) continue
      zone.x_pct = x
      zone.y_pct = y
    }
    zones.push(zone)
  }
  if (zones.length === 0) return null

  const header =
    typeof obj.header === 'string' && obj.header.trim() ? obj.header.trim() : DEFAULT_HEADER
  return { header, mode: opts.mode, zones }
}

// ── Deterministic material quantities ────────────────────────────────
// Named coefficients; ALL arithmetic here — never from the LLM.
const SHEET_COVER_M = 0.762 // Custom Orb effective cover width
const SHEET_AVG_LEN_M = 5.5 // typical residential sheet length
const WASTE_FACTOR = 1.1 // 10% cutting waste
const SCREWS_PER_M2 = 9
const BATTEN_LM_PER_M2 = 1.1

const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LNG_EQUATOR = 111_320

export type LayoutMaterialMetrics = {
  sloped_area_m2: number | null
  ridge_lm: number | null
  footprint_m2: number
  polygon_geojson: GeoJSONPolygon | null
}

/** Footprint perimeter in metres from the polygon ring (equirectangular, the
 *  same model as map-utils.edgeLengthM); 4×√footprint when no geometry. The
 *  `source` names which basis produced the number (surfaced to the tradie). */
function perimeterM(
  metrics: LayoutMaterialMetrics,
): { metres: number; source: 'outline' | 'footprint' } | null {
  const ring = metrics.polygon_geojson?.coordinates?.[0]
  if (Array.isArray(ring) && ring.length >= 4) {
    let total = 0
    let valid = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]
      const b = ring[i + 1]
      if (!Array.isArray(a) || !Array.isArray(b)) continue
      const [lngA, latA] = a
      const [lngB, latB] = b
      if (![lngA, latA, lngB, latB].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
      const latMid = ((latA + latB) / 2) * (Math.PI / 180)
      const dx = (lngB - lngA) * M_PER_DEG_LNG_EQUATOR * Math.cos(latMid)
      const dy = (latB - latA) * M_PER_DEG_LAT
      total += Math.sqrt(dx * dx + dy * dy)
      valid++
    }
    if (valid >= 3 && total > 0) return { metres: total, source: 'outline' }
  }
  if (metrics.footprint_m2 > 0) {
    return { metres: 4 * Math.sqrt(metrics.footprint_m2), source: 'footprint' }
  }
  return null
}

type StructureMetricsLike = {
  metrics?: {
    sloped_area_m2?: number | null
    ridge_lm?: number | null
    footprint_m2?: number | null
    polygon_geojson?: GeoJSONPolygon | null
  } | null
}

/** Whole-job metrics for layoutMaterials, shared by /m, /q/roof and the PDF:
 *  sums across every structure; keeps the exact ring perimeter only when one
 *  structure IS the whole job (multi-structure jobs fall back to the
 *  footprint approximation so edge protection isn't quoted off one building). */
export function combinedLayoutMetrics(
  structures: readonly StructureMetricsLike[],
): LayoutMaterialMetrics {
  const sloped = structures.reduce((s, x) => s + (x.metrics?.sloped_area_m2 ?? 0), 0)
  const ridge = structures.reduce((s, x) => s + (x.metrics?.ridge_lm ?? 0), 0)
  const footprint = structures.reduce((s, x) => s + (x.metrics?.footprint_m2 ?? 0), 0)
  return {
    sloped_area_m2: sloped || null,
    ridge_lm: ridge || null,
    footprint_m2: footprint,
    polygon_geojson:
      structures.length === 1 ? (structures[0]?.metrics?.polygon_geojson ?? null) : null,
  }
}

export type LayoutMaterialItem = {
  item: string
  qty: number
  unit: string
  /** The arithmetic behind the number — measured input × named coefficient. */
  basis: string
  /** Where on the job the material goes. */
  use: string
}

/** ceil with an epsilon so binary-float noise (200 × 1.1 = 220.0000…03)
 *  doesn't inflate a quantity by one unit. */
const ceilQty = (n: number): number => Math.ceil(n - 1e-9)

/** Tradie-facing material quantity estimates, derived ONLY from stored
 *  geometry (spec R6b). patch_repair jobs get an on-site-measure note instead
 *  of committing full-roof numbers. */
export function layoutMaterials(
  metrics: LayoutMaterialMetrics,
  mode: LayoutMode,
): { items: LayoutMaterialItem[]; note: string | null } {
  const items: LayoutMaterialItem[] = []
  const sloped = metrics.sloped_area_m2
  if (sloped !== null && sloped > 0) {
    const area = Math.round(sloped)
    const coverM2 = Math.round(SHEET_COVER_M * SHEET_AVG_LEN_M * 100) / 100 // 4.19
    items.push({
      item: 'Colorbond sheets',
      qty: ceilQty((sloped / (SHEET_COVER_M * SHEET_AVG_LEN_M)) * WASTE_FACTOR),
      unit: 'sheets',
      basis: `${area} m² measured sloped roof ÷ ${coverM2} m² per sheet (${SHEET_COVER_M} m effective cover × ${SHEET_AVG_LEN_M} m average length) + 10% cutting waste`,
      use: 'New roof sheeting across the measured roof surface.',
    })
    items.push({
      item: 'Roofing screws',
      qty: ceilQty(sloped * SCREWS_PER_M2),
      unit: 'screws',
      basis: `${area} m² × ${SCREWS_PER_M2} screws/m² (standard corrugated fixing density)`,
      use: 'Fixing the new sheets to the battens, including laps and flashings.',
    })
    items.push({
      item: 'Battens',
      qty: ceilQty(sloped * BATTEN_LM_PER_M2),
      unit: 'lm',
      basis: `${area} m² × ${BATTEN_LM_PER_M2} lm of batten per m² of roof (typical 900 mm spacing plus trims)`,
      use: 'Roof battens under the new sheeting.',
    })
  }
  if (metrics.ridge_lm !== null && metrics.ridge_lm > 0) {
    const ridge = Math.round(metrics.ridge_lm)
    items.push({
      item: 'Ridge capping',
      qty: ceilQty(metrics.ridge_lm),
      unit: 'lm',
      basis: `${ridge} lm of ridge and hip lines measured from the aerial`,
      use: 'Capping every ridge and hip line, scribed and sealed.',
    })
  }
  const perim = perimeterM(metrics)
  if (perim !== null && perim.metres > 0) {
    items.push({
      item: 'Edge protection',
      qty: ceilQty(perim.metres),
      unit: 'lm',
      basis:
        perim.source === 'outline'
          ? `${Math.round(perim.metres)} lm building perimeter from the measured footprint outline`
          : `≈ 4 × √(${Math.round(metrics.footprint_m2)} m² total footprint) — whole-job approximation across multiple structures`,
      use: 'Guardrail / edge protection around the work-area perimeter (WHS).',
    })
  }
  const note =
    mode === 'patch_repair'
      ? 'Repair quantities are subject to on-site measure — figures below cover the full roof for reference.'
      : null
  return { items, note }
}

// ── Orchestrator (CAS + cache; pattern lib/painting/paint-after.ts) ──

const AERIAL_W = 640
const AERIAL_H = 480

/** A 'generating' claim older than this is considered abandoned (function
 *  killed by timeout/crash before the catch could set 'failed') and becomes
 *  reclaimable — without this a stranded row 409s forever. */
export const STALE_CLAIM_MS = 10 * 60 * 1000

/** The CAS claim's PostgREST or-filter: fresh rows, failed rows, and STALE
 *  'generating' rows (claimed_at marker older than STALE_CLAIM_MS). Pure. */
export function layoutClaimFilter(now: Date): string {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString()
  return `layout_status.is.null,layout_status.eq.failed,and(layout_status.eq.generating,layout_plan->>claimed_at.lt.${cutoff})`
}

let defaultClient: SupabaseClient | null = null
async function serviceClient(): Promise<SupabaseClient> {
  if (!defaultClient) {
    const { createClient } = await import('@supabase/supabase-js')
    defaultClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return defaultClient
}

type ImageBytes = { base64: string; mime: string }

export type LayoutPlanDeps = {
  client?: SupabaseClient
  /** Fetch the satellite aerial the model reasons over. */
  fetchAerial?: (args: { address: string | null; quote: unknown }) => Promise<ImageBytes>
  /** Structured-JSON vision call (defaults to Gemini generateText). */
  generate?: (args: {
    prompt: string
    image: ImageBytes
    schema: Record<string, unknown>
  }) => Promise<string>
}

export type LayoutPlanResult =
  | { ok: true; plan: LayoutPlan }
  | { ok: false; status: 'busy' | 'failed' | 'skipped'; error?: string }

type QuoteLike = {
  structures?: Array<{
    label?: string | null
    inputs?: { intent?: string | null } | null
    metrics?: {
      sloped_area_m2?: number | null
      footprint_m2?: number | null
      form?: RoofForm | null
      ridge_lm?: number | null
      hips?: number | null
      valleys?: number | null
      storeys?: number | null
      polygon_geojson?: GeoJSONPolygon | null
    } | null
  }> | null
}

function firstVertex(quote: QuoteLike): { lat: number; lng: number } | null {
  for (const s of quote.structures ?? []) {
    const v = s.metrics?.polygon_geojson?.coordinates?.[0]?.[0]
    if (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
      return { lat: v[1], lng: v[0] }
    }
  }
  return null
}

async function fetchAerialDefault(args: {
  address: string | null
  quote: unknown
}): Promise<ImageBytes> {
  const { buildStaticMapUrl } = await import('./google-maps')
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!
  const center = firstVertex((args.quote ?? {}) as QuoteLike)
  const url = buildStaticMapUrl(
    {
      address: center ? undefined : (args.address ?? undefined),
      center: center ?? undefined,
      zoom: 20,
      size: { width: AERIAL_W, height: AERIAL_H },
    },
    { apiKey },
  )
  const res = await fetch(url)
  if (!res.ok) throw new Error(`static map fetch ${res.status}`)
  const mime = res.headers.get('content-type') ?? 'image/png'
  const bytes = Buffer.from(await res.arrayBuffer())
  return { base64: bytes.toString('base64'), mime }
}

/**
 * Generate (or serve the cached) layout plan for a roofing measurement,
 * keyed by public_token. Tradie-initiated only (the /m page action) —
 * customer pages and PDFs read the cached plan, never generate.
 */
export async function generateRoofLayoutPlan(
  publicToken: string,
  deps?: LayoutPlanDeps,
): Promise<LayoutPlanResult> {
  if (!deps?.generate && !process.env.GEMINI_API_KEY) {
    return { ok: false, status: 'skipped', error: 'GEMINI_API_KEY missing' }
  }
  if (!deps?.fetchAerial && !process.env.GOOGLE_MAPS_API_KEY) {
    return { ok: false, status: 'skipped', error: 'GOOGLE_MAPS_API_KEY missing' }
  }
  const supabase = deps?.client ?? (await serviceClient())
  const fetchAerial = deps?.fetchAerial ?? fetchAerialDefault
  const generate =
    deps?.generate ??
    (async (args: { prompt: string; image: ImageBytes; schema: Record<string, unknown> }) => {
      const { geminiProvider } = await import('@/lib/ig-engine/providers/gemini')
      if (!geminiProvider.generateText) throw new Error('gemini generateText unavailable')
      return geminiProvider.generateText({
        prompt: args.prompt,
        images: [args.image],
        responseSchema: args.schema,
        temperature: 0,
      })
    })

  const { data: row } = await supabase
    .from('roofing_measurements')
    .select('id, address, quote, layout_status, layout_plan, paid_tier, customer_accepted_tier')
    .eq('public_token', publicToken)
    .maybeSingle()
  if (!row) return { ok: false, status: 'skipped', error: 'not_found' }
  if (row.layout_status === 'ready' && row.layout_plan) {
    return { ok: true, plan: row.layout_plan as LayoutPlan }
  }

  const quote = (row.quote ?? {}) as QuoteLike
  const structures = quote.structures ?? []
  if (structures.length === 0) {
    return { ok: false, status: 'skipped', error: 'no_structures' }
  }

  // CAS claim — only proceed if nobody else is mid-generation. The claimed_at
  // marker (temporarily stored in layout_plan; overwritten by the real plan on
  // success) lets a later request reclaim a claim stranded by a crash/timeout.
  const { data: claimed } = await supabase
    .from('roofing_measurements')
    .update({ layout_status: 'generating', layout_plan: { claimed_at: new Date().toISOString() } })
    .eq('public_token', publicToken)
    .or(layoutClaimFilter(new Date()))
    .select('id')
    .maybeSingle()
  if (!claimed) return { ok: false, status: 'busy' }

  try {
    // The customer's committed tier (paid, else accepted) drives upgrade mode —
    // the roofing rate card frames Best as the material-upgrade option.
    const tierRaw = (row.paid_tier ?? row.customer_accepted_tier) as string | null
    const selectedTier =
      tierRaw === 'good' || tierRaw === 'better' || tierRaw === 'best' ? tierRaw : null
    const mode = layoutModeForJob(structures[0]?.inputs?.intent ?? null, { selectedTier })
    const briefs: LayoutStructureBrief[] = structures.map((s, i) => ({
      index: i + 1,
      label: s.label ?? `Structure ${i + 1}`,
      sloped_area_m2: s.metrics?.sloped_area_m2 ?? null,
      form: s.metrics?.form ?? 'unknown',
      ridge_lm: s.metrics?.ridge_lm ?? null,
      hips: s.metrics?.hips ?? null,
      valleys: s.metrics?.valleys ?? null,
      storeys: s.metrics?.storeys ?? null,
    }))
    const image = await fetchAerial({ address: (row.address as string | null) ?? null, quote })
    const { prompt } = buildLayoutPlanPrompt({
      address: (row.address as string | null) ?? 'the property',
      mode,
      structures: briefs,
      scopeSummary: null,
    })
    const raw = await generate({ prompt, image, schema: layoutPlanSchema(mode) })
    const plan = parseLayoutPlan(raw, { mode, structureCount: structures.length })
    if (!plan) throw new Error('unparseable_layout_plan')

    await supabase
      .from('roofing_measurements')
      .update({ layout_plan: plan, layout_status: 'ready' })
      .eq('public_token', publicToken)
    return { ok: true, plan }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[roofing/layout-plan] generation failed', {
      token: publicToken.slice(0, 8) + '…',
      error,
    })
    await supabase
      .from('roofing_measurements')
      .update({ layout_status: 'failed' })
      .eq('public_token', publicToken)
    return { ok: false, status: 'failed', error }
  }
}
