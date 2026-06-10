// QuoteMate · diagnostic — IG Engine accuracy evaluation
//
// Pulls REAL numbers from the production DB to evaluate WHY the IG
// Engine sometimes produces images that drift from the system prompt
// (wrong count, wrong product, etc.). Read-only — SELECTs only.
//
// Run:  node --env-file=.env.local scripts/evaluate-ig-engine-accuracy.mjs

import pg from 'pg'

const { Client } = pg
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }
const target = dbUrl.includes('bobvihqwhtcbxneelfns') ? 'PRODUCTION' : 'staging'
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : 'n/a')

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
async function safe(label, sql, params = []) {
  try { return (await c.query(sql, params)).rows }
  catch (e) { console.warn(`  ⚠ ${label} — ${e.message}`); return null }
}

// Job types that have visual placement guides in lib/ig-engine/prompts.ts
const HAS_PLACEMENT = new Set(['downlights', 'smoke_alarms', 'power_points', 'ceiling_fans', 'outdoor_lighting'])

try {
  await c.connect()
  console.log(`\n══ IG Engine accuracy diagnostic · ${target} ══\n`)

  // ─── 1. Intake count quality — the most likely failure source ────
  console.log('1. INTAKE: does item_count actually get extracted?\n')
  const intakeStats = await safe('intakes summary', `
    select
      count(*)::int                                                         as total,
      count(*) filter (where (scope->>'item_count') is not null)::int       as with_count,
      count(*) filter (where (scope->>'item_count') is null)::int           as without_count,
      count(*) filter (where coalesce((scope->>'item_count')::int, 0) = 0)::int as zero_or_null
    from intakes
  `)
  if (intakeStats?.[0]) {
    const s = intakeStats[0]
    console.log(`   total intakes ............... ${s.total}`)
    console.log(`   with item_count ............. ${s.with_count}  (${pct(s.with_count, s.total)})`)
    console.log(`   WITHOUT item_count .......... ${s.without_count}  (${pct(s.without_count, s.total)})  ← IG prompt drops "Render exactly N"`)
    console.log('')
  }

  // ─── 2. Per-job-type breakdown ────────────────────────────────────
  console.log('2. PER JOB TYPE: where does count quality break down?\n')
  const byType = await safe('per job_type', `
    select job_type,
           count(*)::int                                                       as n,
           count(*) filter (where (scope->>'item_count') is not null)::int     as with_count,
           round(avg((scope->>'item_count')::numeric) filter (where (scope->>'item_count') is not null), 1) as avg_count
    from intakes
    where job_type is not null
    group by job_type
    order by n desc
    limit 15
  `)
  if (byType) {
    console.log(`   ${'job_type'.padEnd(22)} ${'n'.padStart(4)}  ${'with count'.padEnd(14)}  ${'avg'.padStart(5)}  placement?`)
    console.log(`   ${'─'.repeat(22)} ${'─'.repeat(4)}  ${'─'.repeat(14)}  ${'─'.repeat(5)}  ${'─'.repeat(10)}`)
    for (const r of byType) {
      const placement = HAS_PLACEMENT.has(r.job_type) ? '✓ yes' : '✗ no'
      console.log(`   ${String(r.job_type).padEnd(22)} ${String(r.n).padStart(4)}  ${(`${r.with_count} (${pct(r.with_count, r.n)})`).padEnd(14)}  ${String(r.avg_count ?? '—').padStart(5)}  ${placement}`)
    }
    console.log('')
  }

  // ─── 3. Count distribution for SMOKE ALARMS specifically ──────────
  console.log('3. SMOKE ALARMS specifically (the user-reported failure case)\n')
  const smokeRows = await safe('smoke_alarms', `
    select (scope->>'item_count') as count, count(*)::int as n
    from intakes
    where job_type = 'smoke_alarms'
    group by (scope->>'item_count')
    order by n desc
  `)
  if (smokeRows) {
    if (smokeRows.length === 0) console.log('   (no smoke_alarms intakes found)')
    for (const r of smokeRows) {
      console.log(`   count=${String(r.count ?? 'NULL').padEnd(8)} ${r.n} intake(s)`)
    }
    console.log('')
  }

  // ─── 4. Does the saved preview_prompt actually contain the count? ──
  console.log('4. SAVED PROMPTS: does "Render exactly N" actually reach Gemini?\n')
  const prompts = await safe('preview_prompts', `
    select i.id as intake_id,
           q.id as quote_id,
           coalesce((i.scope->>'item_count')::int, 0)                            as intake_count,
           i.job_type                                                            as job_type,
           position('Render exactly' in coalesce(q.preview_prompt, ''))         as render_exactly_pos,
           position('quantity=' in coalesce(q.preview_prompt, ''))               as quantity_pos
    from intakes i
    join quotes q on q.intake_id = i.id
    where q.preview_prompt is not null
    order by q.created_at desc
    limit 30
  `)
  if (prompts) {
    let promptHasCount = 0, intakeHasCount = 0
    for (const r of prompts) {
      if (r.intake_count > 0) intakeHasCount++
      if (r.render_exactly_pos > 0 || r.quantity_pos > 0) promptHasCount++
    }
    console.log(`   last ${prompts.length} quotes with a saved preview_prompt:`)
    console.log(`     intake had item_count > 0 ...... ${intakeHasCount}/${prompts.length}  (${pct(intakeHasCount, prompts.length)})`)
    console.log(`     prompt actually says "Render exactly" or "quantity=" .. ${promptHasCount}/${prompts.length}  (${pct(promptHasCount, prompts.length)})`)
    console.log(`     gap (intake had count but prompt didn't carry it) ...... ${intakeHasCount - promptHasCount}`)
    console.log('')
  }

  // ─── 5. Product photo coverage — "wrong product" data root cause ──
  console.log('5. PRODUCT PHOTO COVERAGE — root cause for "wrong product" renders\n')
  const photos = await safe('catalogue', `
    select count(*)::int                                              as total,
           count(*) filter (where image_path is not null
                              and btrim(image_path) <> '')::int       as with_photo
    from tenant_material_catalogue
  `)
  if (photos?.[0]) {
    const p = photos[0]
    console.log(`   tenant_material_catalogue: ${p.with_photo}/${p.total} have a photo  (${pct(p.with_photo, p.total)})`)
  }
  // (supplier_catalogue uses a different image column — not the one IG
  // reads from; the IG-relevant photo source is tenant_material_catalogue.)
  console.log('')

  // ─── 5b. Peek a real recent preview_prompt to see what reached Gemini
  console.log('5b. SAMPLE PROMPT — what one real recent quote sent to Gemini\n')
  const sample = await safe('sample prompt', `
    select i.job_type                                  as job_type,
           coalesce((i.scope->>'item_count')::int, 0)  as intake_count,
           q.preview_prompt                            as prompt
    from intakes i
    join quotes q on q.intake_id = i.id
    where q.preview_prompt is not null
      and q.preview_status in ('ready', 'partial')
    order by q.created_at desc
    limit 1
  `)
  if (sample?.[0]) {
    const s = sample[0]
    const first = String(s.prompt).slice(0, 1500)
    console.log(`   job_type=${s.job_type}  intake_count=${s.intake_count}`)
    console.log(`   ──── first 1500 chars of preview_prompt ────`)
    console.log(first.split('\n').map(l => '   ' + l).join('\n'))
    console.log('')
  }

  // ─── 6. Quote-weighted product photo hit rate ─────────────────────
  console.log('6. QUOTE-WEIGHTED: what does IG actually receive at runtime?\n')
  const recent = await safe('recent quotes', `
    select good, better, best
    from quotes
    order by created_at desc
    limit 100
  `)
  if (recent) {
    let lines = 0, withPhoto = 0
    for (const q of recent) {
      for (const tier of [q.good, q.better, q.best]) {
        const items = Array.isArray(tier?.line_items) ? tier.line_items : []
        for (const li of items) {
          const isMaterial = !li?.source || String(li.source).startsWith('material')
          if (!isMaterial) continue
          lines++
          if (typeof li?.image_path === 'string' && li.image_path.trim() !== '') withPhoto++
        }
      }
    }
    console.log(`   last 100 quotes — material line items with a photo: ${withPhoto}/${lines}  (${pct(withPhoto, lines)})`)
    console.log('')
  }

  // ─── 7. Preview render outcomes ───────────────────────────────────
  console.log('7. ACTUAL OUTCOMES: how often does the preview reach "ready"?\n')
  const outcomes = await safe('outcomes', `
    select preview_status, count(*)::int as n
    from quotes
    group by preview_status
    order by n desc
  `)
  if (outcomes) {
    for (const r of outcomes) console.log(`   ${String(r.preview_status ?? 'NULL').padEnd(12)} ${r.n}`)
  }
} catch (e) {
  console.error('Diagnostic failed:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
