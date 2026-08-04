#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// railway-deploy-receptionists.mjs — create + configure + deploy each
// receptionist as a service in the Railway project the token points at.
//
//   node scripts/railway-deploy-receptionists.mjs roofing
//   node scripts/railway-deploy-receptionists.mjs            # all five
//   node scripts/railway-deploy-receptionists.mjs --vars-only roofing
//
// Auth: reads RAILWAY_API_KEY from the monorepo .env.local. That is a
// PROJECT token, so everything lands in its one project as sibling
// services. The token is never printed and never passed on a shell line —
// it goes to the CLI through the child process environment.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// npm's `railway` shim is a shell script Node's spawn can't resolve on
// Windows — go straight to the binary.
const RAILWAY = 'C:/Users/dalig/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe'
const MONO_ENV = 'C:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/.env.local'
const OUT_ROOT = 'C:/Users/dalig/Desktop/MaintainTech/MaintainOrg/QuoteMax/Receptionists'
const TRADES = ['electrical', 'plumbing', 'roofing', 'painting', 'solar']

// Railway owns these at runtime; setting them breaks the deploy.
const SKIP = new Set(['PORT', 'NODE_ENV', 'RAILWAY_PUBLIC_DOMAIN'])

function readVar(file, key) {
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const l = raw.trim()
    if (l.startsWith(key + '=')) return l.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

const token = readVar(MONO_ENV, 'RAILWAY_API_KEY')
if (!token) { console.error('RAILWAY_API_KEY not found in .env.local'); process.exit(1) }
const env = { ...process.env, RAILWAY_TOKEN: token, CI: 'true' }

const run = (args, cwd) => {
  try {
    const out = execFileSync(RAILWAY, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    return { ok: true, out }
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? ''), err: String(e.stderr ?? e.message ?? '') }
  }
}

function envPairs(repo) {
  const p = join(repo, '.env')
  const pairs = []
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const l = raw.trim()
    if (!l || l.startsWith('#')) continue
    const eq = l.indexOf('=')
    if (eq < 1) continue
    const k = l.slice(0, eq).trim()
    const v = l.slice(eq + 1).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || SKIP.has(k) || !v) continue
    pairs.push([k, v])
  }
  return pairs
}

const args = process.argv.slice(2)
const varsOnly = args.includes('--vars-only')
const wanted = args.filter((a) => !a.startsWith('--'))
const list = wanted.length ? wanted : TRADES

// Which services already exist? Avoids duplicate-create noise.
const status = run(['status', '--json'], OUT_ROOT)
let existing = new Set()
try {
  const j = JSON.parse(status.out)
  for (const e of j?.services?.edges ?? []) existing.add(e.node.name)
} catch { /* fall back to create-and-tolerate */ }

for (const trade of list) {
  const name = `qm-${trade}-receptionist`
  const repo = join(OUT_ROOT, name)
  console.log(`\n── ${trade}`)
  if (!existsSync(join(repo, '.env'))) { console.log('   no .env — skipped'); continue }

  // 1. Service
  if (existing.has(name)) {
    console.log('   service: already exists')
  } else {
    const add = run(['add', '--service', name], repo)
    // The CLI prints a linking warning even when creation succeeds, so
    // treat presence in a follow-up status as the real signal.
    console.log(`   service: ${add.ok ? 'created' : 'create attempted'}`)
  }

  // 2. Variables
  const pairs = envPairs(repo)
  const vArgs = ['variables', '--service', name, '--skip-deploys']
  for (const [k, v] of pairs) vArgs.push('--set', `${k}=${v}`)
  const vres = run(vArgs, repo)
  if (vres.ok) console.log(`   variables: set ${pairs.length}`)
  else { console.log(`   variables: FAILED — ${(vres.err || vres.out).split('\n')[0]}`); continue }

  if (varsOnly) continue

  // 3. Deploy (detached; build continues server-side)
  const up = run(['up', '--service', name, '--detach', '--yes'], repo)
  if (up.ok) console.log(`   deploy: started`)
  else console.log(`   deploy: FAILED — ${(up.err || up.out).split('\n').slice(0, 3).join(' | ')}`)
}

console.log('\nDone. Build progress: railway logs --service <name> (or the Railway dashboard).')
