// Live smoke test for the Google Solar API roofing enrichment.
//
//   node --env-file=.env.local scripts/test-solar-api.mjs
//   node --env-file=.env.local scripts/test-solar-api.mjs -33.8915 151.2767
//   node --env-file=.env.local scripts/test-solar-api.mjs "28 Greens Road, Greenbank QLD"
//
// Verifies: (1) the key can call buildingInsights:findClosest, (2) real
// AU coords return roof segments, (3) the parser + pitch/area maths in
// lib/roofing/solar-api.ts match the LIVE payload (logic mirrored here so
// the script is plain JS and needs no build step).

const KEY = process.env.GOOGLE_SOLAR_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY
const GEO_KEY = process.env.GOOGLE_MAPS_API_KEY

// A few greater-metro residential points likely inside Solar coverage,
// plus one semi-rural (Chandler, from the Geoscape probe comments).
const DEFAULTS = [
  { label: 'Parramatta NSW (suburban)', lat: -33.8150, lng: 151.0010 },
  { label: 'Richmond VIC (inner Melbourne)', lat: -37.8230, lng: 144.9980 },
  { label: 'Chandler QLD (semi-rural)', lat: -27.5060, lng: 153.1660 },
]

const FOOTPRINT_SAMPLE = 200 // m², to show the sloped-area effect

// ── parser logic mirrored from lib/roofing/solar-api.ts ──────────────
function numberOrNull(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') { const n = parseFloat(v); if (Number.isFinite(n)) return n }
  return null
}
function weightedMeanPitch(segs) {
  let w = 0, p = 0
  for (const s of segs) {
    if (!Number.isFinite(s.pitchDegrees) || s.pitchDegrees < 0) continue
    const a = Number.isFinite(s.areaMeters2) && s.areaMeters2 > 0 ? s.areaMeters2 : 0
    if (a <= 0) continue
    w += a; p += a * s.pitchDegrees
  }
  return w > 0 ? p / w : null
}
function bucket(deg) {
  if (!Number.isFinite(deg) || deg < 0) return 'unknown'
  if (deg < 20) return 'shallow'
  if (deg <= 25) return 'standard'
  if (deg <= 35) return 'steep'
  return 'very_steep'
}
function slopedArea(footprint, deg) {
  if (deg >= 90) return null
  return Math.round((footprint / Math.cos((deg * Math.PI) / 180)) * 10) / 10
}
function parseSegments(body) {
  const segs = body?.solarPotential?.roofSegmentStats
  if (!Array.isArray(segs)) return []
  const out = []
  for (const s of segs) {
    const pitch = numberOrNull(s?.pitchDegrees)
    if (pitch === null) continue
    const area = numberOrNull(s?.stats?.areaMeters2) ?? numberOrNull(s?.stats?.groundAreaMeters2)
    if (area === null || area <= 0) continue
    out.push({ pitchDegrees: pitch, azimuthDegrees: numberOrNull(s?.azimuthDegrees), areaMeters2: area })
  }
  return out
}

async function geocode(address) {
  if (!GEO_KEY) throw new Error('No GOOGLE_MAPS_API_KEY for geocoding')
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=au&key=${GEO_KEY}`
  const r = await fetch(url)
  const j = await r.json()
  if (j.status !== 'OK') throw new Error(`Geocode ${j.status}: ${j.error_message ?? ''}`)
  const loc = j.results[0].geometry.location
  return { label: j.results[0].formatted_address, lat: loc.lat, lng: loc.lng }
}

async function probe({ label, lat, lng }) {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat.toFixed(7)}&location.longitude=${lng.toFixed(7)}` +
    `&requiredQuality=LOW&key=${KEY}`
  let res
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (e) {
    console.log(`\n❌ ${label} — network error: ${e.message}`)
    return
  }
  if (!res.ok) {
    let detail = ''
    try { detail = JSON.stringify((await res.json())?.error ?? {}).slice(0, 300) } catch {}
    console.log(`\n❌ ${label} — HTTP ${res.status}. ${detail}`)
    if (res.status === 403) console.log('   → Likely the "Solar API" is not enabled on this key (GCP console → APIs & Services → Enable APIs → Solar API).')
    if (res.status === 404) console.log('   → No building/solar coverage near this coordinate (expected for some rural points).')
    return
  }
  const body = await res.json()
  const segs = parseSegments(body)
  const mean = weightedMeanPitch(segs)
  console.log(`\n✅ ${label}`)
  console.log(`   imageryQuality : ${body.imageryQuality ?? '(none)'}`)
  const d = body.imageryDate
  console.log(`   imageryDate    : ${d ? `${d.year}-${String(d.month ?? 1).padStart(2,'0')}-${String(d.day ?? 1).padStart(2,'0')}` : '(none)'}`)
  console.log(`   roof segments  : ${segs.length}`)
  if (mean !== null) {
    const deg = Math.round(mean * 10) / 10
    console.log(`   mean pitch     : ${deg}°  → bucket "${bucket(deg)}"`)
    console.log(`   sloped area    : ${FOOTPRINT_SAMPLE} m² footprint → ${slopedArea(FOOTPRINT_SAMPLE, deg)} m² sloped (vs declared-standard ${Math.round(FOOTPRINT_SAMPLE*1.10*10)/10})`)
    const sample = segs.slice(0, 6).map(s => `${Math.round(s.pitchDegrees)}°/${Math.round(s.areaMeters2)}m²`).join('  ')
    console.log(`   segments       : ${sample}${segs.length > 6 ? '  …' : ''}`)
  } else {
    console.log('   ⚠ no usable pitch/area in roofSegmentStats')
  }
}

async function main() {
  if (!KEY) { console.error('No GOOGLE_SOLAR_API_KEY / GOOGLE_MAPS_API_KEY set.'); process.exit(1) }
  const args = process.argv.slice(2)
  let targets
  if (args.length >= 2 && Number.isFinite(parseFloat(args[0])) && Number.isFinite(parseFloat(args[1]))) {
    targets = [{ label: `(${args[0]}, ${args[1]})`, lat: parseFloat(args[0]), lng: parseFloat(args[1]) }]
  } else if (args.length === 1) {
    targets = [await geocode(args[0])]
  } else {
    targets = DEFAULTS
  }
  console.log(`Solar API smoke test — key ${KEY.slice(0, 8)}… (${targets.length} location${targets.length === 1 ? '' : 's'})`)
  for (const t of targets) await probe(t)
  console.log('\nDone.')
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
