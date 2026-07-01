// QuoteMate · probe-propradar-apis
//
// Read-only diagnostic: does the PropRadar API key return property
// attributes (bedrooms, bathrooms, car spaces, land size, property type,
// year built) for an address?
//
// It first reads the public OpenAPI spec to discover the exact
// /properties/search parameters + the property field schema (no key
// needed, no quota), then hits the live endpoints with the key:
//   GET /health  ->  GET /properties/search  ->  GET /properties/{id}
// and reports which target fields actually come back.
//
// Run:
//   node --env-file=.env.local scripts/probe-propradar-apis.mjs "31 Greens Rd, Coorparoo QLD 4151"
//
// Free tier = 50 calls/month, so this makes at most ~4 authed calls.

const KEY = process.env.PROPRADAR_API
const BASE = process.env.PROPRADAR_API_BASE_URL ?? 'https://api.propradar.com.au/v1'
if (!KEY) {
  console.error('Missing PROPRADAR_API (set it in .env.local).')
  process.exit(1)
}

const query = process.argv[2] ?? '31 Greens Rd, Coorparoo QLD 4151'

// Field aliases we care about for the painting "about your home" panel.
const TARGETS = {
  bedrooms: ['bedrooms', 'beds', 'bed'],
  bathrooms: ['bathrooms', 'baths', 'bath'],
  car_spaces: ['carSpaces', 'car_spaces', 'carspaces', 'parking', 'garages'],
  land_size: ['land_size_sqm', 'landArea', 'land_area', 'landSize', 'land_size', 'land_size_m2', 'landAreaSqm'],
  floor_area: ['floor_area_sqm', 'buildingArea', 'building_area', 'floorArea', 'floor_area', 'internalArea'],
  property_type: ['propertyType', 'property_type', 'type', 'propertyCategory'],
  year_built: ['yearBuilt', 'year_built', 'builtYear', 'yearOfConstruction', 'constructionYear', 'built'],
}

async function req(url, headers = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return {
      status: res.status,
      ms: Date.now() - t0,
      text,
      json,
      rate: res.headers.get('x-ratelimit-remaining') ?? res.headers.get('x-quota-per-month-remaining'),
    }
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: e?.message ?? String(e), json: null }
  }
}

const KEYH = { 'X-API-Key': KEY }

function parseAddress(s) {
  const m = s.match(/^(.*?),?\s*([A-Za-z\s]+?)\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s*(\d{4})?$/i)
  if (!m) return { street: s, suburb: '', state: '', postcode: '' }
  return { street: m[1].trim(), suburb: m[2].trim(), state: (m[3] || '').toUpperCase(), postcode: m[4] || '' }
}

// Walk an object tree; return the first present alias value for a target.
function findField(obj, aliases, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return undefined
  seen.add(obj)
  for (const a of aliases) {
    if (a in obj && obj[a] != null && obj[a] !== '') return obj[a]
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const f = findField(v, aliases, seen)
      if (f !== undefined) return f
    }
  }
  return undefined
}

function reportCoverage(obj, label) {
  console.log(`\n=== Field coverage from ${label} ===`)
  for (const [k, aliases] of Object.entries(TARGETS)) {
    const v = findField(obj, aliases)
    const has = v !== undefined
    console.log(`  [${has ? 'YES' : 'no '}] ${k}${has ? ` = ${JSON.stringify(v).slice(0, 80)}` : ''}`)
  }
}

async function discover() {
  console.log('\n=== Phase 0 - OpenAPI discovery (no key, no quota) ===')
  const { json, status } = await req(`${BASE}/openapi.json`)
  if (!json?.paths) {
    console.log(`  openapi.json HTTP ${status} - could not parse; will guess search params.`)
    return { params: [], schemaHasField: {} }
  }
  const searchOp = json.paths['/properties/search']?.get
  const params = (searchOp?.parameters ?? []).map((p) => ({ name: p.name, in: p.in, required: !!p.required }))
  console.log('  /properties/search params:', params.length ? params.map((p) => `${p.name}${p.required ? '*' : ''}(${p.in})`).join(', ') : '(none declared)')

  // Scan every schema's property names for our target fields.
  const schemas = json.components?.schemas ?? {}
  const allFieldNames = new Set()
  for (const s of Object.values(schemas)) {
    if (s?.properties) for (const f of Object.keys(s.properties)) allFieldNames.add(f)
  }
  console.log('\n  Target fields DEFINED anywhere in the OpenAPI schema:')
  const schemaHasField = {}
  for (const [k, aliases] of Object.entries(TARGETS)) {
    const hit = aliases.find((a) => allFieldNames.has(a))
    schemaHasField[k] = hit ?? null
    console.log(`    [${hit ? 'YES' : 'no '}] ${k}${hit ? ` -> "${hit}"` : ''}`)
  }
  return { params, schemaHasField, searchOp }
}

