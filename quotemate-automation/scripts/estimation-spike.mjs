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

// Kept in sync with buildExtractionPrompt() in lib/estimation/extract.ts.
const PROMPT = `You are an electrical estimator doing a quantity take-off from a construction plan set (PDF attached).

TASK: Find the "${sheetHint}" sheet (and the Reflected Ceiling Plan / lighting sheet if present) and COUNT each electrical item type, using the sheet's own LEGEND to identify symbols.

RULES — follow all of them:
1. LATEST REVISION ONLY. Plan sets often contain multiple revisions of the same sheet (e.g. 103A and 103B, or Rev A / Rev B in the title block). Identify every revision present, then count ONLY from the latest revision of each sheet. Record which revision you used in "sheets_used".
2. READ THE LEGEND FIRST. List every symbol the legend defines before counting anything.
3. ONE LINE ITEM PER LEGEND VARIANT — NEVER MERGE. If the legend defines multiple variants of the same fitting (different wattage e.g. 12W vs 9W, different IP rating e.g. IP44 vs IP65, different location e.g. "@ mirrors", different mounting, colour temperature, or product code), report EACH variant as its own item with its own count. A 9W mirror downlight is NOT the same item as a 12W feature downlight.
4. SINGLE vs DOUBLE OUTLETS ARE DIFFERENT ITEMS. Distinguish GPO (single) from DGPO (double) symbols precisely, including suffix variants (AB/UB/SK, USB, waterproof). Report each as its own line.
5. SWEEP ZONE BY ZONE. Walk the drawing systematically (e.g. left wall → top wall → right wall → bottom wall → interior rooms) so dense areas are not skipped. Count, do not estimate.
6. SHOW YOUR WORKING. For every item, the "note" MUST give a zone-by-zone tally of where each symbol was found (e.g. "left wall 2, amenities 1, bottom wall 1 = 4") so a human can verify the count against the drawing.
7. Wattage/size labels printed next to a symbol on the drawing (e.g. "12W", "9W", "IP65") identify which legend variant it is — use them.
8. PIN EVERY SYMBOL. For each item, return "locations": one entry per counted symbol with the literal PDF page number (1-based, counting every page in the file) and the symbol's approximate position as percentages of that page — "x" from the left edge (0-100) and "y" from the top edge (0-100). locations.length must equal count. Approximate positions are fine; they are used to draw review pins on the drawing.

Count at least these (use the legend's wording; 0 if absent):
- general power outlets (GPO / power points) — each single/double/special variant as its own line
- data / comms outlets
- dedicated or 15-amp circuits / appliance points (including text-labelled power e.g. "fountain power")
- light fittings from the RCP — each legend variant separately (downlights by wattage/IP, battens, panels, feature, exit/emergency)
- switchboards / distribution boards
- any other electrical item the legend defines (TV points, mech isolators, speakers, fans, etc.)

Return STRICT JSON only, no prose:
{
  "sheets_used": ["<sheet number + revision used>"],
  "legend_symbols": [{ "symbol": "<as drawn>", "means": "<from legend>" }],
  "items": [{ "type": "<item incl. variant e.g. wattage/IP>", "symbol": "<symbol>", "count": <int>, "confidence": "high|medium|low", "note": "<zone-by-zone tally>", "locations": [{ "page": <int>, "x": <0-100>, "y": <0-100> }] }],
  "overall_note": "<anything that hurt the count: density, illegible zones, multi-sheet, superseded revisions present, etc.>"
}`

const pdf = readFileSync(pdfPath)
console.log(`▶ ${pdfPath.split(/[\\/]/).pop()} (${(pdf.length / 1e6).toFixed(2)} MB) → ${model}`)
const t0 = Date.now()
try {
  const { text, usage } = await generateText({
    model: anthropic(model),
    // Opus 4.7+ rejects `temperature` — only pin it on models that accept it.
    ...(/opus-4-[78]/.test(model) ? {} : { temperature: 0 }),
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
