// QuoteMate · probe-geoscape-apis
//
// One-shot diagnostic that tries every documented auth method against
// the user's real Geoscape key on a single safe endpoint, then dumps
// the actual response shapes for the working flow.
//
// Run:
//   node --env-file=.env.local scripts/probe-geoscape-apis.mjs \
//     "27 Smith Street, Penrith NSW 2750"
//
// Or with a default address (Sydney Opera House):
//   node --env-file=.env.local scripts/probe-geoscape-apis.mjs
//
// Read-only — no writes.

const KEY = process.env.GEOSCAPE_API_KEY
// CONFIRMED 2026-05-29: api.psma.com.au/v1 is the live host.
const BASE =
  process.env.GEOSCAPE_API_BASE_URL ?? 'https://api.psma.com.au/v1'

if (!KEY) {
  console.error('Missing GEOSCAPE_API_KEY (set it in .env.local).')
  process.exit(1)
}

const DEFAULT_QUERY = 'Sydney Opera House, Bennelong Point NSW 2000'
const query = process.argv[2] ?? DEFAULT_QUERY
// Param name confirmed: the Addresses API expects `addressString`,
// not `query`. Earlier probes that used `query` got HTTP 400 with the
// backend hint "[addressString] parameter is required".
const probeUrl = `${BASE}/addresses?addressString=${encodeURIComponent(query)}&perPage=1`
const ACCEPT = 'application/json'

function summarise(text, n = 600) {
  return text.length > n ? text.slice(0, n) + '…' : text
}

// ── Phase 1 — find a working auth method ───────────────────────────
const AUTH_VARIANTS = [
  { label: 'Authorization: <key> (raw, no Bearer)', headers: { Authorization: KEY }, url: probeUrl },
  { label: 'Authorization: Bearer <key>',           headers: { Authorization: `Bearer ${KEY}` }, url: probeUrl },
  { label: 'apikey: <key>',                         headers: { apikey: KEY }, url: probeUrl },
  { label: 'X-API-Key: <key>',                      headers: { 'X-API-Key': KEY }, url: probeUrl },
  { label: 'authorization (lowercase)',             headers: { authorization: KEY }, url: probeUrl },
  { label: '?key=<key> query param',                headers: {}, url: `${probeUrl}&key=${encodeURIComponent(KEY)}` },
  { label: '?auth=<key> query param',               headers: {}, url: `${probeUrl}&auth=${encodeURIComponent(KEY)}` },
  { label: '?apikey=<key> query param',             headers: {}, url: `${probeUrl}&apikey=${encodeURIComponent(KEY)}` },
]

async function probeAuth(variant) {
  const startedAt = Date.now()
  try {
    const res = await fetch(variant.url, {
      method: 'GET',
      headers: { Accept: ACCEPT, ...variant.headers },
    })
    const ms = Date.now() - startedAt
    const text = await res.text()
    return { ok: res.ok, status: res.status, ms, body: text }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - startedAt, body: e?.message ?? String(e) }
  }
}

// Auth has SUCCEEDED iff the response is NOT an Apigee gateway-level
// rejection. The two rejection signatures we know about:
//   • FailedToResolveAPIKey  → key not found in expected header / param
//   • InvalidApiKey          → wrong format (e.g., Bearer prefix)
// Everything else (200, 400, 403, 404, 422 …) means the request passed
// Apigee and reached the backend — i.e., the auth worked.
function authPassed(status, body) {
  if (status === 200) return true
  // Gateway faults are always 401 with the exact Apigee envelope.
  if (status === 401 && /FailedToResolveAPIKey|InvalidApiKey/i.test(body)) {
    return false
  }
  // Other 4xx/5xx → backend rejected something else; auth was OK.
  return status >= 400 && status < 600
}

