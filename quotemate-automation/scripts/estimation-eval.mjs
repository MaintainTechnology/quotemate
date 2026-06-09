// Electrical BOM-from-plans — eval harness.
//
// Scores an AI extraction (from estimation-spike.mjs) against the estimator's
// ground-truth BOM, item by item. Produces the headline count-accuracy %, the
// $ variance, coverage, and the "manual hours vs AI minutes" comparison.
//
// This IS the eval framework the project has been missing — point it at the
// real CityCave take-off the moment it lands and we get the number in one run.
//
// Usage:
//   node scripts/estimation-eval.mjs <extraction.json> <ground-truth.json> [aliases.json]

import { readFileSync } from 'node:fs'

// ── Default electrical synonym map (canonical → aliases). Extend per estimator
//    via an aliases.json so their BOM wording lines up with the AI's item types.
// NOTE: order matters — specific keys are checked before the generic "double gpo"
// so "single gpo" / "waterproof gpo" don't get swallowed by the bare "gpo" alias.
const DEFAULT_ALIASES = {
  'single gpo': ['single power point', 'single gpo'],
  'waterproof gpo': ['waterproof double gpo', 'wp gpo', 'waterproof gpo'],
  'gpo total': ['gpo total all types combined'],
  'double gpo': ['gpo', 'power point', 'general power outlet', 'double power point', 'power outlet', 'double gpo standard', 'double gpo usb', 'double gpo for cleaning', 'hardwired power', 'recessed gpo'],
  'data point': ['data', 'data outlet', 'comms outlet', 'double data outlet', 'data point cat 6 ethernet', 'comer point data', 'tv foxtel rg6 coaxial point'],
  '15a circuit': ['15 amp circuit', 'dedicated circuit', 'dedicated power circuit', '15 amp dedicated circuit heat panel appliance', 'appliance point'],
  downlight: ['recessed downlight', 'led downlight', 'recessed downlight d2 w smaller held 09', 'recessed downlight d1 w larger held 15'],
  'exit sign': ['emergency exit sign', 'exit'],
  'emergency light': ['em', 'emergency light clevertronics lifelight d32'],
  'distribution board': ['edb', 'electrical distribution board', 'db', 'switchboard', 'main switchboard'],
  'exhaust fan': ['exhaust fan e2', 'e2', 'fan', 'wall fan switch 30 min timer'],
  'hot water unit': ['hwu'],
  speaker: ['speaker wall mounted', 'sonos speakers', 's w'],
  'movement sensor': ['movement sensor pir wall', 'movement sensor 360 degree ceiling', 'mw', 'mc'],
  'security camera': ['cs', 'camera'],
  switch: ['single gang switch', 'double gang switch', 'triple gang switch', 'waterproof switch'],
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Keyword/substring match (robust to verbose AI labels). Checks longer alias
// keys first so "single gpo" wins over the generic "gpo". Falls back to the
// item's own normalised name when nothing matches (surfaces alias gaps).
function canonOf(name, aliases) {
  const n = norm(name)
  for (const canon of Object.keys(aliases)) {
    const keys = [norm(canon), ...aliases[canon].map(norm)].filter(Boolean).sort((a, b) => b.length - a.length)
    for (const k of keys) if (n.includes(k)) return norm(canon)
  }
  return n
}

function indexItems(items, aliases) {
  const m = new Map()
  for (const it of items ?? []) {
    const key = canonOf(it.type ?? it.name, aliases)
    const prev = m.get(key) ?? { count: 0, raw: [] }
    prev.count += Number(it.count) || 0
    prev.raw.push(it)
    m.set(key, prev)
  }
  return m
}

const [, , exPath, gtPath, aliasPath] = process.argv
if (!exPath || !gtPath) {
  console.error('Usage: node scripts/estimation-eval.mjs <extraction.json> <ground-truth.json> [aliases.json]')
  process.exit(1)
}

// Load JSON with a clear, actionable error instead of a raw Node stack trace —
// the ground-truth file in particular won't exist until a real take-off lands.
function loadJson(path, label) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    console.error(`\n✗ ${label} not found:\n    ${path}`)
    if (/ground-truth/i.test(path)) {
      console.error(`\nThis file must hold the estimator's REAL take-off — line counts (+ unit prices`)
      console.error(`and labour hours if you want $ variance). The AI is scored against it.`)
      console.error(`\nThere is no quantity schedule in the plan PDF to derive this from automatically`)
      console.error(`(the sheets show "location & quantity" on the drawing, legend-only), so the`)
      console.error(`numbers have to come from a human count.`)
      console.error(`\nStart from the template, fill in the real numbers, save it under this exact name:`)
      console.error(`    cp estimation-truth/citycave.ground-truth.template.json ${path}`)
      console.error(`then edit ${path} and re-run. Scoring against the *template* only tests the`)
      console.error(`harness — the result is not a real accuracy figure.`)
    }
    process.exit(1)
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.error(`\n✗ ${label} is not valid JSON (${path}):\n    ${e.message}`)
    process.exit(1)
  }
}

