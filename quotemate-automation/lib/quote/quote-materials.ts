// The materials behind an electrical / plumbing quote, for the customer-view
// "Job details" section.
//
// THE DATA IS ALREADY THERE AND NOTHING READS IT. A quote line item persisted
// in quotes.good/better/best carries render metadata that no customer surface
// has ever consumed:
//
//   source               "material:<uuid>" | "assembly:<uuid>" | "labour" | …
//                        the typed row ref the estimator grounded the price on
//   catalogue_id         tenant_material_catalogue.id (WP4 render link)
//   image_path           the product photo — a PUBLIC URL from the
//                        catalogue-images bucket (see app/api/tenant/catalogue/
//                        upload/route.ts), not a storage path needing signing
//   product_description  the operator's own catalogue blurb
//
// Both `app/q/[token]/page.tsx` and `lib/quote/report-html.ts` type a line item
// as exactly five fields and throw the rest away at the type boundary. So
// showing "the materials quoted from the catalogue" is a READ-AND-RENDER job,
// not a schema change.
//
// THREE HONEST LIMITS, encoded in the types rather than hidden:
//   1. `source: "material:<id>"` does NOT say which table. shared_materials and
//      tenant_material_catalogue are UNIONed by the estimator's lookup tool and
//      BOTH stamped `material:` — so a resolver has to probe both.
//   2. Coverage is per-line and not guaranteed. A line the estimator grounded
//      on the loose price+category path carries no id at all
//      (lib/estimate/validate.ts), and a tradie save through TradieEditor
//      preserves only `source` — catalogue_id / image_path / product_description
//      are destroyed. So enrichment is always best-effort; the LINE ITSELF is
//      the source of truth for name, qty, unit and price, and it is always
//      present.
//   3. shared_materials has no description, supplier, range or photo — a line
//      priced off a shared row enriches to brand + specs only.
//
// Money: nothing here computes or alters a price. Quantities and unit prices
// are passed through verbatim for display; the reconciling arithmetic lives in
// lib/quote/line-allocation.ts. Unit-tested in quote-materials.test.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { safeWebsiteUrl } from './tenant-identity'
import { asMoneyNumber } from './money'

/** The loose shape of a persisted line item — every field optional, because
 *  nothing validates a stored line against anything (there is no Zod schema
 *  for line_items anywhere in the repo). */
export type QuoteLineLike = {
  description?: string | null
  unit?: string | null
  quantity?: number | string | null
  unit_price_ex_gst?: number | string | null
  total_ex_gst?: number | string | null
  source?: unknown
  supplied_by?: string | null
  safety_note?: string | null
  catalogue_id?: string | null
  image_path?: string | null
  product_description?: string | null
}

export type LineKind = 'material' | 'assembly' | 'labour' | 'callout' | 'other'

export type RowRef = { type: 'material' | 'assembly'; id: string }

/**
 * Parse `"material:<id>"` / `"assembly:<id>"` out of a line's source.
 *
 * Deliberately IDENTICAL to extractRowRef in lib/estimate/validate.ts — the
 * validator's rules for what counts as a real reference (charset, min length,
 * the literal "uuid" a prompt example once leaked) are the rules that decided
 * whether the price was strictly grounded, so the renderer must not be more
 * generous than the thing that approved the money.
 */
export function parseRowRef(source: unknown): RowRef | null {
  const s = String(source ?? '').trim()
  const m = s.match(/^(material|assembly):([A-Za-z0-9_-]+)$/)
  if (!m) return null
  const id = m[2]
  if (!id || id.length < 4 || id.toLowerCase() === 'uuid') return null
  return { type: m[1] as 'material' | 'assembly', id }
}

