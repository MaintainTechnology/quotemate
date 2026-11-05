// Converts the hand-measured Grange takeoff (TKO-00a, the roof brief's
// takeoff.json, a client document kept out of git) into a RoofPlanTakeoff v1:
// the reference the takeoff checks (TKO-13) and the eval (TKO-15) work from.
// Every Grange roof is a skillion: its eave and high side run across its
// width, and its sides (barges, or a wall junction as an apron) down its run.
// Lengths are on plan. Builder-facing questions only; no names.
//
// Usage: node scripts/roof-takeoff-reference.mjs
// Writes eval/roof-takeoff/grange/takeoff.json.

import { readFileSync, writeFileSync } from 'node:fs'

const brief = JSON.parse(readFileSync('docs/tag-roofing-requests/J14997-59-Grange-Rd/brief/takeoff.json', 'utf8'))
const sheets = JSON.parse(readFileSync('eval/roof-takeoff/grange/sheets.json', 'utf8')).sheets.map((sheet) => {
  const copy = { ...sheet }
  delete copy.model // the expectations' marker for pages the model reads
  return copy
})

// Every plan size comes off the A1001A site plan.
const sitePlan = sheets.find((s) => s.number === 'A1001A')
const round2 = (n) => Math.round(n * 100) / 100
const level = (text) => (/^high/i.test(text) ? 'high' : /^medium/i.test(text) ? 'medium' : 'low')

const structures = brief.structures.map((s, i) => {
  const id = `S${i + 1}`
  const area = round2((s.width_mm * s.run_mm) / 1e6)
  const lengthScaled = /scaled/i.test(s.confidence_text)
  const across = { length_m: s.width_mm / 1000, source: 'measured', confidence: 'high' }
  const down = { length_m: s.run_mm / 1000, source: lengthScaled ? 'derived' : 'measured', confidence: level(s.confidence_text) }
  return {
    id,
    label: s.label,
    role: /house/i.test(s.label) ? 'primary' : 'secondary',
    source: 'plans',
    planes: [{
      id: `${id}-P1`,
      plan_dims_mm: [s.width_mm, s.run_mm],
      polygon_mm: null,
      plan_area_m2: area,
      pitch_deg: s.pitch_deg,
      pitch_source: 'note',
      fall: s.fall_text,
      profile: s.profile,
      finish_tag: s.finish,
      sloped_area_m2: round2(area / Math.cos((s.pitch_deg * Math.PI) / 180)),
      confidence: level(s.confidence_text),
      evidence: [{ file: sitePlan.file, page: sitePlan.page, text: s.source?.['Plan size'] ?? null, bbox: null }],
    }],
    edges: [
      { type: 'eave', ...across },
      { type: 'high_side', ...across },
      ...Object.values(s.sides).map((side) => ({ type: side === 'wall' ? 'apron' : 'barge', ...down })),
    ],
    exclusions: [],
  }
})

const takeoff = {
  version: 1,
  // The brief's C1: A1001A at 1:100 on A1, confirmed by its 10130 and 9600 dimension lines.
  scale: {
    stated: '1:100 @ A1',
    sheet_size: 'A1',
    pdf_page: [2383.94, 1683.78],
    calibration: { method: 'dimension_string', reference_mm: 10130, factor: 35.28, delta_pct: 0.01 },
  },
  sheets,
  structures,
  scope: {
    includes: brief.scope.measured,
    excludes: [],
    questions: brief.questions.filter((q) => q.for === 'Builder').map((q) => q.text),
  },
}

writeFileSync('eval/roof-takeoff/grange/takeoff.json', `${JSON.stringify(takeoff, null, 2)}\n`)
console.log(`eval/roof-takeoff/grange/takeoff.json: ${structures.length} roofs, ${round2(structures.reduce((sum, s) => sum + s.planes[0].plan_area_m2, 0))} m² on plan`)
