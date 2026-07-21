// ════════════════════════════════════════════════════════════════════
// Roofing — interactive 3D model of the property (Track B: VISUAL only).
//
// Pipeline: the tradie's browser captures 5 orbit views (front/left/back/
// right + a nadir top) of the Google Photorealistic 3D tiles → each capture
// is polished by Gemini nano-banana (best-effort: raw capture on failure),
// which also REMOVES neighbouring buildings so only the subject property
// reaches the reconstruction → the five polished captures are synthesised
// into TWO studio renders of the whole house (front + back, plain backdrop)
// → Tripo3D multiview-to-model reconstructs a textured GLB from that pair
// → the GLB is re-hosted in the roof-models bucket (Tripo output URLs
// expire after ~5 minutes) and served via a short-lived signed URL.
//
// The model NEVER feeds measurements or pricing. Ridge/hip/valley numbers
// stay on the measured-geometry path (Geoscape + Google Solar) — an AI
// reconstruction from enhanced screenshots is visually convincing but not
// dimensionally reliable, and both the nano-banana enhancement and the
// synthesis pass invent plausible pixels by design.
//
// Status lives on roofing_measurements (migration 173):
//   model3d_status: null | 'generating' | 'ready' | 'failed'
// CAS-claimed like preview_status (roof-after.ts) so double-clicks and
// concurrent polls never start two paid Tripo tasks.
// ════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'
import type { ImageBytes, ReferenceImage } from '@/lib/ig-engine/providers/base'
import {
  CAPTURE_VIEWS,
  cachePathFor,
  getCachedEnhanced,
  putCachedEnhanced,
  type CacheKind,
  type CaptureView,
} from '@/lib/roofing/capture-cache'

export type Model3dMode = 'auto' | 'manual'

// Lazy so the pure helpers stay importable in vitest without Supabase env.
let _supabase: SupabaseClient | null = null
function supabaseClient() {
  _supabase ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return _supabase
}

// Dedicated bucket: intake-photos is images-only with a 5 MB cap; GLBs need
// model/gltf-binary and run 10–20 MB. Project storage caps files at 50 MB.
const MODEL_BUCKET = 'roof-models'
const MODEL_MAX_BYTES = 48 * 1024 * 1024 // guard under the 50 MB bucket cap
const TRIPO_BASE = 'https://openapi.tripo3d.ai/v3'

