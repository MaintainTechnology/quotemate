// Dev-only preview for the roofing-PDF outline tracing (spec
// roof-pdf-outline-tracing). Runs the REAL buildRoofOutlineSvg over a few
// representative structure sets and writes a standalone HTML file you can open
// in a browser — no Gotenberg needed. Throwaway: safe to delete, not imported
// by the app.
//
//   run:  npx tsx scripts/preview-roof-outline.ts
//   open: quotemate-automation/roof-outline-preview.html
//
// The figure is rendered on the same warm-paper background + figure border the
// PDF uses, so the white-eave casing, the #FFC400 fill/outline and the
// excluded faint-dashed styling look exactly as they will in the quote PDF.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRoofOutlineSvg, type RoofOutlineStructure } from '../lib/roofing/roof-outline-svg'
import type { GeoJSONPolygon } from '../lib/roofing/types'

/** Closed rectangular ring (lng/lat) — origin = south-west corner. */
function rect(west: number, south: number, dLng: number, dLat: number): GeoJSONPolygon {
  const east = west + dLng
  const north = south + dLat
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }
}

// An L-shaped footprint → roof form 'complex' (all edges classified 'unknown').
const L_SHAPE: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [151.2000, -33.8000],
      [151.2011, -33.8000],
      [151.2011, -33.8004],
      [151.2005, -33.8004],
      [151.2005, -33.8008],
      [151.2000, -33.8008],
      [151.2000, -33.8000],
    ],
  ],
}

type Scenario = { title: string; note: string; structures: RoofOutlineStructure[] }

const SCENARIOS: Scenario[] = [
  {
    title: 'Single structure — hip',
    note: 'All four edges classify as eaves (#FFFFFF) — watch the dark casing keep them legible on white.',
    structures: [{ polygon: rect(151.2, -33.8, 0.0006, 0.0005), form: 'hip', included: true }],
  },
  {
    title: 'Single structure — gable',
    note: 'Two long edges = eaves (white); the short gable ends pop in ridge yellow (#FFD23D).',
    structures: [{ polygon: rect(151.2, -33.8, 0.0011, 0.00045), form: 'gable', included: true }],
  },
  {
    title: 'Multi-structure — dwelling + secondary + EXCLUDED shed',
    note: 'Two included structures solid; the excluded shed is faint + dashed grey (#7A8699). All share one frame at correct relative scale.',
    structures: [
      { polygon: rect(151.2, -33.8, 0.0009, 0.0006), form: 'gable', included: true },
      { polygon: rect(151.2012, -33.7998, 0.00045, 0.00045), form: 'hip', included: true },
      { polygon: rect(151.2001, -33.8008, 0.00035, 0.0003), form: 'skillion', included: false },
    ],
  },
  {
    title: 'Complex (L-shaped) footprint',
    note: "form 'complex' → every edge neutral grey (#7A8699): no claim about which edge is what.",
    structures: [{ polygon: L_SHAPE, form: 'complex', included: true }],
  },
]

const W = 1000
const H = 750

const cards = SCENARIOS.map((s) => {
  const svg = buildRoofOutlineSvg(s.structures, { width: W, height: H })
  const fig = svg
    ? `<div class="hero">${svg}</div><figcaption>Roof outline traced from your measured roof areas.</figcaption>`
    : `<div class="empty">buildRoofOutlineSvg returned null (no usable geometry)</div>`
  console.log(`• ${s.title.padEnd(52)} svg=${svg ? `${svg.length} chars` : 'null'}`)
  return `
  <section class="card">
    <h2>${s.title}</h2>
    <p class="note">${s.note}</p>
    <figure class="figure figure-pair">${fig}</figure>
  </section>`
}).join('\n')

const html = `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8">
<title>Roof outline tracing — preview</title>
<style>
  :root{ --paper:#FAF8F4; --card:#FFFFFF; --line:#E9E3DC; --pri:#241E1B; --sec:#5E544E; --dim:#837870; }
  body{ background:var(--paper); color:var(--pri); margin:0; padding:32px;
    font-family:'Manrope','Segoe UI',system-ui,Arial,sans-serif; }
  h1{ text-transform:uppercase; letter-spacing:-0.02em; }
  .lead{ color:var(--sec); max-width:70ch; }
  .card{ background:var(--card); border:1px solid var(--line); padding:18px 20px; margin:20px 0; }
  .card h2{ font-size:15px; text-transform:uppercase; letter-spacing:-0.01em; margin:0 0 4px; }
  .card .note{ color:var(--sec); font-size:12px; margin:0 0 12px; }
  /* mirrors lib/pdf/report-chrome.ts .figure / .figure-pair */
  .figure{ margin:0; }
  .figure-pair .hero{ width:100%; }
  .figure-pair .hero svg{ width:100%; max-height:420px; object-fit:contain;
    border:1px solid var(--line); display:block; }
  .figure figcaption{ text-align:center; color:var(--sec); font-style:italic; font-size:11px; margin-top:6px; }
  .empty{ color:#B45309; font-style:italic; }
</style></head>
<body>
  <h1>Roof outline tracing — preview</h1>
  <p class="lead">Rendered by the real <code>buildRoofOutlineSvg</code> at ${W}×${H}, on the PDF's
  warm-paper background and figure border. This is the hero figure that replaces the satellite photo
  on the roofing quote PDF.</p>
  ${cards}
</body></html>`

const out = join(process.cwd(), 'roof-outline-preview.html')
writeFileSync(out, html, 'utf8')
console.log(`\n✓ wrote ${out} (${html.length} bytes) — open it in a browser.`)
