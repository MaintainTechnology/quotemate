// QuoteMax · draw the QUOTEMAX wordmark as real vector letterforms.
// Usage: node scripts/gen-quotemax-wordmark.mjs [--sheet]
//
// No fonts, no LLM, no network — every glyph is constructed from the same
// grid (cap 200, stem 54, corner radius 30) so the mark stays crisp from a
// 16px favicon to a truck decal. --sheet also rasterises a contact sheet to
// public/brand/concepts-v3/ for eyeballing.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const brandDir = join(here, '..', 'public', 'brand')

// ── Brand tokens (.impeccable/design.json) ────────────────────────────────
const INK = '#16120F' // Command Charcoal
const BONE = '#F6F1EA' // Bone
const ACCENT = '#FFC400' // Caterpillar Yellow
const PAPER = '#FAF8F4' // Warm Paper

// ── Type metrics ──────────────────────────────────────────────────────────
const CAP = 200 // cap height — the unit everything is measured in
const STEM = 54 // vertical stroke weight
const RAD = 30 // outer corner radius on round letters
const CRAD = 12 // counter corner radius
const GAP = 26 // nominal sidebearing between glyphs
const DESC = 226 // lowest point — the Q tail drops below the baseline

const n = (v) => Math.round(v * 100) / 100

// Rounded rect, per-corner radii [tl,tr,br,bl]. L/Q corners only — arcs with
// sweep flags are easy to get backwards, quadratics never are.
function rr(x, y, w, h, r) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r]
  return [
    `M${n(x + tl)} ${n(y)}`,
    `H${n(x + w - tr)}`,
    tr ? `Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + tr)}` : '',
    `V${n(y + h - br)}`,
    br ? `Q${n(x + w)} ${n(y + h)} ${n(x + w - br)} ${n(y + h)}` : '',
    `H${n(x + bl)}`,
    bl ? `Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - bl)}` : '',
    `V${n(y + tl)}`,
    tl ? `Q${n(x)} ${n(y)} ${n(x + tl)} ${n(y)}` : '',
    'Z',
  ].join('')
}

