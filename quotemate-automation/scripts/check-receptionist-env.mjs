#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// check-receptionist-env.mjs — audit each receptionist's .env.
//
//   node scripts/check-receptionist-env.mjs
//
// Reports whether each service is configured well enough to boot and quote.
// Prints NAMES and SET/UNSET only — never a value, never a fragment of one.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const OUT_ROOT = 'C:/Users/dalig/Desktop/MaintainTech/MaintainOrg/QuoteMax/Receptionists'
const TRADES = ['electrical', 'plumbing', 'roofing', 'painting', 'solar']

// Gate boot — main.ts exits without these.
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'CRON_SECRET',
]
// Not required to boot, but the pipeline is degraded without them.
const IMPORTANT = {
  APP_URL: 'customer links + self-calls',
  STRIPE_SECRET_KEY: 'deposit links',
  GOTENBERG_URL: 'quote PDFs',
  VOYAGE_API_KEY: 'RAG grounding for the estimator',
  GOOGLE_MAPS_API_KEY: 'geocoding / static maps',
  TWILIO_SMS_NUMBER: 'fallback outbound sender',
  TRADIE_NOTIFY_NUMBER: 'tradie alerts when a tenant has no owner_mobile',
}
const PER_TRADE = {
  roofing: { GEOSCAPE_API_KEY: 'primary roof measurement', GOOGLE_SOLAR_API_KEY: 'roof facets' },
  painting: { GOOGLE_SOLAR_API_KEY: 'wall area lookup' },
  solar: { GOOGLE_SOLAR_API_KEY: 'building insights' },
  electrical: {}, plumbing: {},
}

function parseEnv(text) {
  const out = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    out.set(key, line.slice(eq + 1).trim())
  }
  return out
}

const set = (m, k) => Boolean((m.get(k) ?? '').length)

let allGood = true
for (const trade of TRADES) {
  const repo = join(OUT_ROOT, `qm-${trade}-receptionist`)
  const envPath = join(repo, '.env')
  console.log(`\n── ${trade}`)

  if (!existsSync(envPath)) { console.log('   .env MISSING'); allGood = false; continue }
  const env = parseEnv(readFileSync(envPath, 'utf8'))
  const total = env.size
  const filled = [...env.values()].filter((v) => v.length).length

  let ignored = false
  try { execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: repo, stdio: 'pipe' }); ignored = true } catch { /* not ignored */ }
  let tracked = true
  try { tracked = execFileSync('git', ['ls-files', '.env'], { cwd: repo, encoding: 'utf8' }).trim().length > 0 } catch { /* ignore */ }

  const missingReq = REQUIRED.filter((k) => !set(env, k))
  const missingImp = Object.keys(IMPORTANT).filter((k) => env.has(k) && !set(env, k))
  const missingTrade = Object.keys(PER_TRADE[trade]).filter((k) => env.has(k) && !set(env, k))

  console.log(`   names=${total}  with values=${filled}  blank=${total - filled}`)
  console.log(`   gitignored=${ignored ? 'yes' : 'NO — FIX THIS'}  tracked_by_git=${tracked ? 'YES — FIX THIS' : 'no'}`)
  console.log(`   boots? ${missingReq.length === 0 ? 'YES — all 6 required set' : 'NO — missing: ' + missingReq.join(' ')}`)
  if (missingImp.length) console.log(`   degraded: ${missingImp.map((k) => `${k} (${IMPORTANT[k]})`).join(', ')}`)
  if (missingTrade.length) console.log(`   ${trade} gaps: ${missingTrade.map((k) => `${k} (${PER_TRADE[trade][k]})`).join(', ')}`)

  if (missingReq.length || !ignored || tracked) allGood = false
}

console.log(`\n${allGood ? 'All five can boot and no .env is tracked by git.' : 'See flags above.'}`)
console.log('Values were never read into this report — only set/unset.')
