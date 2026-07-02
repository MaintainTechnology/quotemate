// Pure parsers that lift trade-specific measurement snapshots out of the
// jsonb the quote-creation routes stamp onto intakes.scope / quotes tiers,
// for the customer-facing /q/[token] page.
//
// Roofing: app/api/roofing/save-as-quote stamps {...inputs, ...metrics} onto
// intake.scope (material, pitch, intent + footprint_m2, sloped_area_m2,
// storeys, form, hips, valleys, ridge_lm, capture_date). Only a third of
// that ever reached the customer — these parsers surface all of it.
//
// Commercial painting: lib/commercial-painting/save-quote-helpers stamps
// {job_name, surfaces, total_m2, labour_hours, crew_size, estimated_days}
// onto intake.scope and wraps the tender's full per-surface takeoff into the
// tier jsonb line_items.
//
// NO I/O — unit-testable, callable from server components.

export type RoofScopeStats = {
  area_m2: number | null
  footprint_m2: number | null
  form: string | null
  material: string | null
  pitch: string | null
  hips: number | null
  valleys: number | null
  ridge_lm: number | null
  storeys: number | null
}

export type CommercialPaintScope = {
  job_name: string | null
  surfaces: number | null
  total_m2: number | null
  labour_hours: number | null
  crew_size: number | null
  estimated_days: number | null
}

export type TenderLineItem = {
  description: string
  quantity: number
  unit: string
  total_ex_gst: number
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

/** Roofing measurement snapshot from intake.scope, or null when the scope
 *  isn't an object. Individual fields degrade to null independently. */
export function roofScopeStats(scope: unknown): RoofScopeStats | null {
  const s = asObject(scope)
  if (!s) return null
  return {
    area_m2: num(s.sloped_area_m2),
    footprint_m2: num(s.footprint_m2),
    form: str(s.form),
    material: str(s.material),
    pitch: str(s.pitch),
    hips: num(s.hips),
    valleys: num(s.valleys),
    ridge_lm: num(s.ridge_lm),
    storeys: num(s.storeys),
  }
}

/** Commercial-painting takeoff summary from intake.scope. Returns null when
 *  the scope isn't an object or carries none of the takeoff fields, so the
 *  page can skip an all-empty section. */
export function commercialPaintScope(scope: unknown): CommercialPaintScope | null {
  const s = asObject(scope)
  if (!s) return null
  const parsed: CommercialPaintScope = {
    job_name: str(s.job_name),
    surfaces: num(s.surfaces),
    total_m2: num(s.total_m2),
    labour_hours: num(s.labour_hours),
    crew_size: num(s.crew_size),
    estimated_days: num(s.estimated_days),
  }
  const hasAny = Object.values(parsed).some((v) => v !== null)
  return hasAny ? parsed : null
}

/** The tender's per-surface line items from a quotes tier jsonb value
 *  (good/better/best all wrap the same single tender tier). Malformed
 *  entries are skipped rather than failing the page. */
export function tenderLineItems(tier: unknown): TenderLineItem[] {
  const t = asObject(tier)
  const raw = t?.line_items
  if (!Array.isArray(raw)) return []
  const items: TenderLineItem[] = []
  for (const entry of raw) {
    const e = asObject(entry)
    if (!e) continue
    const description = str(e.description)
    const quantity = num(e.quantity)
    const total = num(e.total_ex_gst)
    if (description === null || quantity === null || total === null) continue
    items.push({
      description,
      quantity,
      unit: str(e.unit) ?? '',
      total_ex_gst: total,
    })
  }
  return items
}