const poly = (pts) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`

// ── The tick ──────────────────────────────────────────────────────────────
// One shape, used everywhere. Short arm 45°, long arm 60° — the steeper long
// arm reads as rising ("MAX") and keeps the tick compact next to the letters.
// Terminals are cut square (perpendicular), matching the flat letter endings.
// Returned outlined, not stroked, so it survives any scale or export.
function tickPath({ thickness = STEM, height = CAP, a1 = 45, a2 = 60, l1 = 73.5, l2 = 176, flatBoth = false } = {}) {
  const t = thickness / 2
  const rad = (deg) => (deg * Math.PI) / 180
  // a1 = short arm's descent angle, a2 = long arm's rise angle, both from
  // horizontal. Steeper angles narrow the tick without shortening it — needed
  // when it has to fit between two stems rather than sit beside a word.
  const P0 = [0, 0]
  const P1 = [l1 * Math.cos(rad(a1)), l1 * Math.sin(rad(a1))]
  const P2 = [P1[0] + l2 * Math.cos(rad(a2)), P1[1] - l2 * Math.sin(rad(a2))]

  const unit = ([ax, ay], [bx, by]) => {
    const dx = bx - ax
    const dy = by - ay
    const L = Math.hypot(dx, dy)
    return [dx / L, dy / L]
  }
  const d1 = unit(P0, P1)
  const d2 = unit(P1, P2)
  // Left normal (-dy,dx) points to the outer (lower) side of this turn.
  const nrm = ([dx, dy]) => [-dy, dx]
  const n1 = nrm(d1)
  const n2 = nrm(d2)

  const off = (p, nv, s) => [p[0] + nv[0] * s, p[1] + nv[1] * s]

  // Miter at the vertex: bisector of the two normals, extended by t/sin(θ/2).
  const bx = n1[0] + n2[0]
  const by = n1[1] + n2[1]
  const bL = Math.hypot(bx, by)
  const bis = [bx / bL, by / bL]
  // angle between the two arm directions
  const dot = d1[0] * d2[0] + d1[1] * d2[1]
  const turn = Math.acos(Math.max(-1, Math.min(1, dot)))
  const miter = t / Math.sin((Math.PI - turn) / 2)

  const build = (end, start = P0) => [
    off(start, n1, t), // outer start
    [P1[0] + bis[0] * miter, P1[1] + bis[1] * miter], // outer vertex
    off(end, n2, t), // outer end
    off(end, n2, -t), // inner end
    [P1[0] - bis[0] * miter, P1[1] - bis[1] * miter], // inner vertex
    off(start, n1, -t), // inner start
  ]

  // The long arm's tip is cut HORIZONTALLY, not perpendicular to the arm, so it
  // lands flat on the cap line and aligns with the flat top of every letter. A
  // perpendicular cut touches the cap line at one corner only and reads as the
  // tip floating at an arbitrary angle — the defect in the reference artwork.
  // Done by over-running the arm past the cap line and clipping it off there.
  const capY = Math.min(...build(P2).map((p) => p[1]))
  // flatBoth also over-runs the SHORT arm up past the cap line, so it too is
  // cut flat there. That keeps the M's top edge continuous when the tick is
  // standing in for the middle stroke, at the cost of some tick character.
  const overrun = build(
    [P2[0] + d2[0] * 70, P2[1] + d2[1] * 70],
    flatBoth ? [P0[0] - d1[0] * 200, P0[1] - d1[1] * 200] : P0
  )

  const pts = []
  for (let i = 0; i < overrun.length; i++) {
    const A = overrun[i]
    const B = overrun[(i + 1) % overrun.length]
    if (A[1] >= capY) pts.push(A)
    if (A[1] >= capY !== B[1] >= capY) {
      const k = (capY - A[1]) / (B[1] - A[1])
      pts.push([A[0] + (B[0] - A[0]) * k, capY])
    }
  }

  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = capY
  const h = Math.max(...ys) - minY
  const s = height / h
  const norm = pts.map(([x, y]) => [(x - minX) * s, (y - minY) * s])

  return {
    d: poly(norm),
    w: (Math.max(...xs) - minX) * s,
    h: height,
  }
}

const TICK = tickPath()

// ── Glyphs ────────────────────────────────────────────────────────────────
// Each: { w: advance, paths: [{ d, rule? }] }. Separate paths union (same
// fill); a single path with fill-rule="evenodd" punches counters.

function glyphQ({ w = 166, counterW = null } = {}) {
  const cw = counterW ?? w - STEM * 2
  const cx = (w - cw) / 2
  // The tail carries the whole "this is a Q, not an O" load, so it is a full
  // stem-weight bar that cuts the bowl's lower-right curve and lands below the
  // baseline. Bottom-LEFT was tried and reads as a speech-bubble tail — the
  // word came out as "pUOTEMAX". It starts at y=152, clear of the counter.
  return {
    w,
    paths: [
      { d: rr(0, 0, w, CAP, RAD) + rr(cx, STEM, cw, CAP - STEM * 2, CRAD), rule: 'evenodd' },
      { d: poly([[w - 68, 152], [w - 14, 152], [w + 4, 226], [w - 50, 226]]) },
    ],
  }
}

function glyphO(w = 162) {
  return {
    w,
    paths: [
      { d: rr(0, 0, w, CAP, RAD) + rr(STEM, STEM, w - STEM * 2, CAP - STEM * 2, CRAD), rule: 'evenodd' },
    ],
  }
}

function glyphU(w = 162) {
  return {
    w,
    paths: [
      {
        // Counter starts at the cap line, not above it — with fill-rule
        // evenodd any overhang past the outer shape counts as *inside* and
        // renders as a stray filled tab.
        d:
          rr(0, 0, w, CAP, [0, 0, RAD, RAD]) +
          rr(STEM, 0, w - STEM * 2, CAP - STEM, [0, 0, CRAD, CRAD]),
        rule: 'evenodd',
      },
    ],
  }
}

function glyphT(w = 152) {
  const bar = 52
  const a = (w - STEM) / 2
  return { w, paths: [{ d: `M0 0H${n(w)}V${bar}H${n(a + STEM)}V${CAP}H${n(a)}V${bar}H0Z` }] }
}

function glyphE(w = 146) {
  const bar = 52
  const mid = w - 10
  return {
    w,
    paths: [
      {
        d: `M0 0H${n(w)}V${bar}H${STEM}V74H${n(mid)}V126H${STEM}V148H${n(w)}V${CAP}H0Z`,
      },
    ],
  }
}

function glyphM(w = 204, { wedge = true } = {}) {
  // wedge:false leaves the two stems only, so a tick can occupy the middle
  // outright. Overlaying a tick on the intact wedge always strands slivers of
  // it between the tick's arms — no knockout width hides them.
  if (!wedge) {
    return {
      w,
      paths: [{ d: `M0 0H${STEM}V${CAP}H0Z` }, { d: `M${n(w - STEM)} 0H${n(w)}V${CAP}H${n(w - STEM)}Z` }],
    }
  }
  const wedgeL = STEM - 10
  const apexX = w / 2
  const apexY = 152
  // where the wedge edges cross the stems' inner edges
  const yAt = (STEM - wedgeL) / (apexX - wedgeL) * apexY
  return {
    w,
    paths: [
      {
        d:
          `M0 0H${n(w)}V${CAP}H${n(w - STEM)}V${n(yAt)}` +
          `L${n(apexX)} ${n(apexY)}L${n(STEM)} ${n(yAt)}V${CAP}H0Z`,
      },
    ],
  }
}

function glyphA(w = 200) {
  const topL = w * 0.35
  const topR = w - topL
  const slope = topL / CAP // dx per dy
  const hOff = STEM * Math.hypot(1, slope) // horizontal offset for a slanted stem
  const innerL = (y) => topL - slope * y + hOff
  const innerR = (y) => topR + slope * y - hOff
  // counter apex — where the two inner edges meet: innerL(y) === innerR(y)
  const ay = (topL + hOff - (topR - hOff)) / (2 * slope)
  const barTop = 124
  const barBot = 162
  return {
    w,
    paths: [
      {
        d: [
          poly([[0, CAP], [topL, 0], [topR, 0], [w, CAP]]),
          poly([[w / 2, ay], [innerR(barTop), barTop], [innerL(barTop), barTop]]),
          poly([
            [innerL(barBot), barBot],
            [innerR(barBot), barBot],
            [innerR(CAP), CAP],
            [innerL(CAP), CAP],
          ]),
        ].join(''),
        rule: 'evenodd',
      },
    ],
  }
}

function glyphX(w = 168) {
  const ht = STEM * Math.hypot(w, CAP) / CAP // horizontal thickness of a diagonal
  return {
    w,
    paths: [
      { d: poly([[0, 0], [ht, 0], [w, CAP], [w - ht, CAP]]) },
      { d: poly([[w - ht, 0], [w, 0], [ht, CAP], [0, CAP]]) },
    ],
  }
}

// Optical kerning — pairs with open shoulders need tightening.
const KERN = { QU: 4, UO: -2, OT: -8, TE: -8, EM: -2, MA: -4, AX: -6 }

function layout(glyphs) {
  let x = 0
  const placed = []
  glyphs.forEach((g, i) => {
    placed.push({ x, g })
    const next = glyphs[i + 1]
    if (next) x += g.w + GAP + (KERN[g.ch + next.ch] ?? 0)
  })
  return { placed, width: x + glyphs[glyphs.length - 1].w }
}

// The tick, re-cut steep enough to fit between the M's two stems.
const NARROW = tickPath({ a1: 58, a2: 72 })
const NARROW_V = tickPath({ a1: 58, a2: 72, flatBoth: true })
const M_WEDGELESS_W = STEM * 2 + NARROW.w

function wordmark({ tickInQ = false, mWedge = true, mWidth = M_WEDGELESS_W } = {}) {
  const Q = tickInQ ? { ch: 'Q', ...glyphQ({ w: 180, counterW: 72 }) } : { ch: 'Q', ...glyphQ() }
  const glyphs = [
    Q,
    { ch: 'U', ...glyphU() },
    { ch: 'O', ...glyphO() },
    { ch: 'T', ...glyphT() },
    { ch: 'E', ...glyphE() },
    { ch: 'M', ...(mWedge ? glyphM() : glyphM(mWidth, { wedge: false })) },
    { ch: 'A', ...glyphA() },
    { ch: 'X', ...glyphX() },
  ]
  return layout(glyphs)
}

const render = (placed, fill) =>
  placed
    .map(
      ({ x, g }) =>
        `<g transform="translate(${n(x)},0)">` +
        g.paths.map((p) => `<path d="${p.d}" fill="${fill}"${p.rule ? ` fill-rule="${p.rule}"` : ''}/>`).join('') +
        `</g>`
    )
    .join('')

// ── Variants ──────────────────────────────────────────────────────────────
// Each returns { body, w, h } in cap-height units, origin at the cap line.

// A — the tick lives inside the Q's counter. Nothing overlaps a stroke, so no
// letterform is damaged; the tick reads as "quote approved" in negative space.
function variantA(ink) {
  const { placed, width } = wordmark({ tickInQ: true })
  const counterW = 72
  const counterH = CAP - STEM * 2
  const cx = (180 - counterW) / 2
  const pad = 9
  const s = (counterW - pad * 2) / TICK.w
  const th = TICK.h * s
  const ty = STEM + (counterH - th) / 2
  return {
    w: width,
    h: DESC,
    body:
      render(placed, ink) +
      `<g transform="translate(${n(cx + pad)},${n(ty)}) scale(${n(s)})">` +
      `<path d="${TICK.d}" fill="${ACCENT}"/></g>`,
  }
}

// The tile mark, re-cut on the wordmark's grid: same corner radius ratio, same
// outlined tick. The shipped quotemax-mark.svg keeps the concept (speech bubble
// + tick) but uses a rounded, round-capped tick that reads as a different
// family next to these square-cut letters.
function tileMark(size = 240) {
  const k = size / 240
  const bubble = { x: 38, y: 46, w: 164, h: 116, r: RAD * (116 / CAP) }
  const th = 62
  const tw = TICK.w * (th / TICK.h)
  return (
    `<g transform="scale(${n(k)})">` +
    `<rect width="240" height="240" fill="${ACCENT}"/>` +
    `<path d="${rr(bubble.x, bubble.y, bubble.w, bubble.h, bubble.r)}" fill="${INK}"/>` +
    `<path d="${poly([[64, 150], [64, 206], [114, 158]])}" fill="${INK}"/>` +
    `<g transform="translate(${n(bubble.x + (bubble.w - tw) / 2)},${n(bubble.y + (bubble.h - th) / 2)}) ` +
    `scale(${n(th / TICK.h)})"><path d="${TICK.d}" fill="${ACCENT}"/></g>` +
    `</g>`
  )
}

