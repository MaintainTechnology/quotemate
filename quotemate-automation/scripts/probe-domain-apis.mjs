// QuoteMate · probe-domain-apis
//
// Read-only diagnostic: does the Domain API key return property
// attributes (bedrooms, bathrooms, car spaces, land area, property type,
// year built) for an address? Tries several auth methods, then walks the
// Properties suggest -> details flow and reports which target fields
// actually come back for the queried address.
//
// Run:
//   node --env-file=.env.local scripts/probe-domain-apis.mjs "31 Greens Rd, Coorparoo QLD 4151"
//
// No writes. Hits the live Domain API (counts against your plan quota).

const KEY = process.env.DOMAIN_API
const BASE = process.env.DOMAIN_API_BASE_URL ?? 'https://api.domain.com.au'

if (!KEY) {
  console.error('Missing DOMAIN_API (set it in .env.local).')
  process.exit(1)
}

const DEFAULT_QUERY = '31 Greens Rd, Coorparoo QLD 4151'
const query = process.argv[2] ?? DEFAULT_QUERY
const ACCEPT = 'application/json'

function summarise(text, n = 500) {
  return text.length > n ? text.slice(0, n) + '…' : text
}

// Domain "API Key" projects authenticate with the key in a header; OAuth
// projects need a bearer token exchanged from client_id/secret (which we
// do NOT have here). We try the documented key-auth shapes.
const AUTH_VARIANTS = [
  { label: 'X-Api-Key: <key>', headers: { 'X-Api-Key': KEY } },
  { label: 'Authorization: Bearer <key>', headers: { Authorization: `Bearer ${KEY}` } },
  { label: 'apikey: <key>', headers: { apikey: KEY } },
  { label: '?api_key=<key> query', headers: {}, query: `api_key=${encodeURIComponent(KEY)}` },
]

async function get(path, variant) {
  const sep = path.includes('?') ? '&' : '?'
  const url = variant.query ? `${BASE}${path}${sep}${variant.query}` : `${BASE}${path}`
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: ACCEPT, ...variant.headers } })
    const ms = Date.now() - t0
    const text = await res.text()
    const remaining = res.headers.get('x-quota-per-day-remaining') ?? res.headers.get('x-ratelimit-remaining')
    return { ok: res.ok, status: res.status, ms, text, url, remaining }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, text: e?.message ?? String(e), url }
  }
}

const SUGGEST_PATH = `/v1/properties/_suggest?terms=${encodeURIComponent(query)}&pageSize=5`

async function findAuth() {
  console.log('\n=== Phase 1 - auth probe (GET /v1/properties/_suggest) ===')
  console.log(`GET ${BASE}${SUGGEST_PATH}`)
  let winner = null
  for (const v of AUTH_VARIANTS) {
    const r = await get(SUGGEST_PATH, v)
    const tag = r.status === 200 ? '200 OK' : `HTTP ${r.status}`
    console.log(`\n[${tag}] ${v.label}  (${r.ms}ms)${r.remaining ? ` quota-remaining=${r.remaining}` : ''}`)
    console.log(`   ${summarise(r.text, 400)}`)
    if (r.status === 200 && !winner) winner = v
  }
  return winner
}

// Probe representative endpoints for each Domain package using the
// confirmed X-Api-Key mechanism, and print the status so we can read off
// which packages this project is entitled to. 200/400/404 = in-plan;
// 403 "not permitted on project" = package NOT enabled.
async function mapPackages() {
  console.log('\n=== Phase 1b - package entitlement map (X-Api-Key) ===')
  const xkey = { headers: { 'X-Api-Key': KEY } }
  const probes = [
    { m: 'GET', path: `/v1/properties/_suggest?terms=${encodeURIComponent(query)}&pageSize=1`, pkg: 'Properties & Locations - property suggest (beds/baths path)' },
    { m: 'GET', path: `/v1/addressLocators?searchLevel=Address&addressString=${encodeURIComponent(query)}`, pkg: 'Properties & Locations - address locator' },
    { m: 'POST', path: `/v1/listings/residential/_search`, pkg: 'Agents & Listings - live listing search', body: { listingType: 'Sale', pageSize: 1 } },
    { m: 'GET', path: `/v1/me`, pkg: 'Project identity / me' },
    { m: 'GET', path: `/v1/agencies?q=ray%20white&pageSize=1`, pkg: 'Agents & Listings - agencies' },
  ]
  for (const p of probes) {
    const res = await request(p.m, p.path, xkey, p.body)
    const permitted = res.status !== 403 && res.status !== 0
    console.log(`  [HTTP ${res.status}] ${permitted ? 'IN-PLAN ' : 'blocked '} ${p.pkg}`)
    if (res.status !== 403) console.log(`     ${summarise(res.text, 220)}`)
  }
}