async function findWorkingAuth() {
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('Phase 1 — auth-method probe')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Endpoint: GET ${probeUrl}`)
  let winner = null
  for (const v of AUTH_VARIANTS) {
    const r = await probeAuth(v)
    const passed = authPassed(r.status, r.body)
    const tag = r.status === 200 ? '✓ 200' : passed ? `~ ${r.status} (auth OK, backend complaint)` : `✗ ${r.status}`
    console.log(`\n${tag}  ${v.label}  (${r.ms}ms)`)
    console.log(`      ${summarise(r.body)}`)
    if (passed && !winner) winner = v
  }
  return winner
}

// ── Phase 2 — once we have a working auth, dump real response shapes ──
async function dumpResponseShapes(winner) {
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('Phase 2 — response shapes on each API')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Using auth: ${winner.label}`)

  async function call(label, urlPath) {
    const full = winner.url.includes('?key=') || winner.url.includes('?auth=') || winner.url.includes('?apikey=')
      ? // query-param auth — append the key to every URL
        `${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}${winner.url.split('?')[1].split('&').find((p) => p.startsWith('key=') || p.startsWith('auth=') || p.startsWith('apikey='))}`
      : `${BASE}${urlPath}`
    console.log(`\n─── ${label} ───`)
    console.log(`GET ${full}`)
    try {
      const t0 = Date.now()
      const res = await fetch(full, {
        method: 'GET',
        headers: { Accept: ACCEPT, ...winner.headers },
      })
      const ms = Date.now() - t0
      console.log(`HTTP ${res.status} · ${ms}ms`)
      const ct = res.headers.get('content-type') ?? '?'
      console.log(`content-type: ${ct}`)
      const text = await res.text()
      if (ct.includes('json')) {
        try {
          const j = JSON.parse(text)
          const out = JSON.stringify(j, null, 2)
          console.log(out.length > 4000 ? out.slice(0, 4000) + '\n…(truncated)…' : out)
          return j
        } catch {
          console.log(summarise(text, 1000))
        }
      } else {
        console.log(summarise(text, 1000))
      }
    } catch (e) {
      console.log(`ERROR: ${e?.message ?? String(e)}`)
    }
    return null
  }

  // 1. Predictive — confirmed param name: `query` (partial-text input)
  await call(
    'Predictive API',
    `/predictive/address?query=${encodeURIComponent(query)}&perPage=3`,
  )

  // 2. Addresses — confirmed param name: `addressString` (canonical lookup)
  const addrResp = await call(
    'Addresses API · search',
    `/addresses?addressString=${encodeURIComponent(query)}&perPage=1`,
  )

  function findId(obj) {
    if (!obj || typeof obj !== 'object') return null
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const id = findId(item)
        if (id) return id
      }
      return null
    }
    for (const k of ['id', 'addressId', 'address_id', 'pid', 'addressPid']) {
      const v = obj[k]
      if (typeof v === 'string' && v.length > 4) return v
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const id = findId(v)
        if (id) return id
      }
    }
    return null
  }
  const addressId = findId(addrResp)
  console.log(`\nDerived addressId: ${addressId ?? '(none found)'}`)

  if (addressId) {
    await call(
      'Buildings API · by addressId (query form)',
      `/buildings?addressId=${encodeURIComponent(addressId)}`,
    )
    await call(
      'Buildings API · by addressId (path /addresses/{id}/buildings)',
      `/addresses/${encodeURIComponent(addressId)}/buildings`,
    )
  }
}

// ── Main ──
async function main() {
  console.log(`Base URL: ${BASE}`)
  console.log(`Key:      ${KEY.slice(0, 6)}…${KEY.slice(-4)}`)
  console.log(`Query:    "${query}"`)

  const winner = await findWorkingAuth()
  if (!winner) {
    console.log('\n────────────────────────────────────────────────')
    console.log('No auth method returned HTTP 200. Possible causes:')
    console.log('  • The key is for a different environment (sandbox vs prod)')
    console.log('  • The key needs the Addresses product enabled in Geoscape Hub')
    console.log('  • The key is paused / awaiting approval')
    console.log('  • GEOSCAPE_API_BASE_URL needs adjusting')
    console.log('')
    console.log('Send the Phase 1 output above to the integrator.')
    return
  }
  console.log('\n────────────────────────────────────────────────')
  console.log(`✓ Working auth method:  ${winner.label}`)
  console.log('────────────────────────────────────────────────')
  await dumpResponseShapes(winner)
  console.log('\nSend the Phase 2 output above so the parser can be locked to the real field names.')
}

main().catch((e) => {
  console.error('Unhandled:', e)
  process.exit(1)
})
