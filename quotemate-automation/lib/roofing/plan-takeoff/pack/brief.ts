// The pack's roof brief (TKO-18, DEC-037): the supplier's reading of the job,
// after TKO-00a's hand-made Grange brief, on the platform's report chrome
// under the tenant's branding. Gotenberg prints it on A4. Quantities only:
// the brief carries no price, and the tradie sends it with the outline and
// the CSV.
//
// It is built from the pack's copy of the takeoff (privacy.ts), so it has no
// drawing text, and its builder is the request's business name alone. Every
// value is escaped, as the model wrote most of them.

import { esc, renderReportDocument, type TenantBranding } from '@/lib/pdf/report-chrome'
import type { PackGeometry, Point } from './geometry'
import type { PackStructure, PackTakeoff } from './privacy'

export type BriefRun = {
  job_ref: string | null
  job_name: string | null
  site_address: string
  scope_note: string | null
  /** The builder's business, as the request names it; nothing else of theirs. */
  builder_business: string | null
}

const CHECK_NAMES: Record<string, string> = {
  C1: 'Scale calibrated', C2: 'Dimensions consistent', C3: 'Area schedule reconciles', C4: 'Pitch plausible', C5: 'Complete',
  C6: 'Exclusions applied', C7: 'Confidence', C8: 'Drawing status', C9: 'Structure count', C10: 'Aerial agrees',
}
const RESULTS: Record<string, string> = { pass: 'Pass', warning: 'Warning', fail: 'Fail', skipped: 'Skipped' }
const SOURCES: Record<string, string> = { plans: 'Plans', aerial: 'Aerial', hybrid: 'Plans and aerial' }
const NOT_GIVEN = '<span class="note">not given</span>'

const two = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const metres = (n: number) => String(Math.round(n * 1000) / 1000)
const words = (type: string) => type.replace(/_/g, ' ')
const sum = (values: Array<number | null>) => values.reduce<number>((total, v) => total + (v ?? 0), 0)
const unique = <T,>(values: T[]) => [...new Set(values)]

/** A total of values the drawings may not give: the sum when every one is
 *  known, the known part marked "+ not given" when some aren't, and "not
 *  given" when none is. An unknown is never totalled as zero. */
function total(values: Array<number | null>, format: (n: number) => string): string {
  const known = values.filter((v): v is number => v !== null)
  if (!known.length) return NOT_GIVEN
  const text = format(known.reduce((a, b) => a + b, 0))
  return known.length === values.length ? text : `${text} <span class="note">+ not given</span>`
}

// The chrome's footer is fixed, so on A4 it would print over each page's
// last lines; as in the builder quote, it prints once, at the end.
const A4_FOOTER = '<style>.accentbar, .footline { position: static; } .keyplan { width: 100%; height: auto; max-height: 95mm; border: 1px solid var(--line); background: #fff; } .part h3 { font-size: 12px; margin: 12px 0 0; }</style>'

