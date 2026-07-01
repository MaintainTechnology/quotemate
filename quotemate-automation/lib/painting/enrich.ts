// ════════════════════════════════════════════════════════════════════
// Painting — property-data enrichment orchestration.
//
// Runs the Geoscape + PropRadar enrichers concurrently and merges their
// patches onto the base (Solar) PropertyFacts.
//
// Merge rules:
//   • non-null only; the Solar footprint is never overwritten.
//   • storeys: Geoscape fills it when the base provider had none (the user's
//     declared storeys is re-applied AFTER enrichment in measure.ts, so it
//     always wins).
//   • property_type: Geoscape zoning fills a null; PropRadar's specific type
//     (House / Apartment / …) overrides it when present.
//   • floor area: PropRadar's listing floor area is set with source 'listing'
//     (high confidence); resolveFloorArea then prefers it over the footprint
//     derivation.
//
// The PURE merge (applyEnrichment) is separated from the I/O
// (enrichPaintingFacts) so it is unit-testable without network.
// ════════════════════════════════════════════════════════════════════

import type { PaintAddressInput, PropertyFacts } from './types'
import {
  enrichFromGeoscape,
  type GeoscapeEnrichOpts,
  type GeoscapeEnrichResult,
} from './providers/geoscape-enrich'
import {
  enrichFromPropRadar,
  type PropRadarEnrichOpts,
  type PropRadarEnrichResult,
} from './providers/propradar'

export type EnrichmentSources = {
  geoscape?: GeoscapeEnrichResult
  propradar?: PropRadarEnrichResult
}

/** PURE — merge enrichment patches onto base facts (non-null only). */
export function applyEnrichment(
  base: PropertyFacts,
  sources: EnrichmentSources,
): { facts: PropertyFacts; notes: string[] } {
  const f: PropertyFacts = { ...base }
  const notes: string[] = []

  const geo = sources.geoscape
  if (geo) {
    const p = geo.patch
    if (p.storeys != null && !(f.storeys && f.storeys > 0)) f.storeys = p.storeys
    if (p.eave_height_m != null) f.eave_height_m = p.eave_height_m
    if (p.property_type != null && f.property_type == null) f.property_type = p.property_type
    if (p.footprint_m2 != null && !(f.footprint_m2 && f.footprint_m2 > 0)) {
      f.footprint_m2 = p.footprint_m2
    }
    notes.push(...geo.notes)
  }

  const pr = sources.propradar
  if (pr && pr.found) {
    const p = pr.patch
    if (p.bedrooms != null) f.bedrooms = p.bedrooms
    if (p.bathrooms != null) f.bathrooms = p.bathrooms
    if (p.car_spaces != null) f.car_spaces = p.car_spaces
    if (p.property_type != null) f.property_type = p.property_type // more specific — overrides zoning
    if (p.land_size_m2 != null) f.land_size_m2 = p.land_size_m2
    if (p.year_built != null) f.year_built = p.year_built
    if (p.floor_area_m2 != null) {
      f.floor_area_m2 = p.floor_area_m2
      f.floor_area_source = p.floor_area_source ?? 'listing'
    }
    notes.push(...pr.notes)
  }

  if (notes.length > 0) {
    f.capture_note = [f.capture_note, ...notes].filter(Boolean).join(' · ')
  }
  return { facts: f, notes }
}

export type EnrichPaintingOpts = {
  geoscape?: GeoscapeEnrichOpts
  propradar?: PropRadarEnrichOpts
}

/**
 * Run both enrichers concurrently and merge onto `base`. Each enricher
 * no-ops when its API key is unset (or its lookup misses), so an estimate
 * always succeeds on the base provider alone.
 */
export async function enrichPaintingFacts(
  address: PaintAddressInput,
  base: PropertyFacts,
  opts: EnrichPaintingOpts = {},
): Promise<{ facts: PropertyFacts; notes: string[] }> {
  const [geoscape, propradar] = await Promise.all([
    enrichFromGeoscape(address, opts.geoscape),
    enrichFromPropRadar(address, opts.propradar),
  ])
  return applyEnrichment(base, { geoscape, propradar })
}
