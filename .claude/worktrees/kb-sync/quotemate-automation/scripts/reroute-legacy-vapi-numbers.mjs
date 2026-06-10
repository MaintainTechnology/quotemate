// Re-route the 3 legacy Vapi numbers to Sparky's assistant.
//
// Context: orphan-call audit 2026-05-26 found 3 Vapi phone numbers
// (+61481613464, +16185981809, +61489083371) routing to a shared legacy
// assistant `0c0ae33e-2a51-4dff-8e60-2b35b47ddf2e` that is NOT on the
// tenants table. Every call through them landed as an orphan in the
// `calls` table (tenant_id IS NULL). User signed off on re-pointing
// those 3 numbers at Sparky's tenant assistant so future test calls
// are attributed cleanly.
//
// Pre-flight:
//   1. Confirms each of the 3 numbers currently routes to
//      0c0ae33e-... (refuses to PATCH if they've already moved)
//   2. Confirms Sparky's assistant id matches what's stored on the
//      tenants row for Sparky
// Post-verify: re-queries Vapi to confirm the 3 numbers now point at
//   Sparky's assistant.
//
// This script makes NO DB writes. Only PATCHes the Vapi phone-number
// resource.

import pg from 'pg'

const apiKey = process.env.VAPI_API_KEY
if (!apiKey) {
  console.error('Missing VAPI_API_KEY in .env.local')
  process.exit(1)
}
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const LEGACY_ASSISTANT_ID = '0c0ae33e-2a51-4dff-8e60-2b35b47ddf2e'
const LEGACY_NUMBERS = [
  { number: '+61481613464', vapiPhoneId: 'b93aca94-12b3-4e3c-aec3-3a32315b7cb8', label: 'QuoteMate - AU - 2' },
  { number: '+16185981809', vapiPhoneId: 'e668d05a-2c6e-42e6-b897-8ab6ece07c9a', label: 'QuoteMate - US - 1' },
  { number: '+61489083371', vapiPhoneId: 'a1faafa5-c98e-4fcc-8d26-729031a5b80f', label: 'QuoteMate - AU - 1' },
]

async function vapi(method, path, body) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { ok: res.ok, status: res.status, data, raw: text }
}

const { Client } = pg
const pgc = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await pgc.connect()

  // Step 1: confirm Sparky's vapi_assistant_id from the DB.
  console.log('─── pre-flight: load Sparky from tenants ──')
  const { rows: sparky } = await pgc.query(
    `select id, business_name, vapi_assistant_id from tenants where business_name = 'Sparky' limit 1`
  )
  if (sparky.length !== 1 || !sparky[0].vapi_assistant_id) {
    console.error('ABORTING: Sparky not found or has no vapi_assistant_id')
    process.exit(2)
  }
  const SPARKY_ASSISTANT_ID = sparky[0].vapi_assistant_id
  console.log(`  Sparky tenant_id          ${sparky[0].id}`)
  console.log(`  Sparky vapi_assistant_id  ${SPARKY_ASSISTANT_ID}`)

  // Step 2: verify each of the 3 legacy numbers currently routes to the
  // legacy assistant (refuse to PATCH if they've already moved).
  console.log('\n─── pre-flight: verify legacy routing ──')
  for (const n of LEGACY_NUMBERS) {
    const r = await vapi('GET', `/phone-number/${n.vapiPhoneId}`)
    if (!r.ok) {
      console.error(`  ${n.number}  FETCH FAILED (HTTP ${r.status}): ${r.raw.slice(0, 200)}`)
      process.exit(3)
    }
    const currentAssistant = r.data.assistantId
    console.log(`  ${n.number}  currently → ${currentAssistant}`)
    if (currentAssistant !== LEGACY_ASSISTANT_ID) {
      console.error(`\n  ABORTING: ${n.number} does NOT currently point at the legacy assistant.`)
      console.error(`  Expected: ${LEGACY_ASSISTANT_ID}`)
      console.error(`  Found:    ${currentAssistant}`)
      console.error(`  Either someone moved it manually, or the audit data is stale. Re-confirm before re-running.`)
      process.exit(4)
    }
  }

  // Step 3: PATCH each number to Sparky.
  console.log('\n─── executing PATCH per number ──')
  for (const n of LEGACY_NUMBERS) {
    console.log(`  PATCH ${n.number} (${n.label}) → ${SPARKY_ASSISTANT_ID}`)
    const r = await vapi('PATCH', `/phone-number/${n.vapiPhoneId}`, {
      assistantId: SPARKY_ASSISTANT_ID,
    })
    if (!r.ok) {
      console.error(`    FAILED (HTTP ${r.status}): ${r.raw.slice(0, 200)}`)
      process.exit(5)
    }
    console.log(`    OK · new assistantId=${r.data.assistantId}`)
  }

  // Step 4: post-verify.
  console.log('\n─── post-verify ──')
  for (const n of LEGACY_NUMBERS) {
    const r = await vapi('GET', `/phone-number/${n.vapiPhoneId}`)
    const match = r.data.assistantId === SPARKY_ASSISTANT_ID
    console.log(`  ${n.number}  → ${r.data.assistantId}  ${match ? '✓' : 'MISMATCH (!)'}`)
  }

  // Step 5: what happened to the legacy assistant?
  console.log(`\n─── legacy assistant 0c0ae33e-... is now unreferenced ──`)
  console.log(`  It still EXISTS on your Vapi account but no phone number points at it.`)
  console.log(`  Calls through the 3 legacy numbers will now hit Sparky's assistant`)
  console.log(`  and land in the DB with tenant_id=${sparky[0].id} (Sparky) instead of NULL.`)
} catch (e) {
  console.error('SCRIPT FAILED:', e.message)
  process.exitCode = 1
} finally {
  await pgc.end()
}
