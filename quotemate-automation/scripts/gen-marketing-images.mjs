// Regenerate every marketing photo with Gemini (nano-banana,
// gemini-3.1-flash-image). Two sets: the home page (public/marketing) and
// the five trade pages (public/trades).
//
//   node --env-file=.env.local scripts/gen-marketing-images.mjs
//   node --env-file=.env.local scripts/gen-marketing-images.mjs --set=trades
//   node --env-file=.env.local scripts/gen-marketing-images.mjs --only=home-crew,solar-2
//
// Each entry below is one <DuotoneImage> slot. `aspect` is the ratio the SLOT
// renders at (or the source ratio where two different crops share one file and
// the existing object-position tuning depends on it) — generating at the render
// ratio means object-cover barely crops.
//
// Originals are moved to .image-backups/<dir>/ (gitignored, and OUTSIDE public/
// so they are never served or deployed) before anything is written, so a bad
// batch is one `mv` away from being undone.

import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MODEL = process.env.GEMINI_IMAGE_MODEL_HOME ?? 'gemini-3.1-flash-image'
const CONCURRENCY = 3
const JPEG_QUALITY = 80
// Per-set output width lives on SETS.<name>.maxEdge below — 1400px is 2x the
// largest slot on either page, and anything above that is bytes next/image
// throws away.

// The look every image shares. Home-page photos pass through the
// `.duotone-img` treatment (grayscale .55 / sepia .22 / a multiply charcoal
// scrim, and darker again in dark theme), so they must be bright, high in
// tonal separation, and readable without colour. The lower ~30% of most
// frames sits under a caption gradient — keep it visually quiet.
const STYLE = `
Photographic style: authentic Australian trade documentary photography. Real
working tradespeople mid-task, competent and focused — never posed, never
grinning at the lens, never a polished stock-photo handshake. Natural daylight,
bright and generously exposed with strong separation between highlight and
shadow so the frame still reads once desaturated. Warm neutral palette, muted
and slightly dusty, with safety-yellow as the one saturated note. Shot on a
full-frame 35mm camera with a fast prime, gentle depth of field, honest
straight-on framing, no wide-angle distortion, no lens flare, no heavy vignette.
Unmistakably Australian: Colorbond steel roofing, brick-veneer and weatherboard
suburban homes, hard clear southern-hemisphere light, gum trees and dry lawn.
Composition: the subject sits in the upper two thirds; the bottom edge of the
frame stays calm and uncluttered. Hard constraints: no text, no lettering, no
numbers, no signage, no logos, no brand marks, no watermark anywhere in the
image. No collage, no split frame, no border, no illustration or 3D render —
one single photograph.`.replace(/\s+/g, ' ').trim()

