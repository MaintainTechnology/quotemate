// AI-generated tradie trust videos (spec tradie-trust-video-generation).
//
// Generates the two customer-facing trust videos — the §03 "welcome" and the
// post-booking "thank-you" — with Veo 3.1 on the Gemini API (the requester's
// "Gemini Omni" ask maps here: on this key gemini-omni-flash-preview has no
// video output method; the video engine is veo-3.1-*-generate-preview via
// predictLongRunning). Output lands in the public tenant-videos bucket (mig
// 177) and is stamped onto tenants.intro_video_url / thankyou_video_url (mig
// 175), where trustVideoUrls() already prefers it over the QuoteMax default —
// no customer-page changes needed.
//
// RESUMABLE by design: the Gemini long-running operation name is persisted in
// tenants.trust_video_state (mig 178) the moment the job starts, so a
// serverless timeout mid-poll never strands a generation — any later status
// read (GET /api/tenant/videos) polls the operation and finalises.
//
// Key hygiene: GEMINI_API_KEY is read from env, sent as a header, and never
// logged. All calls are server-side.

import type { SupabaseClient } from '@supabase/supabase-js'

export type TrustVideoSlot = 'welcome' | 'thankyou'

export type TrustVideoSlotState = {
  status: 'idle' | 'generating' | 'ready' | 'failed'
  /** Gemini long-running operation name — the resume handle. */
  operation?: string | null
  script?: string | null
  error?: string | null
  updated_at?: string
  source?: 'auto' | 'dashboard'
  /** Set when the reference image was rejected and we fell back to text-only. */
  note?: string | null
}

export type TrustVideoState = Partial<Record<TrustVideoSlot, TrustVideoSlotState>>

export const TRUST_VIDEO_SLOTS: readonly TrustVideoSlot[] = ['welcome', 'thankyou'] as const

