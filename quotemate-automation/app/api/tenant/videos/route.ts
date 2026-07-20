// GET /api/tenant/videos — the tradie's trust-video slots: current URLs,
// generation state, and the RESUME backstop (spec tradie-trust-video-
// generation R3): any slot left 'generating' by a serverless timeout is
// polled here and finalised when the Veo operation has completed, so the
// dashboard's status polling doubles as the job's completion path.
//
// Dual-auth via resolveTenantRequest (Clerk session or legacy Supabase
// Bearer), scoped strictly to the caller's own tenant.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { trustVideoUrls } from '@/lib/quote/tenant-identity'
import {
  TENANT_VIDEO_COLUMNS,
  TRUST_VIDEO_SLOTS,
  defaultScript,
  readSlotState,
  resumeTrustVideo,
  type TrustVideoState,
} from '@/lib/videos/trust-video'

export const runtime = 'nodejs'
// A resume may download + re-upload a finished ~10-30MB video.
export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const resolved = await resolveTenantRequest(supabase, req, TENANT_VIDEO_COLUMNS)
  if (!resolved) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = resolved.tenant as {
    id: string
    business_name: string | null
    contact_name: string | null
    trade: string | null
    logo_url: string | null
    intro_video_url: string | null
    thankyou_video_url: string | null
    trust_video_state: TrustVideoState | null
  } | null
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  // Resume backstop — a single poll per in-flight slot; finalises when done.
  const states = {
    welcome: await resumeTrustVideo(supabase, tenant, 'welcome'),
    thankyou: await resumeTrustVideo(supabase, tenant, 'thankyou'),
  }

  // Re-read the URL columns when a resume just finalised (stamped them).
  let urls = { intro: tenant.intro_video_url, thankyou: tenant.thankyou_video_url }
  if (
    (states.welcome.status === 'ready' && !tenant.intro_video_url) ||
    (states.thankyou.status === 'ready' && !tenant.thankyou_video_url)
  ) {
    const { data: fresh } = await supabase
      .from('tenants')
      .select('intro_video_url, thankyou_video_url')
      .eq('id', tenant.id)
      .maybeSingle()
    if (fresh) {
      urls = {
        intro: (fresh.intro_video_url as string | null) ?? null,
        thankyou: (fresh.thankyou_video_url as string | null) ?? null,
      }
    }
  }

  const defaults = trustVideoUrls({ intro_video_url: null, thankyou_video_url: null })

  return Response.json({
    ok: true,
    business_name: tenant.business_name,
    contact_name: tenant.contact_name,
    slots: Object.fromEntries(
      TRUST_VIDEO_SLOTS.map((slot) => {
        const own = slot === 'welcome' ? urls.intro : urls.thankyou
        const fallback = slot === 'welcome' ? defaults.intro : defaults.thankyou
        const state = readSlotState({ ...tenant.trust_video_state, [slot]: states[slot] }, slot)
        return [
          slot,
          {
            url: own,
            effective_url: own ?? fallback,
            using_default: !own,
            default_script: defaultScript(slot, tenant.business_name ?? '', tenant.contact_name),
            state,
          },
        ]
      }),
    ),
  })
}