/** The key plan: the DXF's own geometry as SVG, north up, not to scale. */
function keyPlan(geometry: PackGeometry): string {
  const [x1, y1, x2, y2] = geometry.extent
  const width = Math.max(x2 - x1, 1)
  const height = Math.max(y2 - y1, 1)
  const pad = Math.max(width, height) * 0.06
  const label = Math.max(width, height) * 0.025
  const stroke = Math.max(width, height) * 0.0025
  const at = ([x, y]: Point) => `${(x - x1).toFixed(0)},${(y2 - y).toFixed(0)}`
  const shapes = geometry.structures.flatMap((s) => {
    if (!s.box) return []
    const planes = s.planes.flatMap((p) => (p.outline ? [`<polygon points="${p.outline.map(at).join(' ')}" fill="#FFF8DB" stroke="#241E1B" stroke-width="${stroke.toFixed(0)}"/>`] : []))
    const footprint = s.footprint ? [`<polygon points="${s.footprint.map(at).join(' ')}" fill="none" stroke="#837870" stroke-dasharray="${(stroke * 4).toFixed(0)}" stroke-width="${stroke.toFixed(0)}"/>`] : []
    const edges = s.edges.map((e) => `<line x1="${at(e.from).split(',')[0]}" y1="${at(e.from).split(',')[1]}" x2="${at(e.to).split(',')[0]}" y2="${at(e.to).split(',')[1]}" stroke="${e.type === 'eave' ? '#1D4ED8' : e.type === 'high_side' ? '#15803D' : '#B91C1C'}" stroke-width="${(stroke * 2).toFixed(0)}"/>`)
    const [lx, ly] = at([s.box[0], s.box[3]]).split(',').map(Number)
    const name = `<text x="${lx}" y="${(ly - label * 0.6).toFixed(0)}" font-size="${label.toFixed(0)}" font-family="Manrope, Arial, sans-serif" font-weight="700" fill="#241E1B">${esc(s.id)}</text>`
    return [...planes, ...footprint, ...edges, name]
  })
  return `<svg class="keyplan" viewBox="${(-pad).toFixed(0)} ${(-pad - label * 1.5).toFixed(0)} ${(width + 2 * pad).toFixed(0)} ${(height + 2 * pad + label * 1.5).toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Key plan of the roofs">${shapes.join('')}</svg>`
}

const pitchOf = (s: PackStructure) => {
  const pitches = unique(s.planes.map((p) => p.pitch_deg))
  if (pitches.some((p) => p === null)) return NOT_GIVEN
  return pitches.map((p) => `${p}°`).join(', ')
}

function roofsTable(structures: PackStructure[]): string {
  const rows = structures.map((s) => {
    const plan = s.planes.some((p) => p.plan_area_m2 === null) ? null : sum(s.planes.map((p) => p.plan_area_m2))
    const roof = s.planes.some((p) => p.sloped_area_m2 === null) ? null : sum(s.planes.map((p) => p.sloped_area_m2))
    return `<tr><td class="mono">${esc(s.id)}</td><td>${esc(s.label)}</td><td>${s.role === 'primary' ? 'Main' : 'Secondary'}</td><td>${SOURCES[s.source] ?? esc(s.source)}</td>`
      + `<td>${unique(s.planes.map((p) => p.profile).filter((p): p is string => !!p)).map(esc).join(', ') || NOT_GIVEN}</td>`
      + `<td class="num">${pitchOf(s)}</td><td class="num">${plan === null ? NOT_GIVEN : two(plan)}</td><td class="num">${roof === null ? NOT_GIVEN : two(roof)}</td></tr>`
  })
  const planes = structures.flatMap((s) => s.planes)
  const all = `<tr><td></td><td><strong>All roofs</strong></td><td></td><td></td><td></td><td></td><td class="num"><strong>${total(planes.map((p) => p.plan_area_m2), two)}</strong></td><td class="num"><strong>${total(planes.map((p) => p.sloped_area_m2), two)}</strong></td></tr>`
  return `<table><thead><tr><th>Roof</th><th>Label</th><th>Role</th><th>From</th><th>Profile</th><th class="num">Pitch</th><th class="num">On plan (m²)</th><th class="num">Roof area (m²)</th></tr></thead><tbody>${rows.join('')}${all}</tbody></table>`
}

