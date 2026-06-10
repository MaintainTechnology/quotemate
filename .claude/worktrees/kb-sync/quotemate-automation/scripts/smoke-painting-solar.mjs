// QuoteMate · smoke test the Google Solar painting data path.
// Usage: node --env-file=.env.local scripts/smoke-painting-solar.mjs
//
// Confirms (a) the Geocoding API and (b) the Solar API are enabled on the
// GOOGLE_MAPS_API_KEY project, and that a real AU address returns a
// footprint. Never prints the key. Read-only — one geocode + one Solar call.

const key = process.env.GOOGLE_MAPS_API_KEY
if (!key) {
  console.error('Missing GOOGLE_MAPS_API_KEY')
  process.exit(1)
}

const ADDRESS = '28 Greens Rd, Coorparoo, 4151, QLD, Australia'

function redact(s) {
  return String(s).replaceAll(key, '<key>')
}

try {
  // 1. Geocode
  const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ADDRESS)}&region=au&key=${key}`
  const geoRes = await fetch(geoUrl)
  const geo = await geoRes.json()
  console.log(`Geocode status: ${geo.status}`)
  if (geo.status !== 'OK') {
    console.error('Geocoding failed:', redact(geo.error_message ?? geo.status))
    console.error('→ Enable the "Geocoding API" on this key\'s Google Cloud project.')
    process.exit(2)
  }
  const { lat, lng } = geo.results[0].geometry.location
  console.log(`  location: ${lat}, ${lng}`)

  // 2. Solar buildingInsights
  const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=LOW&key=${key}`
  const solarRes = await fetch(solarUrl)
  const solar = await solarRes.json()
  console.log(`Solar HTTP: ${solarRes.status}`)
  if (!solarRes.ok) {
    console.error('Solar API error:', redact(solar?.error?.message ?? `HTTP ${solarRes.status}`))
    if (solarRes.status === 403) {
      console.error('→ Enable the "Solar API" on this key\'s Google Cloud project (and check key restrictions).')
    }
    process.exit(3)
  }
  const sp = solar.solarPotential ?? {}
  const footprint =
    sp.wholeRoofStats?.groundAreaMeters2 ??
    sp.buildingStats?.groundAreaMeters2 ??
    sp.wholeRoofStats?.areaMeters2 ??
    null
  const d = solar.imageryDate
  console.log(`  footprint m²: ${footprint != null ? Math.round(footprint) : '<none>'}`)
  console.log(`  imagery date: ${d ? `${d.year}-${String(d.month).padStart(2, '0')}` : '<none>'}`)
  console.log(`  imagery quality: ${solar.imageryQuality ?? '<none>'}`)

  if (footprint == null) {
    console.error('\nSolar responded but returned no footprint — try another address.')
    process.exit(4)
  }
  console.log('\n✓ Both APIs work. The "Other tools" tab will return real footprints.')
} catch (e) {
  console.error('SMOKE FAILED:', redact(e?.message ?? e))
  process.exitCode = 1
}