/** Which tenants column each slot stamps (mig 175). */
export const SLOT_URL_COLUMN: Record<TrustVideoSlot, 'intro_video_url' | 'thankyou_video_url'> = {
  welcome: 'intro_video_url',
  thankyou: 'thankyou_video_url',
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const BUCKET = 'tenant-videos'

/** veo-3.1-fast: best cost/latency on this key. Env-overridable. */
export function trustVideoModel(): string {
  return process.env.TRUST_VIDEO_MODEL?.trim() || 'veo-3.1-fast-generate-preview'
}

// ── Scripts + prompt (pure) ─────────────────────────────────────────

/** Veo's prompt budget is tiny (480 tokens) and speech beyond ~8s gets cut —
 *  scripts are hard-capped. Custom scripts over the cap are REJECTED with an
 *  honest error (spec R1), never silently truncated. */
export const MAX_SCRIPT_CHARS = 220

/** Default spoken lines — condensed from the approved "Why Choose Me" welcome
 *  and customer thank-you scripts (2026-07-20) to fit Veo's ~8s speech window.
 *  The contact name from the tradie's account personalises the intro when set. */
export function defaultScript(
  slot: TrustVideoSlot,
  businessName: string,
  contactName?: string | null,
): string {
  const name = businessName.trim() || 'our team'
  const contact = contactName?.trim()
  if (slot === 'welcome') {
    const intro = contact ? `Hi, I'm ${contact} from ${name}.` : `G'day, we're ${name}.`
    return `${intro} Thanks for the opportunity to quote. No shortcuts and no surprises, just quality work built to last. Book your site visit and we will sort the rest.`
  }
  return contact
    ? `Hi, it's ${contact} from ${name}. Thank you for accepting our quote and booking your site inspection. I will call shortly to confirm the exact time. See you soon.`
    : `Thank you for accepting our quote and booking your site inspection. ${name} will call shortly to confirm the exact time. We look forward to meeting you.`
}

export function validateScript(
  script: string | null | undefined,
): { ok: true; script: string | null } | { ok: false; error: string } {
  if (script === null || script === undefined) return { ok: true, script: null }
  const cleaned = script.replace(/\s+/g, ' ').trim()
  if (!cleaned) return { ok: true, script: null }
  if (cleaned.length > MAX_SCRIPT_CHARS) {
    return {
      ok: false,
      error: `Script is ${cleaned.length} characters — keep it under ${MAX_SCRIPT_CHARS} so it fits the spoken length of the video.`,
    }
  }
  return { ok: true, script: cleaned }
}

export function buildTrustVideoPrompt(opts: {
  slot: TrustVideoSlot
  businessName: string
  contactName?: string | null
  trade?: string | null
  script?: string | null
  extraContext?: string | null
  /** True when a reference image (logo or owner photo) accompanies the prompt. */
  hasReferenceImage?: boolean
}): string {
  const business = opts.businessName.trim() || 'the business'
  const trade = (opts.trade ?? '').trim().replace(/_/g, ' ')
  const speaker = opts.contactName?.trim()
    ? `${opts.contactName.trim()}, the owner of ${business}`
    : `the friendly owner of ${business}`
  const line = (opts.script?.trim() || defaultScript(opts.slot, business, opts.contactName)).replace(/"/g, "'")
  const scene =
    opts.slot === 'welcome'
      ? `standing in front of their branded work vehicle outside an Australian suburban home on a sunny day`
      : `outside an Australian suburban home, giving a warm nod of thanks`
  // Branding directive: the company name always appears on the vehicle and
  // workwear; when a logo/reference image rides along, tell Veo to match it
  // exactly rather than invent a substitute mark.
  const branding = opts.hasReferenceImage
    ? `The company logo from the reference image is prominently displayed on the side of the vehicle and on the chest of the workwear, large and clearly legible, alongside the company name "${business}", matching the reference exactly.`
    : `The company name "${business}" is visible in clean lettering on the vehicle and workwear.`
  const extra = opts.extraContext?.trim() ? ` ${opts.extraContext.trim().slice(0, 160)}` : ''
  return (
    `A warm, professional video of ${speaker}, an Australian ${trade || 'trades'} professional, ` +
    `${scene}. ${branding}${extra} ` +
    `They look at the camera and say: "${line}" ` +
    `Natural daylight, steady camera, friendly and trustworthy tone, spoken with an Australian accent.`
  )
}

// ── State helpers (pure) ────────────────────────────────────────────

export function readSlotState(
  state: TrustVideoState | null | undefined,
  slot: TrustVideoSlot,
): TrustVideoSlotState {
  return state?.[slot] ?? { status: 'idle' }
}

export function withSlotState(
  state: TrustVideoState | null | undefined,
  slot: TrustVideoSlot,
  patch: Partial<TrustVideoSlotState>,
): TrustVideoState {
  const current = readSlotState(state, slot)
  return {
    ...(state ?? {}),
    [slot]: { ...current, ...patch, updated_at: new Date().toISOString() },
  }
}

/** Auto-generation must never clobber real content: skip when the slot URL is
 *  already set (a manual/tradie film or an earlier generation) or a job is
 *  already in flight. Dashboard regeneration is an explicit user action and
 *  bypasses this. */
export function shouldAutoGenerate(
  slotUrl: string | null | undefined,
  state: TrustVideoState | null | undefined,
  slot: TrustVideoSlot,
): boolean {
  if (slotUrl?.trim()) return false
  const s = readSlotState(state, slot)
  return s.status !== 'generating' && s.status !== 'ready'
}

// ── Veo long-running operations ─────────────────────────────────────

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not configured')
  return key
}

type ReferenceImage = { bytesBase64: string; mimeType: string }

/** Start a Veo generation. Returns the operation name. A 400 with a reference
 *  image retries text-only (safety/format rejections must not kill the job). */
export async function startVeoOperation(opts: {
  prompt: string
  referenceImage?: ReferenceImage | null
}): Promise<{ operation: string; note: string | null }> {
  const model = trustVideoModel()
  const url = `${GEMINI_BASE}/models/${model}:predictLongRunning`
  const call = async (withImage: boolean) => {
    const instance: Record<string, unknown> = { prompt: opts.prompt }
    if (withImage && opts.referenceImage) {
      // referenceImages (asset), NOT instance.image — `image` switches Veo to
      // image-to-video and makes the logo the literal first frame. An asset
      // reference weaves the logo into the scene instead.
      instance.referenceImages = [
        {
          image: {
            bytesBase64Encoded: opts.referenceImage.bytesBase64,
            mimeType: opts.referenceImage.mimeType,
          },
          referenceType: 'asset',
        },
      ]
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify({
        instances: [instance],
        parameters: { aspectRatio: '16:9' },
      }),
      signal: AbortSignal.timeout(60_000),
    })
  }

  let res = await call(!!opts.referenceImage)
  let note: string | null = null
  if (!res.ok && opts.referenceImage && res.status === 400) {
    // Reference rejected (format/safety) → text-only fallback, noted in state.
    note = 'Reference image was not accepted — generated from the script only.'
    res = await call(false)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Veo start failed (${res.status}): ${body.slice(0, 300)}`)
  }
  const json = (await res.json()) as { name?: string }
  if (!json.name) throw new Error('Veo start returned no operation name')
  return { operation: json.name, note }
}

/** Tolerant extraction of the generated video URI across response shapes. */
export function extractVideoUri(response: unknown): string | null {
  const r = response as Record<string, any> | null | undefined
  return (
    r?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
    r?.generateVideoResponse?.generatedVideos?.[0]?.video?.uri ??
    r?.generatedVideos?.[0]?.video?.uri ??
    r?.predictions?.[0]?.video?.uri ??
    null
  )
}

/** Veo's responsible-AI filter reports blocks via raiMediaFilteredReasons
 *  (observed live: "Sorry, we can't create videos with real people's names or
 *  likenesses…"). Surface the real reason instead of a generic failure. */
export function extractRaiReason(response: unknown): string | null {
  const r = response as Record<string, any> | null | undefined
  const reasons = r?.generateVideoResponse?.raiMediaFilteredReasons
  return Array.isArray(reasons) && typeof reasons[0] === 'string' ? reasons[0] : null
}

/** True when an RAI block is about personal names/likenesses — the one case
 *  the pipeline can self-heal by regenerating without the contact name. */
export function isPersonNameBlock(reason: string | null | undefined): boolean {
  return !!reason && /people'?s names|likeness|celebrity/i.test(reason)
}

export type VeoPoll =
  | { done: false }
  | { done: true; uri: string }
  | { done: true; uri: null; error: string }

export async function pollVeoOperation(operation: string): Promise<VeoPoll> {
  const res = await fetch(`${GEMINI_BASE}/${operation}`, {
    headers: { 'x-goog-api-key': apiKey() },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Veo poll failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    done?: boolean
    error?: { message?: string }
    response?: unknown
  }
  if (!json.done) return { done: false }
  if (json.error) return { done: true, uri: null, error: json.error.message ?? 'generation failed' }
  const uri = extractVideoUri(json.response)
  if (!uri) {
    const rai = extractRaiReason(json.response)
    return { done: true, uri: null, error: rai ?? 'generation finished but returned no video' }
  }
  return { done: true, uri }
}

async function downloadVideo(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri, {
    headers: { 'x-goog-api-key': apiKey() },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`video download failed (${res.status})`)
  return res.arrayBuffer()
}

// ── Orchestration ───────────────────────────────────────────────────

type TenantVideoRow = {
  id: string
  business_name: string | null
  contact_name: string | null
  trade: string | null
  logo_url: string | null
  intro_video_url: string | null
  thankyou_video_url: string | null
  trust_video_state: TrustVideoState | null
}

export const TENANT_VIDEO_COLUMNS =
  'id, business_name, contact_name, trade, logo_url, intro_video_url, thankyou_video_url, trust_video_state'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural DI (house pattern, see lib/quote/paid-confirm.ts)
type Db = any

async function saveSlotState(
  supabase: Db,
  tenantId: string,
  state: TrustVideoState,
): Promise<void> {
  const { error } = await supabase
    .from('tenants')
    .update({ trust_video_state: state })
    .eq('id', tenantId)
  if (error) console.warn('[trust-video] state save skipped (apply migration 178)', error.message)
}

/** Fetch the tenant's logo bytes for reference conditioning (public URL).
 *  Veo takes raster refs only, and most tradie logos are uploaded as SVG —
 *  those are rasterised to PNG with sharp (explicit dep) so the logo is
 *  never silently dropped from the generation. */
async function fetchReferenceFromUrl(url: string | null | undefined): Promise<ReferenceImage | null> {
  if (!url?.trim()) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    let buf: Buffer = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) return null
    if (mime === 'image/svg+xml' || url.trim().toLowerCase().split('?')[0].endsWith('.svg')) {
      const sharp = (await import('sharp')).default
      // White backing: transparent logo marks read badly as a Veo reference.
      buf = await sharp(buf, { density: 300 })
        .resize(1024, 1024, { fit: 'inside' })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer()
      if (buf.length === 0 || buf.length > 7_000_000) return null
      return { bytesBase64: buf.toString('base64'), mimeType: 'image/png' }
    }
    if (!/^image\/(png|jpeg|webp)$/.test(mime)) return null
    if (buf.length > 7_000_000) return null
    return { bytesBase64: buf.toString('base64'), mimeType: mime }
  } catch {
    return null
  }
}

async function uploadVideoToBucket(
  supabase: Db,
  tenantId: string,
  slot: TrustVideoSlot,
  bytes: ArrayBuffer,
): Promise<string> {
  const path = `${tenantId}/${slot}-${Date.now()}.mp4`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'video/mp4', upsert: true })
  if (error) throw new Error(`bucket upload failed: ${error.message}`)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl as string
}

/** Download the finished operation's video, publish it, stamp the tenant. */
async function finaliseSlot(
  supabase: Db,
  tenant: TenantVideoRow,
  slot: TrustVideoSlot,
  uri: string,
): Promise<string> {
  const bytes = await downloadVideo(uri)
  const publicUrl = await uploadVideoToBucket(supabase, tenant.id, slot, bytes)
  const { error } = await supabase
    .from('tenants')
    .update({ [SLOT_URL_COLUMN[slot]]: publicUrl })
    .eq('id', tenant.id)
  if (error) throw new Error(`tenant stamp failed: ${error.message}`)
  return publicUrl
}

/**
 * Generate one slot end to end. Never throws — failures land in
 * trust_video_state.<slot>.error. Long-poll bounded by maxWaitMs; on timeout
 * the state stays 'generating' with the operation persisted (resumable).
 */
export async function generateTrustVideo(
  supabase: Db,
  opts: {
    tenantId: string
    slot: TrustVideoSlot
    script?: string | null
    source: 'auto' | 'dashboard'
    referenceImage?: ReferenceImage | null
    /** Extra business context woven into the scene prompt (dashboard "details"). */
    extraContext?: string | null
    maxWaitMs?: number
  },
): Promise<{ status: 'ready' | 'generating' | 'failed'; url?: string; error?: string }> {
  const { tenantId, slot } = opts
  try {
    const { data: tenant } = await supabase
      .from('tenants')
      .select(TENANT_VIDEO_COLUMNS)
      .eq('id', tenantId)
      .maybeSingle()
    if (!tenant) return { status: 'failed', error: 'tenant not found' }
    const t = tenant as TenantVideoRow

    const reference = opts.referenceImage ?? (await fetchReferenceFromUrl(t.logo_url))
    // Surface a dropped logo instead of failing silently — the dashboard
    // shows this note under the slot.
    const logoUnused = !reference && !!t.logo_url?.trim()
    const usingDefaultScript = !opts.script?.trim()

    // Attempt 1 speaks as the contact when one is set. Veo's responsible-AI
    // filter rejects "real people's names or likenesses" (observed live), so
    // a DEFAULT script that trips it self-heals on attempt 2 with the
    // business-name-only variant. A CUSTOM script is the tradie's words —
    // its RAI failure is surfaced verbatim for them to edit, never rewritten.
    const attempts: Array<{ script: string; contactName: string | null; note: string | null }> = [
      {
        script:
          opts.script?.trim() || defaultScript(slot, t.business_name ?? '', t.contact_name),
        contactName: t.contact_name,
        note: null,
      },
    ]
    if (usingDefaultScript && t.contact_name?.trim()) {
      attempts.push({
        script: defaultScript(slot, t.business_name ?? '', null),
        contactName: null,
        note: 'The AI cannot use personal names, so this video speaks as your business instead.',
      })
    }

    let state = t.trust_video_state
    let lastError = 'generation failed'
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      const prompt = buildTrustVideoPrompt({
        slot,
        businessName: t.business_name ?? '',
        contactName: attempt.contactName,
        trade: t.trade,
        script: attempt.script,
        extraContext: opts.extraContext ?? null,
        hasReferenceImage: !!reference,
      })

      state = withSlotState(state, slot, {
        status: 'generating',
        script: attempt.script,
        error: null,
        source: opts.source,
      })
      await saveSlotState(supabase, tenantId, state)

      const { operation, note } = await startVeoOperation({ prompt, referenceImage: reference })
      state = withSlotState(state, slot, {
        operation,
        note:
          attempt.note ??
          note ??
          (logoUnused
            ? 'Your logo could not be read, so this video was generated without it.'
            : null),
      })
      await saveSlotState(supabase, tenantId, state)

      const deadline = Date.now() + (opts.maxWaitMs ?? 240_000)
      let attemptFailed: string | null = null
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 8_000))
        const poll = await pollVeoOperation(operation).catch(() => null)
        if (!poll) continue // transient — keep polling
        if (!poll.done) continue
        if (poll.uri === null) {
          attemptFailed = poll.error
          break
        }
        const url = await finaliseSlot(supabase, t, slot, poll.uri)
        state = withSlotState(state, slot, { status: 'ready', error: null })
        await saveSlotState(supabase, tenantId, state)
        return { status: 'ready', url }
      }
      if (attemptFailed === null) {
        // Timed out — the operation keeps running at Google; state stays
        // 'generating' and the next GET /api/tenant/videos resumes it.
        return { status: 'generating' }
      }
      lastError = attemptFailed
      const canRetry = i + 1 < attempts.length && isPersonNameBlock(attemptFailed)
      if (!canRetry) break
      // Fall through to the neutral-script attempt.
    }
    state = withSlotState(state, slot, { status: 'failed', error: lastError })
    await saveSlotState(supabase, tenantId, state)
    return { status: 'failed', error: lastError }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try {
      const { data: t2 } = await supabase
        .from('tenants')
        .select('trust_video_state')
        .eq('id', tenantId)
        .maybeSingle()
      await saveSlotState(
        supabase,
        tenantId,
        withSlotState((t2 as { trust_video_state?: TrustVideoState } | null)?.trust_video_state, slot, {
          status: 'failed',
          error: msg,
        }),
      )
    } catch {
      /* state save is best-effort */
    }
    console.warn('[trust-video] generation failed', { tenantId, slot, error: msg })
    return { status: 'failed', error: msg }
  }
}

/**
 * Auto-generate both trust videos for a tenant (spec R5) — called from the
 * activation flow's deferred block. Gated by TRUST_VIDEO_AUTOGEN (default on);
 * shouldAutoGenerate keeps it idempotent and never clobbers real content.
 * Sequential on purpose (one in-flight Veo job per tenant); never throws.
 */
export async function autoGenerateTrustVideos(supabase: Db, tenantId: string): Promise<void> {
  if ((process.env.TRUST_VIDEO_AUTOGEN ?? '').trim().toLowerCase() === 'false') return
  try {
    const { data } = await supabase
      .from('tenants')
      .select(TENANT_VIDEO_COLUMNS)
      .eq('id', tenantId)
      .maybeSingle()
    if (!data) return
    const t = data as TenantVideoRow
    if (!t.business_name?.trim()) return
    for (const slot of TRUST_VIDEO_SLOTS) {
      const url = slot === 'welcome' ? t.intro_video_url : t.thankyou_video_url
      if (!shouldAutoGenerate(url, t.trust_video_state, slot)) continue
      await generateTrustVideo(supabase, { tenantId, slot, source: 'auto' })
    }
  } catch (e) {
    console.warn('[trust-video] auto-generation skipped', {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * Resume an in-flight slot: single poll; finalise when done. The backstop that
 * makes serverless timeouts harmless — called from GET /api/tenant/videos.
 */
export async function resumeTrustVideo(
  supabase: Db,
  tenant: TenantVideoRow,
  slot: TrustVideoSlot,
): Promise<TrustVideoSlotState> {
  const s = readSlotState(tenant.trust_video_state, slot)
  if (s.status !== 'generating' || !s.operation) return s
  try {
    const poll = await pollVeoOperation(s.operation)
    if (!poll.done) return s
    let next: TrustVideoSlotState
    if (poll.uri === null) {
      next = { ...s, status: 'failed', error: poll.error }
    } else {
      await finaliseSlot(supabase, tenant, slot, poll.uri)
      next = { ...s, status: 'ready', error: null }
    }
    await saveSlotState(supabase, tenant.id, withSlotState(tenant.trust_video_state, slot, next))
    return next
  } catch (e) {
    // Transient poll failure — leave the job resumable.
    console.warn('[trust-video] resume poll failed (will retry on next read)', {
      tenantId: tenant.id,
      slot,
      error: e instanceof Error ? e.message : String(e),
    })
    return s
  }
}