const HOME_IMAGES = [
  // ── Hero filmstrip (3 tiles, 3:4 / 4:5) ─────────────────────────────
  {
    file: 'trade-electrical.jpg',
    aspect: '3:4', // hero tile 3/4; also the Trades panel 2:1 crop (pos 25%)
    section: 'Hero filmstrip — Electrical / Trades panel',
    prompt: `A portrait photograph of an Australian electrician working at an
    open residential switchboard mounted on the outside wall of a brick-veneer
    home. He wears a yellow hard hat and a faded hi-vis shirt, sleeves pushed
    up, and holds a multimeter probe to a circuit breaker, reading the meter in
    his other hand with quiet concentration. The neat row of breakers and
    coloured wiring fills the panel beside him. Morning sun rakes across the
    wall from camera left, lighting his face and forearms cleanly. Background
    softly out of focus.`,
  },
  {
    file: 'trade-plumbing-2.jpg',
    aspect: '3:4',
    section: 'Hero filmstrip — Plumbing',
    prompt: `A portrait photograph of an Australian plumber lying on her back
    half inside the cabinet under a kitchen sink, reaching up with a basin
    wrench to the tap tailpiece. She wears a navy work shirt with the sleeves
    rolled and there is a small open tool roll on the tiled floor beside her
    shoulder. Bright kitchen daylight from a window off camera fills the
    cabinet and lights her face and hands; the timber cupboard frame edges the
    shot. Water stains and honest wear on the pipework.`,
  },
  {
    file: 'trade-solar.jpg',
    aspect: '2:3', // two crops share this file (hero 3/4 @15%, tile 4/3 @62%)
    section: 'Hero filmstrip — Solar / More trades tile',
    prompt: `A tall photograph of two Australian solar installers on the
    Colorbond roof of a single-storey suburban house, carrying a large
    photovoltaic panel between them toward a half-finished array. Both wear
    hi-vis shirts and harness lanyards clipped to a roof anchor. The mounted
    panels run diagonally across the lower half of the frame, the installers
    stand upright in the middle, and clear pale sky with a few gum tree crowns
    fills the top. Hard midday sun, crisp shadows on the roof sheeting.`,
  },

  // ── How it works — "You stay on the tools" (tall column) ────────────
  {
    file: 'trade-carpentry.jpg',
    aspect: '2:3',
    section: 'How it works — "You stay on the tools"',
    prompt: `A tall photograph of an Australian carpenter at a tidy workshop
    bench, planing the edge of a dressed timber board with a hand plane, a fine
    shaving curling away. Chisels and a combination square are laid out in a
    neat row on the bench; a sawdust haze hangs in the light. He is absorbed in
    the cut, eyes down on the work. Big soft daylight through a roller door at
    camera left rakes across the bench top. Warm timber tones, dark quiet
    workshop depth behind him.`,
  },

  // ── Trades — Electrical / Plumbing panels (2:1 band) ────────────────
  {
    file: 'trade-plumbing.jpg',
    aspect: '16:9',
    section: 'Trades panel — Plumbing (wide band)',
    prompt: `A wide photograph of an Australian plumber crouched at an open
    vanity cupboard in a bathroom, tightening the compression nut on a flexible
    supply line with a shifting spanner. A drop sheet and a small parts tray
    with new washers sit on the tiled floor. He wears a grey work shirt with
    the sleeves rolled. Cool clean bathroom daylight from a frosted window at
    camera right lights the pipework and his hands; the composition runs
    horizontally, subject slightly left of centre with the plumbing filling the
    right of the frame.`,
  },

  // ── Trades — "More trades" tiles (4:3) ──────────────────────────────
  {
    file: 'trade-roofing.jpg',
    aspect: '4:3',
    section: 'More trades tile — Roofing',
    prompt: `A photograph of an Australian roofer kneeling on a pitched
    Colorbond steel roof, driving a screw through a new sheet of corrugated
    roofing with a cordless impact driver. He wears a bucket hat, hi-vis shirt
    and a harness line running out of frame. The corrugations lead the eye
    diagonally across the frame; the ridge line and pale sky sit behind him.
    Late afternoon sun low from camera right throws long crisp shadows down the
    ribs of the sheeting.`,
  },
  {
    file: 'trade-painting.jpg',
    aspect: '4:3',
    section: 'More trades tile — Painting',
    prompt: `A photograph of two Australian painters working an interior wall of
    an empty room, one rolling fresh paint in long even strokes from an
    extension pole, the other cutting in the cornice line with a brush from a
    low step ladder. Canvas drop sheets cover the floorboards and a paint pot
    sits on the sheet. They wear white painter's whites flecked with old paint.
    Big bright window light from camera left, clean fresh wall tone, calm and
    orderly.`,
  },

  // ── Trades — "Request your trade" band (portrait column) ────────────
  {
    file: 'workshop.jpg',
    aspect: '4:5',
    section: 'Trades — "Request your trade" band',
    prompt: `A photograph of an Australian tradesperson in a well-kept home
    workshop, standing at the bench and checking a measurement on a
    part she has just finished, turning it over in her hands. Behind her a
    pegboard wall holds hand tools hung in orderly rows and a roller cabinet
    sits under the bench. Deliberately generic trade work — not clearly
    electrical, plumbing, roofing, solar or painting. Warm afternoon light
    through a high window, dust in the air, quiet pride in the moment.`,
  },

  // ── Covered trades cards (4:5 portrait, links to trade pages) ───────
  {
    file: 'home-electrical.jpg',
    aspect: '4:5',
    section: 'Covered trades — Electrical ("Downlights to switchboards")',
    prompt: `A portrait photograph of an Australian electrician on a step
    ladder, fitting a round LED downlight into a plasterboard ceiling, one hand
    guiding the spring clips into the cut hole and the other supporting the
    fitting. He wears a hi-vis shirt; the ceiling and the top of the wall fill
    the frame around him. Shot from slightly below, looking up. Clean bright
    interior daylight from a window behind camera, crisp shadow under the
    ceiling line.`,
  },
  {
    file: 'home-plumbing.jpg',
    aspect: '4:5',
    section: 'Covered trades — Plumbing ("Drains to hot water")',
    prompt: `A portrait photograph of an Australian plumber servicing an
    exterior hot water cylinder mounted against the brick side wall of a
    suburban house, spanner on the tempering valve at the inlet pipework, head
    tilted to watch the fitting. Copper pipes run up the wall beside the
    cylinder. He wears a navy work shirt and gloves. Bright overcast daylight,
    a strip of dry lawn and a paling fence softly out of focus behind him.`,
  },
  {
    file: 'home-roofing.jpg',
    aspect: '4:5',
    section: 'Covered trades — Roofing ("Re-roofs and repairs")',
    prompt: `A portrait photograph of a re-roof in progress on an Australian
    suburban house: fresh Colorbond steel sheets laid over half the pitch,
    battens and sarking still exposed on the other half, with a roofer standing
    mid-frame lining up the next sheet against the run. He wears a hi-vis
    shirt and bucket hat. Shot from the ridge looking down the slope so the new
    sheeting runs to the gutter line at the bottom of the frame. Hard clear
    daylight, strong sheet-metal highlights.`,
  },
  {
    file: 'home-solar.jpg',
    aspect: '4:5',
    section: 'Covered trades — Solar ("Systems sized from the address")',
    prompt: `A portrait photograph of a completed rooftop solar array on a
    single-storey Australian brick home, ten photovoltaic panels in two neat
    rows across the Colorbond roof, with an installer standing at the end of
    the run checking the rail fixings. Shot from a raised angle so the array
    fills the middle of the frame and the roof line, backyard and neighbouring
    rooftops fall away behind. Clear blue-grey sky, hard midday sun glinting
    off the panel glass.`,
  },
  {
    file: 'home-painting.jpg',
    aspect: '4:5',
    section: 'Covered trades — Painting ("Repaints inside and out")',
    prompt: `A portrait photograph of an Australian painter cutting in a
    weatherboard exterior with a brush, working along the shadow line of a
    board on a freshly prepared house wall. She wears white painter's whites
    and holds a small paint pot in her free hand. The horizontal boards run
    across the frame behind her, half in fresh paint and half in the old
    faded coat. Warm late-afternoon side light, soft green garden out of focus
    at the edge.`,
  },

  // ── Built in Australia (feature band, 4:3) ──────────────────────────
  {
    file: 'home-crew.jpg',
    aspect: '4:3',
    section: 'Built in Australia — crew feature band',
    prompt: `A photograph of a small Australian trade crew of three at the back
    of a work ute on a suburban street at the end of the day, tailgate down and
    tool boxes open, talking through tomorrow's jobs. One leans on the tray,
    one is stowing a cordless drill in its case, one is looking off down the
    street. Mixed crew of the kind you actually see on an Australian site,
    hi-vis and faded work shirts, boots. Warm low golden light down the street,
    brick homes and a Colorbond fence softly out of focus behind them.`,
  },
]