/**
 * What kind of cost a line represents.
 *
 * THE TYPED ROW REF WINS OVER THE UNIT, and that ordering is load-bearing.
 * `unit` is a PRICING unit, not a category: the electrical estimator routinely
 * emits an assembly at an hourly rate — a real production line looks like
 *
 *   { unit: 'hr', quantity: 2, source: 'assembly:<uuid>',
 *     description: 'Disconnect, remove old, fit new, test (Replace double GPO assembly)' }
 *
 * so classifying on `unit === 'hr'` first silently reclassified every
 * supply-and-install assembly as labour and emptied the materials list on the
 * customer's quote. `source` is the estimator's own declaration of what the
 * line IS; the unit only says how it was measured.
 *
 * Note this deliberately DIVERGES from labourHours() below, which stays
 * unit-based because that is how lib/estimate/validate.ts sums the labour-hours
 * floor. The same line can legitimately be "an assembly" for display and "2
 * hours of labour" for the hours check — they are different questions.
 */
export function classifyLine(li: QuoteLineLike): LineKind {
  const unit = String(li.unit ?? '').trim().toLowerCase()
  const src = String(li.source ?? '').trim().toLowerCase()

  // A typed, validator-grade reference is definitive.
  const ref = parseRowRef(li.source)
  if (ref) return ref.type

  if (src === 'callout' || src === 'call_out') return 'callout'
  if (src === 'labour' || src === 'after_hours' || src === 'risk_buffer') return 'labour'
  // Loosely-grounded / tradie-added lines: fall back to the source prefix, then
  // to the unit. An untyped hourly line is labour.
  if (src.startsWith('material')) return 'material'
  if (src.startsWith('assembly')) return 'assembly'
  if (unit === 'hr') return 'labour'
  return 'other'
}

/** True for a line the customer reads as "a thing you're supplying me". */
export function isSuppliedItem(li: QuoteLineLike): boolean {
  const k = classifyLine(li)
  return k === 'material' || k === 'assembly'
}

/** A material as the customer sees it. `name`/`quantity`/`unit` always exist;
 *  everything else is best-effort catalogue enrichment. */
export type QuoteMaterial = {
  name: string
  /** 'material' = a product off the catalogue; 'assembly' = a bundled
   *  supply-and-install item, whose price does NOT decompose into parts +
   *  labour (shared_assemblies.default_unit_price_ex_gst is one number). The
   *  caller labels the two differently so an assembly is never presented as
   *  though its dollars were all product. */
  kind: 'material' | 'assembly'
  quantity: number
  unit: string
  /** Ex-GST unit price, passed through verbatim for the rate-card caption. */
  unitPriceExGst: number
  brand: string | null
  range: string | null
  supplier: string | null
  /** Operator's product blurb — from the line, else the catalogue row. */
  blurb: string | null
  /** Renderable image src (https or data:), else null. Never an unsigned path. */
  imageSrc: string | null
  /** Formatted spec pairs off the catalogue row's `properties` jsonb. */
  specs: Array<[string, string]>
  /** Customer supplies it — we install only. */
  customerSupplied: boolean
  safetyNote: string | null
  /** True when a catalogue/shared row was actually resolved for this line. */
  enriched: boolean
}

/** An image src safe for a public customer page: https, or an embedded data:
 *  URI. `image_path` holds a permanent public URL (catalogue-images is a public
 *  bucket), so there is nothing to sign — but a legacy value could be a bare
 *  storage path, and rendering that would produce a broken image. Skip it. */
function safeImageSrc(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  if (t.startsWith('data:image/')) return t
  return safeWebsiteUrl(t)
}

/** Spec keys worth showing a customer, in display order. The `properties`
 *  jsonb is free-form (shape parity with shared_materials filters), so an
 *  allowlist keeps internal flags off the customer's quote. */
const SPEC_LABELS: Array<[string, string]> = [
  ['watts', 'Wattage'],
  ['lumens', 'Output'],
  ['color_temp', 'Colour temp'],
  ['color_options', 'Colour'],
  ['ip_rating', 'IP rating'],
  ['dimmable', 'Dimmable'],
  ['smart', 'Smart'],
  ['weatherproof', 'Weatherproof'],
  ['warranty_years', 'Warranty'],
  ['amps', 'Rating'],
  ['size', 'Size'],
  ['finish', 'Finish'],
  ['material', 'Material'],
  ['litres', 'Capacity'],
]

