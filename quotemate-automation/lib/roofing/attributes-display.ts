// Presentational helper — turn the Geoscape premium building attributes on
// a RoofMetrics into [label, value] chips shared by the tradie dashboard and
// the customer quote page, so both surfaces show identical roof data.

import type { RoofMetrics, RoofPropertyContext } from './types'

export function buildingAttributeChips(metrics: RoofMetrics): Array<[string, string]> {
  const a = metrics.building_attributes
  if (!a) return []
  const chips: Array<[string, string]> = []
  if (a.roof_material) chips.push(['Material', a.roof_material])
  if (a.roof_complexity) chips.push(['Complexity', a.roof_complexity])
  if (a.max_roof_height_m != null) chips.push(['Ridge height', `${a.max_roof_height_m.toFixed(1)} m`])
  if (a.eave_height_m != null) chips.push(['Eave height', `${a.eave_height_m.toFixed(1)} m`])
  if (a.roof_rise_m != null) chips.push(['Roof rise', `${a.roof_rise_m.toFixed(1)} m`])
  if (a.ground_elevation_m != null) chips.push(['Ground elevation', `${a.ground_elevation_m.toFixed(1)} m`])
  if (a.solar_panel != null) chips.push(['Existing solar', a.solar_panel ? 'Yes' : 'No'])
  if (a.overhanging_tree != null) chips.push(['Tree overhang', a.overhanging_tree ? 'Yes' : 'No'])
  return chips
}

/** Roofing-relevant PropRadar property context as [label, value] chips —
 *  shared by the tradie dashboard and the customer quote page. */
export function propertyContextChips(ctx: RoofPropertyContext): Array<[string, string]> {
  const chips: Array<[string, string]> = []
  if (ctx.property_type) chips.push(['Property type', ctx.property_type])
  if (ctx.year_built != null) chips.push(['Year built', String(ctx.year_built)])
  if (ctx.floor_area_sqm != null) chips.push(['Floor area', `${Math.round(ctx.floor_area_sqm)} m²`])
  if (ctx.land_size_sqm != null) chips.push(['Land size', `${Math.round(ctx.land_size_sqm)} m²`])
  return chips
}