// ── Trade pages (/trades/[trade], app/trades/_template.tsx) ───────────
// Two slots per trade: a 4:5 portrait hero beside the headline, and a 3:2
// detail band whose caption names exactly what the photo has to show. Every
// scene is deliberately different from the home-page set above — the same
// trade should never appear twice with the same shot.
const TRADE_IMAGES = [
  // ── Electrical ──────────────────────────────────────────────────────
  {
    file: 'electrical.jpg',
    aspect: '4:3',
    section: 'Electrical — hero',
    prompt: `A portrait photograph of an Australian electrician kneeling at a
    partly opened wall in a home under renovation, fitting a double power point
    into its mounting block. The wall plate is off, the cable is drawn out in
    one hand and a screwdriver is in the other, and he is looking closely at
    the terminals. He wears a hi-vis shirt with the sleeves rolled. Bright
    daylight from a window across the room lights his hands and the socket;
    bare plasterboard and studwork softly out of focus behind him.`,
  },
  {
    file: 'electrical-2.jpg',
    aspect: '3:2',
    section: 'Electrical — detail band ("Switchboards and circuits")',
    prompt: `A close, wide detail photograph of an open Australian residential
    switchboard: two neat rows of circuit breakers and a bank of safety
    switches, tidy loomed wiring in red, black and green-yellow dropping into
    the terminals. A gloved hand at the right of the frame rests a test probe
    on one breaker. Shot square-on and close, filling the frame with the
    board, shallow depth of field falling off at the edges. Clean, even
    daylight; the workmanship is the subject.`,
  },

  // ── Plumbing ────────────────────────────────────────────────────────
  {
    file: 'plumbing.jpg',
    aspect: '4:3',
    section: 'Plumbing — hero',
    prompt: `A portrait photograph of an Australian plumber outside a
    brick-veneer home clearing a blocked drain, feeding a high-pressure jetter
    hose down an open gully trap in a strip of dry lawn beside the wall. He
    is crouched over the drain, both hands on the hose, watching the line go
    in. Work boots, navy shirt, gloves. Bright overcast daylight, a paling
    fence and downpipe softly out of focus behind him.`,
  },
  {
    file: 'plumbing-2.jpg',
    aspect: '3:2',
    section: 'Plumbing — detail band ("Fixtures and access")',
    prompt: `A close, wide detail photograph of new copper and PEX pipework run
    neatly along the inside wall of an Australian laundry: soldered elbows,
    isolation valves and clipped runs, a compression fitting mid-tighten with a
    shifting spanner resting on it. Shot square-on and close so the pipe run
    fills the frame, shallow depth of field falling off at both edges. Cool
    clean daylight, the copper the one warm note.`,
  },

  // ── Roofing ─────────────────────────────────────────────────────────
  {
    file: 'roofing.jpg',
    aspect: '4:3',
    section: 'Roofing — hero',
    prompt: `A portrait photograph of an Australian roofer working on a terracotta
    tiled roof, lifting a cracked tile clear of the batten with both hands while
    a small stack of replacement tiles sits beside his knee. He wears a hi-vis
    shirt and a bucket hat, harness line running out of frame. Shot from
    slightly below along the pitch so the tile courses run up the frame behind
    him to the ridge and pale sky. Hard clear daylight, crisp shadows between
    the tile ribs.`,
  },
  {
    file: 'roofing-2.jpg',
    aspect: '3:2',
    section: 'Roofing — detail band ("Multi-structure jobs measured per roof")',
    prompt: `An elevated wide photograph looking down over an Australian
    suburban property that has three separate roof structures: the main house
    roof in Colorbond, a detached garage with its own smaller roof, and a lower
    patio awning joining them. The three planes sit at different pitches and
    angles, clearly readable as separate structures. Dry lawn, a paling fence
    and a gum tree at the boundary. Hard midday sun, strong sheet-metal
    highlights and clean shadow lines between the roofs. No people.`,
  },

  // ── Solar ───────────────────────────────────────────────────────────
  {
    file: 'solar.jpg',
    aspect: '4:3',
    section: 'Solar — hero',
    prompt: `A portrait photograph of an Australian solar installer kneeling
    between two rows of roof-mounted photovoltaic panels, tightening a mid-clamp
    on the mounting rail with a torque wrench, head down on the fixing. He wears
    a hi-vis shirt and a harness. The panel edges run diagonally through the
    lower frame, the roof line and pale sky sit behind him. Hard midday sun,
    sharp reflections across the panel glass.`,
  },
  {
    file: 'solar-2.jpg',
    aspect: '3:2',
    section: 'Solar — detail band ("Roof, orientation and shading")',
    prompt: `An elevated wide photograph looking down on the roof of a
    single-storey Australian brick home in the late afternoon, the north-facing
    Colorbond pitch open and clear while the long shadow of a big gum tree falls
    across one corner of it. The roof plane, its ridge line and the shaded
    corner are all clearly readable. Dry lawn and neighbouring rooftops beyond.
    Low warm sun, long defined shadows. No people.`,
  },

  // ── Painting ────────────────────────────────────────────────────────
  {
    file: 'painting.jpg',
    aspect: '4:3',
    section: 'Painting — hero',
    prompt: `A portrait photograph of an Australian painter cutting in by hand
    around a window architrave in an empty interior room, brush drawn along the
    edge of the trim in one clean line, small paint pot in her other hand. She
    wears white painter's whites flecked with old paint. Canvas drop sheets on
    the floorboards below. Big bright daylight through the window she is
    working around, the fresh wall tone clean beside the untouched trim.`,
  },
  {
    file: 'painting-2.jpg',
    aspect: '3:2',
    section: 'Painting — detail band ("Measured room by room")',
    prompt: `A wide photograph of an empty Australian interior room mid-repaint:
    two walls finished in fresh paint, the third still in the old faded colour,
    skirting and architraves masked with tape, a step ladder, a roller tray and
    a paint pot standing on canvas drop sheets over the floorboards. Cornice and
    ceiling clean and cut in. Big soft window light from the left, calm and
    orderly. No people.`,
  },
]

