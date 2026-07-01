// QuoteMate · probe-geoscape-building-attrs
//
// Read-only diagnostic for the PAINTING enrichment: does the Geoscape key
// return the premium Insight-Pack attributes we want (eave/roof height,
// total floor area, facade/wall material, building use) PER-ADDRESS via the
// live API — or only as bulk PSV? Resolves address -> building, dumps the
// building summary's full `links` object, fetches every linked sub-resource,
// and also tries the `?include=` inline mechanism.
//
// Run:
//   node --env-file=.env.local scripts/probe-geoscape-building-attrs.mjs "31 Greens Rd, Coorparoo QLD 4151" QLD
//
// No writes. Costs a handful of Geoscape credits.

const KEY = process.env.GEOSCAPE_API_KEY
const BASE = process.env.GEOSCAPE_API_BASE_URL ?? 'https://api.psma.com.au/v1'
if (!KEY) {
  console.error('Missing GEOSCAPE_API_KEY (set it in .env.local).')
  process.exit(1)
}

const query = process.argv[2] ?? '31 Greens Rd, Coorparoo QLD 4151'
const state = process.argv[3] ?? (query.match(/\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/i)?.[1] ?? 'QLD').toUpperCase()

const H = { Authorization: KEY, Accept: 'application/json' }

async function get(url) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', headers: H })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return { status: res.status, ms: Date.now() - t0, text, json }
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: e?.message ?? String(e), json: null }
  }
}

function abs(link) {
  try {
    const b = new URL(BASE)
    return new URL(link, `${b.protocol}//${b.host}`).toString()
  } catch {
    return BASE.replace(/\/v1\/?$/, '') + link
  }
}

// Attributes we want for painting enrichment (probe the include= mechanism).
const WANT_INCLUDES = [
  'eaveHeight', 'eave_height', 'roofHeight', 'roof_height', 'height',
  'totalFloorArea', 'total_floor_area', 'floorArea',
  'buildingUse', 'building_use', 'use',
  'facadeMaterial', 'facade_material', 'primaryFacadeMaterial', 'wallMaterial',
  'estimatedLevels', 'roofShape', 'area', 'groundElevation', 'centroid',
  'captureMethod', 'capture_method', 'dateLastCaptured',
]

async function main() {
  console.log(`Base:  ${BASE}`)
  console.log(`Key:   ${KEY.slice(0, 6)}…${KEY.slice(-4)}`)
  console.log(`Query: "${query}"  state=${state}`)

  // 1. address -> addressId
  const addrUrl = `${BASE}/addresses?addressString=${encodeURIComponent(query)}&state=${encodeURIComponent(state)}&perPage=1`
  console.log(`\n=== 1. Addresses ===\nGET ${addrUrl}`)
  const addr = await get(addrUrl)
  console.log(`HTTP ${addr.status}  ${addr.text.slice(0, 400)}`)
  const addressId =
    addr.json?.data?.[0]?.addressId ??
    addr.json?.data?.[0]?.id ??
    addr.json?.data?.[0]?.pid ?? null
  if (!addressId) {
    console.log('No addressId — stopping.')
    return
  }
  console.log(`addressId = ${addressId}`)

  // 2. buildings by addressId — dump FULL summary (all links).
  const bUrl = `${BASE}/buildings?addressId=${encodeURIComponent(addressId)}`
  console.log(`\n=== 2. Buildings summary (full — note the links object) ===\nGET ${bUrl}`)
  const blist = await get(bUrl)
  console.log(`HTTP ${blist.status}`)
  console.log(blist.text.length > 3000 ? blist.text.slice(0, 3000) + '…' : blist.text)

  const first =
    blist.json?.data?.[0] ?? blist.json?.results?.[0] ?? blist.json?.buildings?.[0] ?? null
  if (!first) {
    console.log('No building record — stopping.')
    return
  }
  const buildingId = first.buildingId ?? first.building_id ?? first.pid ?? first.id ?? null
  const links = first.links && typeof first.links === 'object' ? first.links : {}
  console.log(`\nbuildingId = ${buildingId}`)
  console.log(`link keys  = ${Object.keys(links).join(', ') || '(none)'}`)

  // 3. Fetch EVERY linked sub-resource and dump it.
  console.log('\n=== 3. Every linked sub-resource ===')
  for (const [name, link] of Object.entries(links)) {
    if (typeof link !== 'string') continue
    const r = await get(abs(link))
    console.log(`\n--- ${name}  (HTTP ${r.status}) ---`)
    console.log(r.text.length > 900 ? r.text.slice(0, 900) + '…' : r.text)
  }

  // 4. Try the include= inline mechanism on the building resource.
  if (buildingId) {
    const incUrl = `${BASE}/buildings/${encodeURIComponent(buildingId)}?include=${WANT_INCLUDES.join(',')}`
    console.log(`\n=== 4. include= inline attributes ===\nGET ${incUrl}`)
    const inc = await get(incUrl)
    console.log(`HTTP ${inc.status}`)
    console.log(inc.text.length > 3000 ? inc.text.slice(0, 3000) + '…' : inc.text)
  }
}

main().catch((e) => {
  console.error('Unhandled:', e)
  process.exit(1)
})