// Latest H-Series snapshot (2026-02); pin the dated id, not the alias.
// Override without a deploy when Tripo ships a newer snapshot.
const TRIPO_MODEL = () => process.env.TRIPO_MODEL_VERSION ?? 'v3.1-20260211'
// 8K 'extreme' textures + uncapped 'detailed' geometry produced a 62 MB GLB —
// over the 50 MB storage cap. face_limit keeps geometry weight bounded at the
// source (~300k triangles is crisp for a house and lands ~10–20 MB); crank
// these back up via env if the storage plan grows.
const TRIPO_TEXTURE_QUALITY = () => process.env.TRIPO_TEXTURE_QUALITY ?? 'detailed'
const TRIPO_FACE_LIMIT = () => {
  const n = Number(process.env.TRIPO_FACE_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 300_000
}

// Image model for the polish + anatomy + synthesis passes — Nano Banana Pro
// (2K output, better texture fidelity and line adherence than Flash-Lite).
// Scoped to the roofing 3D feature; the global GEMINI_IMAGE_MODEL default
// stays untouched for the other trades' previews.
//
// ⚠ This was 'gemini-3-pro-image-preview', which Google SHUT DOWN on
// 2026-06-25 (GA replacement 'gemini-3-pro-image', GA since 2026-05-28) —
// every image call here was hitting a dead endpoint and silently degrading
// to the best-effort fallbacks. Pin the GA id; override via env when a newer
// snapshot ships, and check ai.google.dev/gemini-api/docs/deprecations when
// renders start failing.
export const MODEL3D_IMAGE_MODEL = () =>
  process.env.ROOFING_MODEL3D_IMAGE_MODEL ?? 'gemini-3-pro-image'

// Tripo's canonical multiview slots. 'top' (see CAPTURE_VIEWS) has no slot —
// a top capture is enhanced + cached but never sent to Tripo.
export const VIEW_ORDER = ['front', 'left', 'back', 'right'] as const
export type ViewName = (typeof VIEW_ORDER)[number]

/** One capture, labelled with the view it shows (auto orbit or manual). */
export type LabeledCapture = { view: CaptureView; image: string }

export type Model3dState = {
  status: 'idle' | 'generating' | 'ready' | 'failed'
  progress?: number | null
  modelUrl?: string | null
  error?: string | null
  /** Roof-anatomy overlays (auto mode): view → signed image URL. */
  anatomy?: Record<string, string> | null
  /** Gemini-polished captures for this property: view → signed image URL. */
  polished?: Record<string, string> | null
  /** The two synthesised studio renders Tripo reconstructed from:
   *  'front'/'back' → signed image URL. Absent when synthesis was skipped. */
  synth?: Record<string, string> | null
}

// ── pure helpers (unit-tested) ──────────────────────────────────────

/** PURE — the text label that precedes a capture in the synthesis call, so
 *  the model can tell which view each attached image is. */
export function captureLabel(view: CaptureView): string {
  return `${view.toUpperCase()} capture of the house`
}

/**
 * PURE — the labelled five-capture set both synthesis calls are conditioned
 * on, in canonical order. Returns null unless ALL five views are present:
 * the prompts state that five captures are attached, so a partial set (a
 * 3-photo manual upload) would make that a lie and invite the model to
 * invent the missing elevations. Incomplete → no synthesis, and the
 * polished captures go to Tripo as before.
 */
export function synthesisInputs(
  polished: { view: CaptureView; image: ImageBytes }[],
): ReferenceImage[] | null {
  const set = CAPTURE_VIEWS.flatMap((view) => {
    const hit = polished.find((p) => p.view === view)
    return hit ? [{ image: hit.image, label: captureLabel(view) }] : []
  })
  return set.length === CAPTURE_VIEWS.length ? set : null
}

/**
 * PURE — which images fill Tripo's view slots.
 *
 * Both synthesised renders present → those two alone (front + back). A
 * studio-lit synthetic render beside a −50° aerial is a WORSE multiview
 * prior than four consistent aerials, so a partial synthesis (one call
 * failed) falls all the way back to the polished captures rather than
 * mixing sources. 'top' never has a slot.
 */
export function selectTripoInputs(
  polished: { view: CaptureView; image: ImageBytes }[],
  synth: SynthPair | null,
): Partial<Record<ViewName, ImageBytes>> {
  if (synth?.front && synth.back) return { front: synth.front, back: synth.back }
  const out: Partial<Record<ViewName, ImageBytes>> = {}
  for (const { view, image } of polished) {
    if ((VIEW_ORDER as readonly string[]).includes(view)) out[view as ViewName] = image
  }
  return out
}

/** Strip a data-URL prefix; returns base64 + mime (default jpeg). */
export function parseDataUrl(input: string): ImageBytes {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(input)
  if (m) return { mime: m[1].toLowerCase(), base64: m[2] }
  return { mime: 'image/jpeg', base64: input }
}

/**
 * PURE — Tripo v3 multiview request body. Colour preservation comes from
 * texture_alignment 'original_image'; fidelity from PBR + HD texture +
 * detailed geometry. face_limit bounds the GLB size so it fits the 50 MB
 * storage cap (~60 credits ≈ US$0.60 per model at the defaults).
 */
export function buildMultiviewTaskBody(
  fileTokens: Partial<Record<ViewName, string>>,
  modelVersion: string,
  opts: { textureQuality?: string; faceLimit?: number } = {},
): Record<string, unknown> {
  return {
    // Only the provided Tripo slots — views may be omitted (front required
    // upstream), and non-Tripo views ('top') never reach this map.
    inputs: VIEW_ORDER.filter((view) => fileTokens[view]).map((view) => ({
      [view]: { file_token: fileTokens[view] },
    })),
    model: modelVersion,
    texture: true,
    pbr: true,
    texture_quality: opts.textureQuality ?? 'detailed',
    geometry_quality: 'detailed',
    texture_alignment: 'original_image',
    orientation: 'default',
    face_limit: opts.faceLimit ?? 300_000,
  }
}

/**
 * PURE — orbit range (m) for the capture camera, from the footprint bbox
 * diagonal: the whole footprint plus 10 m of margin, floored at 26 m so
 * small sheds keep a sane standoff; 45 m when there is no footprint.
 *
 * This REVERTS the tight 0.8 × d + 8 framing. That existed so neighbours
 * occupied less of each capture — a job now done twice downstream (the
 * polish pass removes neighbouring buildings, and the synthesis pass drops
 * the surroundings entirely for a plain backdrop). With that pressure gone,
 * the remaining risk runs the other way: a too-close orbit clips eaves and
 * ridge ends, and the synthesis pass can only reproduce the house it can
 * actually see in all five captures.
 */
export function captureOrbitRangeM(diagonalM: number | null): number {
  if (typeof diagonalM !== 'number' || !Number.isFinite(diagonalM) || diagonalM <= 0) return 45
  return Math.max(26, diagonalM + 10)
}

/** PURE — pick status/progress/model URL out of a Tripo task response. */
export function parseTripoTask(body: unknown): {
  status: string
  progress: number | null
  modelUrl: string | null
  error: string | null
} {
  const data = (body as { data?: Record<string, unknown> })?.data ?? {}
  const output = (data.output ?? {}) as Record<string, unknown>
  return {
    status: typeof data.status === 'string' ? data.status : 'unknown',
    progress: typeof data.progress === 'number' ? data.progress : null,
    modelUrl: typeof output.model_url === 'string' ? output.model_url : null,
    error: typeof data.error === 'string' ? data.error : null,
  }
}

// ── Tripo I/O ───────────────────────────────────────────────────────

function tripoKey(): string {
  const key = process.env.TRIPO_API_KEY?.trim()
  if (!key) throw new Error('TRIPO_API_KEY missing')
  return key
}

async function tripoFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${TRIPO_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tripoKey()}`, ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* keep text for the error below */
  }
  if (!res.ok) {
    const code = (json as { code?: number })?.code
    const msg = (json as { message?: string })?.message ?? text.slice(0, 200)
    throw new Error(`Tripo HTTP ${res.status}${code != null ? ` (code ${code})` : ''}: ${msg}`)
  }
  return json
}

/** Upload one image → file_token. */
async function tripoUpload(image: ImageBytes): Promise<string> {
  const form = new FormData()
  const ext = image.mime === 'image/png' ? 'png' : 'jpg'
  form.append(
    'file',
    new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime }),
    `view.${ext}`,
  )
  const json = await tripoFetch('/files', { method: 'POST', body: form })
  const token = (json as { data?: { file_token?: string } })?.data?.file_token
  if (!token) throw new Error('Tripo upload returned no file_token')
  return token
}

/** Create the multiview task → task_id. */
async function tripoCreateMultiview(fileTokens: Partial<Record<ViewName, string>>): Promise<string> {
  const json = await tripoFetch('/generation/multiview-to-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      buildMultiviewTaskBody(fileTokens, TRIPO_MODEL(), {
        textureQuality: TRIPO_TEXTURE_QUALITY(),
        faceLimit: TRIPO_FACE_LIMIT(),
      }),
    ),
  })
  const id = (json as { data?: { task_id?: string } })?.data?.task_id
  if (!id) throw new Error('Tripo task creation returned no task_id')
  return id
}

// ── Gemini enhancement (nano-banana) ────────────────────────────────

export const ENHANCE_SYSTEM =
  'You are a photo enhancement engine for property imagery. You upscale and sharpen ' +
  'aerial photographs, and you remove distracting neighbouring buildings from the frame ' +
  'edges. You never change the central subject property — its geometry, roof shape, ' +
  'colours and proportions stay exactly as photographed — and you never alter the ' +
  'framing or camera angle of the photograph.'

export const ENHANCE_USER =
  'Enhance this aerial capture into a high-resolution, crisp, photorealistic image. ' +
  'Keep the central house and every structure on its own lot exactly as captured — ' +
  'geometry, roof shape, colours, proportions. Remove neighbouring houses and buildings ' +
  'at the frame edges, replacing them with plausible garden and greenery, so only the ' +
  'subject property remains. If you are unsure whether a structure belongs to the ' +
  'central property, keep it. Do not reframe, zoom, or change the camera angle. ' +
  'Improve sharpness, clarity and texture detail.'

/**
 * Enhance one capture — BEST-EFFORT. Returns null when enhancement did NOT
 * happen (no key / quota / safety / network) so the caller can fall back to
 * the raw capture without poisoning the cache with unpolished images.
 */
async function enhanceCapture(image: ImageBytes): Promise<ImageBytes | null> {
  if (!process.env.GEMINI_API_KEY?.trim()) return null
  try {
    // No aspectRatio: captures are 3:2 (auto crop) or arbitrary (manual/
    // upload), so a fixed ratio would be a false source claim — omitting it
    // keeps GEMINI_IMAGE_ASPECT=source from stretching the frame.
    return await geminiProvider.renderImage({
      system: ENHANCE_SYSTEM,
      user: ENHANCE_USER,
      sourceImage: image,
      model: MODEL3D_IMAGE_MODEL(),
    })
  } catch (e) {
    console.warn('[roofing/model3d] enhancement failed, using raw capture', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

// ── roof-anatomy annotation (auto mode, display-only) ───────────────

export const ANATOMY_SYSTEM =
  'You are a roofing diagram annotator. You draw clean, precise overlay lines and small ' +
  'text labels on aerial photographs of roofs. You never alter the underlying photograph — ' +
  'no adding, removing, or reshaping structures.'

export const ANATOMY_USER =
  'Draw colour-coded lines along the roof features of this house, with a small matching ' +
  'text label on each: RIDGE lines in blue, HIP lines in red, VALLEY lines in green, ' +
  'EAVE lines in magenta, GUTTER lines in orange (along the roof’s outer drainage ' +
  'edges, where gutters run). Trace every visible ridge, hip, valley, eave and gutter. ' +
  'Keep the photograph otherwise unchanged.'

/**
 * Annotate one enhanced capture with the colour-coded roof-anatomy overlay.
 * BEST-EFFORT: display-only feature, so any failure returns null and the
 * generation carries on. These images are NEVER sent to Tripo — painted
 * lines would bake into the 3D model's textures.
 */
async function annotateCapture(image: ImageBytes): Promise<ImageBytes | null> {
  if (!process.env.GEMINI_API_KEY?.trim()) return null
  try {
    // No aspectRatio — same reasoning as enhanceCapture: never claim a
    // ratio the source image may not have.
    return await geminiProvider.renderImage({
      system: ANATOMY_SYSTEM,
      user: ANATOMY_USER,
      sourceImage: image,
      model: MODEL3D_IMAGE_MODEL(),
    })
  } catch (e) {
    console.warn('[roofing/model3d] anatomy annotation failed', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

// ── AI view synthesis (Nano Banana Pro, GEMINI_API_KEY) ─────────────
//
// Two calls, one shared system prompt. Inputs are ALWAYS the five POLISHED
// captures (Gemini-enhanced, neighbours stripped) — never the raw Cesium
// screenshots. Call 1 renders the front; call 2 renders the back from the
// same five captures PLUS call 1's output as a labelled reference. That
// chaining is what keeps both images the SAME house rather than two
// plausible houses. Both renders then become Tripo's front/back slots.
//
// Off with ROOFING_MODEL3D_SYNTH=0. Any failure → null → the caller falls
// back to today's four polished captures.

export const SYNTH_SYSTEM =
  'You are an architectural visualisation engine. Based on the screenshots of the house ' +
  'provided, generate a high-quality full 3D view of the house, including front and back ' +
  'perspectives. The result must be accurate and match exactly what is shown in the five ' +
  'screenshots.\n\n' +
  'You are rendering ONE single physical building across a set of images. Every image you ' +
  'produce for a property must be recognisably the same house at the same address — same ' +
  'building, same materials, same colours, same proportions, same light. You reproduce; you ' +
  'do not design. The screenshots are the specification, and exact fidelity to them is the ' +
  'acceptance test: every roof plane, opening, material and colour in your render must be ' +
  'traceable to the captures. Every one of these is locked to the screenshots and must be ' +
  'identical in every image you generate for this property:\n' +
  '1. Storey count, overall footprint shape and proportions.\n' +
  '2. Roof form (gable / hip / skillion / combination), pitch, number of planes, and the ' +
  'ridge, hip and valley layout.\n' +
  '3. Roof material and exact colour (tile, metal sheet, shingle).\n' +
  '4. Wall cladding material and exact colour; gutter, fascia and barge colour.\n' +
  '5. Window and door count, placement pattern and frame colour.\n' +
  '6. Attached structures exactly as photographed — garage, carport, verandah, chimney, ' +
  'vents, skylights, solar panels. Nothing added, nothing removed.\n' +
  '7. Lighting: even, neutral studio lighting from the same direction in every image, with ' +
  'soft consistent shadows on the building itself.\n' +
  '8. Camera: the same elevation above the ground and the same distance in every image, with ' +
  'the house occupying the same fraction of the frame. Only the compass heading changes ' +
  'between images.\n' +
  '9. Background: a plain, seamless, flat white or light neutral grey backdrop — the building ' +
  'alone, isolated like a product shot. No grass, lawn, trees, shrubs, garden, landscaping, ' +
  'fences, paths, driveways, kerbs, vehicles, people, neighbouring buildings, sky, horizon ' +
  'line, ground plane, text or watermark. The building sits on its own slab or foundation ' +
  'edge, which stays visible where the walls meet the base, with the plain backdrop ' +
  'everywhere around it.\n\n' +
  'Together, the images you produce must cover the full exterior of the building — a complete ' +
  '360 degree read of the house from front and back. Where a detail is not visible in the ' +
  'screenshots, infer the simplest continuation of what is visible. Never invent a decorative ' +
  'feature to fill a gap. Output photorealistic architectural imagery — not illustration, not ' +
  'stylised CGI.'

export const SYNTH_USER_FRONT =
  'The attached images are five aerial captures of one house: front, left, right, back and ' +
  'top. Together they define the building. Render a single photorealistic image of that house ' +
  'from a FRONT three-quarter view — camera at roughly 30 degrees above the ground, looking at ' +
  'the front elevation and one side wall, so the front wall, the entry door, the front ' +
  'windows, that side wall and the front roof planes are all clearly visible in one view. Show ' +
  'the complete building from roof ridge down to the base, including walls, doors, windows and ' +
  'the foundation edge where it meets the base. Reproduce the roof exactly as captured: same ' +
  'form, same pitch, same plane layout, same material and colour. Isolate the house completely ' +
  'on a plain, seamless white or light neutral grey background — no grass, plants, ' +
  'landscaping, fences, driveways, vehicles, sky or horizon, nothing in the frame but the ' +
  'building itself.'

export const SYNTH_USER_BACK =
  'The attached images are five aerial captures of one house: front, left, right, back and ' +
  'top. The final attached image is a finished FRONT render of this same house. Render a ' +
  'single photorealistic image of that same house from a REAR three-quarter view — the camera ' +
  'rotated 180 degrees, at the same height above the ground and the same distance, looking at ' +
  'the rear elevation and the opposite side wall to the one shown in the front render, so that ' +
  'your image and the front render together show all four elevations of the building. The back ' +
  'wall, back door, rear windows, that side wall and the rear roof planes must all be clearly ' +
  'visible. Show the complete building from roof ridge down to the base, including walls, ' +
  'doors, windows and the foundation edge. Isolate the house completely on the same plain, ' +
  'seamless white or light neutral grey background as the front render — no grass, plants, ' +
  'landscaping, fences, driveways, vehicles, sky or horizon, nothing in the frame but the ' +
  'building itself.'

export const SYNTH_FRONT_REFERENCE_LABEL =
  'REFERENCE — the finished FRONT render of this same house. It is the ground truth for this ' +
  'building’s appearance. Match it exactly: identical roof form, pitch, material and colour; ' +
  'identical wall cladding colour and texture; identical gutter, fascia and window frame ' +
  'colours; identical storey count and proportions; identical lighting direction and ' +
  'intensity; identical camera height and distance; identical framing and image proportions; ' +
  'identical plain background tone. The only difference between that image and the one you ' +
  'produce is the camera heading — rotated to the rear. A viewer must see the two images as ' +
  'the same house photographed from the front and from the back.'

/** The pair Tripo reconstructs from. Either both renders or neither. */
export type SynthPair = { front: ImageBytes | null; back: ImageBytes | null }

/**
 * Synthesise the front + back studio renders from the polished captures.
 * BEST-EFFORT: returns null when synthesis is off, keyless, or either call
 * fails — the caller then uses the polished captures unchanged. The back
 * call is chained on the front render so both images are the same house.
 */
async function synthesizeViews(
  polished: { view: CaptureView; image: ImageBytes }[],
): Promise<SynthPair | null> {
  if ((process.env.ROOFING_MODEL3D_SYNTH ?? '1') === '0') return null
  if (!process.env.GEMINI_API_KEY?.trim()) return null
  // Both calls see an identical, complete, canonically-ordered input set.
  const sourceImages = synthesisInputs(polished)
  if (!sourceImages) return null
  // temperature + top_p pinned to 0 on BOTH calls rather than inherited: the
  // pair must be reproducible and mutually consistent, and the global
  // GEMINI_IMAGE_* knobs are shared with the other trades' previews — a tweak
  // there must not make one house's front and back drift apart.
  const deterministic = { temperature: 0, topP: 0, model: MODEL3D_IMAGE_MODEL() }
  try {
    const front = await geminiProvider.renderImage({
      system: SYNTH_SYSTEM,
      user: SYNTH_USER_FRONT,
      sourceImages,
      ...deterministic,
    })
    const back = await geminiProvider.renderImage({
      system: SYNTH_SYSTEM,
      user: SYNTH_USER_BACK,
      sourceImages,
      reference: { image: front, label: SYNTH_FRONT_REFERENCE_LABEL },
      ...deterministic,
    })
    return { front, back }
  } catch (e) {
    console.warn('[roofing/model3d] view synthesis failed, using polished captures', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

// ── orchestration ───────────────────────────────────────────────────

type Row = { id: string; address: string | null; model3d_status: string | null; model3d_task_id: string | null; model3d_glb_path: string | null; model3d_error: string | null; model3d_anatomy: Record<string, string> | null }

async function loadRow(measureToken: string): Promise<Row | null> {
  const { data } = await supabaseClient()
    .from('roofing_measurements')
    .select('id, address, model3d_status, model3d_task_id, model3d_glb_path, model3d_error, model3d_anatomy')
    .eq('measure_token', measureToken)
    .maybeSingle()
  return (data as Row | null) ?? null
}

async function markFailed(measureToken: string, error: string): Promise<void> {
  console.error('[roofing/model3d] failed', { measureToken, error })
  await supabaseClient()
    .from('roofing_measurements')
    .update({ model3d_status: 'failed', model3d_error: error.slice(0, 500) })
    .eq('measure_token', measureToken)
}

/**
 * CAS-claim the row for a fresh generation. Returns the row's address on
 * success (the cache key), or null when another request is already
 * mid-generation (409 for the route).
 */
export async function claimModel3d(
  measureToken: string,
): Promise<{ address: string | null } | null> {
  const { data } = await supabaseClient()
    .from('roofing_measurements')
    // model3d_anatomy cleared too: row-stamped overlays were drawn over the
    // PREVIOUS generation's polished captures — a regenerate must not keep
    // showing them (they may pre-date the neighbour-removal contract).
    .update({
      model3d_status: 'generating',
      model3d_error: null,
      model3d_task_id: null,
      model3d_anatomy: null,
    })
    .eq('measure_token', measureToken)
    .or('model3d_status.is.null,model3d_status.eq.failed,model3d_status.eq.ready')
    .select('id, address')
    .maybeSingle()
  return data ? { address: (data.address as string | null) ?? null } : null
}

/**
 * The heavy start path — runs in after() once the route has fast-acked.
 * Per view: reuse the address-keyed cached enhancement when allowed, else
 * enhance via Gemini and store the result for the next generation of this
 * property (cross-tenant by design — the token saving is the point). The
 * five polished captures are then synthesised into the front/back render
 * pair (also address-cached) and that pair is uploaded to Tripo; without a
 * complete five-view set, or with synthesis off or failing, the polished
 * captures go to Tripo directly. Never throws; failures land on
 * model3d_status.
 */
export async function startModel3d(
  measureToken: string,
  captures: LabeledCapture[],
  opts: { address?: string | null; mode?: Model3dMode } = {},
): Promise<void> {
  try {
    const address = opts.address?.trim() || null
    const mode: Model3dMode = opts.mode ?? 'auto'
    // Tradie-supplied captures (manual frame-ups or uploaded photos) bypass
    // the cache READ (deliberate framing wins) but still WRITE, refreshing
    // the property's cache for future runs.
    const reuse = mode === 'auto' && !!address

    const polished = await Promise.all(
      captures.map(async ({ view, image }) => {
        const raw = parseDataUrl(image)
        if (reuse) {
          const cached = await getCachedEnhanced(address!, view)
          if (cached) return { view, image: cached, fromCache: true }
        }
        const enhanced = await enhanceCapture(raw)
        // Cache only genuinely-enhanced output — a raw fallback must not
        // become the permanent "polished" image for this address.
        if (enhanced && address) await putCachedEnhanced(address, view, enhanced)
        return { view, image: enhanced ?? raw, fromCache: false }
      }),
    )
    const reused = polished.filter((p) => p.fromCache).length
    if (reused > 0) {
      console.log('[roofing/model3d] reused cached enhancements', { measureToken, reused })
    }

    // Roof-anatomy overlays (ridge/hip/valley/eave/gutter lines) drawn over
    // THIS run's polished captures — display-only, cached by address, stored
    // per measurement. Runs for every source (auto orbit, manual, upload),
    // concurrently with the Tripo uploads below; never blocks the build.
    const anatomyWork = (async () => {
      const row = await loadRow(measureToken)
      if (!row) return
      const entries = await Promise.all(
        polished.map(async ({ view, image, fromCache }) => {
          // Cached anatomy is only valid for the cached polished image it
          // was drawn over — a freshly polished view must be re-annotated,
          // and the write below replaces the stale cache entry.
          let overlay =
            address && fromCache ? await getCachedEnhanced(address, view, 'anatomy') : null
          if (!overlay) {
            overlay = await annotateCapture(image)
            if (overlay && address) await putCachedEnhanced(address, view, overlay, 'anatomy')
          }
          if (!overlay) return null
          const path = `roofing/${row.id}/anatomy-${view}`
          const { error } = await supabaseClient()
            .storage.from(MODEL_BUCKET)
            .upload(path, Buffer.from(overlay.base64, 'base64'), {
              contentType: overlay.mime,
              upsert: true,
            })
          return error ? null : ([view, path] as const)
        }),
      )
      const anatomy = Object.fromEntries(entries.filter((e): e is [CaptureView, string] => !!e))
      if (Object.keys(anatomy).length > 0) {
        await supabaseClient()
          .from('roofing_measurements')
          .update({ model3d_anatomy: anatomy })
          .eq('measure_token', measureToken)
      }
    })().catch((e) =>
      console.warn('[roofing/model3d] anatomy pass failed', {
        error: e instanceof Error ? e.message : String(e),
      }),
    )

    // The two synthesised studio renders — cached by address exactly like the
    // polished captures, so a repeat generation for a known property costs no
    // Gemini calls at all. Null (synthesis off / failed) → the polished
    // captures go to Tripo unchanged, which is the pre-synthesis behaviour.
    let synth: SynthPair | null = null
    if (reuse) {
      const [front, back] = await Promise.all([
        getCachedEnhanced(address!, 'front', 'synth'),
        getCachedEnhanced(address!, 'back', 'synth'),
      ])
      if (front && back) {
        synth = { front, back }
        console.log('[roofing/model3d] reused cached synthesis', { measureToken })
      }
    }
    if (!synth) {
      synth = await synthesizeViews(polished)
      if (synth?.front && synth.back && address) {
        await Promise.all([
          putCachedEnhanced(address, 'front', synth.front, 'synth'),
          putCachedEnhanced(address, 'back', synth.back, 'synth'),
        ])
      }
    }

    const startTask = async (inputs: Partial<Record<ViewName, ImageBytes>>) => {
      const fileTokens: Partial<Record<ViewName, string>> = {}
      await Promise.all(
        Object.entries(inputs).map(async ([view, image]) => {
          if (image) fileTokens[view as ViewName] = await tripoUpload(image)
        }),
      )
      return tripoCreateMultiview(fileTokens)
    }
    // One fallback: the synthesised pair fills only the front+back slots — an
    // unverified combination. If that task can't be created (rejected shape,
    // or a transient upload blip) the generation degrades to the four polished
    // captures instead of failing outright. Logged, so a systematic rejection
    // is visible rather than silently costing quality on every run.
    let taskId: string
    try {
      taskId = await startTask(selectTripoInputs(polished, synth))
    } catch (e) {
      if (!synth) throw e
      console.warn('[roofing/model3d] synthesised-pair task failed — retrying with the polished captures', {
        error: e instanceof Error ? e.message : String(e),
      })
      taskId = await startTask(selectTripoInputs(polished, null))
    }
    await supabaseClient()
      .from('roofing_measurements')
      .update({ model3d_task_id: taskId })
      .eq('measure_token', measureToken)
    await anatomyWork
  } catch (e) {
    await markFailed(measureToken, e instanceof Error ? e.message : String(e))
  }
}

/** Signed URL for a stored GLB (1 h — the viewer loads it immediately). */
async function signedModelUrl(path: string): Promise<string | null> {
  const { data } = await supabaseClient().storage.from(MODEL_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

/** Signed URLs for the row-stamped anatomy overlays (view → URL), or null. */
async function signedAnatomy(
  anatomy: Record<string, string> | null,
): Promise<Record<string, string> | null> {
  if (!anatomy) return null
  const out: Record<string, string> = {}
  await Promise.all(
    Object.entries(anatomy).map(async ([view, path]) => {
      const { data } = await supabaseClient().storage.from(MODEL_BUCKET).createSignedUrl(path, 3600)
      if (data?.signedUrl) out[view] = data.signedUrl
    }),
  )
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Signed URLs (view → URL) for the property's address-keyed cache of one
 * kind — 'enhanced' = the Gemini-polished captures, 'anatomy' = the
 * annotated overlays drawn over them, 'synth' = the two studio renders
 * ('front'/'back' only). createSignedUrl errors on missing objects, so
 * absent views drop out.
 */
async function signedFromCache(
  address: string | null,
  kind: CacheKind,
): Promise<Record<string, string> | null> {
  if (!address?.trim()) return null
  const out: Record<string, string> = {}
  await Promise.all(
    CAPTURE_VIEWS.map(async (view) => {
      const { data } = await supabaseClient()
        .storage.from(MODEL_BUCKET)
        .createSignedUrl(cachePathFor(address, view, kind), 3600)
      if (data?.signedUrl) out[view] = data.signedUrl
    }),
  )
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Poll-and-finalize, called from GET. When the Tripo task has succeeded,
 * download the GLB IMMEDIATELY (output URLs expire in ~5 min) and re-host
 * it in storage. Idempotent: once model3d_glb_path is set the row is
 * 'ready' and Tripo is never hit again.
 */
export async function pollModel3d(measureToken: string): Promise<Model3dState | null> {
  const row = await loadRow(measureToken)
  if (!row) return null

  // Anatomy must show annotations of the SAME generation as the polished
  // panel: prefer the address-keyed anatomy cache (written together with the
  // polished cache). The row-stamped copies are only a fallback when there
  // is no polished panel at all (e.g. no usable address) — never shown next
  // to polished captures they weren't drawn over.
  const [cacheAnatomy, rowAnatomy, polished, synth] = await Promise.all([
    signedFromCache(row.address, 'anatomy'),
    signedAnatomy(row.model3d_anatomy),
    signedFromCache(row.address, 'enhanced'),
    signedFromCache(row.address, 'synth'),
  ])
  const anatomy = cacheAnatomy ?? (polished ? null : rowAnatomy)
  if (row.model3d_status === 'ready' && row.model3d_glb_path) {
    return { status: 'ready', modelUrl: await signedModelUrl(row.model3d_glb_path), anatomy, polished, synth }
  }
  if (row.model3d_status === 'failed') {
    return { status: 'failed', error: row.model3d_error, anatomy, polished, synth }
  }
  if (row.model3d_status !== 'generating') return { status: 'idle', anatomy, polished, synth }

  // Task id not stamped yet — enhancement/upload still running in after().
  if (!row.model3d_task_id) return { status: 'generating', progress: 0, anatomy, polished, synth }

  let task: ReturnType<typeof parseTripoTask>
  try {
    task = parseTripoTask(await tripoFetch(`/tasks/${encodeURIComponent(row.model3d_task_id)}`))
  } catch (e) {
    // Transient poll failure — keep generating; the next poll retries.
    console.warn('[roofing/model3d] poll failed', { error: e instanceof Error ? e.message : String(e) })
    return { status: 'generating', progress: null, anatomy, polished, synth }
  }

  if (task.status === 'success' && task.modelUrl) {
    try {
      const glbRes = await fetch(task.modelUrl)
      if (!glbRes.ok) throw new Error(`GLB download HTTP ${glbRes.status}`)
      const bytes = Buffer.from(await glbRes.arrayBuffer())
      if (bytes.length > MODEL_MAX_BYTES) {
        throw new Error(
          `model too large for storage (${(bytes.length / 1048576).toFixed(1)} MB > 48 MB) — lower TRIPO_FACE_LIMIT / TRIPO_TEXTURE_QUALITY`,
        )
      }
      const path = `roofing/${row.id}/model3d-${Date.now()}.glb`
      const { error: upErr } = await supabaseClient().storage
        .from(MODEL_BUCKET)
        .upload(path, bytes, { contentType: 'model/gltf-binary', upsert: false })
      if (upErr) throw new Error(`storage upload: ${upErr.message}`)
      await supabaseClient()
        .from('roofing_measurements')
        .update({ model3d_status: 'ready', model3d_glb_path: path })
        .eq('measure_token', measureToken)
      return { status: 'ready', modelUrl: await signedModelUrl(path), anatomy, polished, synth }
    } catch (e) {
      await markFailed(measureToken, e instanceof Error ? e.message : String(e))
      return { status: 'failed', error: e instanceof Error ? e.message : String(e), anatomy, polished, synth }
    }
  }

  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'banned' || task.status === 'expired') {
    const error = task.error ?? `Tripo task ${task.status}`
    await markFailed(measureToken, error)
    return { status: 'failed', error, anatomy, polished, synth }
  }

  return { status: 'generating', progress: task.progress, anatomy, polished, synth }
}
