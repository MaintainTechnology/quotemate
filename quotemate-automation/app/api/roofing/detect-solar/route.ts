// POST /api/roofing/detect-solar — detect EXISTING rooftop solar from the
// Google satellite aerial (Gemini vision) and compute the detach & reinstate
// allowance using the tenant's rate card.
//
// Body: { address, center?: {lat,lng}, intent? }. Auth: bearer token (same
// pattern as /api/roofing/measure). Best-effort: vision/parse failures
// surface as { ok:false, code } with HTTP 200, never throw.
//
// Gemini vision takes a few seconds, so maxDuration is raised.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { effectiveRateCardFromOverlay } from '@/lib/roofing/rate-card-overlay'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'
import {
  buildSolarDetectPrompt,
  computeSolarAllowance,
  parseSolarDetection,
  solarAllowanceConfigFromCard,
  SOLAR_DETECTION_SCHEMA,
} from '@/lib/roofing/solar'
import { DEFAULT_ROOFING_RATE_CARD } from '@/lib/roofing/pricing'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SOLAR_VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  address: z.string().min(3).max(300),
  center: z.object({ lat: z.number(), lng: z.number() }).optional(),
  intent: z
    .enum(['full_reroof', 'patch_repair', 'leak_trace', 'gutter_replace', 'ridge_cap', 'flashing_repair', 'unknown'])
    .optional(),
})

async function userAndTenantFromBearer(
  req: Request,
): Promise<{ userId: string; tenantId: string | null; primaryTrade: string | null } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, trade')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  return {
    userId: data.user.id,
    tenantId: (tenant?.id as string | undefined) ?? null,
    primaryTrade: (tenant?.trade as string | null | undefined) ?? null,
  }
}

async function loadRoofingOverlay(tenantId: string, primaryTrade: string | null): Promise<unknown> {
  try {
    let q = supabase.from('pricing_book').select('overlays').eq('tenant_id', tenantId)
    if (primaryTrade) q = q.eq('trade', primaryTrade)
    const { data } = await q.limit(1).maybeSingle()
    const overlays = (data?.overlays as Record<string, unknown> | null | undefined) ?? null
    return overlays?.roofing_rate_card ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const auth = await userAndTenantFromBearer(req)
  if (!auth) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return Response.json({ ok: false, code: 'maps_key_missing' }, { status: 200 })
  }
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ ok: false, code: 'gemini_key_missing' }, { status: 200 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }
  const { address, center, intent } = parsed.data

  // Resolve the tenant's rate card for the (configurable) allowance.
  let rateCard = DEFAULT_ROOFING_RATE_CARD
  if (auth.tenantId) {
    const overlayJson = await loadRoofingOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) rateCard = effectiveRateCardFromOverlay(overlayJson)
  }

  try {
    // 1. Fetch the satellite aerial (same source the measure tool shows).
    const target = buildStaticMapUrl(
      {
        address: center ? undefined : address,
        center: center ?? undefined,
        zoom: 20,
        size: { width: 640, height: 640 },
        maptype: 'satellite',
      },
      { apiKey: process.env.GOOGLE_MAPS_API_KEY! },
    )
    const satRes = await fetch(target)
    if (!satRes.ok) {
      return Response.json({ ok: false, code: 'satellite_unavailable', detail: `HTTP ${satRes.status}` }, { status: 200 })
    }
    const mime = satRes.headers.get('content-type') ?? 'image/png'
    const bytes = Buffer.from(await satRes.arrayBuffer())

    // 2. Gemini vision → detection. (generateText is optional on the
    // provider interface; the Gemini adapter always implements it.)
    const generateText = geminiProvider.generateText
    if (!generateText) {
      return Response.json({ ok: false, code: 'vision_unavailable' }, { status: 200 })
    }
    const text = await generateText({
      prompt: buildSolarDetectPrompt(),
      images: [{ base64: bytes.toString('base64'), mime }],
      temperature: 0,
      model: SOLAR_VISION_MODEL,
      responseSchema: SOLAR_DETECTION_SCHEMA,
    })
    const detection = parseSolarDetection(text)
    if (!detection) {
      return Response.json({ ok: false, code: 'vision_unparsable' }, { status: 200 })
    }

    // 3. Allowance from the tenant rate card.
    const cfg = solarAllowanceConfigFromCard(rateCard)
    const allowance = computeSolarAllowance(detection, {
      intent: intent ?? 'full_reroof',
      base_ex_gst: cfg.base_ex_gst,
      per_array_ex_gst: cfg.per_array_ex_gst,
      gstRegistered: rateCard.gst_registered,
    })

    return Response.json({ ok: true, detection, allowance }, { status: 200 })
  } catch (e) {
    return Response.json(
      { ok: false, code: 'detect_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