// B — tile lockup: the mark + a clean charcoal wordmark, nothing overlapping.
function variantB(ink) {
  const { placed, width } = wordmark()
  const tile = 236
  const gapX = 56
  return {
    w: tile + gapX + width,
    h: DESC,
    body:
      `<g transform="translate(0,${n((CAP - tile) / 2)})">${tileMark(tile)}</g>` +
      `<g transform="translate(${n(tile + gapX)},0)">${render(placed, ink)}</g>`,
  }
}

// C — the tick as a terminal accent: it sits after the X, baseline-aligned and
// overshooting the cap line, so the word ends on a rising "approved".
function variantC(ink) {
  const { placed, width } = wordmark()
  const s = 1.0
  const tw = TICK.w * s
  const th = TICK.h * s
  const gapX = 38
  return {
    w: width + gapX + tw,
    h: DESC,
    body:
      render(placed, ink) +
      `<g transform="translate(${n(width + gapX)},${n(CAP - th)}) scale(${n(s)})">` +
      `<path d="${TICK.d}" fill="${ACCENT}"/></g>`,
  }
}

// D — the original composition: tick over the M. TICK is normalised to exactly
// cap height, so dropping it at y=0 puts the long arm's tip flush on the cap
// line and the vertex flush on the baseline — the same band every letter sits
// in. That is the alignment the reference was missing; its tip floated above
// the caps at an arbitrary height and its terminal was cut on no shared angle.
// `halo` knocks the tick out of the M in the background colour so both shapes
// stay readable — without it the tick eats the M's left stem and wedge.
function variantD(ink, { halo = null } = {}) {
  const { placed, width } = wordmark()
  const m = placed.find((p) => p.g.ch === 'M')
  // Left edge sits on the M's left stem, so the stem stays readable and the
  // tick starts on an existing edge instead of floating mid-letter. With the
  // tip flush on the cap line that gives the tick two shared alignments.
  const x = m.x + STEM
  return {
    w: width,
    h: DESC,
    body:
      render(placed, ink) +
      `<g transform="translate(${n(x)},0)">` +
      (halo
        ? `<path d="${TICK.d}" fill="${halo}" stroke="${halo}" stroke-width="20" stroke-linejoin="miter"/>`
        : '') +
      `<path d="${TICK.d}" fill="${ACCENT}"/></g>`,
  }
}

