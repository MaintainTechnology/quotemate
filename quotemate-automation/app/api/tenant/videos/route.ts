// GET /api/tenant/videos — the tradie's trust-video slots for ONE trade, plus
// the list of trades they have switched on (so the dashboard renders a sub-tab
// per trade). Also the RESUME backstop (spec tradie-trust-video-generation R3):
// a slot left 'generating' by a serverless timeout is polled here and
// finalised, so the dashboard's status polling doubles as the completion path.
//
// ?trade=<slug> selects the tab; omitted picks the tenant's first trade. A
// tenant with no recognised trade falls back to the legacy tenant-wide pair so
// nothing regresses.
//
// Dual-auth via resolveTenantRequest (Clerk session or legacy Supabase
// Bearer), scoped strictly to the caller's own tenant.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { trustVideoUrls } from '@/lib/quote/tenant-identity'
import { tenantFeatureSlugs } from '@/lib/features/catalog'
import { tradeLabel } from '@/lib/admin/trades'
import {
  normaliseVideoTrade,
  tradeVideoUrl,
  readTradeSlot,
  type TradeVideoMap,
} from '@/lib/videos/trade-videos'
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
    trades: string[] | null
    trade_videos: TradeVideoMap | null
  } | null
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  // Which trades this tenant has switched on — the same source the dashboard
  // hub tabs use (trades[] ∩ KNOWN_TRADES), with the legacy scalar as the
  // fallback for pre-migration-017 single-trade tenants.
  const raw = (tenant.trades ?? []).filter((t): t is string => typeof t === 'string')
  const slugs = tenantFeatureSlugs(raw.length ? raw : tenant.trade ? [tenant.trade] : [])

  // Selected tab: an explicit ?trade= the tenant actually has, else the first.
  const asked = normaliseVideoTrade(new URL(req.url).searchParams.get('trade'))
  const selected = asked && slugs.includes(asked) ? asked : (slugs[0] ?? null)

  // Resume backstop — one poll per in-flight slot of the SELECTED trade.
  const states = {
    welcome: await resumeTrustVideo(supabase, tenant, 'welcome', selected),
    thankyou: await resumeTrustVideo(supabase, tenant, 'thankyou', selected),
  }

  // Re-read after a resume just finalised (it stamped a url).
  let map: TradeVideoMap = tenant.trade_videos ?? {}
  let legacy = { intro: tenant.intro_video_url, thankyou: tenant.thankyou_video_url }
  if (states.welcome.status === 'ready' || states.thankyou.status === 'ready') {
    const { data: fresh } = await supabase
      .from('tenants')
      .select('intro_video_url, thankyou_video_url, trade_videos')
      .eq('id', tenant.id)
      .maybeSingle()
    if (fresh) {
      map = ((fresh as { trade_videos?: TradeVideoMap | null }).trade_videos ?? {}) as TradeVideoMap
      legacy = {
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
    trade: selected,
    trades: slugs.map((slug) => ({ slug, label: tradeLabel(slug) })),
    slots: Object.fromEntries(
      TRUST_VIDEO_SLOTS.map((slot) => {
        const legacyUrl = slot === 'welcome' ? legacy.intro : legacy.thankyou
        // The trade's own video wins; the tenant-wide pair still counts as
        // "their" video so an existing tradie is not told they have none.
        const own = (selected ? tradeVideoUrl(map, selected, slot) : null) ?? legacyUrl
        const fallback = slot === 'welcome' ? defaults.intro : defaults.thankyou
        const state = selected
          ? { ...readTradeSlot(map, selected, slot), ...states[slot] }
          : readSlotState({ ...tenant.trust_video_state, [slot]: states[slot] }, slot)
        return [
          slot,
          {
            url: own,
            effective_url: own ?? fallback,
            using_default: !own,
            default_script: defaultScript(
              slot,
              tenant.business_name ?? '',
              tenant.contact_name,
              selected,
            ),
            state,
          },
        ]
      }),
    ),
  })
}
