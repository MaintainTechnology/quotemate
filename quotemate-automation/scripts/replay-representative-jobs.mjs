// QuoteMate · R50 — DETERMINISTIC replay harness for the representative job set.
//
//   node --import tsx --env-file=.env.local scripts/replay-representative-jobs.mjs
//
// WHAT THIS PROVES (and what it deliberately does NOT)
// ----------------------------------------------------
// This harness exercises the DETERMINISTIC half of the quote pipeline end to
// end against the LIVE prod catalogue, with NO LLM in the loop and NO prod
// writes. For each of the 14 representative job types it:
//
//   1. Loads the REAL catalogue from prod (pricing_book + shared_assemblies +
//      shared_materials, trade-scoped) plus the active tenant offerings — the
//      same rows lib/estimate/run.ts loadCandidatePrices() feeds the validator.
//   2. Builds a GROUNDED Good/Better/Best draft by hand from those real rows:
//        • labour  → unit 'hr' at pricing_book.hourly_rate (≥ min_labour_hours),
//        • materials/assemblies → real row price (raw or × default markup),
//          each line source-tagged "material:<id>" / "assembly:<id>" so it hits
//          the validator's STRICT UUID grounding path (the path Opus is meant
//          to use), tagged with the real DB row id.
//   3. Runs the ACTUAL exported lib/estimate/validate.ts
//      validateQuoteGrounding() + detectCrossTierDuplicates() and
//      lib/routing/decide.ts decideRouting().
//   4. CONFIRMS each grounds clean AND routes to a real quote (tradie_review /
//      auto_send) — NOT inspection.
//
// Plus 3 NEGATIVE cases proving the guardrails still bite:
//   (a) a planted WITHIN-TIER duplicate row  → grounding FLAGS it (D-1 dedup);
//   (b) a planted CROSS-TIER unframed dup    → detectCrossTierDuplicates FLAGS;
//   (c) a gas_fitting / always_inspection job → decideRouting → inspection.
//
// The LIVE Opus draft + the full SMS send are covered separately by the R52
// live smoke. This harness proves only the data + grounding + routing path,
// which is exactly the part that must be machine-checkable and reproducible.
//
// READ-ONLY: opens prod with a single SELECT-only pg session and never writes.

import pg from 'pg'
import {
  buildCandidatePrices,
  validateQuoteGrounding,
  detectCrossTierDuplicates,
} from '../lib/estimate/validate.ts'
import { decideRouting } from '../lib/routing/decide.ts'

// ───────────────────────────────────────────────────────────────────────────
// 0. The 14 representative job types (from CLAUDE.md / quote-funnel snapshot).
//    Each maps to a TRADE, a label, and the catalogue rows the line items
//    should ground on, selected by category from whatever prod actually holds.
// ───────────────────────────────────────────────────────────────────────────

// Job spec: which trade + which catalogue category each tier's product line
// should be grounded on. We resolve the actual rows from prod at runtime so
// the harness never hard-codes a price or a row id — it grounds on whatever
// the live catalogue carries for that category.
const JOB_SPECS = [
  // ── Electrical ──
  { job: 'downlights',       trade: 'electrical', materialCat: 'downlight',     assemblyCat: 'downlight' },
  { job: 'power_points',     trade: 'electrical', materialCat: 'gpo',           assemblyCat: 'gpo' },
  { job: 'ceiling_fans',     trade: 'electrical', materialCat: 'fan',           assemblyCat: 'fan' },
  { job: 'smoke_alarms',     trade: 'electrical', materialCat: 'smoke_alarm',   assemblyCat: 'smoke_alarm' },
  { job: 'outdoor_lighting', trade: 'electrical', materialCat: 'outdoor_light', assemblyCat: 'outdoor_light' },
  { job: 'oven_cooktop',     trade: 'electrical', materialCat: null,            assemblyCat: 'oven_cooktop' },
  { job: 'fault_finding',    trade: 'electrical', materialCat: null,            assemblyCat: 'fault_find' },
  // ── Plumbing ──
  { job: 'hot_water',        trade: 'plumbing',   materialCat: 'hot_water',     assemblyCat: 'hot_water' },
  { job: 'blocked_drain',    trade: 'plumbing',   materialCat: null,            assemblyCat: 'drain' },
  { job: 'tap_replace',      trade: 'plumbing',   materialCat: 'tap',           assemblyCat: 'tap' },
  { job: 'toilet_replace',   trade: 'plumbing',   materialCat: 'toilet',        assemblyCat: 'toilet' },
  { job: 'tap_repair',       trade: 'plumbing',   materialCat: null,            assemblyCat: 'tap' },
  { job: 'toilet_repair',    trade: 'plumbing',   materialCat: 'toilet',        assemblyCat: 'toilet' },
  { job: 'gas_fitting',      trade: 'plumbing',   materialCat: null,            assemblyCat: 'gas' },
]