async function request(method, path, variant, body) {
  const sep = path.includes('?') ? '&' : '?'
  const url = variant.query ? `${BASE}${path}${sep}${variant.query}` : `${BASE}${path}`
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: ACCEPT,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...variant.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, text: await res.text(), url }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, text: e?.message ?? String(e), url }
  }
}

function findId(obj) {
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const id = findId(it)
      if (id) return id
    }
    return null
  }
  if (obj && typeof obj === 'object') {
    if (typeof obj.id === 'string' && obj.id.length > 2) return obj.id
    if (typeof obj.id === 'number') return String(obj.id)
    for (const v of Object.values(obj)) {
      const id = findId(v)
      if (id) return id
    }
  }
  return null
}

// The fields we care about for the painting "about your home" panel.
const TARGET_FIELDS = [
  'bedrooms', 'bathrooms', 'carSpaces', 'landAreaSqm', 'buildingAreaSqm',
  'propertyType', 'propertyCategory', 'yearBuilt', 'features', 'isResidential', 'address',
]

async function main() {
  console.log(`Base:  ${BASE}`)
  console.log(`Key:   ${KEY.slice(0, 5)}…${KEY.slice(-4)}`)
  console.log(`Query: "${query}"`)

  const winner = await findAuth()
  if (!winner) {
    // The key auths (X-Api-Key => 403 "not permitted", not 401) but the
    // property lookup isn't in this project's plan. Map which packages the
    // project CAN reach so we know exactly what the key is scoped for.
    await mapPackages()
    console.log('\n----------------------------------------------------------------')
    console.log('No 200 from /v1/properties/_suggest.')
    console.log('  403 "Operation not permitted on project" => key is VALID (X-Api-Key),')
    console.log('  but the project lacks the package that owns this endpoint.')
    console.log('  Beds/baths live in "Properties & Locations" (/v1/properties/{id}).')
    return
  }
  console.log(`\nWorking auth: ${winner.label}`)

  console.log('\n=== Phase 2 - suggest response shape ===')
  const sug = await get(SUGGEST_PATH, winner)
  let sugJson = null
  try { sugJson = JSON.parse(sug.text) } catch { /* non-JSON */ }
  console.log(summarise(sug.text, 1800))

  const id = findId(sugJson)
  console.log(`\nDerived property id: ${id ?? '(none found)'}`)
  if (!id) {
    console.log('Suggest returned no property id - cannot fetch details.')
    return
  }

  console.log('\n=== Phase 3 - property details (GET /v1/properties/{id}) ===')
  const det = await get(`/v1/properties/${encodeURIComponent(id)}`, winner)
  console.log(`HTTP ${det.status}${det.remaining ? ` quota-remaining=${det.remaining}` : ''}`)
  let detJson = null
  try { detJson = JSON.parse(det.text) } catch { /* non-JSON */ }
  console.log(summarise(det.text, 2600))

  if (detJson && typeof detJson === 'object') {
    console.log('\n=== Field coverage (the answer to the question) ===')
    for (const f of TARGET_FIELDS) {
      const has = f in detJson && detJson[f] != null && !(Array.isArray(detJson[f]) && detJson[f].length === 0)
      console.log(`  [${has ? 'YES' : 'no '}] ${f}${has ? ` = ${JSON.stringify(detJson[f]).slice(0, 90)}` : ''}`)
    }
  } else if (det.status === 403) {
    console.log('\n403 on details - suggest is in-plan but property DETAILS is a separate package/scope not on this key.')
  }
}

main().catch((e) => {
  console.error('Unhandled:', e)
  process.exit(1)
})