// E — the tick IS the M's middle stroke. The wedge is gone rather than hidden,
// so there is nothing left to strand: left stem, tick, right stem, two clean
// counters. Tip still lands flat on the cap line.
function variantE(ink) {
  const { placed, width } = wordmark({ mWedge: false })
  const m = placed.find((p) => p.g.ch === 'M')
  return {
    w: width,
    h: DESC,
    body:
      render(placed, ink) +
      `<g transform="translate(${n(m.x + STEM)},0)"><path d="${NARROW.d}" fill="${ACCENT}"/></g>`,
  }
}

// F — as E, but both arms run to the cap line so the M keeps an unbroken top.
function variantF(ink) {
  const { placed, width } = wordmark({ mWedge: false, mWidth: STEM * 2 + NARROW_V.w })
  const m = placed.find((p) => p.g.ch === 'M')
  return {
    w: width,
    h: DESC,
    body:
      render(placed, ink) +
      `<g transform="translate(${n(m.x + STEM)},0)"><path d="${NARROW_V.d}" fill="${ACCENT}"/></g>`,
  }
}

const VARIANTS = { a: variantA, b: variantB, c: variantC, d: variantD, e: variantE, f: variantF }

function svg(variant, { ink = INK, bg = null, pad = 40 } = {}) {
  const v = VARIANTS[variant](ink)
  const w = v.w + pad * 2
  const h = v.h + pad * 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" ` +
    `viewBox="0 0 ${n(w)} ${n(h)}" role="img" aria-label="QuoteMax">` +
    `<title>QuoteMax</title>` +
    (bg ? `<rect width="${n(w)}" height="${n(h)}" fill="${bg}"/>` : '') +
    `<g transform="translate(${pad},${pad})">${v.body}</g>` +
    `</svg>`
  )
}