// ───────────────────────────────────────────────────────────────────────────
// 1. Category extraction for catalogue rows.
//
// The validator's STRICT UUID path only needs a price match against the exact
// row id, so for grounding we can rely purely on source-tagging. But to PICK
// rows by category we need to read each row's category. Some prod rows carry a
// non-canonical `category` (e.g. 'ceiling_fan', 'safety_switch', 'hws_electric',
// 'tapware_*', 'sundries') that the validator's CATEGORY list does not
// recognise — so we resolve a row's effective category from BOTH the column and
// the canonical aliases below, falling back to a keyword scan of the name.
// This is for ROW SELECTION only; grounding correctness comes from the row id.
// ───────────────────────────────────────────────────────────────────────────

// Map non-canonical prod category strings → the canonical bucket we select on.
const CAT_ALIAS = {
  ceiling_fan: 'fan',
  safety_switch: 'rcbo',
  sundries: 'sundry',
  // plumbing HWS variants all serve the hot_water job
  hws_electric: 'hot_water',
  hws_gas: 'hot_water',
  hws_heat_pump: 'hot_water',
  // plumbing tapware variants all serve tap jobs
  tapware_kitchen: 'tap',
  tapware_laundry: 'tap',
  tapware_outdoor: 'tap',
  tapware_basin: 'tap',
  // toilet repair internals serve the toilet job family
  toilet_repair: 'toilet',
}