function formatSpecs(properties: unknown): Array<[string, string]> {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
  const p = properties as Record<string, unknown>
  const out: Array<[string, string]> = []
  for (const [key, label] of SPEC_LABELS) {
    const v = p[key]
    if (v === null || v === undefined || v === '' || v === false) continue
    let text: string
    if (v === true) text = 'Yes'
    else if (Array.isArray(v)) {
      const parts = v.map((x) => String(x).trim()).filter(Boolean)
      if (!parts.length) continue
      text = parts.join(', ')
    } else text = String(v).trim()
    if (!text) continue
    if (key === 'warranty_years' && /^\d+$/.test(text)) text = `${text} years`
    out.push([label, text])
  }
  return out
}

type CatalogueRow = {
  id: string
  name?: string | null
  brand?: string | null
  range_series?: string | null
  supplier?: string | null
  description?: string | null
  image_path?: string | null
  properties?: unknown
}

type SharedRow = {
  id: string
  name?: string | null
  brand?: string | null
  properties?: unknown
}

type AssemblyRow = {
  id: string
  name?: string | null
  description?: string | null
}

/** PURE — the material lines of a tier, in order, with no enrichment. Exported
 *  so a caller with no DB (or a tenant-less legacy quote) still renders a list. */
export function materialLines(lines: ReadonlyArray<QuoteLineLike>): QuoteLineLike[] {
  return lines.filter(isSuppliedItem)
}

/** PURE — the distinct row ids to look up, grouped by kind. */
export function collectRefs(lines: ReadonlyArray<QuoteLineLike>): {
  materialIds: string[]
  assemblyIds: string[]
  catalogueIds: string[]
} {
  const materialIds = new Set<string>()
  const assemblyIds = new Set<string>()
  const catalogueIds = new Set<string>()
  for (const li of lines) {
    const ref = parseRowRef(li.source)
    if (ref?.type === 'material') materialIds.add(ref.id)
    if (ref?.type === 'assembly') assemblyIds.add(ref.id)
    const cid = (li.catalogue_id ?? '').trim()
    if (cid) catalogueIds.add(cid)
  }
  return {
    materialIds: [...materialIds],
    assemblyIds: [...assemblyIds],
    catalogueIds: [...catalogueIds],
  }
}

/** PURE — assemble the customer-facing list from lines + whatever rows resolved.
 *  Split out from the DB call so the mapping is unit-testable without Supabase. */
export function buildQuoteMaterials(
  lines: ReadonlyArray<QuoteLineLike>,
  rows: {
    catalogue?: Map<string, CatalogueRow>
    shared?: Map<string, SharedRow>
    assemblies?: Map<string, AssemblyRow>
  } = {},
): QuoteMaterial[] {
  const cat = rows.catalogue ?? new Map()
  const shared = rows.shared ?? new Map()
  const asm = rows.assemblies ?? new Map()

  return materialLines(lines).map((li) => {
    const ref = parseRowRef(li.source)
    const cid = (li.catalogue_id ?? '').trim()

    // Prefer the explicit catalogue_id (only ever a tenant_material_catalogue
    // row), then the typed source ref against whichever table has it.
    const catRow = (cid && cat.get(cid)) || (ref?.type === 'material' ? cat.get(ref.id) : undefined)
    const sharedRow = !catRow && ref?.type === 'material' ? shared.get(ref.id) : undefined
    const asmRow = ref?.type === 'assembly' ? asm.get(ref.id) : undefined

    const properties = catRow?.properties ?? sharedRow?.properties
    const blurb =
      (li.product_description ?? '').trim() ||
      (catRow?.description ?? '').trim() ||
      (asmRow?.description ?? '').trim() ||
      null

    return {
      name: (li.description ?? '').trim() || catRow?.name?.trim() || sharedRow?.name?.trim() || 'Supplied item',
      kind: classifyLine(li) === 'assembly' ? 'assembly' : 'material',
      quantity: asMoneyNumber(li.quantity),
      unit: (li.unit ?? '').trim() || 'each',
      unitPriceExGst: asMoneyNumber(li.unit_price_ex_gst),
      brand: (catRow?.brand ?? sharedRow?.brand ?? '').trim() || null,
      range: (catRow?.range_series ?? '').trim() || null,
      supplier: (catRow?.supplier ?? '').trim() || null,
      blurb,
      imageSrc: safeImageSrc(li.image_path ?? catRow?.image_path),
      specs: formatSpecs(properties),
      customerSupplied: li.supplied_by === 'customer',
      safetyNote: (li.safety_note ?? '').trim() || null,
      enriched: !!(catRow || sharedRow || asmRow),
    }
  })
}

