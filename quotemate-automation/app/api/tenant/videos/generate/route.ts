// POST /api/tenant/videos/generate — kick AI generation of the tradie's
// trust videos (spec tradie-trust-video-generation R3). Multipart FormData:
//
//   slot            'welcome' | 'thankyou' | 'both'
//   trade           optional trade slug — which trade's pair to generate;
//                   omitted keeps the legacy tenant-wide pair
//   script_welcome  optional custom script (<= MAX_SCRIPT_CHARS)
//   script_thankyou optional custom script
//   contact_name    optional — also persisted to the tenant row
//   details         optional extra context woven into the prompt
//   owner_photo     optional image file — the Veo reference image
//   extra_image     optional supplementary images (repeatable) — stored under
//                   tenant-videos/<id>/assets/ for reference use (no UI yet)
//
// Fast-ack pattern (webhook doctrine): validate, stamp 'generating', return;
// the Veo job runs in after(). A serverless timeout mid-poll is harmless —
// the operation name is persisted and GET /api/tenant/videos resumes it.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { tenantFeatureSlugs } from '@/lib/features/catalog'
import { normaliseVideoTrade } from '@/lib/videos/trade-videos'
import {
  MAX_SCRIPT_CHARS,
  TRUST_VIDEO_SLOTS,
  generateTrustVideo,
  validateScript,
  type TrustVideoSlot,
} from '@/lib/videos/trust-video'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_IMAGE_BYTES = 7 * 1024 * 1024
const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp']

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  const resolved = await resolveTenantRequest(supabase, req, 'id, business_name')
  if (!resolved) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = resolved.tenant as { id: string; business_name: string | null } | null
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'expected multipart form data' }, { status: 400 })
  }

  const slotRaw = String(form.get('slot') ?? 'both')
  const slots: TrustVideoSlot[] =
    slotRaw === 'both'
      ? [...TRUST_VIDEO_SLOTS]
      : TRUST_VIDEO_SLOTS.includes(slotRaw as TrustVideoSlot)
        ? [slotRaw as TrustVideoSlot]
        : []
  if (slots.length === 0) {
    return Response.json({ error: `slot must be welcome, thankyou or both` }, { status: 400 })
  }

  // Which trade's pair. Must be a trade the tenant actually has switched on —
  // otherwise a caller could seed videos for a trade they do not run.
  const askedTrade = normaliseVideoTrade(form.get('trade') ? String(form.get('trade')) : null)
  let trade: string | null = null
  if (askedTrade) {
    const { data: tRow } = await supabase
      .from('tenants')
      .select('trade, trades')
      .eq('id', tenant.id)
      .maybeSingle()
    const raw = ((tRow?.trades as string[] | null) ?? []).filter(
      (t): t is string => typeof t === 'string',
    )
    const slugs = tenantFeatureSlugs(
      raw.length ? raw : tRow?.trade ? [tRow.trade as string] : [],
    )
    if (!slugs.includes(askedTrade as never)) {
      return Response.json({ error: 'trade_not_enabled' }, { status: 403 })
    }
    trade = askedTrade
  }

  // Scripts — reject over-long input with an honest error (never truncate).
  const scripts: Partial<Record<TrustVideoSlot, string | null>> = {}
  for (const slot of slots) {
    const raw = form.get(`script_${slot}`)
    const check = validateScript(typeof raw === 'string' ? raw : null)
    if (!check.ok) return Response.json({ error: check.error, max: MAX_SCRIPT_CHARS }, { status: 400 })
    scripts[slot] = check.script
  }

  // Optional owner photo → a person-likeness reference. It rides in Veo's
  // reference set on attempt 1 and is the FIRST thing the RAI degradation
  // ladder drops if the filter blocks it (generateTrustVideo).
  let ownerReference: { bytesBase64: string; mimeType: string } | null = null
  const ownerPhoto = form.get('owner_photo')
  if (ownerPhoto instanceof File && ownerPhoto.size > 0) {
    const mime = (ownerPhoto.type ?? '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_IMAGE_MIME.includes(mime)) {
      return Response.json({ error: 'owner_photo must be PNG, JPEG or WebP' }, { status: 400 })
    }
    if (ownerPhoto.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: 'owner_photo must be 7 MB or smaller' }, { status: 400 })
    }
    const buf = Buffer.from(await ownerPhoto.arrayBuffer())
    ownerReference = { bytesBase64: buf.toString('base64'), mimeType: mime }
    // Keep the source asset alongside the videos (best-effort).
    await supabase.storage
      .from('tenant-videos')
      .upload(`${tenant.id}/assets/owner-photo-${Date.now()}.${mime.split('/')[1]}`, buf, {
        contentType: mime,
        upsert: true,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn('[trust-video] owner photo asset store skipped', error.message)
      })
  }

  // Supplementary images (ute, finished jobs) — the first two join the Veo
  // reference set so they genuinely shape the video (Veo caps refs at 3);
  // all are stored alongside the videos.
  const extraReferences: Array<{ bytesBase64: string; mimeType: string }> = []
  for (const entry of form.getAll('extra_image')) {
    if (!(entry instanceof File) || entry.size === 0) continue
    const mime = (entry.type ?? '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_IMAGE_MIME.includes(mime) || entry.size > MAX_IMAGE_BYTES) continue
    const buf = Buffer.from(await entry.arrayBuffer())
    if (extraReferences.length < 2) {
      extraReferences.push({ bytesBase64: buf.toString('base64'), mimeType: mime })
    }
    await supabase.storage
      .from('tenant-videos')
      .upload(`${tenant.id}/assets/extra-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${mime.split('/')[1]}`, buf, {
        contentType: mime,
        upsert: true,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn('[trust-video] extra image store skipped', error.message)
      })
  }

  // Optional detail fields persisted onto the tenant (contact name feeds the
  // spoken intro; blank values never clobber existing data).
  const contactName = String(form.get('contact_name') ?? '').trim()
  if (contactName) {
    await supabase.from('tenants').update({ contact_name: contactName }).eq('id', tenant.id)
  }

  const details = String(form.get('details') ?? '').trim() || null

  // Fast-ack: the Veo jobs run after the response. Sequential on purpose —
  // one in-flight generation per tenant keeps cost + rate limits sane.
  after(async () => {
    for (const slot of slots) {
      await generateTrustVideo(supabase, {
        tenantId: tenant.id,
        slot,
        trade,
        script: scripts[slot] ?? null,
        source: 'dashboard',
        ownerReference,
        extraReferences,
        extraContext: details,
      })
    }
  })

  return Response.json({ ok: true, generating: slots, trade })
}
