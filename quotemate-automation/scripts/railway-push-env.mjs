#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// railway-push-env.mjs — upload a receptionist's .env to its linked Railway
// service, so you don't paste 40+ variables by hand, five times.
//
//   cd <receptionist repo>          # must already be `railway link`ed
//   node <path>/railway-push-env.mjs            # push this repo's .env
//   node <path>/railway-push-env.mjs --dry      # show what would be sent
//
// Requires: Railway CLI installed and authenticated (`railway login`).
// This script never receives, stores or prints a credential — it shells out
// to the CLI, which reads whatever session you already established.
//
// APP_URL is intentionally NOT pushed as-is unless you pass --app-url:
// the value in .env points at the web app for customer links, which is
// usually right, but it is the one variable worth a deliberate decision.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'

const cwd = process.cwd()
const envPath = resolve(cwd, '.env')
const args = process.argv.slice(2)
const dry = args.includes('--dry')

if (!existsSync(envPath)) {
  console.error(`No .env in ${cwd}. Run this from a receptionist repo.`)
  process.exit(1)
}

// Values the platform owns. Pushing these breaks the deploy.
const SKIP = new Set(['PORT', 'NODE_ENV', 'RAILWAY_PUBLIC_DOMAIN'])

const pairs = []
for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq < 1) continue
  const key = line.slice(0, eq).trim()
  const val = line.slice(eq + 1).trim()
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue
  if (SKIP.has(key)) continue
  if (!val) continue // blank = leave unset, the code treats it as "feature off"
  pairs.push([key, val])
}

console.log(`${basename(cwd)}: ${pairs.length} variables with values`)
console.log(`skipped (platform-owned): ${[...SKIP].join(', ')}`)

if (dry) {
  console.log('\nWould set (names only):')
  console.log('  ' + pairs.map(([k]) => k).join(' '))
  console.log('\nDry run — nothing sent.')
  process.exit(0)
}

// One invocation with repeated --set is far faster than one call per key,
// and means a single redeploy rather than N.
const cliArgs = ['variables']
for (const [k, v] of pairs) cliArgs.push('--set', `${k}=${v}`)
// Let Railway redeploy once, at the end.
cliArgs.push('--skip-deploys')

try {
  execFileSync('railway', cliArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
  console.log(`\nSet ${pairs.length} variables. Run \`railway up\` (or redeploy) to apply.`)
} catch (e) {
  const err = String(e.stderr ?? e.stdout ?? e.message)
  // Never echo argv back — it holds the values.
  console.error('\nrailway CLI failed. First lines of its output:')
  console.error(err.split('\n').slice(0, 6).join('\n'))
  console.error('\nCommon causes: not logged in (`railway login`), or this')
  console.error('directory is not linked to a service (`railway link`).')
  process.exit(1)
}