/**
 * Resolve the materials behind a tier, enriching from the catalogue where the
 * stored refs allow it.
 *
 * Best-effort throughout, matching the page's existing pattern for post-hoc
 * columns: every select is separate and a failure degrades to un-enriched lines
 * rather than breaking a live public page. Two probes are required for the
 * `material:` prefix because the estimator's lookup tool UNIONs
 * tenant_material_catalogue with shared_materials and stamps both the same way.
 */
export async function loadQuoteMaterials(
  supabase: SupabaseClient,
  opts: {
    lines: ReadonlyArray<QuoteLineLike>
    tenantId: string | null
    trade: string
  },
): Promise<QuoteMaterial[]> {
  const lines = materialLines(opts.lines)
  if (lines.length === 0) return []

  const { materialIds, assemblyIds, catalogueIds } = collectRefs(lines)
  const catalogue = new Map<string, CatalogueRow>()
  const shared = new Map<string, SharedRow>()
  const assemblies = new Map<string, AssemblyRow>()

  const catLookup = [...new Set([...catalogueIds, ...materialIds])]

  // tenant_material_catalogue — the only table with full product identity.
  // Tenant-scoped: a token-only public page must never read another tradie's
  // catalogue, so a tenant-less legacy quote simply skips this probe.
  if (catLookup.length && opts.tenantId) {
    try {
      const { data } = await supabase
        .from('tenant_material_catalogue')
        .select('id, name, brand, range_series, supplier, description, image_path, properties')
        .eq('tenant_id', opts.tenantId)
        .in('id', catLookup)
      for (const r of (data ?? []) as CatalogueRow[]) catalogue.set(r.id, r)
    } catch {
      /* un-enriched is a valid render */
    }
  }

  // shared_materials — name/brand/properties only (no description, supplier,
  // range or photo exist on this table).
  const stillUnknown = materialIds.filter((id) => !catalogue.has(id))
  if (stillUnknown.length) {
    try {
      const { data } = await supabase
        .from('shared_materials')
        .select('id, name, brand, properties')
        .eq('trade', opts.trade)
        .in('id', stillUnknown)
      for (const r of (data ?? []) as SharedRow[]) shared.set(r.id, r)
    } catch {
      /* ignore */
    }
  }

  // Assemblies are a bundled supply+install line; the row supplies a name and
  // a customer-facing description, never a parts breakdown.
  if (assemblyIds.length) {
    try {
      const { data } = await supabase
        .from('shared_assemblies')
        .select('id, name, description')
        .in('id', assemblyIds)
      for (const r of (data ?? []) as AssemblyRow[]) assemblies.set(r.id, r)
    } catch {
      /* ignore */
    }
  }

  return buildQuoteMaterials(lines, { catalogue, shared, assemblies })
}

/** Labour hours across a tier — the same sum the grounding validator takes
 *  (unit 'hr'), so the page can state hours without inventing a split. */
export function labourHours(lines: ReadonlyArray<QuoteLineLike>): number {
  return lines
    .filter((li) => String(li.unit ?? '').trim().toLowerCase() === 'hr')
    .reduce((sum, li) => sum + asMoneyNumber(li.quantity), 0)
}