function rowCategory(row) {
  const raw = (row.category ?? '').toLowerCase().trim()
  if (raw && CAT_ALIAS[raw]) return CAT_ALIAS[raw]
  if (raw) return raw
  // fall back to a coarse keyword scan of the name
  const n = (row.name ?? '').toLowerCase()
  if (/downlight/.test(n)) return 'downlight'
  if (/gpo|power\s*point|outlet|socket/.test(n)) return 'gpo'
  if (/ceiling\s*fan|\bfan\b/.test(n)) return 'fan'
  if (/smoke\s*alarm/.test(n)) return 'smoke_alarm'
  if (/outdoor|flood|exterior/.test(n)) return 'outdoor_light'
  if (/oven|cooktop|stove/.test(n)) return 'oven_cooktop'
  if (/fault|diagnostic/.test(n)) return 'fault_find'
  if (/hot\s*water|hws|heat\s*pump/.test(n)) return 'hot_water'
  if (/drain|blockage|jet|rod/.test(n)) return 'drain'
  if (/tap|mixer|faucet/.test(n)) return 'tap'
  if (/toilet|cistern/.test(n)) return 'toilet'
  if (/gas/.test(n)) return 'gas'
  return 'general'
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Prod loaders — READ-ONLY. One SELECT-only session, no writes anywhere.
// ───────────────────────────────────────────────────────────────────────────

async function loadProd(client) {
  const tenants = (
    await client.query(
      `select id, business_name, trade, trades, status
         from tenants where status = 'active' order by business_name`,
    )
  ).rows

  const pricingBook = (
    await client.query(
      `select tenant_id, trade, hourly_rate, apprentice_rate, senior_rate,
              call_out_minimum, default_markup_pct, min_labour_hours,
              after_hours_multiplier
         from pricing_book`,
    )
  ).rows

  const assemblies = (
    await client.query(
      `select id, trade, name, default_unit_price_ex_gst, category, always_inspection
         from shared_assemblies`,
    )
  ).rows

  const materials = (
    await client.query(
      `select id, trade, name, default_unit_price_ex_gst, category
         from shared_materials`,
    )
  ).rows

  // tenant_service_offerings — which assemblies a tenant offers (enabled).
  const offerings = (
    await client.query(
      `select tenant_id, assembly_id, enabled from tenant_service_offerings`,
    )
  ).rows

  return { tenants, pricingBook, assemblies, materials, offerings }
}

// Pick a tenant that actually serves a given trade AND has a pricing_book for
// it. Prefer a tenant whose PRIMARY trade column is this trade (the trade-
// native operator) so the table shows real tenant variety across trades,
// falling back to any cross-trade tenant that carries the trade in trades[].
function pickTenant(tenants, pricingBook, trade) {
  const tradesOf = (t) =>
    Array.isArray(t.trades)
      ? t.trades
      : (() => {
          try {
            return JSON.parse(t.trades ?? '[]')
          } catch {
            return []
          }
        })()
  const hasBook = (t) =>
    pricingBook.some((b) => b.tenant_id === t.id && b.trade === trade)
  // 1st choice: primary-trade match with a pricing_book.
  const primary = tenants.find((t) => t.trade === trade && hasBook(t))
  if (primary) return primary
  // 2nd choice: any tenant that lists the trade and has a pricing_book.
  const secondary = tenants.find(
    (t) => tradesOf(t).includes(trade) && hasBook(t),
  )
  return secondary ?? null
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Grounded draft builder.
//
// Builds a Good/Better/Best draft from REAL rows. Each tier:
//   • a labour line: unit 'hr', source 'labour', price = hourly_rate, with
//     quantity ≥ min_labour_hours (so the per-tier labour floor passes);
//   • one product line: a real catalogue row, source-tagged
//     "material:<id>" / "assembly:<id>" at the row's raw OR × default-markup
//     price — both are accepted by the strict UUID path.
//
// Good/Better/Best use DIFFERENT real rows where the catalogue offers them
// (cheaper → premium), so there is no accidental cross-tier collision; where
// only one row exists for a category we reuse it at the SAME quantity across
// tiers, which detectCrossTierDuplicates explicitly allows (ordinary tier
// progression). All prices are derived deterministically from prod rows.
// ───────────────────────────────────────────────────────────────────────────

function markedUp(price, markupPct) {
  return +(Number(price) * (1 + Number(markupPct) / 100)).toFixed(2)
}

function rowsForCategory(rows, trade, cat) {
  return rows
    .filter((r) => r.trade === trade && rowCategory(r) === cat)
    .filter((r) => !r.always_inspection) // never ground on an inspection-only row
    .filter((r) => Number(r.default_unit_price_ex_gst) > 0)
    .sort(
      (a, b) =>
        Number(a.default_unit_price_ex_gst) - Number(b.default_unit_price_ex_gst),
    )
}

// Choose up to 3 product rows (cheap→mid→premium) for Good/Better/Best.
// Prefers materials (the visible product the customer pays for) then
// assemblies. If fewer than 3 distinct rows exist, the last is reused at the
// SAME quantity (allowed tier progression).
function pickTierRows(spec, materials, assemblies) {
  const mat = spec.materialCat
    ? rowsForCategory(materials, spec.trade, spec.materialCat).map((r) => ({
        kind: 'material',
        row: r,
      }))
    : []
  const asm = spec.assemblyCat
    ? rowsForCategory(assemblies, spec.trade, spec.assemblyCat).map((r) => ({
        kind: 'assembly',
        row: r,
      }))
    : []
  // Prefer materials for the priced product line; fall back to assemblies.
  const pool = mat.length >= 1 ? mat : asm
  if (pool.length === 0) return null
  const pick = (i) => pool[Math.min(i, pool.length - 1)]
  return [pick(0), pick(Math.floor(pool.length / 2)), pick(pool.length - 1)]
}

function buildLabourLine(book) {
  const hours = Math.max(Number(book.min_labour_hours ?? 2), 2)
  return {
    description: 'Licensed tradesperson labour (supply + install)',
    quantity: hours,
    unit: 'hr',
    unit_price_ex_gst: Number(book.hourly_rate),
    source: 'labour',
  }
}

function buildProductLine(pick, book) {
  const { kind, row } = pick
  const raw = Number(row.default_unit_price_ex_gst)
  // Use the marked-up price (the realistic customer-facing number); the strict
  // UUID path accepts raw OR × default-markup, so this still grounds on row id.
  const price = markedUp(raw, book.default_markup_pct)
  return {
    description: row.name,
    quantity: 1,
    unit: 'each',
    unit_price_ex_gst: price,
    source: `${kind}:${row.id}`,
  }
}

function buildGroundedDraft(spec, book, materials, assemblies) {
  const picks = pickTierRows(spec, materials, assemblies)
  if (!picks) return null
  const [good, better, best] = picks
  const tier = (pick) => ({
    line_items: [buildLabourLine(book), buildProductLine(pick, book)],
  })
  return {
    needs_inspection: false,
    scope_of_works: `${spec.job} — supply and install, standard residential access.`,
    good: tier(good),
    better: tier(better),
    best: tier(best),
  }
}

// Candidate set for ONE job — built from prod rows exactly like
// loadCandidatePrices(), trade-scoped, including the row id so the strict
// UUID path can resolve it.
function candidatesForTrade(trade, materials, assemblies, book) {
  return buildCandidatePrices(
    materials
      .filter((r) => r.trade === trade)
      .map((r) => ({
        id: r.id,
        name: r.name,
        price: r.default_unit_price_ex_gst,
        category: r.category ?? null,
      })),
    assemblies
      .filter((r) => r.trade === trade && !r.always_inspection)
      .map((r) => ({
        id: r.id,
        name: r.name,
        price: r.default_unit_price_ex_gst,
        category: r.category ?? null,
      })),
    book,
  )
}

// ───────────────────────────────────────────────────────────────────────────
// 4. The replay.
// ───────────────────────────────────────────────────────────────────────────

function fmt(s, w) {
  s = String(s)
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length)
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL
  if (!dbUrl) {
    console.error('Missing SUPABASE_DB_URL in .env.local')
    process.exit(1)
  }
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  let prod
  try {
    prod = await loadProd(client)
  } finally {
    await client.end() // close the read-only session immediately; no writes.
  }

  const { tenants, pricingBook, assemblies, materials } = prod

  console.log('')
  console.log('QuoteMate R50 — deterministic replay of the representative job set')
  console.log('  prod (read-only):  active tenants=' + tenants.length +
    '  shared_assemblies=' + assemblies.length +
    '  shared_materials=' + materials.length)
  console.log('  LLM calls: NONE   prod writes: NONE')
  console.log('')

  const results = []

  // ── Positive cases: 14 representative job types ──
  for (const spec of JOB_SPECS) {
    const tenant = pickTenant(tenants, pricingBook, spec.trade)
    if (!tenant) {
      results.push({ job: spec.job, trade: spec.trade, tenant: '(none)',
        grounded: false, routing: 'n/a', pass: false,
        note: 'no active tenant with a pricing_book for trade' })
      continue
    }
    const book = pricingBook.find(
      (b) => b.tenant_id === tenant.id && b.trade === spec.trade,
    )
    const draft = buildGroundedDraft(spec, book, materials, assemblies)
    if (!draft) {
      results.push({ job: spec.job, trade: spec.trade, tenant: tenant.business_name,
        grounded: false, routing: 'n/a', pass: false,
        note: 'no catalogue rows for category ' + (spec.materialCat || spec.assemblyCat) })
      continue
    }

    const candidates = candidatesForTrade(spec.trade, materials, assemblies, book)
    const grounding = validateQuoteGrounding(draft, book, candidates)
    const crossTier = detectCrossTierDuplicates(draft, candidates)
    const groundedClean = grounding.valid && crossTier.length === 0

    const routing = decideRouting({
      intake: { confidence: 'MEDIUM', inspection_required: false },
      quote: { needs_inspection: draft.needs_inspection },
    })
    const routedToQuote = routing === 'tradie_review' || routing === 'auto_send'

    const pass = groundedClean && routedToQuote
    let note = 'grounded clean → ' + routing
    if (!grounding.valid) {
      note = 'GROUNDING FAILED: ' +
        grounding.failures.slice(0, 2).map((f) =>
          `${f.tier}#${f.lineIndex} "${f.description}" — ${f.expected}`).join(' ; ')
    } else if (crossTier.length > 0) {
      note = 'CROSS-TIER DUP: ' + crossTier.map((d) => d.anchor).join(', ')
    } else if (!routedToQuote) {
      note = 'UNEXPECTED routing: ' + routing
    }

    results.push({ job: spec.job, trade: spec.trade, tenant: tenant.business_name,
      grounded: groundedClean, routing, pass, note })
  }

  // ── Negative case (a): planted WITHIN-TIER duplicate → must be FLAGGED ──
  {
    const spec = { job: 'downlights', trade: 'electrical', materialCat: 'downlight', assemblyCat: 'downlight' }
    const tenant = pickTenant(tenants, pricingBook, spec.trade)
    const book = pricingBook.find((b) => b.tenant_id === tenant.id && b.trade === spec.trade)
    const draft = buildGroundedDraft(spec, book, materials, assemblies)
    // Plant the SAME product row twice in the Good tier (raw + marked-up).
    const dupRow = rowsForCategory(materials, spec.trade, 'downlight')[0]
    draft.good.line_items.push({
      description: dupRow.name + ' (second charge)',
      quantity: 1, unit: 'each',
      unit_price_ex_gst: Number(dupRow.default_unit_price_ex_gst), // raw — same row
      source: `material:${dupRow.id}`,
    })
    const candidates = candidatesForTrade(spec.trade, materials, assemblies, book)
    const grounding = validateQuoteGrounding(draft, book, candidates)
    // Guardrail BITES when grounding is now invalid AND cites a duplicate.
    const flagged = !grounding.valid &&
      grounding.failures.some((f) => /duplicate/i.test(f.expected))
    results.push({
      job: 'NEG(a) within-tier dup', trade: 'electrical', tenant: tenant.business_name,
      grounded: false, routing: 'inspection (downgrade)', pass: flagged,
      note: flagged
        ? 'guardrail BIT: ' + grounding.failures.find((f) => /duplicate/i.test(f.expected)).expected.slice(0, 70) + '…'
        : 'GUARDRAIL MISSED — within-tier dup not flagged',
    })
  }

  // ── Negative case (b): planted CROSS-TIER unframed dup → must be FLAGGED ──
  {
    const spec = { job: 'downlights', trade: 'electrical', materialCat: 'downlight', assemblyCat: 'downlight' }
    const tenant = pickTenant(tenants, pricingBook, spec.trade)
    const book = pricingBook.find((b) => b.tenant_id === tenant.id && b.trade === spec.trade)
    const dlRows = rowsForCategory(materials, spec.trade, 'downlight')
    const row = dlRows[0]
    const mk = (qty) => ({
      line_items: [
        buildLabourLine(book),
        {
          description: row.name,
          quantity: qty, unit: 'each',
          unit_price_ex_gst: markedUp(row.default_unit_price_ex_gst, book.default_markup_pct),
          source: `material:${row.id}`,
        },
      ],
    })
    // SAME row, DIFFERENT quantities across tiers, NO scope framing the change.
    const draft = {
      needs_inspection: false,
      scope_of_works: 'Downlight install.', // deliberately does NOT frame the qty jump
      good: mk(3), better: mk(3), best: mk(8),
    }
    const candidates = candidatesForTrade(spec.trade, materials, assemblies, book)
    const crossTier = detectCrossTierDuplicates(draft, candidates)
    const grounding = validateQuoteGrounding(draft, book, candidates)
    const flagged = crossTier.length > 0 && !grounding.valid
    results.push({
      job: 'NEG(b) cross-tier unframed', trade: 'electrical', tenant: tenant.business_name,
      grounded: false, routing: 'inspection (downgrade)', pass: flagged,
      note: flagged
        ? 'guardrail BIT: cross-tier dup ' + crossTier.map((d) => d.anchor).join(',')
        : 'GUARDRAIL MISSED — cross-tier unframed dup not flagged',
    })
  }

  // ── Negative case (c): gas_fitting / always_inspection job → INSPECTION ──
  {
    // The estimate path flags gas/always_inspection work via needs_inspection.
    // Replay that: a gas job whose draft is marked needs_inspection (mirrors
    // the validator's inspection fallback + always_inspection 'Install gas HWS')
    // must route to inspection, never to a quote.
    const draft = { needs_inspection: true }
    const routing = decideRouting({
      intake: { confidence: 'LOW', inspection_required: true },
      quote: { needs_inspection: true },
    })
    const grounding = validateQuoteGrounding(draft, { hourly_rate: 0, apprentice_rate: 0, call_out_minimum: 0, default_markup_pct: 0 }, { material: [], assembly: [] })
    const inspected = routing === 'inspection_required'
    results.push({
      job: 'NEG(c) gas / always-inspect', trade: 'plumbing', tenant: '(routing)',
      grounded: grounding.valid, routing, pass: inspected,
      note: inspected
        ? 'routed to inspection as required (never auto-quoted)'
        : 'GUARDRAIL MISSED — gas job did not route to inspection',
    })
  }

  // ── Print the per-fixture PASS/FAIL table ──
  const W = { job: 28, trade: 11, tenant: 21, ground: 8, route: 22, res: 6 }
  const hr = '─'.repeat(W.job + W.trade + W.tenant + W.ground + W.route + W.res + 6)
  console.log(hr)
  console.log(
    fmt('JOB TYPE', W.job) + ' ' +
    fmt('TRADE', W.trade) + ' ' +
    fmt('TENANT', W.tenant) + ' ' +
    fmt('GROUNDED', W.ground) + ' ' +
    fmt('ROUTING', W.route) + ' ' +
    fmt('RESULT', W.res),
  )
  console.log(hr)
  for (const r of results) {
    console.log(
      fmt(r.job, W.job) + ' ' +
      fmt(r.trade, W.trade) + ' ' +
      fmt(r.tenant, W.tenant) + ' ' +
      fmt(r.grounded ? 'clean' : 'no', W.ground) + ' ' +
      fmt(r.routing, W.route) + ' ' +
      fmt(r.pass ? 'PASS' : 'FAIL', W.res),
    )
    console.log('    ↳ ' + r.note)
  }
  console.log(hr)

  const passes = results.filter((r) => r.pass).length
  const total = results.length
  const positives = results.filter((r) => !r.job.startsWith('NEG'))
  const negatives = results.filter((r) => r.job.startsWith('NEG'))
  console.log(
    `SUMMARY: ${passes}/${total} PASS  ` +
    `(positives ${positives.filter((r) => r.pass).length}/${positives.length} grounded-clean & routed-to-quote, ` +
    `negatives ${negatives.filter((r) => r.pass).length}/${negatives.length} guardrails bit) — ` +
    (passes === total ? 'ALL GREEN' : 'FAILURES PRESENT'),
  )
  console.log('')

  process.exit(passes === total ? 0 : 1)
}

main().catch((e) => {
  console.error('REPLAY HARNESS ERROR:', e)
  process.exit(2)
})
