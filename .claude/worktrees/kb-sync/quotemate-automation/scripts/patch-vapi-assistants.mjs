// Two related Vapi-side patches after the 2026-05-26 voice-path diagnosis:
//
//   1. Add `tenant_id` (and `trade`) to Peppers Plumbing + Sparky assistant
//      metadata so the webhook's cheap resolution path works for them
//      (today only Atomic Electrical has it; the other two rely on the
//      DB fallback).
//
//   2. Rename the now-dormant legacy assistant 0c0ae33e-... so a future
//      audit immediately knows it's deprecated. The 3 phone numbers that
//      used to point at it were re-routed to Sparky earlier this session.
//
// Pre-flight: fetches the live metadata for each target assistant and
// verifies they're in the "missing tenant_id" state (refuses to overwrite
// metadata that has already been patched). Post-verify: re-GETs each
// assistant + prints the new metadata + name.
//
// Vapi PATCH on /assistant — metadata is REPLACED, not merged. To avoid
// dropping the existing `trades` array we read it first, then send the
// merged object back. Same logic for name.

import pg from 'pg'

const apiKey = process.env.VAPI_API_KEY
if (!apiKey) { console.error('Missing VAPI_API_KEY'); process.exit(1) }
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

const LEGACY_ASSISTANT_ID = '0c0ae33e-2a51-4dff-8e60-2b35b47ddf2e'
const LEGACY_NEW_NAME = 'DEPRECATED — legacy single-tenant assistant (replaced 2026-05-26)'

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

  // ── 1. Load Peppers + Sparky from DB ──
  console.log('─── pre-flight: load target tenants from DB ──')
  const { rows: targets } = await pgc.query(`
    select id, business_name, vapi_assistant_id, trade, trades
      from tenants
     where business_name in ('Peppers Plumbing', 'Sparky')
     order by business_name`)
  if (targets.length !== 2) {
    console.error(`ABORTING: expected 2 target tenants, got ${targets.length}`)
    process.exit(2)
  }
  for (const t of targets) {
    console.log(`  ${t.business_name.padEnd(22)} tenant=${t.id}  vapi=${t.vapi_assistant_id}  trade=${t.trade}  trades=${JSON.stringify(t.trades)}`)
  }

  // ── 2. Pre-flight each target: confirm metadata is in the "missing
  //      tenant_id" state. Refuse to PATCH if someone already patched it
  //      or the assistant is gone. ──
  console.log('\n─── pre-flight: verify each is missing tenant_id in metadata ──')
  for (const t of targets) {
    const r = await vapi('GET', `/assistant/${t.vapi_assistant_id}`)
    if (!r.ok) {
      console.error(`  ${t.business_name}  FETCH FAILED (HTTP ${r.status})`)
      process.exit(3)
    }
    const md = r.data.metadata ?? {}
    console.log(`  ${t.business_name.padEnd(22)} current metadata: ${JSON.stringify(md)}`)
    if (md.tenant_id) {
      console.log(`  ${t.business_name}: already has tenant_id — refusing to overwrite. Skipping this target.`)
      t.skip = true
    } else {
      t.currentMetadata = md
    }
  }

  // ── 3. PATCH each target with merged metadata ──
  console.log('\n─── executing PATCH on Peppers + Sparky ──')
  for (const t of targets) {
    if (t.skip) continue
    const newMetadata = {
      ...t.currentMetadata,
      tenant_id: t.id,
      trade: t.trade ?? t.currentMetadata.trade ?? null,
      trades: Array.isArray(t.trades) && t.trades.length > 0
        ? t.trades
        : (t.currentMetadata.trades ?? [t.trade].filter(Boolean)),
    }
    console.log(`  PATCH ${t.business_name}  → metadata=${JSON.stringify(newMetadata)}`)
    const r = await vapi('PATCH', `/assistant/${t.vapi_assistant_id}`, { metadata: newMetadata })
    if (!r.ok) {
      console.error(`    FAILED (HTTP ${r.status}): ${r.raw.slice(0, 300)}`)
      process.exit(4)
    }
    console.log(`    OK · server metadata now: ${JSON.stringify(r.data.metadata)}`)
  }

  // ── 4. Rename the legacy assistant ──
  console.log('\n─── rename legacy assistant ──')
  const r0 = await vapi('GET', `/assistant/${LEGACY_ASSISTANT_ID}`)
  if (!r0.ok) {
    console.error(`  FETCH legacy assistant FAILED (HTTP ${r0.status})`)
    process.exit(5)
  }
  console.log(`  current name: "${r0.data.name}"`)
  console.log(`  new name:     "${LEGACY_NEW_NAME}"`)
  const rN = await vapi('PATCH', `/assistant/${LEGACY_ASSISTANT_ID}`, { name: LEGACY_NEW_NAME })
  if (!rN.ok) {
    console.error(`  RENAME FAILED (HTTP ${rN.status}): ${rN.raw.slice(0, 300)}`)
    process.exit(6)
  }
  console.log(`  OK · server name now: "${rN.data.name}"`)

  // ── 5. Post-verify ──
  console.log('\n─── post-verify ──')
  for (const t of targets) {
    const r = await vapi('GET', `/assistant/${t.vapi_assistant_id}`)
    const md = r.data.metadata ?? {}
    const okFlag = md.tenant_id === t.id ? '✓' : 'MISMATCH (!)'
    console.log(`  ${t.business_name.padEnd(22)} ${okFlag}  metadata=${JSON.stringify(md)}`)
  }
  const rL = await vapi('GET', `/assistant/${LEGACY_ASSISTANT_ID}`)
  console.log(`  legacy 0c0ae33e-... name now: "${rL.data.name}"`)

  console.log('\nAll Vapi patches applied.')
} catch (e) {
  console.error('SCRIPT FAILED:', e.message)
  process.exitCode = 1
} finally {
  await pgc.end()
}
