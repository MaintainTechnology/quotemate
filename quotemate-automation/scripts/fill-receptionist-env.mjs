#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// fill-receptionist-env.mjs — copy secrets from this monorepo's .env.local
// into each receptionist's gitignored .env.
//
//   node scripts/fill-receptionist-env.mjs           # fill all five
//   node scripts/fill-receptionist-env.mjs roofing   # just one
//   node scripts/fill-receptionist-env.mjs --dry     # report, write nothing
//
// Rules this script follows:
//   · Only writes names the receptionist's OWN .env already lists (i.e. that
//     its code actually reads). The monorepo has Clerk/Vercel/Sentry/Canva
//     keys these services never touch — those stay put.
//   · Never prints a secret value. Output is names and counts only.
//   · Backs up an existing .env to .env.bak.<n> before touching it.
//   · Leaves the grouped comment structure intact — only `KEY=` lines change.
//   · Skips the deployment-shaped vars (PORT, APP_URL, …) which must be set
//     per-environment, not inherited. See DEPLOYMENT_VARS below.
//
// .env is gitignored in every receptionist repo — verified before writing.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const MONO_ENV = 'C:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/.env.local'
const OUT_ROOT = 'C:/Users/dalig/Desktop/MaintainTech/MaintainOrg/QuoteMax/Receptionists'

const TRADES = {
  electrical: 3101, plumbing: 3102, roofing: 3103, painting: 3104, solar: 3105,
}

// Values that describe WHERE this service runs. Inheriting them from the web
// app is wrong, so they are set explicitly rather than copied.
const DEPLOYMENT_VARS = new Set([
  'PORT', 'NODE_ENV', 'RAILWAY_PUBLIC_DOMAIN', 'APP_URL', 'NEXT_PUBLIC_APP_URL',
])

/** Parse KEY=VALUE from a .env file. Last occurrence wins, matching dotenv. */
function parseEnv(text) {
  const out = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let val = line.slice(eq + 1).trim()
    // Strip matching surrounding quotes.
    if ((val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
        (val.startsWith("'") && val.endsWith("'") && val.length > 1)) {
      val = val.slice(1, -1)
    }
    out.set(key, val)
  }
  return out
}

function isGitIgnored(repoDir, file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: repoDir, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const wanted = args.filter((a) => !a.startsWith('--'))
const list = wanted.length ? wanted : Object.keys(TRADES)

if (!existsSync(MONO_ENV)) {
  console.error(`monorepo .env.local not found at ${MONO_ENV}`)
  process.exit(1)
}
const source = parseEnv(readFileSync(MONO_ENV, 'utf8'))
console.log(`source: .env.local — ${source.size} variables\n`)

// The public URL of the WEB APP — not of this receptionist. Most APP_URL
// reads build customer-facing links (/upload/{token}, /q/choose/{token},
// /api/q/*/pdf) that only the web app serves, so a receptionist URL here
// would hand customers 404s.
//
// A localhost value in .env.local is the monorepo's dev setting and is
// useless once deployed, so it is deliberately ignored in favour of the
// production domain. Override by editing .env after this runs.
const PROD_WEB_APP = 'https://www.quotemax.com.au'
const candidate = (source.get('APP_URL') || source.get('NEXT_PUBLIC_APP_URL') || '').replace(/\/$/, '')
const webAppUrl = /^https:\/\//.test(candidate) && !/localhost|127\.0\.0\.1/.test(candidate)
  ? candidate
  : PROD_WEB_APP
if (candidate && webAppUrl !== candidate) {
  console.log(`note: .env.local APP_URL is "${candidate}" (dev) — using ${PROD_WEB_APP} for customer links\n`)
}

for (const trade of list) {
  if (!(trade in TRADES)) { console.error(`unknown trade: ${trade}`); process.exitCode = 1; continue }
  const repo = join(OUT_ROOT, `qm-${trade}-receptionist`)
  const envPath = join(repo, '.env')

  if (!existsSync(envPath)) {
    console.log(`${trade.padEnd(11)} SKIP — no .env (run export-receptionist.mjs first)`)
    continue
  }
  // Refuse to write secrets into a file git would track.
  if (!isGitIgnored(repo, '.env')) {
    console.log(`${trade.padEnd(11)} REFUSED — .env is NOT gitignored in this repo`)
    process.exitCode = 1
    continue
  }

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  const filled = []
  const blank = []
  const kept = []

  const out = lines.map((line) => {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!m) return line
    const [, key, existing] = m

    if (DEPLOYMENT_VARS.has(key)) {
      // Set deliberately, not inherited.
      if (key === 'PORT') return `PORT=${TRADES[trade]}`
      if (key === 'NODE_ENV') return 'NODE_ENV=development'
      // APP_URL: the web app, because most reads build CUSTOMER links
      // (/upload, /q/choose, /api/q/*/pdf) that only the web app serves.
      if (key === 'APP_URL') return `APP_URL=${webAppUrl}`
      if (key === 'NEXT_PUBLIC_APP_URL') return `NEXT_PUBLIC_APP_URL=${webAppUrl}`
      return line // RAILWAY_PUBLIC_DOMAIN — injected by the platform
    }

    // Never clobber a value already present in the receptionist's .env.
    if (existing.trim()) { kept.push(key); return line }

    const val = source.get(key)
    if (val === undefined || val === '') { blank.push(key); return line }
    filled.push(key)
    return `${key}=${val}`
  })

  if (!dry) {
    let n = 0
    while (existsSync(`${envPath}.bak.${n}`)) n++
    copyFileSync(envPath, `${envPath}.bak.${n}`)
    writeFileSync(envPath, out.join('\n'))
  }

  console.log(
    `${trade.padEnd(11)} filled=${String(filled.length).padStart(3)}  ` +
    `still-blank=${String(blank.length).padStart(3)}  kept=${kept.length}${dry ? '  (dry run)' : ''}`,
  )
  if (blank.length) console.log(`            no value in .env.local: ${blank.join(' ')}`)
}

console.log('\n.env files are gitignored — verified per repo before writing.')
if (dry) console.log('Dry run: nothing was written.')