const extraction = loadJson(exPath, 'Extraction')
const truth = loadJson(gtPath, 'Ground-truth')
const aliases = aliasPath ? { ...DEFAULT_ALIASES, ...loadJson(aliasPath, 'Aliases') } : DEFAULT_ALIASES

const ai = indexItems(extraction.items, aliases)
const gt = indexItems(truth.items, aliases)

let sumTruth = 0
let sumAbsErr = 0
let matched = 0
let truthValue = 0
let aiValue = 0
let hasPrice = false
const rows = []

for (const [key, g] of gt) {
  const a = ai.get(key)
  const aiC = a?.count ?? 0
  const err = aiC - g.count
  sumTruth += g.count
  sumAbsErr += Math.abs(err)
  if (a) matched += 1
  const price = g.raw.find((r) => r.unit_price != null)?.unit_price
  if (price != null) {
    hasPrice = true
    truthValue += g.count * price
    aiValue += aiC * price
  }
  rows.push({ item: key, truth: g.count, ai: aiC, err, status: a ? (err === 0 ? 'exact' : err > 0 ? 'over' : 'under') : 'MISSED' })
}
const extras = [...ai.keys()].filter((k) => !gt.has(k)).map((k) => ({ item: k, ai: ai.get(k).count }))

const countAccuracy = sumTruth > 0 ? Math.max(0, 1 - sumAbsErr / sumTruth) : 0
const coverage = gt.size > 0 ? matched / gt.size : 0

console.log(`\n════════ EVAL: ${extraction.plan ?? exPath} vs ${truth.plan ?? gtPath} ════════`)
console.log('item'.padEnd(26), 'truth'.padStart(6), 'ai'.padStart(6), 'err'.padStart(6), '  status')
console.log('─'.repeat(56))
for (const r of rows.sort((a, b) => Math.abs(b.err) - Math.abs(a.err))) {
  console.log(r.item.padEnd(26), String(r.truth).padStart(6), String(r.ai).padStart(6), String(r.err).padStart(6), '  ' + r.status)
}
if (extras.length) {
  console.log('\nAI extras (not in ground-truth — possible double-count or alias gap):')
  for (const e of extras) console.log('  +', e.ai, e.item)
}
console.log('\n──────── SCORECARD ────────')
console.log(`COUNT ACCURACY : ${(countAccuracy * 100).toFixed(1)}%   (1 − Σ|err|/Σtruth = 1 − ${sumAbsErr}/${sumTruth})`)
console.log(`COVERAGE       : ${(coverage * 100).toFixed(0)}% of truth line-items found (${matched}/${gt.size}); AI extras: ${extras.length}`)
if (hasPrice) {
  const varPct = truthValue > 0 ? (aiValue / truthValue - 1) * 100 : 0
  console.log(`$ VARIANCE     : AI $${aiValue.toLocaleString()} vs truth $${truthValue.toLocaleString()}  (${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}%)`)
}
console.log(`TARGET         : ≥ 80% count accuracy  →  ${countAccuracy >= 0.8 ? 'PASS ✅' : 'below target ⚠'}`)

// "40 hours vs minutes" framing
const manualHours = truth.manual_hours
if (manualHours != null) {
  const aiMin = extraction.runtime_seconds ? (extraction.runtime_seconds / 60).toFixed(1) : '~2'
  console.log(`\nTIME           : estimator ${manualHours} hr  vs  AI ${aiMin} min   (${(manualHours * 60 / Number(aiMin || 2)).toFixed(0)}× faster)`)
}
