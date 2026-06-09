// Electrical BOM-from-plans — feasibility spike (v0, Approach-2 baseline).
//
// Sends a construction plan set PDF straight to Claude (which renders + reads
// it, legend included) and asks for a structured count of electrical items on
// the POWER & DATA + RCP-lighting sheets. NO tiling yet — this is the naive
// single-pass baseline we measure Approach-1 (rasterise + tile) against.
//
// Usage: node --env-file=.env.local scripts/estimation-spike.mjs "<pdf path>" [sheet hint]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

const pdfPath = process.argv[2]
const sheetHint = process.argv[3] || 'POWER & DATA LAYOUT'
if (!pdfPath) {
  console.error('Usage: node --env-file=.env.local scripts/estimation-spike.mjs "<pdf path>" [sheet hint]')
  process.exit(1)
}
const model = process.env.ESTIMATION_MODEL ?? 'claude-sonnet-4-6'

const PROMPT = `You are an electrical estimator doing a quantity take-off from a construction plan set (PDF attached).

TASK: Find the "${sheetHint}" sheet (and the Reflected Ceiling Plan / lighting sheet if present) and COUNT each electrical item type, using the sheet's own LEGEND to identify symbols.

Be systematic: read the legend first, then sweep the drawing zone by zone so you do not miss symbols in dense areas. Count, do not estimate.

Count at least these (use the legend's wording; 0 if absent):
- general power outlets (GPO / power points) — single and double, report total
- data / comms outlets
- dedicated or 15-amp circuits / appliance points
- light fittings (downlights, battens, feature, exit/emergency) from the RCP if visible
- switchboards / distribution boards
- any other electrical item the legend defines (TV points, mech isolators, etc.)

Return STRICT JSON only, no prose:
{
  "sheets_used": ["..."],
  "legend_symbols": [{ "symbol": "<as drawn>", "means": "<from legend>" }],
  "items": [{ "type": "<item>", "symbol": "<symbol>", "count": <int>, "confidence": "high|medium|low", "note": "<optional>" }],
  "overall_note": "<anything that hurt the count: density, illegible zones, multi-sheet, etc.>"
}`

const pdf = readFileSync(pdfPath)
console.log(`▶ ${pdfPath.split(/[\\/]/).pop()} (${(pdf.length / 1e6).toFixed(2)} MB) → ${model}`)
const t0 = Date.now()
try {
  const { text, usage } = await generateText({
    model: anthropic(model),
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'file', data: pdf, mediaType: 'application/pdf' },
        ],
      },
    ],
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const m = text.match(/\{[\s\S]*\}/)
  let parsed = null
  try { parsed = m ? JSON.parse(m[0]) : null } catch {}
  console.log(`✓ ${secs}s | tokens in/out: ${usage?.inputTokens ?? '?'}/${usage?.outputTokens ?? '?'}`)
  if (parsed) {
    // Persist the extraction so the eval harness can score it against ground-truth.
    const stem = pdfPath.split(/[\\/]/).pop().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    mkdirSync('estimation-output', { recursive: true })
    const outPath = `estimation-output/${stem}.extraction.json`
    writeFileSync(outPath, JSON.stringify({ plan: stem, model, sheet_hint: sheetHint, ...parsed }, null, 2))
    console.log(`saved → ${outPath}`)
  }
  if (parsed) {
    console.log('\nSheets used:', JSON.stringify(parsed.sheets_used))
    console.log('Legend symbols:', (parsed.legend_symbols ?? []).length)
    console.log('\n— EXTRACTED COUNTS (Approach-2 baseline, no tiling) —')
    for (const it of parsed.items ?? []) {
      console.log(`  ${String(it.count).padStart(4)}  ${(it.type || '').padEnd(34)} [${it.symbol ?? ''}] (${it.confidence})${it.note ? ' — ' + it.note : ''}`)
    }
    console.log('\nNote:', parsed.overall_note ?? '(none)')
  } else {
    console.log('\nRAW (unparseable JSON):\n', text.slice(0, 2000))
  }
} catch (e) {
  console.error(`✗ failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e?.message || e)
  process.exit(1)
}