function buildSearchQuery(params) {
  const a = parseAddress(query)
  const names = new Set(params.map((p) => p.name))
  const qs = new URLSearchParams()
  // Prefer a single free-text search param.
  const freeText = ['q', 'query', 'search', 'address', 'term', 'text', 'fullAddress', 'keywords'].find((n) => names.has(n))
  if (freeText) {
    // Strip a trailing 4-digit postcode from the free-text line; it goes
    // in its own required `postcode` param.
    const withoutPc = query.replace(/\b\d{4}\b\s*$/, '').trim().replace(/,\s*$/, '')
    qs.set(freeText, withoutPc || query)
  } else if (params.length === 0) {
    qs.set('q', query) // best-effort default
  } else {
    if (names.has('suburb') && a.suburb) qs.set('suburb', a.suburb)
    if (names.has('state') && a.state) qs.set('state', a.state)
    for (const n of ['street', 'streetAddress', 'address']) if (names.has(n) && a.street) qs.set(n, a.street)
  }
  // `postcode` is a separate required param on /properties/search.
  if (names.has('postcode') && a.postcode) qs.set('postcode', a.postcode)
  return qs.toString()
}

function firstId(json) {
  const arr = Array.isArray(json)
    ? json
    : json?.data ?? json?.results ?? json?.properties ?? json?.items ?? json?.listings ?? json?.sold ?? json?.matches ?? []
  const list = Array.isArray(arr) ? arr : []
  for (const it of list) {
    if (it && typeof it === 'object') {
      for (const k of ['id', 'propertyId', 'property_id', 'pid']) {
        if (it[k] != null) return { id: String(it[k]), sample: it }
      }
    }
  }
  return { id: null, sample: list[0] ?? null }
}

async function search(qs, label) {
  const url = `${BASE}/properties/search${qs ? `?${qs}` : ''}`
  console.log(`\nGET ${url.replace(KEY, 'pr_live_...')}`)
  const r = await req(url, KEYH)
  console.log(`HTTP ${r.status}${r.rate ? ` rate-remaining=${r.rate}` : ''}  (${r.ms}ms)`)
  console.log(`  body: ${r.text.slice(0, 600)}`)
  if (r.status !== 200) return null
  return r.json
}

async function main() {
  console.log(`Base:  ${BASE}`)
  console.log(`Key:   ${KEY.slice(0, 8)}…${KEY.slice(-4)}`)
  console.log(`Query: "${query}"`)

  const { params } = await discover()

  console.log('\n=== Phase 1 - health (key auth check) ===')
  const health = await req(`${BASE}/health`, KEYH)
  console.log(`GET /health -> HTTP ${health.status}${health.rate ? ` rate-remaining=${health.rate}` : ''}  ${health.text.slice(0, 200)}`)
  if (health.status === 401 || health.status === 403) {
    console.log('\nKey rejected on /health - auth problem, stopping.')
    return
  }

  console.log('\n=== Phase 2 - property search ===')
  let results = await search(buildSearchQuery(params), 'address')
  let { id, sample } = firstId(results ?? {})

  // Fallback: the exact address may not be on-market/sold. Try a broad
  // suburb search so we can still confirm the DATA SHAPE.
  if (!id) {
    const a = parseAddress(query)
    console.log(`\n  No property id for the exact address. Falling back to a suburb search (${a.suburb || 'Bondi'} ${a.state || 'NSW'})...`)
    const fbNames = new Set(params.map((p) => p.name))
    const fbFree = ['q', 'query', 'search', 'address', 'term', 'text'].find((n) => fbNames.has(n))
    const fbQs = new URLSearchParams()
    if (fbFree) fbQs.set(fbFree, `${a.suburb || 'Bondi'} ${a.state || 'NSW'}`)
    if (fbNames.has('postcode') && a.postcode) fbQs.set('postcode', a.postcode)
    results = await search(fbQs.toString(), 'suburb')
    ;({ id, sample } = firstId(results ?? {}))
  }

  if (sample) reportCoverage(sample, 'search result row')

  // Fallback 2: pull real properties from the suburb listings endpoint so
  // we can confirm the data shape even when the exact address isn't listed.
  if (!id) {
    const a = parseAddress(query)
    const st = (a.state || 'NSW').toLowerCase()
    const sub = (a.suburb || 'bondi').toLowerCase().replace(/\s+/g, '-')
    for (const kind of ['listings', 'sold']) {
      const url = `${BASE}/suburbs/${st}/${sub}/${kind}?limit=3`
      console.log(`\nGET ${url}`)
      const r = await req(url, KEYH)
      console.log(`HTTP ${r.status}${r.rate ? ` rate-remaining=${r.rate}` : ''}  ${r.text.slice(0, 700)}`)
      if (r.status === 200 && r.json) {
        const picked = firstId(r.json)
        if (picked.sample) {
          reportCoverage(picked.sample, `suburb ${kind} row`)
          id = picked.id ?? id
          sample = picked.sample
          break
        }
      }
    }
  }

  if (!id) {
    console.log('\nNo property id resolved - cannot fetch detail. See search output above.')
    return
  }

  console.log(`\n=== Phase 3 - property detail (GET /properties/${id}) ===`)
  const det = await req(`${BASE}/properties/${encodeURIComponent(id)}`, KEYH)
  console.log(`HTTP ${det.status}${det.rate ? ` rate-remaining=${det.rate}` : ''}  (${det.ms}ms)`)
  console.log(det.text.slice(0, 2200))
  if (det.json) reportCoverage(det.json, 'property detail')
}

main().catch((e) => {
  console.error('Unhandled:', e)
  process.exit(1)
})