// Each set knows where it writes and how big its largest slot is.
const SETS = {
  home: { images: HOME_IMAGES, dir: 'marketing', maxEdge: 1400 },
  // The trade hero renders at 45vw of max-w-[88rem] (~630px) and the detail
  // band at 50vw (~700px); 1400px covers both at 2x DPR.
  trades: { images: TRADE_IMAGES, dir: 'trades', maxEdge: 1400 },
}

// ── Gemini call ───────────────────────────────────────────────────────
const KEY = process.env.GEMINI_API_KEY
if (!KEY) {
  console.error('GEMINI_API_KEY not set — run with `node --env-file=.env.local`')
  process.exit(1)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function generate(entry, attempt = 1) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${encodeURIComponent(KEY)}`
  const prompt = `${entry.prompt.replace(/\s+/g, ' ').trim()}\n\n${STYLE}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generation_config: {
        response_modalities: ['IMAGE'],
        thinking_config: { thinking_level: 'high' },
        image_config: { image_size: '2K', aspect_ratio: entry.aspect },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    // Google returns 429 both for "slow down" (retryable) and for "the account
    // has no credit" (not retryable — backing off 14s per image just makes a
    // dead run take longer, and the real message is buried in the body).
    if (/prepayment credits are depleted|billing/i.test(body)) {
      throw new Error('BILLING: Gemini prepayment credits are depleted — top up at https://ai.studio/projects, then re-run')
    }
    // 429 rate limit / 503 overloaded → back off and retry, as lib/ig-engine does.
    if ((res.status === 429 || res.status === 503 || res.status >= 500) && attempt < 4) {
      const wait = Math.min(1000 * 2 ** attempt, 20_000)
      console.warn(`  ${entry.file}: HTTP ${res.status}, retry ${attempt + 1} in ${wait}ms`)
      await sleep(wait)
      return generate(entry, attempt + 1)
    }
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 300)}`)
  }

  const data = await res.json()
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const inline = parts.map(p => p.inline_data ?? p.inlineData).find(d => d?.data)
  if (!inline?.data) {
    const refusal = parts.find(p => p.text)?.text
    throw new Error(`no image data${refusal ? ` — ${refusal.slice(0, 200)}` : ''}`)
  }
  return Buffer.from(inline.data, 'base64')
}

// ── Run ───────────────────────────────────────────────────────────────
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const setName = arg('set')
if (setName && !SETS[setName]) {
  console.error(`Unknown --set=${setName}. Known: ${Object.keys(SETS).join(', ')}`)
  process.exit(1)
}

const only = arg('only')
  ?.split(',')
  .map(s => s.trim().replace(/\.jpg$/, ''))
  .filter(Boolean)

// A slot carries its set with it, so --only can span both sets and each file
// still lands in the right directory.
const all = Object.entries(SETS).flatMap(([name, s]) =>
  s.images.map(i => ({ ...i, set: name })),
)
const inSet = setName ? all.filter(i => i.set === setName) : all
const queue = only ? inSet.filter(i => only.includes(i.file.replace(/\.jpg$/, ''))) : inSet

if (!queue.length) {
  console.error(`Nothing to do. Known: ${all.map(i => `${i.set}/${i.file}`).join(', ')}`)
  process.exit(1)
}

const dirsFor = set => ({
  out: path.join(process.cwd(), 'public', SETS[set].dir),
  prev: path.join(process.cwd(), '.image-backups', SETS[set].dir),
})

for (const set of new Set(queue.map(i => i.set)))
  await mkdir(dirsFor(set).prev, { recursive: true })

console.log(`${MODEL} → ${queue.length} image(s)\n`)

const results = []
let cursor = 0
// A billing failure hits every remaining image identically — bail the whole
// run on the first one instead of failing 10 times over.
let fatal = null

async function worker() {
  while (cursor < queue.length && !fatal) {
    const entry = queue[cursor++]
    const { out: outDir, prev: prevDir } = dirsFor(entry.set)
    const dest = path.join(outDir, entry.file)
    try {
      const raw = await generate(entry)
      const maxEdge = SETS[entry.set].maxEdge
      const out = await sharp(raw)
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer()
      const meta = await sharp(out).metadata()

      // Back up the original once (never clobber an earlier backup, so a
      // re-run of a single image still has the true original to fall back to).
      const backup = path.join(prevDir, entry.file)
      const hasBackup = await access(backup).then(() => true, () => false)
      if (!hasBackup) {
        const existing = await readFile(dest).catch(() => null)
        if (existing) await rename(dest, backup)
      }

      await writeFile(dest, out)
      const kb = (out.length / 1024).toFixed(0)
      console.log(`  ok  ${`${entry.set}/${entry.file}`.padEnd(28)} ${meta.width}x${meta.height}  ${kb}KB  — ${entry.section}`)
      results.push({ file: entry.file, ok: true })
    } catch (err) {
      if (err.message.startsWith('BILLING:')) fatal = err.message
      console.error(`  FAIL ${`${entry.set}/${entry.file}`.padEnd(28)} ${err.message}`)
      results.push({ file: entry.file, ok: false, error: err.message })
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

if (fatal) {
  console.error(`\n${fatal}`)
  console.error('Nothing was written — public/ is untouched.')
  process.exit(1)
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} generated. Originals in .image-backups/`)
if (failed.length) {
  console.log(`Retry: node --env-file=.env.local scripts/gen-marketing-images.mjs --only=${failed.map(f => f.file.replace('.jpg', '')).join(',')}`)
  process.exit(1)
}
