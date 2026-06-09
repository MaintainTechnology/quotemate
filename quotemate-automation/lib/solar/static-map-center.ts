// Pure: derive a {lat,lng} centre for the solar hero satellite image from
// the estimate's roof polygon. GeoJSON rings are [lng, lat] pairs, so the
// first vertex maps to { lat: v[1], lng: v[0] }. Null on no polygon
// (manual fallback) — the route then centres on the address instead.

export type LatLngCenter = { lat: number; lng: number }

export function centerForSolarEstimate(args: {
  roof: { polygon_geojson: { type?: string; coordinates?: number[][][] } | null }
}): LatLngCenter | null {
  const ring = args.roof.polygon_geojson?.coordinates?.[0]
  const v = ring?.[0]
  if (
    Array.isArray(v) &&
    typeof v[0] === 'number' &&
    Number.isFinite(v[0]) &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[1])
  ) {
    return { lat: v[1], lng: v[0] }
  }
  return null
}