// ── Output ────────────────────────────────────────────────────────────────
mkdirSync(brandDir, { recursive: true })
const files = []
for (const k of Object.keys(VARIANTS)) {
  files.push([`quotemax-wordmark-${k}.svg`, svg(k, { ink: INK })])
  files.push([`quotemax-wordmark-${k}-reversed.svg`, svg(k, { ink: BONE })])
}
files.push([
  'quotemax-mark-v2.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" ` +
    `role="img" aria-label="QuoteMax"><title>QuoteMax</title>${tileMark(256)}</svg>`,
])

for (const [name, body] of files) {
  writeFileSync(join(brandDir, name), body)
  console.log(`✓ ${name}`)
}

if (process.argv.includes('--sheet')) {
  const sharp = (await import('sharp')).default
  const outDir = join(brandDir, 'concepts-v3')
  mkdirSync(outDir, { recursive: true })

  const rows = []
  let y = 0
  const SHEET_W = 2200
  const label = (t, yy, fill) =>
    `<text x="60" y="${yy}" font-family="monospace" font-size="26" fill="${fill}" letter-spacing="3">${t}</text>`

  for (const k of Object.keys(VARIANTS)) {
    for (const [mode, ink, bg] of [
      ['light', INK, PAPER],
      ['dark', BONE, INK],
    ]) {
      const v = VARIANTS[k](ink)
      const scale = (SHEET_W - 240) / v.w
      const blockH = v.h * scale + 150
      rows.push(
        `<g transform="translate(0,${y})">` +
          `<rect width="${SHEET_W}" height="${blockH}" fill="${bg}"/>` +
          label(`VARIANT ${k.toUpperCase()} · ${mode}`, 52, mode === 'light' ? '#8a8078' : '#6E6354') +
          `<g transform="translate(120,90) scale(${scale})">${v.body}</g>` +
          `</g>`
      )
      y += blockH
    }
    // legibility strip — rendered at real pixel cap heights
    const v = VARIANTS[k](INK)
    const strip = 150
    let sx = 120
    const small = [30, 20, 13]
      .map((capPx) => {
        const sc = capPx / CAP
        const g = `<g transform="translate(${sx},${(strip - CAP * sc) / 2}) scale(${n(sc)})">${v.body}</g>`
        sx += v.w * sc + 90
        return g
      })
      .join('')
    rows.push(
      `<g transform="translate(0,${y})"><rect width="${SHEET_W}" height="${strip}" fill="${PAPER}"/>${small}` +
        label(`↑ cap height 30 / 20 / 13 px`, strip - 16, '#8a8078') +
        `</g>`
    )
    y += strip
  }

  const sheet =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${y}" viewBox="0 0 ${SHEET_W} ${y}">` +
    `<rect width="${SHEET_W}" height="${y}" fill="${PAPER}"/>${rows.join('')}</svg>`
  writeFileSync(join(outDir, 'sheet.svg'), sheet)
  await sharp(Buffer.from(sheet)).png().toFile(join(outDir, 'sheet.png'))
  console.log(`✓ contact sheet → ${join(outDir, 'sheet.png')}`)
}
