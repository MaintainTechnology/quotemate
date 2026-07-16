// ════════════════════════════════════════════════════════════════════
// Roofing — interactive 3D model of the property (Track B: VISUAL only).
//
// Pipeline: the tradie's browser captures 4 orbit views (front/left/back/
// right) of the Google Photorealistic 3D tiles → each capture is enhanced
// by Gemini nano-banana (best-effort: raw capture on failure) → Tripo3D
// multiview-to-model reconstructs a textured GLB → the GLB is re-hosted in
// the intake-photos bucket (Tripo output URLs expire after ~5 minutes) and
// served via a short-lived signed URL.
//
// The model NEVER feeds measurements or pricing. Ridge/hip/valley numbers
// stay on the measured-geometry path (Geoscape + Google Solar) — an AI
// reconstruction from 4 enhanced screenshots is visually convincing but not
// dimensionally reliable, and nano-banana enhancement invents plausible
// pixels by design.
//
// Status lives on roofing_measurements (migration 173):
//   model3d_status: null | 'generating' | 'ready' | 'failed'
// CAS-claimed like preview_status (roof-after.ts) so double-clicks and
// concurrent polls never start two paid Tripo tasks.
// ════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'
import type { ImageBytes } from '@/lib/ig-engine/providers/base'
import {
  getCachedEnhanced,
  putCachedEnhanced,
  type CaptureView,
} from '@/lib/roofing/capture-cache'

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
}

// ── pure helpers (unit-tested) ──────────────────────────────────────

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

const ENHANCE_SYSTEM =
  'You are a photo enhancement engine. You upscale and sharpen aerial photographs. ' +
  'You never invent, add, remove, or move structures, and never change colours, ' +
  'roof shape, proportions, or camera angle.'

const ENHANCE_USER =
  'Enhance this aerial capture of a house into a high-resolution, crisp, photorealistic ' +
  'image. Preserve the exact building geometry, roof shape, colours and surroundings. ' +
  'Only improve sharpness, clarity and texture detail.'

/**
 * Enhance one capture — BEST-EFFORT. Returns null when enhancement did NOT
 * happen (no key / quota / safety / network) so the caller can fall back to
 * the raw capture without poisoning the cache with unpolished images.
 */
async function enhanceCapture(image: ImageBytes): Promise<ImageBytes | null> {
  if (!process.env.GEMINI_API_KEY?.trim()) return null
  try {
    return await geminiProvider.renderImage({
      system: ENHANCE_SYSTEM,
      user: ENHANCE_USER,
      sourceImage: image,
      aspectRatio: '4:3',
    })
  } catch (e) {
    console.warn('[roofing/model3d] enhancement failed, using raw capture', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

// ── orchestration ───────────────────────────────────────────────────

type Row = { id: string; model3d_status: string | null; model3d_task_id: string | null; model3d_glb_path: string | null; model3d_error: string | null }

async function loadRow(measureToken: string): Promise<Row | null> {
  const { data } = await supabaseClient()
    .from('roofing_measurements')
    .select('id, model3d_status, model3d_task_id, model3d_glb_path, model3d_error')
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
    .update({ model3d_status: 'generating', model3d_error: null, model3d_task_id: null })
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
 * property (cross-tenant by design — the token saving is the point). Then
 * upload the Tripo-consumable views ('top' is cached only) and create the
 * task. Never throws; failures land on model3d_status.
 */
export async function startModel3d(
  measureToken: string,
  captures: LabeledCapture[],
  opts: { address?: string | null; reuseCache?: boolean } = {},
): Promise<void> {
  try {
    const address = opts.address?.trim() || null
    // Manual captures bypass the READ (deliberate framing wins) but still
    // WRITE, refreshing the property's cache for future runs.
    const reuse = opts.reuseCache !== false && !!address

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

    const fileTokens: Partial<Record<ViewName, string>> = {}
    await Promise.all(
      polished
        .filter((p) => (VIEW_ORDER as readonly string[]).includes(p.view))
        .map(async (p) => {
          fileTokens[p.view as ViewName] = await tripoUpload(p.image)
        }),
    )
    const taskId = await tripoCreateMultiview(fileTokens)
    await supabaseClient()
      .from('roofing_measurements')
      .update({ model3d_task_id: taskId })
      .eq('measure_token', measureToken)
  } catch (e) {
    await markFailed(measureToken, e instanceof Error ? e.message : String(e))
  }
}

/** Signed URL for a stored GLB (1 h — the viewer loads it immediately). */
async function signedModelUrl(path: string): Promise<string | null> {
  const { data } = await supabaseClient().storage.from(MODEL_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
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

  if (row.model3d_status === 'ready' && row.model3d_glb_path) {
    return { status: 'ready', modelUrl: await signedModelUrl(row.model3d_glb_path) }
  }
  if (row.model3d_status === 'failed') {
    return { status: 'failed', error: row.model3d_error }
  }
  if (row.model3d_status !== 'generating') return { status: 'idle' }

  // Task id not stamped yet — enhancement/upload still running in after().
  if (!row.model3d_task_id) return { status: 'generating', progress: 0 }

  let task: ReturnType<typeof parseTripoTask>
  try {
    task = parseTripoTask(await tripoFetch(`/tasks/${encodeURIComponent(row.model3d_task_id)}`))
  } catch (e) {
    // Transient poll failure — keep generating; the next poll retries.
    console.warn('[roofing/model3d] poll failed', { error: e instanceof Error ? e.message : String(e) })
    return { status: 'generating', progress: null }
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
      return { status: 'ready', modelUrl: await signedModelUrl(path) }
    } catch (e) {
      await markFailed(measureToken, e instanceof Error ? e.message : String(e))
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
    }
  }

  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'banned' || task.status === 'expired') {
    const error = task.error ?? `Tripo task ${task.status}`
    await markFailed(measureToken, error)
    return { status: 'failed', error }
  }

  return { status: 'generating', progress: task.progress }
}