function edgesTable(structures: PackStructure[]): string {
  const types = unique(structures.flatMap((s) => s.edges.map((e) => e.type)))
  if (!types.length) return '<p class="note">The takeoff lists no edges.</p>'
  const cell = (s: PackStructure, type: string) => {
    const edges = s.edges.filter((e) => e.type === type)
    if (!edges.length) return '<td class="num">–</td>'
    return `<td class="num">${edges.some((e) => e.length_m === null) ? NOT_GIVEN : metres(sum(edges.map((e) => e.length_m)))}</td>`
  }
  const rows = types.map((type) => `<tr><td>${esc(words(type))}</td>${structures.map((s) => cell(s, type)).join('')}<td class="num"><strong>${total(structures.flatMap((s) => s.edges.filter((e) => e.type === type).map((e) => e.length_m)), metres)}</strong></td></tr>`)
  return `<table><thead><tr><th>Edge (m)</th>${structures.map((s) => `<th class="num">${esc(s.id)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

function roofPart(s: PackStructure, geometry: PackGeometry, index: number): string {
  const drawn = geometry.structures[index]
  const onLayers = new Set(drawn?.edges.map((e) => e.index) ?? [])
  const value = (n: number | null, unit = '') => (n === null ? NOT_GIVEN : `${n}${unit}`)
  const planes = s.planes.map((p) => `<tr><td class="mono">${esc(p.id)}</td>`
    + `<td class="num">${p.plan_dims_mm ? `${Math.round(p.plan_dims_mm[0])} × ${Math.round(p.plan_dims_mm[1])}` : NOT_GIVEN}</td>`
    + `<td class="num">${p.plan_area_m2 === null ? NOT_GIVEN : two(p.plan_area_m2)}</td><td class="num">${value(p.pitch_deg, '°')}</td>`
    + `<td>${p.pitch_source ? esc(p.pitch_source) : NOT_GIVEN}</td><td>${p.fall ? esc(p.fall) : NOT_GIVEN}</td>`
    + `<td class="num">${p.sloped_area_m2 === null ? NOT_GIVEN : two(p.sloped_area_m2)}</td><td>${esc(p.confidence)}</td>`
    + `<td class="mono">${p.sheets.length ? p.sheets.map(esc).join(', ') : NOT_GIVEN}</td></tr>`).join('')
  const edges = s.edges.length
    ? `<table><thead><tr><th>Edge</th><th>Type</th><th class="num">Length (m)</th><th>From</th><th>On the outline</th></tr></thead><tbody>${s.edges.map((e, j) => `<tr><td class="mono">E${j + 1}</td><td>${esc(words(e.type))}</td><td class="num">${e.length_m === null ? NOT_GIVEN : metres(e.length_m)}</td><td>${esc(e.source)}</td><td>${onLayers.has(j) ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="note">No edges were read for this roof.</p>'
  const exclusions = s.exclusions.length
    ? `<h3>Left out</h3><ul class="bullets">${s.exclusions.map((x) => `<li>${esc(x.label)}: ${esc(x.reason)}${x.area_m2 === null ? '' : ` (${two(x.area_m2)} m² on plan)`}</li>`).join('')}</ul>`
    : ''
  const aerial = s.aerial ? `<p class="note">Measured from aerial data: a footprint of ${two(s.aerial.footprint_m2)} m²${s.aerial.drawn_plan_m2 === null ? '' : ` against ${two(s.aerial.drawn_plan_m2)} m² drawn`}.</p>` : ''
  return `<div class="part"><div class="part-head"><span class="marker">${esc(s.id)}</span><p class="part-title">${esc(s.label)}</p></div>`
    + `<p class="part-note-row"><span class="part-note">${s.role === 'primary' ? 'Main roof' : 'Secondary roof'} · from the ${(SOURCES[s.source] ?? s.source).toLowerCase()} · ${s.planes.length} plane${s.planes.length === 1 ? '' : 's'}</span></p>${aerial}`
    + `<h3>Planes</h3><table><thead><tr><th>Plane</th><th class="num">Size (mm)</th><th class="num">On plan (m²)</th><th class="num">Pitch</th><th>Pitch from</th><th>Falls</th><th class="num">Roof area (m²)</th><th>Confidence</th><th>Sheets</th></tr></thead><tbody>${planes}</tbody></table>`
    + `<h3>Edges</h3>${edges}${exclusions}</div>`
}

const bullets = (items: string[], none: string) =>
  (items.length ? `<ul class="bullets">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p class="note">${none}</p>`)

/** The roof brief's page, for Gotenberg to print on A4. */
export function briefHtml(input: { branding: TenantBranding; run: BriefRun; pack: PackTakeoff; geometry: PackGeometry; date: Date }): string {
  const { pack, run, geometry } = input
  const planes = pack.structures.flatMap((s) => s.planes)
  const review = pack.checks?.status === 'needs_review'
  const used = pack.sheets.filter((s) => s.used)
  const job = [run.job_name, run.job_ref].filter(Boolean).join(', ')
  const stat = (v: string, l: string) => `<div class="stat"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`
  const checks = pack.checks?.results.length
    ? `<table><thead><tr><th>Check</th><th>Result</th><th>Detail</th><th>Sheet</th></tr></thead><tbody>${pack.checks.results.map((c) => `<tr><td><span class="mono">${esc(c.id)}</span> ${esc(CHECK_NAMES[c.id] ?? '')}</td><td>${c.result === 'pass' || c.result === 'skipped' ? RESULTS[c.result] : `<span class="flag">${RESULTS[c.result] ?? esc(c.result)}</span>`}</td><td>${esc(c.detail)}</td><td class="mono">${c.sheet ? esc(c.sheet) : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="note">The checks haven’t run on this takeoff.</p>'
  const body = `${A4_FOOTER}
  <div class="statgrid">${stat(String(pack.structures.length), pack.structures.length === 1 ? 'roof' : 'roofs')}${stat(total(planes.map((p) => p.sloped_area_m2), two), 'm² of roof')}${stat(total(planes.map((p) => p.plan_area_m2), two), 'm² on plan')}${stat(review ? 'Needs review' : 'Ready', 'checks')}</div>
  ${review ? '<p class="note"><span class="flag">Needs review</span> The checks flagged this takeoff. The tradie accepted it for export; the checks below say what to confirm.</p>' : ''}
  <h2>Key plan</h2>
  <figure class="figure">${keyPlan(geometry)}<figcaption>Drawn from roof-outline.dxf: each roof in its own slot, north up, not to scale. Eaves blue, high sides green, barges red, where the takeoff fixes them.</figcaption></figure>
  <h2>Roofs</h2>${roofsTable(pack.structures)}
  <h2>Edges</h2>${edgesTable(pack.structures)}
  <h2>Scope</h2>
  ${run.scope_note ? `<div class="scope">${esc(run.scope_note)}</div>` : '<p class="note">The request gives no scope note.</p>'}
  <h3>Includes</h3>${bullets(pack.scope.includes, 'Nothing listed.')}
  <h3>Excludes</h3>${bullets(pack.scope.excludes, 'Nothing listed.')}
  <h3>To confirm</h3>${bullets(pack.scope.questions, 'No questions.')}
  ${pack.structures.map((s, i) => roofPart(s, geometry, i)).join('')}
  <h2>Checks</h2>${checks}
  <h2>Drawings used</h2>
  ${used.length ? `<table><thead><tr><th>Sheet</th><th>Title</th><th>Revision</th><th>Kind</th><th>Status</th></tr></thead><tbody>${used.map((s) => `<tr><td class="mono">${esc(s.ref)}</td><td>${s.title ? esc(s.title) : ''}</td><td>${s.revision ? esc(s.revision) : ''}</td><td>${esc(words(s.kind))}</td><td>${s.preliminary ? '<span class="flag">Preliminary</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No sheet is marked as used.</p>'}`
  return renderReportDocument(input.branding, {
    docTitle: `Roof brief${run.job_ref ? ` ${run.job_ref}` : ''} — ${input.branding.businessName}`,
    eyebrow: 'Roof brief · For Roof Wizard',
    titleText: 'Roof brief',
    dateLabel: input.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' }),
    customerName: run.builder_business,
    siteAddress: run.site_address,
    introHtml: `The roofs${job ? ` for <strong>${esc(job)}</strong>` : ''}, measured from the builder's plans for the supplier's takeoff. Quantities only: this brief carries no price.`,
    bodyHtml: body,
    pleaseNote: [
      `Measured from the builder's plans${used.length ? `: ${used.map((s) => s.ref).join(', ')}` : ''}. Verify on site before ordering.`,
      'roof-outline.dxf is in millimetres at 1:1, north up, with each roof in its own slot; takeoff.csv lists every plane and edge.',
      'Lengths are in metres and areas in m². A value marked "not given" is one the drawings don’t give.',
    ],
    footerPriceNote: 'Roof brief · quantities only, no prices',
  })
}
