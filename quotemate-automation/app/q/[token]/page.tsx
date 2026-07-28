// Customer-facing public quote page.
// Reached via the SMS link "View full quote: {APP_URL}/q/{share_token}".
// Anyone with the token can view; tokens are unguessable (see lib/stripe/checkout
// generateShareToken). RLS policy on quotes is bypassed via the service-role
// client because this is a public sharing surface — only the columns we render
// below are exposed.
//
// Design system: Maintain Technology brand (dark navy canvas, vibrant orange
// accents, all-caps Manrope display, JetBrains Mono labels, numbered cards,
// topographic SVG overlay, orange CTA bar). Source: maintain.com.au + the
// .claude/skills/maintain-design-system/SKILL.md doc.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { notFound, redirect } from 'next/navigation'
import { asQuoteTierMode, resolveVisibleTiers } from '@/lib/quote/tier-visibility'
import { refreshSignedUrl } from '@/lib/storage/upload'
import { CustomerPhotosBlock } from './CustomerPhotosBlock'
import { RoofHeroStrip } from './RoofHeroStrip'
import { CommercialPaintDetails } from './CommercialPaintDetails'
import { TradeTiers } from './TradeTiers'
import { resolveTradeFormat, tierLabelsForTrade } from '@/lib/quote/trade-format'
import { QuoteChrome, type StickyBar } from '../_chrome/QuoteChrome'
import { tradeIcon } from '../_chrome/icons'
import {
  QuoteSheet, Letterhead, HeroPhoto, QuoteHero, StatGrid, Scope,
  SheetSection, GoodToKnow, CredentialFooter, TrustVideo, TradiePhoto,
  MetricGrid,
  type Stat, type FooterRow, type ScopeItem,
} from '../_chrome/parts'
import { tradieProfile } from '@/lib/quote/tradie-profile'
import { jobDetailsSentence } from '@/lib/quote/scope-short'
import { jobDetailBullets } from '@/lib/roofing/quote-bullets'
import { resolveRoofRenderSelection } from '@/lib/roofing/selection'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import {
  INSPECTION_FEE_AUD,
  clampDepositPct,
  displayDeposit,
  displayIncGst,
  fmtAud,
} from '@/lib/quote/money'
import { safeWebsiteUrl, trustVideoTrack } from '@/lib/quote/tenant-identity'
import type { TrustVideoState } from '@/lib/videos/trust-video'
import type { TradeVideoMap } from '@/lib/videos/trade-videos'
import { allocateIncGst, priceStack } from '@/lib/quote/line-allocation'
import { jobMethod, METHOD_DISCLAIMER } from '@/lib/quote/job-method'
import { loadQuoteMaterials, labourHours, type QuoteMaterial } from '@/lib/quote/quote-materials'
import { formatVisitSlot } from '@/lib/quote/trade-booking'
import { buildCalendarLinks } from '@/lib/quote/calendar-links'
import { resolveEventWindow } from '@/lib/quote/calendar'
import { tzForState } from '@/lib/quote/availability'
import { AddToCalendar } from '../_chrome/parts'
import {
  roofScopeStats,
  commercialPaintScope,
  tenderLineItems,
} from '@/lib/quote/trade-scope'
import {
  resolveSolarPagePath,
  resolveCommercialPaintTenderPath,
} from '@/lib/quote/dedicated-page'
import { generatePreviewImage } from '@/lib/ig-engine/generate'
import { generateSampleImages } from '@/lib/ig-engine/samples'
import { PreviewSection } from './PreviewSection'
import TradieEditor from './TradieEditor'
import { AcceptBlock } from '../_chrome/AcceptBlock'
import { resolveAcceptView } from '@/lib/quote/accept'
import { computePriceHoldUntil, priceHoldStatus, fmtHoldUntilAU } from '@/lib/quote/hold'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'
import {
  earlyBirdStatus,
  fmtEarlyBirdDeadlineAU,
  fmtEarlyBirdRemaining,
} from '@/lib/quote/early-bird'
import {
  resolveQuoteDisplayMode,
  type QuoteDisplayMode,
} from '@/lib/quote/display'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type LineItem = {
  unit: string
  quantity: number
  description: string
  total_ex_gst: number
  unit_price_ex_gst: number
}

type Tier = {
  label: string
  subtotal_ex_gst: number | string
  line_items?: LineItem[]
} | null

type StripeLinks = Partial<Record<'good' | 'better' | 'best' | 'inspection', string>>

// Tradie identity for the quote letterhead (migration 141). business_name +
// owner_* are always present; contact_name/website_url/business_address/logo_url
// arrive with migration 141 (best-effort select degrades gracefully if absent).
type TenantIdentity = {
  business_name: string | null
  contact_name: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  owner_mobile: string | null
  owner_email: string | null
  /** AU state code — drives tzForState so a booked visit echoes back in the
   *  timezone its slot was generated in (a WA slot formatted in Sydney reads
   *  as the wrong day). Base column, same age as the owner_* fields. */
  state: string | null
  website_url: string | null
  business_address: string | null
  logo_url: string | null
  /** Mig 180 — the tradie's own photo for the "Your tradie" section. */
  photo_url: string | null
  /** Mig 175 trust videos — tenant's own film, else the QuoteMax default. */
  intro_video_url: string | null
  thankyou_video_url: string | null
  /** Mig 178 — includes the script each film was generated FROM, which is
   *  what its captions say (trustVideoTrack + lib/videos/captions). */
  trust_video_state: TrustVideoState | null
  /** Mig 179 — the PER-TRADE video map the dashboard Videos tab actually
   *  writes to. This page was reading only the mig-175 scalar pair above,
   *  which the per-trade generation path deliberately never stamps, so a
   *  tradie's own clip could not be found. */
  trade_videos: TradeVideoMap | null
}

const JOB_TYPE_LABEL: Record<string, string> = {
  // ── Electrical ──────────────────────────────
  downlights: 'downlights',
  power_points: 'power points',
  ceiling_fans: 'ceiling fans',
  smoke_alarms: 'smoke alarms',
  outdoor_lighting: 'outdoor lighting',
  switchboard: 'switchboard work',
  oven_cooktop: 'oven/cooktop',
  ev_charger: 'EV charger',
  fault_finding: 'fault finding',
  renovation: 'renovation',
  // ── Plumbing (v5) ───────────────────────────
  blocked_drain: 'blocked drain',
  hot_water: 'hot water system',
  tap_repair: 'tap repair',
  tap_replace: 'tap replacement',
  toilet_repair: 'toilet repair',
  toilet_replace: 'toilet replacement',
  gas_fitting: 'gas fitting',
  burst_pipe: 'burst pipe repair',
  bathroom_renovation: 'bathroom renovation',
  cctv_inspection: 'CCTV drain inspection',
  prv_install: 'pressure-reduction valve',
  // ── Fallback (trade-neutral; was "electrical work" pre-v5) ──
  other: 'job',
}

function asNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'string' ? parseFloat(v) : v
}

// Money maths + formatting live in lib/quote/money.ts — the SAME functions
// the SMS, PDF and Stripe charge derive from, so every surface shows one
// number (spec customer-quote-five-sections R9).
const fmt = fmtAud

// The Section 2 sentence (scope_short, else the scope's first sentence) now
// resolves through the shared lib/quote/scope-short jobDetailsSentence, so this
// page and the quote PDF print the SAME job details.

export default async function PublicQuotePage(props: {
  params: Promise<{ token: string }>
}) {
  const { token } = await props.params

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, intake_id, tenant_id, status, scope_of_works, assumptions, risk_flags, good, better, best, optional_upsells, estimated_timeframe, needs_inspection, inspection_reason, gst_note, selected_tier, share_token, stripe_links, paid_at, paid_tier, created_at, price_hold_until, booking_state, preview_status, preview_image_path, preview_image_paths, samples_status, sample_image_paths, display_mode, deposit_pct')
    .eq('share_token', token)
    .maybeSingle()

  if (!quote) notFound()

  // v8 Phase A — early-booking discount. SEPARATE best-effort select so
  // a pre-migration-044 deploy (columns absent) returns an error row
  // rather than 500-ing this public page — supabase-js yields data:null
  // on a missing column, which simply leaves the offer at zero.
  let ebDiscountPct = 0
  let ebExpiresAt: string | null = null
  let ebAppliedPct = 0
  {
    const { data: eb } = await supabase
      .from('quotes')
      .select('early_bird_discount_pct, early_bird_expires_at, applied_discount_pct')
      .eq('id', quote.id)
      .maybeSingle()
    if (eb) {
      ebDiscountPct = Number(eb.early_bird_discount_pct ?? 0)
      ebExpiresAt = (eb.early_bird_expires_at as string | null) ?? null
      ebAppliedPct = Number(eb.applied_discount_pct ?? 0)
    }
  }

  // Customer acceptance (migration 164) — SEPARATE best-effort select so a
  // deploy that lands before the migration applies simply reads null (the
  // "Accepted · continue" hint stays off) instead of failing the main select
  // and 404-ing this live public page. Mirrors the early-bird block above.
  let customerAcceptedAt: string | null = null
  {
    const { data: ca } = await supabase
      .from('quotes')
      .select('customer_accepted_at')
      .eq('id', quote.id)
      .maybeSingle()
    if (ca) customerAcceptedAt = (ca.customer_accepted_at as string | null) ?? null
  }

  // Section 2 sentence (migration 175) — SEPARATE best-effort select so a
  // deploy that lands before the migration simply reads null and the page
  // falls back to the first sentence of scope_of_works. Same pattern as the
  // early-bird + acceptance blocks above.
  let scopeShort: string | null = null
  {
    const { data: ss } = await supabase
      .from('quotes')
      .select('scope_short')
      .eq('id', quote.id)
      .maybeSingle()
    if (ss) scopeShort = (ss.scope_short as string | null) ?? null
  }

  // v5 multi-trade: must fetch intake before pricing_book so we can filter
  // pricing_book by intake.trade. Without this filter the .maybeSingle()
  // would return null once there are 2+ rows in pricing_book (electrical
  // + plumbing). Legacy intake rows without a trade column fall back to
  // 'electrical' (the original NSW/NECA pilot).
  const { data: intake } = await supabase
    .from('intakes')
    .select('id, call_id, job_type, scope, caller, address, suburb, photo_paths, trade')
    .eq('id', quote.intake_id)
    .maybeSingle()
  const intakeTrade = ((intake as { trade?: string } | null)?.trade as string | undefined) ?? 'electrical'
  // Single source of truth for which renderer this trade uses (spec R1–R3).
  // Electrical/plumbing keep the generic Good/Better/Best card; every other
  // trade renders the non-electrical TradeTiers; unknown trades fall back to
  // the generic card AND log a warning here on the customer surface.
  const tradeFormat = resolveTradeFormat(intakeTrade)
  const isRoofing = tradeFormat.key === 'roofing'

  // ── Solar → dedicated page redirect ──────────────────────────────
  // The solar pipeline token-twins its rows (quotes.share_token ==
  // solar_estimates.public_token) and leaves the quotes row TIER-LESS —
  // rendering it here produced an empty "Your solar options" page. The
  // dedicated /q/solar/[token] page owns the measurement detail (kW,
  // panels, sun/shade map) AND the deposit CTAs, so every /q/<token>
  // link — including ones already sent by SMS — hands over to it.
  if (tradeFormat.key === 'solar') {
    const solarPath = await resolveSolarPagePath(supabase, token)
    if (solarPath) redirect(solarPath)
  }

  // Pull the roof-hero stats off the intake scope when this IS a roofing
  // job. The roofing save-as-quote route stamps its full measurement
  // snapshot ({...inputs, ...metrics}) into intake.scope verbatim (see
  // app/api/roofing/save-as-quote/route.ts) — surface all of it.
  const roofStats = isRoofing ? roofScopeStats(intake?.scope) : null

  // Wrong-roof fix: when this quote was promoted FROM a measurement, centre
  // the hero satellite on the MEASURED building polygon (the roofing proxy's
  // ?b=1) instead of geocoding the address text — on large/rural parcels the
  // geocode pin regularly lands on the wrong building.
  let roofHeroMapPath: string | null = null
  // Section 02 "Job details" bullets — the measured detail this page used to
  // leave behind on the measurement. Same row, wider projection: no extra query.
  let roofQuote: MultiRoofQuote | null = null
  if (isRoofing) {
    const { data: linkedRoof } = await supabase
      .from('roofing_measurements')
      .select('public_token, quote, included_indices, confirmed_structure')
      .eq('quote_share_token', token)
      .maybeSingle()
    if (linkedRoof?.public_token) {
      roofHeroMapPath = `/api/roofing/q/${linkedRoof.public_token}/static-map?b=1`
    }
    if (linkedRoof) {
      // Narrowed to the included structures — the same selection the roofing
      // PDF prices, so the bullets can't describe a shed nobody is paying for.
      roofQuote = resolveRoofRenderSelection(
        linkedRoof as Parameters<typeof resolveRoofRenderSelection>[0],
      ).quote
    }
  }

  // Commercial painting: the tender's measured takeoff (intake.scope
  // summary + the per-surface line items wrapped into the tender tier),
  // plus a link to the rich /q/commercial-paint page when the saved_quote
  // backlink resolves one. This quotes row keeps the deposit checkout, so
  // it enriches in place instead of redirecting like solar.
  const isCommercialPaint = tradeFormat.key === 'commercial-painting'
  const commPaintScope = isCommercialPaint ? commercialPaintScope(intake?.scope) : null
  const commPaintLines = isCommercialPaint ? tenderLineItems(quote.better) : []
  const commPaintTenderUrl = isCommercialPaint
    ? await resolveCommercialPaintTenderPath(supabase, quote.id as string)
    : null
  // WP1 — the licence number + GST status shown to the customer must be
  // THIS quote's tradie, never "whichever pricing_book row Postgres returns
  // first for the trade". Showing another tradie's licence on a quote is a
  // compliance problem, not just a cosmetic one. Scope by the quote's
  // tenant_id when we have it; only legacy pre-v6 quotes (tenant_id null,
  // single-pilot era, one book per trade) fall back to a deterministic
  // trade-only lookup.
  const quoteTenantId = (quote as { tenant_id?: string | null }).tenant_id ?? null
  let pricingBookQuery = supabase
    .from('pricing_book')
    .select('licence_type, licence_number, licence_state, gst_registered, quote_display, quote_tier_mode')
    .eq('trade', intakeTrade)
  pricingBookQuery = quoteTenantId
    ? pricingBookQuery.eq('tenant_id', quoteTenantId)
    : pricingBookQuery.order('id', { ascending: true }).limit(1)
  const { data: pricingBook } = await pricingBookQuery.maybeSingle()

  // ─── Tradie identity (letterhead) ───────────────────────────────
  // Scope strictly by the quote's tenant_id (same compliance reasoning as the
  // licence lookup) so a customer never sees another tradie's branding. Two
  // selects: the base identity columns (always present) + a best-effort select
  // for the migration-141 columns so a pre-141 deploy degrades to null rather
  // than 500-ing this public page.
  let tenantIdentity: TenantIdentity | null = null
  if (quoteTenantId) {
    const { data: base } = await supabase
      .from('tenants')
      .select('business_name, owner_first_name, owner_last_name, owner_mobile, owner_email, state')
      .eq('id', quoteTenantId)
      .maybeSingle()
    if (base) {
      const b = base as Record<string, string | null>
      const { data: ex } = await supabase
        .from('tenants')
        .select('contact_name, website_url, business_address, logo_url, intro_video_url, thankyou_video_url')
        .eq('id', quoteTenantId)
        .maybeSingle()
      const e = (ex ?? {}) as Record<string, string | null>
      // Own best-effort select (mig 180): a pre-180 deploy loses only the
      // photo — the letterhead columns above keep loading.
      const { data: ph } = await supabase
        .from('tenants')
        .select('photo_url')
        .eq('id', quoteTenantId)
        .maybeSingle()
      // Same pattern again (mig 178/179): the trust-video script — what the
      // welcome video actually says — is what its captions are built from, and
      // trade_videos is where the dashboard Videos tab stores the clip itself.
      const { data: tvs } = await supabase
        .from('tenants')
        .select('trust_video_state, trade_videos')
        .eq('id', quoteTenantId)
        .maybeSingle()
      tenantIdentity = {
        business_name: b.business_name ?? null,
        owner_first_name: b.owner_first_name ?? null,
        owner_last_name: b.owner_last_name ?? null,
        owner_mobile: b.owner_mobile ?? null,
        owner_email: b.owner_email ?? null,
        state: b.state ?? null,
        contact_name: e.contact_name ?? null,
        website_url: e.website_url ?? null,
        business_address: e.business_address ?? null,
        logo_url: e.logo_url ?? null,
        photo_url: ((ph ?? {}) as { photo_url?: string | null }).photo_url ?? null,
        intro_video_url: e.intro_video_url ?? null,
        thankyou_video_url: e.thankyou_video_url ?? null,
        trust_video_state:
          ((tvs ?? {}) as { trust_video_state?: TrustVideoState | null }).trust_video_state ?? null,
        trade_videos:
          ((tvs ?? {}) as { trade_videos?: TradeVideoMap | null }).trade_videos ?? null,
      }
    }
  }

  // Phase A: tenant-level itemised-vs-summary preference. Phase B will add
  // a per-quote override on quotes.display_mode; the resolver already
  // accepts that arg so we just have to start passing it through later.
  const quoteDisplayMode: QuoteDisplayMode = resolveQuoteDisplayMode({
    perQuoteOverride: (quote as { display_mode?: string | null }).display_mode ?? null,
    tenantPreference: (pricingBook as { quote_display?: string | null } | null)?.quote_display ?? null,
  })

  // Photo rendering — STRICT per-quote scoping.
  //
  // Only render photos snapshotted onto intakes.photo_paths at intake/structure
  // time. We deliberately DO NOT pull from the live calls.photo_paths or
  // sms_conversations.photo_paths at render time, because:
  //
  //   1. The live source rows can be reused across multiple quotes for the
  //      same customer (4h open window, 5min done-grace). If we read live,
  //      photos from one quote bleed into another.
  //   2. The intake snapshot is the canonical "what was uploaded for THIS
  //      quote" record — it's what Opus vision already saw when drafting,
  //      and what the customer agreed was attached when the quote was sent.
  //
  // Trade-off: late uploads (after intake/structure has run) won't appear
  // on the quote page. That's the right call — if the customer wants those
  // photos to influence the quote, they should send a fresh request and
  // re-upload during the new dialog. Strict per-quote scoping over live
  // updates.
  const photoPaths = Array.isArray(intake?.photo_paths)
    ? (intake.photo_paths as string[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
    : []

  // ─── photo_request_token + live photo-paths fallback ────────────────
  //
  // The intake snapshot above is the canonical "what was attached at
  // structure time" record. For the new in-page Step 02 upload widget
  // we ALSO need:
  //   1. The photo_request_token so the client component can POST to
  //      /api/upload/<token> (same endpoint the SMS link hits).
  //   2. A fallback to live calls/sms_conversations.photo_paths so
  //      that photos uploaded AFTER intake/structure (via the new
  //      in-page widget OR a late SMS-link click) still render on the
  //      next page refresh — without needing the upload route to also
  //      mutate the intake snapshot.
  //
  // The "strict per-quote scoping" concern from the original comment
  // only matters when intake.photo_paths is non-empty; when it's empty
  // we know the customer hasn't attached anything yet, so falling back
  // to live can't bleed photos from another quote.
  // SMS intakes always have intakes.call_id = null — the link from intake
  // to its sms_conversation is the reverse direction: sms_conversations.intake_id.
  // Voice intakes use intakes.call_id pointing at the calls row. Resolve both.
  // SMS intakes always have intakes.call_id = null — the link from intake
  // to its sms_conversation is the reverse direction: sms_conversations.intake_id.
  // Voice intakes use intakes.call_id pointing at the calls row. Resolve both.
  type ConvoRow = { photo_request_token: string | null; photo_paths: string[] | null }
  let uploadToken: string | null = null
  let liveSignedUrls: string[] = []
  const callId = (intake?.call_id ?? null) as string | null
  let convoRow: ConvoRow | null = null

  if (callId) {
    const { data: call } = await supabase
      .from('calls')
      .select('photo_request_token, photo_paths')
      .eq('id', callId)
      .maybeSingle()
    if (call) {
      uploadToken = (call.photo_request_token as string | null) ?? null
      if (photoPaths.length === 0) {
        const livePaths = Array.isArray(call.photo_paths)
          ? (call.photo_paths as string[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
          : []
        liveSignedUrls = livePaths.length === 0 ? [] : (
          await Promise.all(livePaths.map(p => refreshSignedUrl(p).catch(() => null)))
        ).filter((u): u is string => !!u)
      }
    } else {
      const { data: convo } = await supabase
        .from('sms_conversations')
        .select('photo_request_token, photo_paths')
        .eq('id', callId)
        .maybeSingle()
      convoRow = (convo as unknown as ConvoRow | null) ?? null
    }
  } else if (intake?.id) {
    const { data: convo } = await supabase
      .from('sms_conversations')
      .select('photo_request_token, photo_paths')
      .eq('intake_id', intake.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    convoRow = (convo as unknown as ConvoRow | null) ?? null
  }

  if (convoRow) {
    uploadToken = convoRow.photo_request_token ?? null
    if (photoPaths.length === 0) {
      const livePaths = Array.isArray(convoRow.photo_paths)
        ? convoRow.photo_paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      liveSignedUrls = livePaths.length === 0 ? [] : (
        await Promise.all(livePaths.map(p => refreshSignedUrl(p).catch(() => null)))
      ).filter((u): u is string => !!u)
    }
  }

  const customerPhotoUrls: string[] = photoPaths.length === 0
    ? liveSignedUrls
    : (
        await Promise.all(photoPaths.map(p => refreshSignedUrl(p).catch(() => null)))
      ).filter((u): u is string => !!u)

  // ─── AI preview + sample-gallery state for this render + Trigger 2 ───
  const previewStatus = (quote.preview_status as
    'idle' | 'no_photos' | 'generating' | 'ready' | 'partial' | 'failed' | null) ?? 'idle'
  // Prefer the new plural column. Fall back to the legacy singular for
  // quotes generated before migration 011 landed (multi-photo previews).
  const rawPreviewPaths: string[] =
    Array.isArray(quote.preview_image_paths) && quote.preview_image_paths.length > 0
      ? (quote.preview_image_paths as string[])
      : (quote.preview_image_path ? [quote.preview_image_path as string] : [])
  let previewImageUrls: string[] = []
  if ((previewStatus === 'ready' || previewStatus === 'partial') && rawPreviewPaths.length > 0) {
    previewImageUrls = (await Promise.all(rawPreviewPaths.map(p => refreshSignedUrl(p).catch(() => null))))
      .filter((u): u is string => !!u)
  }

  const samplesStatus = (quote.samples_status as
    'idle' | 'generating' | 'ready' | 'partial' | 'failed' | null) ?? 'idle'
  const samplePaths = (Array.isArray(quote.sample_image_paths) ? quote.sample_image_paths : []) as string[]
  const sampleImageUrls: string[] = (samplesStatus === 'ready' || samplesStatus === 'partial')
    ? (await Promise.all(samplePaths.map(p => refreshSignedUrl(p).catch(() => null))))
        .filter((u): u is string => !!u)
    : []

  // Inspection-required quotes still get preview + samples — the customer
  // uploaded photos of the site, so visualising the proposed work is just
  // as useful before the on-site visit as it is for an auto-priced quote.
  //
  // Install-visualisation (photo upload prompt + "AI preview · your room" +
  // room sample images) is electrical/plumbing framing. Bespoke trades
  // (roofing / commercial painting / …) are measured deterministically from
  // satellite or plan documents — the room-install visuals are wrong there,
  // so both the sections AND the Gemini generation triggers are gated off.
  const showInstallVisuals = tradeFormat.usesGenericCard
  const needsPreview = showInstallVisuals && previewStatus === 'idle' && photoPaths.length > 0
  const needsSamples = showInstallVisuals && samplesStatus === 'idle'
  if (needsPreview || needsSamples) {
    after(async () => {
      try {
        await Promise.all([
          needsPreview ? generatePreviewImage(quote.id as string) : Promise.resolve(),
          needsSamples ? generateSampleImages(quote.id as string) : Promise.resolve(),
        ])
      } catch (e: any) {
        console.error('[preview] page-load trigger 2 threw', { quoteId: quote.id, error: e?.message ?? String(e) })
      }
    })
  }

  // WP7 — record that the customer opened their quote. This is the
  // 'viewed' lifecycle event the follow-up queue uses to tell "sent but
  // never looked at" apart from "looked but didn't pay". Runs in
  // after() so it never delays the render, and advanceQuoteStatus is
  // monotonic + non-throwing: it no-ops once the quote is already
  // viewed/paid/accepted and never rewrites the first-view timestamp,
  // so repeated opens (and the rare tradie self-open) can't corrupt the
  // signal or downgrade a converted quote.
  after(async () => {
    await advanceQuoteStatus(supabase, quote.id as string, 'viewed')
  })

  const firstName = (intake?.caller?.name ?? '').toString().split(' ')[0] || 'there'
  // JOB_TYPE_LABEL covers electrical/plumbing job types; bespoke trades fall
  // back to their trade label ("your roofing quote", "your commercial
  // painting quote") instead of the anonymous "your job quote".
  const jobLabel =
    JOB_TYPE_LABEL[intake?.job_type ?? ''] ??
    (tradeFormat.usesGenericCard ? 'job' : tradeFormat.label.toLowerCase())
  const itemCount: number | undefined = intake?.scope?.item_count

  const stripeLinks: StripeLinks = (quote.stripe_links as StripeLinks) ?? {}
  const isInspection = !!quote.needs_inspection
  // Roofing inspection quotes keep REAL computed tiers in good/better/best
  // (the deterministic roofing engine prices from the satellite measurement,
  // then flags the job for an on-site visit). So instead of hiding all prices
  // behind the $99-only InspectionBlock — which read as a blank/$0 quote — we
  // show those tiers as an INDICATIVE estimate, with the $99 booking CTA. This
  // is scoped to roofing only; every other trade's inspection quote has null
  // tiers and keeps the InspectionBlock. The guard requires at least one tier
  // with a real dollar value so a genuinely unpriceable roof (e.g. asbestos →
  // $0 tiers) still falls back to the InspectionBlock, never a $0 quote.
  const roofTierValue = (t: unknown): number => {
    const v = (t as { total_inc_gst?: number } | null)?.total_inc_gst
    return typeof v === 'number' ? v : 0
  }
  const roofingTierHasValue =
    isRoofing && [quote.good, quote.better, quote.best].some((t) => roofTierValue(t) > 0)
  const roofingIndicative = isInspection && roofingTierHasValue
  // In indicative mode, hide any $0 tier (e.g. asbestos has no patch/re-roof
  // price, only an upgrade price) so the customer never sees a "$0" option.
  const roofTierIfPositive = (t: unknown): Tier =>
    !roofingIndicative || roofTierValue(t) > 0 ? (t as Tier) : null
  const isPaid = !!quote.paid_at
  const quoteRef = quote.id.slice(0, 8).toUpperCase()
  const issuedDate = quote.created_at
    ? new Date(quote.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  // P2 — honour the per-quote deposit % (quotes.deposit_pct, DB default 30).
  // This page previously HARDCODED 30 while /r/<token>/<tier> charged the
  // stored value — a tenant on 20% saw 30% advertised and was charged 20%.
  const depositPct = isInspection
    ? null
    : clampDepositPct((quote as { deposit_pct?: number | string | null }).deposit_pct)
  // P1 — every price on this page honours gst_registered exactly like the
  // stored total_inc_gst (a legacy tenant-less quote defaults to registered).
  const gstRegistered = pricingBook ? !!pricingBook.gst_registered : true

  // WP6 — price-hold / urgency. Use the persisted price_hold_until when
  // present (migration 026); otherwise derive it from created_at so the
  // countdown works on every quote even before the column is populated.
  // The banner only shows pre-deposit on auto-priced quotes — once the
  // customer has paid, urgency is moot and the paid chip takes over.
  const effectiveHoldUntil =
    ((quote as { price_hold_until?: string | null }).price_hold_until ?? null) ??
    computePriceHoldUntil(quote.created_at as string | null)
  const hold = priceHoldStatus(effectiveHoldUntil)
  const showHoldBanner = !isPaid && !isInspection && hold.state !== 'none'
  // Price hold lapsed → suppress the "Lock in" CTA so a customer can't book /
  // pay against a stale price. The banner above already tells them to reply
  // for a refreshed quote. N/A to inspection ($99 fee, no hold) or once paid.
  const priceExpired = !isPaid && !isInspection && hold.state === 'expired'

  // v8 — early-booking discount. `ebApplied` once the customer booked
  // in time → tier prices render discounted. Otherwise, while the offer
  // is still live and unpaid, advertise the countdown so they book now.
  const ebStatus = earlyBirdStatus(ebDiscountPct, ebExpiresAt)
  const ebApplied = ebAppliedPct > 0
  const showEarlyBirdOffer =
    !isPaid && !isInspection && !ebApplied && ebStatus.state === 'live'

  // Mig 142 — resolve which tier(s) the customer sees for THIS feature's mode.
  // Presentation-only: the full good/better/best stays persisted for the tradie
  // (the TradieEditor overlay below still gets all three). selected_tier drives
  // the 'single' mode; an inspection quote has no priced tiers so this is [].
  const tierMode = asQuoteTierMode(
    (pricingBook as { quote_tier_mode?: string | null } | null)?.quote_tier_mode,
  )
  const visibleTierKeys = resolveVisibleTiers({
    mode: tierMode,
    present: { good: !!quote.good, better: !!quote.better, best: !!quote.best },
    selectedTier: (quote.selected_tier as string | null) ?? null,
  })
  const visibleTierSet = new Set<'good' | 'better' | 'best'>(visibleTierKeys)
  const tierCount = visibleTierKeys.length
  // When only one option is shown it IS the offer — no "recommended" badge.
  const showRecommendedBadge = visibleTierKeys.length > 1

  // ─── Presentation-only helpers for the reskinned sheet ──────────────
  // Everything below reuses the pricing computations already established
  // above (lib/quote/money displayIncGst / displayDeposit, the /r/<token>/<key>
  // link, visibleTierSet, priceExpired, isPaid/paid_tier). No new pricing.
  const ebApp = ebApplied ? ebAppliedPct : 0
  // P4 — ONE discount order for every renderer on this page (lib/quote/money):
  // discount the ex-GST base, then GST, rounded once. Previously this path
  // rounded to inc-GST dollars FIRST then discounted while TradeTiers did the
  // opposite — same quote, two components, off-by-a-dollar results.
  const tierIncGst = (t: Tier): number =>
    displayIncGst((t as { subtotal_ex_gst?: number | string })?.subtotal_ex_gst ?? 0, {
      discountPct: ebApp,
      gstRegistered,
    })
  const tierDeposit = (t: Tier): number | null =>
    displayDeposit(
      (t as { subtotal_ex_gst?: number | string })?.subtotal_ex_gst ?? 0,
      depositPct,
      { discountPct: ebApp, gstRegistered },
    )
  const cleanTierLabel = (label: string | undefined): string =>
    (label ?? '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()

  // Featured tier for the sticky bar — the tradie-selected tier if it's
  // visible, else the middle ('better') if visible, else the first visible.
  const featuredKey: 'good' | 'better' | 'best' | null =
    (visibleTierSet.has((quote.selected_tier as 'good' | 'better' | 'best') ?? 'better')
      ? ((quote.selected_tier as 'good' | 'better' | 'best' | null) ?? null)
      : null) ??
    (visibleTierSet.has('better') ? 'better' : (visibleTierKeys[0] ?? null))

  // Build the sticky deposit bar. Mirrors the tier-card CTA gating exactly:
  //   paid            → "Deposit paid"
  //   inspection      → $99 site-visit CTA (unless roofing-indicative, which
  //                     keeps real tiers + its own $99 banner in-sheet)
  //   otherwise       → featured visible tier's inc-GST price + deposit CTA
  //                     (href suppressed when the price hold has lapsed or no
  //                     Stripe link exists).
  let stickyBar: StickyBar | null = null
  if (isPaid) {
    stickyBar = {
      paid: true,
      paidSub: quote.paid_tier
        ? `${cleanTierLabel(String(quote.paid_tier)) || String(quote.paid_tier).toUpperCase()} option · your tradie will be in touch`
        : 'Your tradie will be in touch',
    }
  } else if (isInspection && (isRoofing || !roofingIndicative)) {
    // Every inspection quote's sticky action is the $99 site visit. Roofing
    // indicative quotes previously fell through to a per-tier deposit CTA the
    // in-sheet cards deliberately withheld (spec five-sections R6) — the $99
    // is the one thing this page sells.
    stickyBar = {
      tierLabel: `$${INSPECTION_FEE_AUD} site visit · refundable`,
      priceText: `$${INSPECTION_FEE_AUD}`,
      ctaLabel: `Pay $${INSPECTION_FEE_AUD}`,
      // /r/<token>/inspection mints a fresh $99 Session per click — no stored
      // stripe_links.inspection needed (roofing/commercial save routes never
      // wrote one). Always link so the CTA is never dead.
      ctaHref: `/r/${token}/inspection`,
    }
  } else if (featuredKey) {
    const fTier = quote[featuredKey] as Tier
    if (fTier) {
      const fInc = tierIncGst(fTier)
      const fDep = tierDeposit(fTier)
      // /r mints a fresh Session from good/better/best per click, so the CTA
      // no longer depends on a pre-stored stripe_links[tier] (which roofing /
      // commercial never wrote). Gate only on price-hold expiry.
      const hasLink = !priceExpired
      stickyBar = {
        tierLabel: `${cleanTierLabel(fTier.label) || featuredKey.toUpperCase()} option${
          depositPct ? ` · ${depositPct}% deposit` : ''
        }`,
        priceText: `$${fmt(fInc)}`,
        ctaLabel: fDep ? `Pay $${fmt(fDep)} deposit` : 'Pay deposit',
        ctaHref: hasLink ? `/r/${token}/${featuredKey}` : null,
      }
    }
  }

  // ── Explicit "Accept quote & confirm site visit" block (Gap #1/#3). The
  // accept block is the single primary accept-and-proceed action for a PRICED
  // quote (deposit path) and the paid confirmation. Inspection/held quotes are
  // owned by the InspectionBlock / RoofingIndicativeBanner $99 CTA above, so
  // the block is rendered only when !isInspection.
  const acceptFeaturedTier = featuredKey ? (quote[featuredKey] as Tier) : null
  const acceptInc = acceptFeaturedTier ? tierIncGst(acceptFeaturedTier) : 0
  const acceptDep = acceptFeaturedTier ? tierDeposit(acceptFeaturedTier) : null
  const acceptView = resolveAcceptView({
    token,
    tier: (featuredKey ?? 'better') as 'good' | 'better' | 'best',
    isPaid,
    pricesVisible: !isInspection,
    priceExpired,
    priceLabel: acceptFeaturedTier ? `$${fmt(acceptInc)} inc GST` : null,
    depositLabel: acceptDep ? `${depositPct ?? 30}% deposit ($${fmt(acceptDep)})` : null,
  })

  // NOTE: the electrical/plumbing tier cards used to be built here for the
  // long-scroll layout below. Those trades now return the five-section view
  // above, so that mapping was unreachable — and it built React elements per
  // line item on every request to throw them away. Removed rather than left
  // to look live: the five-section "Your price" section (which honours the
  // same tier visibility, discount, deposit and price-hold gating) is the one
  // place electrical/plumbing prices are rendered.

  // Stat grid — up to 4 truthful cells from data that actually exists.
  const statItems: Stat[] = []
  if (itemCount && itemCount > 0) {
    statItems.push({ k: 'The job', v: String(itemCount), sub: jobLabel })
  }
  if (quote.estimated_timeframe) {
    statItems.push({ k: 'Timeframe', v: quote.estimated_timeframe as string })
  }
  if (!isInspection && depositPct) {
    statItems.push({ k: 'Deposit', v: `${depositPct}%`, sub: 'to book' })
  }
  if (pricingBook?.gst_registered) {
    statItems.push({ k: 'GST', v: 'Incl.', sub: 'all prices' })
  } else if (isInspection) {
    statItems.push({ k: 'Site visit', v: '$99', sub: 'refundable' })
  }

  // Credential footer rows — only render rows whose data genuinely exists.
  const footerRows: FooterRow[] = []
  if (tenantIdentity?.business_name) {
    footerRows.push({ k: 'Contractor', v: tenantIdentity.business_name })
  }
  if (pricingBook?.licence_type && pricingBook?.licence_state) {
    footerRows.push({
      k: 'Licence',
      v: `${pricingBook.licence_type} (${pricingBook.licence_state})${
        pricingBook.licence_number ? ` · ${pricingBook.licence_number}` : ''
      }`,
    })
  }
  if (pricingBook?.gst_registered) {
    footerRows.push({ k: 'GST', v: 'Registered · all prices include 10% GST' })
  }
  footerRows.push({ k: 'Quote ref', v: quoteRef })
  footerRows.push({
    k: 'Terms',
    v: 'Draft prepared via QuoteMax. Final scope confirmed by your tradie before work commences. Australian Consumer Law applies.',
  })

  // Letterhead credential line (licence) + phone href.
  const letterheadCredential =
    pricingBook?.licence_type && pricingBook?.licence_state
      ? `${pricingBook.licence_type} ${pricingBook.licence_state}${
          pricingBook.licence_number ? ` · ${pricingBook.licence_number}` : ''
        }`
      : null
  const ownerPhone = (tenantIdentity?.owner_mobile ?? '').trim()
  const letterheadPhoneHref = ownerPhone ? `tel:${ownerPhone.replace(/\s+/g, '')}` : null
  // Reference-quote letterhead contact strip: Contact / Phone / Email. Contact
  // name = contact_name, else owner full name, else owner first name.
  const letterheadContactName =
    (tenantIdentity?.contact_name?.trim() || '') ||
    [tenantIdentity?.owner_first_name, tenantIdentity?.owner_last_name]
      .filter(Boolean).join(' ').trim() ||
    (tenantIdentity?.owner_first_name ?? '') ||
    null
  const letterheadEmail = (tenantIdentity?.owner_email ?? '').trim() || null

  // Hero photo — first customer photo, else first AI preview, else none.
  const heroPhotoSrc = customerPhotoUrls[0] ?? previewImageUrls[0] ?? null

  // Hero headline (component uppercases them): the warm "G'day {name}," /
  // "your {job} quote" style from the reference quote surface. jobLabel is the
  // trade-specific label ("downlights", "commercial painting", …); firstName
  // falls back to "there" when the caller name is unknown.
  const heroLine1 = `G'day ${firstName},`
  const heroLine2 = `your ${jobLabel} quote`
  const heroStatus: { label: string; tone: 'await' | 'booked' } = isPaid
    ? { label: 'Deposit paid', tone: 'booked' }
    : isInspection
      ? { label: 'Site visit', tone: 'await' }
      : { label: 'Awaiting you', tone: 'await' }
  const heroGreeting = isInspection
    ? `This job needs a quick on-site visit before a real price can be locked in. The visit is $99, refundable and credited toward your final quote.`
    : tierCount === 1
      ? `One option below. Price includes 10% GST. Tap to lock it in with a ${depositPct ?? 30}% deposit.`
      : `${tierCount === 2 ? 'Two' : 'Three'} options below. All prices include 10% GST. Tap any tier to lock it in with a ${depositPct ?? 30}% deposit.`

  // ═══ Five-section roofing layout (spec customer-quote-five-sections) ═══
  //
  // The page sells ONE thing for roofing: pay $99 and the tradie validates
  // this quote in person. Overview → Job details → Trust → Price → CTA,
  // rendered as the signature numbered cards. One option only (tier mode
  // 'single' resolves selected_tier = better = "Full roof replacement").
  // Electrical/plumbing keep the generic layout below — restructuring their
  // live AI-preview/photo-upload surfaces was ruled out of scope.
  if (isRoofing) {
    const roofTier = featuredKey ? (quote[featuredKey] as Tier) : null
    // P10 — roofing tiers carry a GST-aware stored total_inc_gst (the roofing
    // pricer honours gst_registered); prefer it over recomputing ×1.1. But a
    // realised early-booking discount must not be skipped by the stored path
    // (price and deposit would disagree) — discounted quotes go through the
    // money module. Unreachable today (roofing never stamps an offer), kept
    // as a guard in case early-bird ever extends to roofing.
    const storedInc = (roofTier as { total_inc_gst?: number } | null)?.total_inc_gst
    const roofPriceInc =
      ebApp === 0 && typeof storedInc === 'number' && storedInc > 0
        ? Math.round(storedInc)
        : roofTier
          ? tierIncGst(roofTier)
          : 0
    const roofTierLabel = tierLabelsForTrade('roofing')[featuredKey ?? 'better']
    const roofDeposit = !isInspection && roofTier ? tierDeposit(roofTier) : null
    const jobSentence = jobDetailsSentence(scopeShort, quote.scope_of_works as string | null)
    const websiteUrl = safeWebsiteUrl(tenantIdentity?.website_url)
    const tradieName = tenantIdentity?.business_name ?? 'Your roofer'
    // Section 03 identity — the same resolver the quote PDF uses, so the photo
    // and the sentence are identical on both surfaces (mig 180).
    const roofTradie = tradieProfile({
      businessName: tradieName,
      photoUrl: tenantIdentity?.photo_url,
      trade: 'roofing',
    })

    const microNote: React.CSSProperties = {
      fontFamily: 'var(--font-mono)',
      fontSize: 9.5,
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
      color: 'var(--text-dim)',
    }

    // Video + the script it speaks, resolved together so the captions can
    // never belong to a different film than the one playing. intakeTrade is
    // required for the dashboard-generated clip to resolve at all — see the
    // note at app/q/roof/[token]/page.tsx.
    const welcomeVideo = trustVideoTrack(tenantIdentity, 'welcome', intakeTrade)

    const roofSections: ScopeItem[] = [
      {
        title: 'Overview',
        body:
          (quote.scope_of_works as string | null) ??
          'Your roofing quote, measured from satellite imagery of your property.',
      },
      {
        title: 'Job details',
        body: jobSentence ?? 'Scope confirmed with you before any work is booked.',
        // Empty for a quote with no linked measurement → today's sentence only.
        list: jobDetailBullets(roofQuote, featuredKey),
      },
      {
        title: 'Your tradie',
        body: (
          <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
            <div className="qm-print-hide">
              <TrustVideo
                src={welcomeVideo.url}
                script={welcomeVideo.script}
                title={tradieName}
                caption="A short introduction from your tradie"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <TradiePhoto src={roofTradie.photoSrc} alt={roofTradie.name} />
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-sec)' }}>
                {roofTradie.blurb}
                {websiteUrl ? (
                  <>
                    {' '}
                    <a href={websiteUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                      Visit their website
                    </a>
                    .
                  </>
                ) : null}
              </p>
            </div>
          </div>
        ),
      },
      {
        title: 'Your price',
        body: (
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 800,
                fontSize: 24,
                lineHeight: 1,
                color: 'var(--text-pri)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {roofPriceInc > 0 ? `$${fmt(roofPriceInc)}` : 'Confirmed on site'}
            </div>
            <div style={{ marginTop: 6, ...microNote }}>
              {roofPriceInc > 0
                ? `${roofTierLabel} · inc GST${isInspection ? ' · indicative' : ''}`
                : 'Priced after your site visit'}
            </div>
            {isInspection && roofPriceInc > 0 ? (
              <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-dim)', maxWidth: '52ch' }}>
                Estimated from your satellite measurement. The final price is confirmed at your site visit.
              </p>
            ) : null}
          </div>
        ),
      },
      {
        title: isInspection ? 'Book your site inspection' : 'Lock it in',
        body: (
          <div style={{ display: 'grid', gap: 10, maxWidth: 380 }}>
            {isPaid ? (
              <div
                style={{
                  border: '1px solid color-mix(in srgb, var(--success-bright) 40%, transparent)',
                  padding: '13px 16px',
                  textAlign: 'center',
                  ...microNote,
                  color: 'var(--success-bright)',
                }}
              >
                {isInspection ? 'Site visit paid · pick your time from the link we sent' : 'Deposit paid'}
              </div>
            ) : isInspection ? (
              <>
                <a
                  href={`/r/${token}/inspection`}
                  className="qm-cta"
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    border: '1px solid transparent',
                    background: 'var(--accent)',
                    color: 'var(--accent-ink)',
                    padding: '13px 16px',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 700,
                    fontSize: 13,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    textDecoration: 'none',
                  }}
                >
                  Book a site inspection · ${INSPECTION_FEE_AUD}
                </a>
                <span style={microNote}>Refundable · credited toward your final quote</span>
              </>
            ) : (
              <a
                href={`/r/${token}/${featuredKey ?? 'better'}`}
                className="qm-cta"
                style={{
                  display: 'block',
                  textAlign: 'center',
                  border: '1px solid transparent',
                  background: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  padding: '13px 16px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 700,
                  fontSize: 13,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  textDecoration: 'none',
                }}
              >
                {roofDeposit ? `Pay $${fmt(roofDeposit)} deposit` : 'Pay deposit'}
              </a>
            )}
          </div>
        ),
      },
    ]

    return (
      <QuoteChrome
        trade={{ label: tradeFormat.label, icon: tradeIcon(intakeTrade) }}
        sticky={stickyBar}
      >
        <TradieEditor
          quoteId={quote.id as string}
          gstRegistered={gstRegistered}
          initialTiers={{
            good: (quote.good as Parameters<typeof TradieEditor>[0]['initialTiers']['good']) ?? null,
            better: (quote.better as Parameters<typeof TradieEditor>[0]['initialTiers']['better']) ?? null,
            best: (quote.best as Parameters<typeof TradieEditor>[0]['initialTiers']['best']) ?? null,
          }}
        />
        <QuoteSheet label={`Quote ${quoteRef}`}>
          {tenantIdentity?.business_name ? (
            <Letterhead
              name={tenantIdentity.business_name}
              credential={letterheadCredential}
              phoneHref={letterheadPhoneHref}
              logoUrl={tenantIdentity.logo_url}
              contactName={letterheadContactName}
              phone={ownerPhone || null}
              email={letterheadEmail}
            />
          ) : null}
          <Scope eyebrow={`Quote ${quoteRef}`} items={roofSections} />
          <CredentialFooter
            rows={footerRows}
            tagline="Book the visit · We confirm on site · Licensed & insured"
          />
        </QuoteSheet>
      </QuoteChrome>
    )
  }

  // ═══ Five-section electrical / plumbing customer view ════════════════
  //
  // Brings the generic-card trades onto the SAME numbered five-section format
  // roofing already uses, so the customer view reads the same on every trade:
  //
  //   01 Overview       the job in a sentence, then the three visual blocks
  //                     that used to be numbered cards 02/03/04 of their own
  //                     (Photos for your quote · AI preview · your room ·
  //                     Expected sample images) as SUB-blocks
  //   02 Job details    what's being done, the materials quoted from the
  //                     catalogue, the tools, the step-by-step process, plus
  //                     the risk flags and assumptions that used to sit in
  //                     their own sections near the page footer
  //   03 Your tradie    the dashboard-selected trust video + the tradie
  //   04 Your price     every visible tier, each with a breakdown whose rows
  //                     SUM to its inc-GST total (lib/quote/line-allocation)
  //   05 Your site visit  booked slot + calendar, or the pay-and-book CTA
  //
  // Nothing about pricing, gating, Stripe links, the sticky bar, the tradie
  // editor or the acceptance record changes — this is presentation. The
  // non-generic trades (aircon, signage, commercial painting) keep the
  // long-scroll layout below because their evidence blocks differ.
  if (tradeFormat.usesGenericCard) {
    // Booked-visit state. SEPARATE best-effort select, matching the early-bird /
    // acceptance / scope_short blocks above: these columns post-date the
    // original page, and a pre-migration read must degrade to "not booked"
    // rather than 404 a live public quote.
    let scheduledAt: string | null = null
    let scheduledWindow: string | null = null
    {
      const { data: sch } = await supabase
        .from('quotes')
        .select('scheduled_at, scheduled_window')
        .eq('id', quote.id)
        .maybeSingle()
      if (sch) {
        scheduledAt = (sch.scheduled_at as string | null) ?? null
        scheduledWindow = (sch.scheduled_window as string | null) ?? null
      }
    }

    const featuredTier = featuredKey ? (quote[featuredKey] as Tier) : null
    const featuredLines = Array.isArray(featuredTier?.line_items) ? featuredTier!.line_items! : []

    // The materials behind the quote. Every field comes off the persisted line
    // items (which already carry the estimator's typed row refs + the WP4
    // catalogue link) enriched against the catalogue — no price is recomputed
    // here, and an un-enrichable line still renders from the line itself.
    const materials: QuoteMaterial[] = await loadQuoteMaterials(supabase, {
      lines: featuredLines,
      tenantId: quoteTenantId,
      trade: intakeTrade,
    })
    const hours = labourHours(featuredLines)
    const method = jobMethod(intakeTrade, intake?.job_type as string | null)

    const websiteUrl = safeWebsiteUrl(tenantIdentity?.website_url)
    const tradieName = tenantIdentity?.business_name ?? 'Your tradie'
    const tradie = tradieProfile({
      businessName: tradieName,
      photoUrl: tenantIdentity?.photo_url,
      trade: intakeTrade,
    })
    // The dashboard Videos tab stores its clip per trade — passing intakeTrade
    // is what makes the tradie's own film resolve instead of the stock default.
    const welcomeVideo = trustVideoTrack(tenantIdentity, 'welcome', intakeTrade)

    const tz = tzForState(tenantIdentity?.state ?? null)
    const slotLabel = scheduledAt ? formatVisitSlot(scheduledAt, scheduledWindow, tz) : ''
    const placeLabel =
      [intake?.address, intake?.suburb].filter(Boolean).join(', ').trim() || null
    const calLinks =
      isPaid && scheduledAt
        ? (() => {
            const { start, end } = resolveEventWindow(scheduledAt, scheduledWindow)
            return buildCalendarLinks({
              title: `${jobLabel} — ${tradieName}`,
              startIso: start.toISOString(),
              endIso: end.toISOString(),
              details: `Your ${jobLabel} visit with ${tradieName}.`,
              location: placeLabel ?? undefined,
              timeZone: tz,
            })
          })()
        : null

    const microNote: React.CSSProperties = {
      fontFamily: 'var(--font-mono)',
      fontSize: 9.5,
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
      color: 'var(--text-dim)',
    }
    const subHeading: React.CSSProperties = {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      color: 'var(--text-pri)',
      margin: 0,
    }
    const ctaStyle: React.CSSProperties = {
      display: 'block',
      textAlign: 'center',
      border: '1px solid transparent',
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      padding: '13px 16px',
      fontFamily: 'var(--font-sans)',
      fontWeight: 700,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      textDecoration: 'none',
    }
    // Scope's body cell sets white-space: pre-line for plain-text bodies. These
    // bodies are structured JSX, where pre-line turns every source-code newline
    // into rendered whitespace.
    const blockBody: React.CSSProperties = {
      display: 'grid',
      gap: 20,
      maxWidth: 560,
      whiteSpace: 'normal',
    }

    const sections: ScopeItem[] = [
      {
        title: 'Overview',
        // Overview ORIENTS; Job details carries the detail. Deliberately NOT
        // scope_of_works here: section 02 opens with that same paragraph, and
        // printing it in both put its first sentence on the page twice.
        body: (
          <div style={blockBody}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              G&apos;day {firstName}, here&apos;s your {jobLabel} quote
              {placeLabel ? ` for ${placeLabel}` : ''}
              {issuedDate ? `, issued ${issuedDate}` : ''}. {heroGreeting}
            </p>

            {/* The three blocks that were numbered sections 02/03/04. Each is
                the SAME component in `nested` mode — the upload flow and the
                preview polling are untouched, only their chrome differs. */}
            <CustomerPhotosBlock urls={customerPhotoUrls} uploadToken={uploadToken} nested />
            <PreviewSection
              shareToken={token}
              initialPreviewStatus={previewStatus}
              initialPreviewImageUrls={previewImageUrls}
              initialSamplesStatus={samplesStatus}
              initialSampleImageUrls={sampleImageUrls}
              nested
            />
          </div>
        ),
      },
      {
        title: 'Job details',
        body: (
          <div style={blockBody}>
            {/* The FULL scope paragraph lives here, not in Overview — this is
                the comprehensive section. jobDetailsSentence (the shared
                one-liner the PDF prints) is the fallback for a quote with no
                scope paragraph at all. */}
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
              {(quote.scope_of_works as string | null)?.trim() ||
                jobDetailsSentence(scopeShort, quote.scope_of_works as string | null) ||
                'Scope confirmed with you before any work is booked.'}
            </p>

            <MetricGrid
              cols={2}
              items={[
                ...(itemCount && itemCount > 0
                  ? [{ k: 'The job', v: String(itemCount), sub: jobLabel }]
                  : []),
                ...(quote.estimated_timeframe
                  ? [{ k: 'Timeframe', v: quote.estimated_timeframe as string }]
                  : []),
                ...(hours > 0
                  ? [{ k: 'On-site labour', v: `${hours}`, sub: hours === 1 ? 'hour' : 'hours' }]
                  : []),
                ...(materials.length > 0
                  ? [
                      {
                        k: 'Items supplied',
                        v: String(materials.length),
                        sub: materials.length === 1 ? 'line' : 'lines',
                      },
                    ]
                  : []),
              ]}
            />

            {/* Materials quoted from the catalogue — product name, the
                operator's own blurb and photo, specs, and the rate the quote
                used. Prices are ex-GST rate-card values passed through
                verbatim; the reconciling totals live in section 04. */}
            {materials.length > 0 ? (
              <div>
                <h4 style={subHeading}>Materials &amp; items quoted</h4>
                <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                  Exactly what your quote prices in, resolved from your tradie&apos;s catalogue.
                </p>
                <div style={{ marginTop: 12, display: 'grid', gap: 1, border: '1px solid var(--ink-line)', background: 'var(--ink-line)' }}>
                  {materials.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                        padding: '12px 14px',
                        background: 'var(--ink-card)',
                      }}
                    >
                      {m.imageSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.imageSrc}
                          alt={m.name}
                          loading="lazy"
                          style={{
                            width: 56,
                            height: 56,
                            flexShrink: 0,
                            objectFit: 'cover',
                            display: 'block',
                            border: '1px solid var(--ink-line)',
                            background: 'var(--ink-deep)',
                          }}
                        />
                      ) : null}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 13.5, lineHeight: 1.35, color: 'var(--text-pri)', fontWeight: 600 }}>
                            {m.name}
                          </span>
                          {m.customerSupplied ? (
                            <span
                              style={{
                                ...microNote,
                                fontSize: 8.5,
                                color: 'var(--accent)',
                                border: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
                                padding: '1px 5px',
                              }}
                              title="You're supplying this item — we install only."
                            >
                              You supply
                            </span>
                          ) : null}
                        </div>
                        {m.brand || m.range || m.supplier ? (
                          <div style={{ marginTop: 3, ...microNote, fontSize: 9 }}>
                            {[m.brand, m.range, m.supplier].filter(Boolean).join(' · ')}
                          </div>
                        ) : null}
                        {m.blurb ? (
                          <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                            {m.blurb}
                          </p>
                        ) : null}
                        {m.specs.length ? (
                          <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {m.specs.map(([label, value]) => (
                              <span
                                key={label}
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 10.5,
                                  border: '1px solid var(--ink-line)',
                                  background: 'var(--ink-deep)',
                                  padding: '3px 7px',
                                  color: 'var(--text-sec)',
                                }}
                              >
                                <span style={{ color: 'var(--text-dim)' }}>{label}: </span>
                                {value}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {m.safetyNote ? (
                          <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--text-dim)' }}>
                            {m.safetyNote}
                          </p>
                        ) : null}
                        {/* An assembly is priced per HOUR by this estimator, so
                            "2 × hr" would read as nonsense. Say "2 hr" and name
                            it supply & install — its dollars are not all
                            product, and the row must not imply they are. */}
                        <div style={{ marginTop: 7, ...microNote, fontSize: 9 }}>
                          {m.unit.toLowerCase() === 'hr'
                            ? `${m.quantity} hr`
                            : `${m.quantity} × ${m.unit}`}
                          {m.unitPriceExGst > 0 ? ` @ $${fmt(m.unitPriceExGst)} ex GST` : ''}
                          {m.kind === 'assembly' ? ' · supply & install' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* How the job runs + what the tradie brings. Authored per trade and
                job type (lib/quote/job-method) — deterministic, never generated
                at render time, and carried under METHOD_DISCLAIMER so it reads
                as standard practice rather than a bespoke promise. */}
            {method ? (
              <>
                <div>
                  <h4 style={subHeading}>How the job runs</h4>
                  <ol style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                    {method.steps.map((s, i) => (
                      <li key={i} style={{ display: 'flex', gap: 11, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                        <span
                          aria-hidden="true"
                          style={{
                            flexShrink: 0,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: 'var(--accent)',
                            paddingTop: 2,
                          }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div>
                  <h4 style={subHeading}>Tools &amp; equipment we bring</h4>
                  <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {method.tools.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          border: '1px solid var(--ink-line)',
                          background: 'var(--ink-deep)',
                          padding: '5px 9px',
                          color: 'var(--text-sec)',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <p style={{ margin: '11px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                    {METHOD_DISCLAIMER}
                  </p>
                </div>

                <div>
                  <h4 style={subHeading}>Compliance</h4>
                  <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                    {method.compliance.map((c) => (
                      <div key={c} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                        <span aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>✓</span>
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            {/* Risk flags + assumptions moved in here from their own sections
                near the old page footer. They are safety and consumer-law
                content — folding them into Job details keeps the five-section
                shape without dropping anything the customer needs. */}
            {Array.isArray(quote.risk_flags) && quote.risk_flags.length > 0 ? (
              <div>
                <h4 style={{ ...subHeading, color: 'var(--warning-bright)' }}>Things to be aware of</h4>
                <div style={{ marginTop: 11, display: 'grid', gap: 10 }}>
                  {(quote.risk_flags as Array<string | { description?: string }>).map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 11, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                      <span aria-hidden="true" style={{ color: 'var(--warning-bright)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>!</span>
                      <span>{typeof r === 'string' ? r : (r?.description ?? JSON.stringify(r))}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(Array.isArray(quote.assumptions) && quote.assumptions.length > 0) || quote.gst_note ? (
              <div>
                <h4 style={subHeading}>Good to know</h4>
                <div style={{ marginTop: 11, display: 'grid', gap: 9 }}>
                  {(Array.isArray(quote.assumptions) ? (quote.assumptions as string[]) : []).map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 11, fontSize: 13, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                      <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0 }}>○</span>
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
                {quote.gst_note ? (
                  <p style={{ margin: '11px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                    {quote.gst_note as string}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        title: 'Your tradie',
        body: (
          <div style={{ ...blockBody, gap: 12 }}>
            <div className="qm-print-hide">
              <TrustVideo
                src={welcomeVideo.url}
                script={welcomeVideo.script}
                title={tradieName}
                caption="A short introduction from your tradie"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <TradiePhoto src={tradie.photoSrc} alt={tradie.name} />
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-sec)' }}>
                {tradie.blurb}
                {letterheadCredential ? ` Licence ${letterheadCredential}.` : ''}
                {websiteUrl ? (
                  <>
                    {' '}
                    <a href={websiteUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                      Visit their website
                    </a>
                    .
                  </>
                ) : null}
              </p>
            </div>
          </div>
        ),
      },
      {
        title: 'Your price',
        body: (
          <div style={blockBody}>
            {/* Urgency + discount banners, moved in beside the price they
                actually qualify. */}
            {showHoldBanner ? <PriceHoldBanner hold={hold} depositPct={depositPct ?? 30} /> : null}
            {showEarlyBirdOffer ? (
              <EarlyBirdBanner
                discountPct={ebStatus.discountPct}
                remaining={fmtEarlyBirdRemaining(ebStatus)}
                deadline={fmtEarlyBirdDeadlineAU(ebStatus.expiresAt)}
              />
            ) : null}
            {ebApplied && !isInspection ? <EarlyBirdAppliedBanner discountPct={ebAppliedPct} /> : null}

            {isInspection ? (
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 800,
                    fontSize: 24,
                    lineHeight: 1,
                    color: 'var(--text-pri)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  ${INSPECTION_FEE_AUD}
                </div>
                <div style={{ marginTop: 6, ...microNote }}>Site visit · refundable</div>
                <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-dim)', maxWidth: '52ch' }}>
                  {quote.inspection_reason
                    ? `Why a visit: ${quote.inspection_reason as string}`
                    : 'Every site is different, so this job is priced in person rather than sight-unseen.'}{' '}
                  The visit fee is credited toward your final quote.
                </p>
              </div>
            ) : (
              // One breakdown per VISIBLE tier. Each table's rows sum EXACTLY to
              // that tier's inc-GST total: the total is computed once through
              // lib/quote/money, then apportioned by each line's share of the
              // summed ex-GST with largest-remainder rounding. Grossing each row
              // up independently would drift a dollar or more from the headline.
              <div style={{ display: 'grid', gap: 16 }}>
                {(['good', 'better', 'best'] as const)
                  .filter((k) => visibleTierSet.has(k) && !!quote[k])
                  .map((k) => {
                    const t = quote[k] as NonNullable<Tier>
                    const lines = Array.isArray(t.line_items) ? t.line_items : []
                    const stack = priceStack(t.subtotal_ex_gst ?? 0, {
                      discountPct: ebApp,
                      gstRegistered,
                    })
                    const rowTotals = allocateIncGst(lines, stack.totalDollars)
                    const dep = tierDeposit(t)
                    const recommended = showRecommendedBadge && quote.selected_tier === k
                    const paidThis = isPaid && quote.paid_tier === k
                    const otherPaid = isPaid && quote.paid_tier !== k
                    return (
                      <div
                        key={k}
                        style={{
                          border: recommended ? '1px solid var(--accent)' : '1px solid var(--ink-line)',
                          background: recommended
                            ? 'color-mix(in srgb, var(--accent) 6%, var(--ink-card))'
                            : 'var(--ink-card)',
                          padding: '16px 16px 18px',
                          opacity: otherPaid ? 0.55 : 1,
                        }}
                      >
                        {/* The eyebrow must say WHICH OPTION this is, and the
                            stored label is not reliable for that: cleanTierLabel
                            strips the "(good)" suffix, so a tier labelled
                            "Brilliant Halo 90 9W LED downlight (good)" collapsed
                            to a bare product name and the option heading read as
                            a light fitting. Name the tier ourselves, then carry
                            the stored label underneath as the description —
                            which is where the product detail belongs. Following
                            the same rule as TierCards: one visible option IS the
                            offer, so it is never labelled "good". */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 12,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.14em',
                              color: 'var(--accent)',
                            }}
                          >
                            {tierCount === 1 ? 'Your quote' : k}
                            {recommended ? ' · most popular' : ''}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 800,
                              fontSize: 22,
                              lineHeight: 1,
                              color: 'var(--text-pri)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            ${fmt(stack.totalDollars)}
                          </span>
                        </div>
                        <div style={{ marginTop: 5, ...microNote, textAlign: 'right' }}>
                          inc GST{stack.discountPct > 0 ? ` · ${stack.discountPct}% off applied` : ''}
                        </div>
                        {cleanTierLabel(t.label) ? (
                          <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                            {cleanTierLabel(t.label)}
                          </p>
                        ) : null}

                        {lines.length ? (
                          // The breakdown is ALWAYS available, but whether it
                          // starts open honours the tenant's quote_display
                          // preference: a tradie on 'summary' wants the lump sum
                          // read first and the rate card behind an opt-in, which
                          // is the whole point of that setting. 'itemised' opens
                          // the featured tier; the others stay collapsed either
                          // way so the section does not become a wall of tables.
                          <details
                            open={quoteDisplayMode === 'itemised' && k === featuredKey}
                            style={{ marginTop: 14 }}
                          >
                            <summary
                              style={{
                                cursor: 'pointer',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 10,
                                textTransform: 'uppercase',
                                letterSpacing: '0.14em',
                                color: 'var(--text-dim)',
                              }}
                            >
                              Full cost breakdown
                            </summary>

                            <div style={{ marginTop: 12, display: 'grid', gap: 1, background: 'var(--ink-line)', border: '1px solid var(--ink-line)' }}>
                              {lines.map((li, i) => {
                                const youSupply =
                                  (li as unknown as { supplied_by?: string }).supplied_by === 'customer'
                                return (
                                  <div
                                    key={i}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      gap: 12,
                                      padding: '10px 12px',
                                      background: 'var(--ink-deep)',
                                    }}
                                  >
                                    <span style={{ minWidth: 0, fontSize: 12.5, lineHeight: 1.4, color: 'var(--text-sec)' }}>
                                      {li.description}
                                      {youSupply ? ' (you supply · install only)' : ''}
                                      <span style={{ display: 'block', marginTop: 2, ...microNote, fontSize: 9 }}>
                                        {asNumber(li.quantity)} × {li.unit} @ ${fmt(asNumber(li.unit_price_ex_gst))} ex GST
                                      </span>
                                    </span>
                                    <span
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: 12.5,
                                        flexShrink: 0,
                                        color: 'var(--text-pri)',
                                        fontVariantNumeric: 'tabular-nums',
                                      }}
                                    >
                                      ${fmt(rowTotals[i] ?? 0)}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>

                            {/* The stack. GST is the residual of the total, so
                                subtotal + GST always equals the headline. */}
                            <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
                              <StackRow label="Subtotal (ex GST)" value={`$${fmt(stack.baseExDollars)}`} />
                              {stack.discountDollars > 0 ? (
                                <StackRow
                                  label={`Early-booking discount (${stack.discountPct}%)`}
                                  value={`−$${fmt(stack.discountDollars)}`}
                                  accent
                                />
                              ) : null}
                              {stack.discountDollars > 0 ? (
                                <StackRow label="Discounted subtotal (ex GST)" value={`$${fmt(stack.netExDollars)}`} />
                              ) : null}
                              {stack.gstApplies ? (
                                <StackRow label="GST (10%)" value={`$${fmt(stack.gstDollars)}`} />
                              ) : (
                                <StackRow label="GST" value="Not registered" />
                              )}
                              <StackRow label="Total (inc GST)" value={`$${fmt(stack.totalDollars)}`} strong />
                              {dep ? (
                                <StackRow
                                  label={`Deposit to book (${depositPct}%)`}
                                  value={`$${fmt(dep)}`}
                                  accent
                                />
                              ) : null}
                            </div>

                            <p style={{ margin: '11px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                              Line amounts are shown inc GST and add up to the total above. The
                              per-unit rates beneath each line are your tradie&apos;s ex-GST rate card.
                            </p>
                          </details>
                        ) : null}

                        {paidThis ? (
                          <div
                            style={{
                              marginTop: 14,
                              border: '1px solid color-mix(in srgb, var(--success-bright) 40%, transparent)',
                              padding: '11px 14px',
                              textAlign: 'center',
                              ...microNote,
                              color: 'var(--success-bright)',
                            }}
                          >
                            Deposit paid
                          </div>
                        ) : otherPaid ? (
                          <div style={{ marginTop: 14, ...microNote, textAlign: 'center' }}>
                            Another option confirmed
                          </div>
                        ) : priceExpired ? (
                          <div style={{ marginTop: 14, ...microNote, textAlign: 'center' }}>
                            Reply to your tradie for a refreshed price
                          </div>
                        ) : (
                          <a href={`/r/${token}/${k}`} className="qm-cta" style={{ ...ctaStyle, marginTop: 14 }}>
                            {dep ? `Pay $${fmt(dep)} deposit` : 'Pay deposit'}
                          </a>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        ),
      },
      {
        title: 'Your site visit',
        body: (
          <div style={{ ...blockBody, gap: 14, maxWidth: 460 }}>
            {isPaid && scheduledAt ? (
              <>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                  Your visit is booked for{' '}
                  <strong style={{ color: 'var(--text-pri)' }}>{slotLabel}</strong>.{' '}
                  {tradieName} will be in touch to confirm the exact time.
                </p>
                {calLinks ? (
                  <AddToCalendar
                    google={calLinks.google}
                    outlook={calLinks.outlook}
                    outlookOffice={calLinks.outlookOffice}
                    icsHref={`/api/q/${token}/ics`}
                  />
                ) : null}
                <a
                  href={`/q/${token}/thanks`}
                  className="qm-ghost"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    justifySelf: 'start',
                    border: '1px solid var(--ink-line)',
                    background: 'transparent',
                    color: 'var(--text-sec)',
                    padding: '11px 16px',
                    borderRadius: 'var(--qm-r-ctl)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    textDecoration: 'none',
                  }}
                >
                  View your booking →
                </a>
              </>
            ) : isPaid ? (
              <>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                  Payment received. Pick a time that suits and your visit is locked in.
                </p>
                <a href={`/q/${token}/book`} className="qm-cta" style={ctaStyle}>
                  Pick your visit time →
                </a>
              </>
            ) : priceExpired ? (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                This price has lapsed, so there is nothing to book just yet. Reply to your
                tradie&apos;s text and they&apos;ll send a refreshed quote.
              </p>
            ) : isInspection ? (
              // No CTA here on purpose. The AcceptBlock below is the ONE action
              // band on this page (it records customer_accepted_at before
              // routing to Stripe); repeating its $99 button here gave the
              // customer two buttons for one decision.
              <>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                  Your tradie prices this one in person. Book the ${INSPECTION_FEE_AUD} site
                  visit below and you pick your time straight after paying — the fee is
                  refundable and credited toward your final quote.
                </p>
                <span style={microNote}>Takes about 30 minutes on site</span>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-sec)' }}>
                Accept your option below and pay the {depositPct ?? 30}% deposit — you pick
                your visit time straight after, and the deposit comes off the final invoice.
              </p>
            )}
          </div>
        ),
      },
    ]

    return (
      <QuoteChrome
        trade={{ label: tradeFormat.label, icon: tradeIcon(intakeTrade) }}
        sticky={stickyBar}
      >
        {/* Tradie-owner edit overlay — renders nothing for customers. */}
        <TradieEditor
          quoteId={quote.id as string}
          gstRegistered={gstRegistered}
          initialTiers={{
            good: (quote.good as Parameters<typeof TradieEditor>[0]['initialTiers']['good']) ?? null,
            better: (quote.better as Parameters<typeof TradieEditor>[0]['initialTiers']['better']) ?? null,
            best: (quote.best as Parameters<typeof TradieEditor>[0]['initialTiers']['best']) ?? null,
          }}
        />
        <QuoteSheet label={`Quote ${quoteRef}`}>
          {tenantIdentity?.business_name ? (
            <Letterhead
              name={tenantIdentity.business_name}
              credential={letterheadCredential}
              phoneHref={letterheadPhoneHref}
              logoUrl={tenantIdentity.logo_url}
              contactName={letterheadContactName}
              phone={ownerPhone || null}
              email={letterheadEmail}
            />
          ) : null}
          <Scope eyebrow={`Quote ${quoteRef}`} items={sections} />
          {/* Acceptance record (customer_accepted_at) — the legal record that
              this exact price and scope was accepted. Kept OUT of section 05 on
              purpose: it renders its own full-bleed action band with the
              #accept anchor the sticky bar targets.
              Rendered ONLY for the two ACTIONABLE modes. In 'paid' mode section
              05 already confirms the booking and in 'expired' mode both section
              04's banner and section 05 already say so — rendering it anyway
              put the same message on the page three times. */}
          {acceptView.mode === 'deposit' || acceptView.mode === 'inspection' ? (
            <AcceptBlock token={token} view={acceptView} alreadyAccepted={!!customerAcceptedAt} />
          ) : null}
          <CredentialFooter rows={footerRows} />
        </QuoteSheet>
      </QuoteChrome>
    )
  }

  return (
    <QuoteChrome
      trade={{ label: tradeFormat.label, icon: tradeIcon(intakeTrade) }}
      sticky={stickyBar}
    >
      {/* ─── Tradie-owner edit overlay (renders nothing for customers) ─── */}
      <TradieEditor
        quoteId={quote.id as string}
        gstRegistered={!!pricingBook?.gst_registered}
        initialTiers={{
          good: (quote.good as unknown as {
            label?: string
            timeframe?: string
            subtotal_ex_gst?: number
            line_items?: Array<{
              description: string
              quantity: number
              unit?: string
              unit_price_ex_gst: number
              total_ex_gst?: number
            }>
          } | null) ?? null,
          better: (quote.better as unknown as {
            label?: string
            timeframe?: string
            subtotal_ex_gst?: number
            line_items?: Array<{
              description: string
              quantity: number
              unit?: string
              unit_price_ex_gst: number
              total_ex_gst?: number
            }>
          } | null) ?? null,
          best: (quote.best as unknown as {
            label?: string
            timeframe?: string
            subtotal_ex_gst?: number
            line_items?: Array<{
              description: string
              quantity: number
              unit?: string
              unit_price_ex_gst: number
              total_ex_gst?: number
            }>
          } | null) ?? null,
        }}
      />

      <QuoteSheet label={`Quote ${quoteRef}`}>
        {/* ─── Tradie letterhead (the quote's owning tradie) ─── */}
        {tenantIdentity?.business_name ? (
          <Letterhead
            name={tenantIdentity.business_name}
            credential={letterheadCredential}
            phoneHref={letterheadPhoneHref}
            logoUrl={tenantIdentity.logo_url}
            contactName={letterheadContactName}
            phone={ownerPhone || null}
            email={letterheadEmail}
          />
        ) : null}

        {/* ─── Hero photo (customer photo or AI preview, when present) ─── */}
        {heroPhotoSrc ? <HeroPhoto src={heroPhotoSrc} alt={`${jobLabel} · job photo`} /> : null}

        {/* ─── Hero ─────────────────────────────────────── */}
        <QuoteHero
          quoteId={`Quote ${quoteRef}`}
          status={heroStatus}
          line1={heroLine1}
          line2={heroLine2}
          greeting={heroGreeting}
          issued={issuedDate ? `Issued ${issuedDate}` : null}
        />

        {/* ─── Summary stat grid ─────────────────────────── */}
        {statItems.length > 0 ? <StatGrid items={statItems} /> : null}

        {/* ─── WP6 · Price-hold / urgency banner ─────────── */}
        {showHoldBanner ? (
          <SheetSection pad="20px 24px">
            <PriceHoldBanner hold={hold} depositPct={depositPct ?? 30} />
          </SheetSection>
        ) : null}

        {/* ─── v8 · Early-booking discount banner ────────── */}
        {showEarlyBirdOffer ? (
          <SheetSection pad="20px 24px">
            <EarlyBirdBanner
              discountPct={ebStatus.discountPct}
              remaining={fmtEarlyBirdRemaining(ebStatus)}
              deadline={fmtEarlyBirdDeadlineAU(ebStatus.expiresAt)}
            />
          </SheetSection>
        ) : null}
        {ebApplied && !isInspection ? (
          <SheetSection pad="20px 24px">
            <EarlyBirdAppliedBanner discountPct={ebAppliedPct} />
          </SheetSection>
        ) : null}

        {/* ─── Scope of works ────────────────────────────── */}
        {quote.scope_of_works ? (
          <Scope items={[{ title: 'Scope of works', body: quote.scope_of_works as string }]} />
        ) : null}

        {/* ─── Customer photos ─────────────────────────────
            Electrical/plumbing quotes always render it (three states incl.
            the upload prompt). Bespoke trades are measured from satellite /
            plan documents, so the block only appears when photos genuinely
            exist — never as an upload prompt that has no pipeline behind it. */}
        {showInstallVisuals || customerPhotoUrls.length > 0 ? (
          <SheetSection pad="20px 20px" background="var(--ink-deep)">
            <CustomerPhotosBlock urls={customerPhotoUrls} uploadToken={uploadToken} />
          </SheetSection>
        ) : null}

        {/* ─── AI preview + sample gallery ─────────────────
            Electrical/plumbing only ("AI preview · your room" is install
            visualisation). Renders for BOTH auto-priced and inspection-
            required quotes there. Bespoke trades show their own measurement
            evidence instead (RoofHeroStrip / CommercialPaintDetails below). */}
        {showInstallVisuals ? (
          <SheetSection pad="20px 20px" background="var(--ink-deep)">
            <PreviewSection
              shareToken={token}
              initialPreviewStatus={previewStatus}
              initialPreviewImageUrls={previewImageUrls}
              initialSamplesStatus={samplesStatus}
              initialSampleImageUrls={sampleImageUrls}
            />
          </SheetSection>
        ) : null}

        {/* ─── Roof hero (only for roofing quotes) ──────── */}
        {isRoofing && roofStats && intake && (
          <SheetSection pad="20px 20px" background="var(--ink-deep)">
            <RoofHeroStrip
              address={String(intake.address ?? '')}
              suburb={(intake.suburb as string | null | undefined) ?? null}
              shareToken={token}
              stats={roofStats}
              staticMapPath={roofHeroMapPath}
            />
          </SheetSection>
        )}

        {/* ─── Measured takeoff (only for commercial painting) ── */}
        {isCommercialPaint ? (
          <SheetSection pad="20px 20px" background="var(--ink-deep)">
            <CommercialPaintDetails
              scope={commPaintScope}
              lineItems={commPaintLines}
              tenderUrl={commPaintTenderUrl}
            />
          </SheetSection>
        ) : null}

        {/* ─── Inspection-only block OR tier cards ──────── */}
        {/* Roofing quotes render the roofing-framed options (patch/repair ·
            re-roof · upgrade) instead of the generic electrical card so a
            roofing customer never sees the electrical line-item card
            (spec R2/R9/R18). */}
        {isInspection && !roofingIndicative ? (
          <SheetSection pad="20px 24px">
            <InspectionBlock
              reason={quote.inspection_reason}
              shareToken={token}
              paid={isPaid}
            />
          </SheetSection>
        ) : !tradeFormat.usesGenericCard ? (
          <SheetSection pad="20px 24px">
            {/* Roofing on-site quote: the deterministic engine DID price the
                roof from the satellite measurement; show those tiers as an
                indicative estimate plus the $99 booking CTA, rather than the
                price-free InspectionBlock (which read as a blank/$0 quote). */}
            {roofingIndicative ? (
              <RoofingIndicativeBanner
                reason={quote.inspection_reason}
                shareToken={token}
                paid={isPaid}
              />
            ) : null}
            <TradeTiers
              tiers={{
                good: visibleTierSet.has('good') ? roofTierIfPositive(quote.good) : null,
                better: visibleTierSet.has('better') ? roofTierIfPositive(quote.better) : null,
                best: visibleTierSet.has('best') ? roofTierIfPositive(quote.best) : null,
              }}
              token={token}
              stripeLinks={stripeLinks}
              depositPct={depositPct}
              gstRegistered={gstRegistered}
              selectedTier={showRecommendedBadge ? ((quote.selected_tier as string | null) ?? null) : null}
              appliedDiscountPct={ebApplied ? ebAppliedPct : 0}
              isPaid={isPaid}
              paidTier={(quote.paid_tier as string | null) ?? null}
              priceExpired={priceExpired}
              // A commercial-painting tender is a CONFIRMED price → its per-tier
              // deposit CTA is live; a roofing on-site (indicative) quote is
              // priced from satellite only → deposit withheld, $99 site visit
              // (banner above) is the path.
              depositEnabled={isCommercialPaint}
              // Roofing keeps its roofing-specific copy (component default), but
              // an on-site (indicative) roofing quote gets an indicative footnote.
              // Any other non-generic trade gets neutral labels so it still
              // avoids the electrical line-item card (R2).
              {...(isRoofing
                ? roofingIndicative
                  ? {
                      footnote:
                        'Indicative estimate from your satellite measurement. Your final price is confirmed at a quick on-site visit ($99, refundable and credited to your job).',
                    }
                  : {}
                : isCommercialPaint
                  ? {
                      // One tender price wrapped into the tier slots — frame it
                      // as the tender, never as a Good/Better/Best ladder.
                      heading: 'Your tender',
                      labels: tierLabelsForTrade(intakeTrade),
                      blurbs: {
                        good: 'Fixed price for the full measured scope. Every surface itemised above.',
                        better:
                          'Fixed price for the full measured scope. Every surface itemised above.',
                        best: 'Fixed price for the full measured scope. Every surface itemised above.',
                      },
                      footnote:
                        'Priced from the measured takeoff above. Your tradie confirms the final scope before any work commences.',
                    }
                  : {
                      heading: `Your ${tradeFormat.label.toLowerCase()} options`,
                      labels: tierLabelsForTrade(intakeTrade),
                      blurbs: { good: '', better: '', best: '' },
                      footnote:
                        'Final price is confirmed after our on-site visit. This estimate is based on the information provided so far.',
                    })}
            />
          </SheetSection>
        ) : null}
        {/* The third arm of this ternary was the electrical/plumbing TierCards.
            Those trades return the five-section view above, so it could never
            render — `!tradeFormat.usesGenericCard` is necessarily true here. */}

        {/* ─── Explicit "Accept & confirm" — the primary accept action on a
            priced quote (records acceptance, then deposit). Inspection/held
            quotes use the $99 CTA in the block above instead. ─── */}
        {!isInspection ? (
          <AcceptBlock
            token={token}
            view={acceptView}
            alreadyAccepted={!!customerAcceptedAt}
          />
        ) : null}

        {/* ─── Things to be aware of (risk flags) ───────── */}
        {Array.isArray(quote.risk_flags) && quote.risk_flags.length > 0 ? (
          <SheetSection eyebrow="Things to be aware of" eyebrowAccent>
            <div style={{ marginTop: 14, display: 'grid', gap: 11 }}>
              {(quote.risk_flags as Array<string | { description?: string }>).map((r, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', gap: 11, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}
                >
                  <span aria-hidden="true" style={{ color: 'var(--warning-bright)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>!</span>
                  <span>{typeof r === 'string' ? r : (r?.description ?? JSON.stringify(r))}</span>
                </div>
              ))}
            </div>
          </SheetSection>
        ) : null}

        {/* ─── Good to know (assumptions) + GST note ────── */}
        {(Array.isArray(quote.assumptions) && quote.assumptions.length > 0) || quote.gst_note ? (
          <GoodToKnow
            items={Array.isArray(quote.assumptions) ? (quote.assumptions as string[]) : []}
            note={quote.gst_note ? (quote.gst_note as string) : undefined}
          />
        ) : null}

        {/* ─── Credential footer + tagline strip ────────── */}
        <CredentialFooter rows={footerRows} />
      </QuoteSheet>
    </QuoteChrome>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Components
   ═══════════════════════════════════════════════════════════════ */

/** One line of the Subtotal / Discount / GST / Total stack in section 04.
 *  Tabular numerals so the column reads as an addable sum, which is the whole
 *  point of the section. */
function StackRow({
  label,
  value,
  strong = false,
  accent = false,
}: {
  label: string
  value: string
  strong?: boolean
  accent?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        ...(strong
          ? { borderTop: '1px solid var(--ink-line)', paddingTop: 8, marginTop: 1 }
          : null),
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: strong ? 10.5 : 10,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: strong ? 'var(--text-pri)' : 'var(--text-dim)',
          fontWeight: strong ? 700 : 400,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: strong ? 15 : 12.5,
          fontWeight: strong ? 800 : 400,
          color: accent ? 'var(--accent)' : strong ? 'var(--text-pri)' : 'var(--text-sec)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function PriceHoldBanner({
  hold,
  depositPct,
}: {
  hold: ReturnType<typeof priceHoldStatus>
  depositPct: number
}) {
  if (hold.state === 'expired') {
    return (
      <section className="mt-8 bg-ink-card border-l-2 border-l-warning border-y border-r border-ink-line p-5 sm:p-6">
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-warning mb-2">
          Price expired
        </div>
        <p className="text-sm leading-relaxed text-text-sec sm:text-base">
          The price on this quote was held until{' '}
          <span className="font-semibold text-text-pri">{fmtHoldUntilAU(hold.holdUntil)}</span> and
          has now lapsed. Reply to your tradie&apos;s SMS for a refreshed quote. Pricing may have
          changed.
        </p>
      </section>
    )
  }

  // state === 'held'
  const days = hold.daysRemaining
  const remaining =
    days >= 1
      ? `${days} day${days === 1 ? '' : 's'} left`
      : 'Last day to lock it in'
  return (
    <section className="mt-8 bg-ink-card border border-accent/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-accent mb-1">
            Price held · {remaining}
          </div>
          <p className="text-sm leading-relaxed text-text-sec sm:text-base">
            We&apos;re holding this price until{' '}
            <span className="font-semibold text-text-pri">{fmtHoldUntilAU(hold.holdUntil)}</span>.
            Lock it in with your {depositPct}% deposit to secure it before it changes.
          </p>
        </div>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] bg-accent text-white px-2.5 py-1 font-bold shrink-0">
          Held until {fmtHoldUntilAU(hold.holdUntil)}
        </span>
      </div>
    </section>
  )
}

// v8 — early-booking discount advert. Shown pre-booking while the offer
// is live: a countdown that nudges the customer to lock a time in today.
// The discount is realised server-side when they pick a slot before the
// deadline (see /api/q/[token]/book).
function EarlyBirdBanner({
  discountPct,
  remaining,
  deadline,
}: {
  discountPct: number
  remaining: string
  deadline: string
}) {
  return (
    <section className="mt-8 bg-accent/10 border border-accent/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-accent mb-1">
            Early-booking discount · {remaining}
          </div>
          <p className="text-sm leading-relaxed text-text-sec sm:text-base">
            Book your job in now and{' '}
            <span className="font-semibold text-text-pri">save {discountPct}%</span> off
            the total. The discount locks in when you pick a time
            {deadline ? (
              <>
                {' '}before <span className="font-semibold text-text-pri">{deadline}</span>
              </>
            ) : null}
            .
          </p>
        </div>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] bg-accent text-white px-2.5 py-1 font-bold shrink-0">
          Save {discountPct}%
        </span>
      </div>
    </section>
  )
}

// v8 — shown once the customer has booked in time and earned the
// discount. Confirms the saving; the tier cards now render discounted.
function EarlyBirdAppliedBanner({ discountPct }: { discountPct: number }) {
  return (
    <section className="mt-8 bg-success/10 border border-success/40 p-5 sm:p-6">
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-success-bright mb-1">
        Early-booking discount locked in
      </div>
      <p className="text-sm leading-relaxed text-text-sec sm:text-base">
        Nice one, you booked in time. Your{' '}
        <span className="font-semibold text-text-pri">{discountPct}% discount</span> is
        applied to the prices below.
      </p>
    </section>
  )
}

// Roofing on-site (indicative) banner. The indicative tier prices render below
// this (TradeTiers); here we frame them as an estimate and carry the $99
// on-site booking CTA — so an on-site-flagged roofing quote shows a real number
// AND a clear next step, instead of the price-free InspectionBlock.
function RoofingIndicativeBanner({
  reason,
  shareToken,
  paid,
}: {
  reason: string | null
  shareToken: string
  paid: boolean
}) {
  return (
    <section className="bg-ink-card border-2 border-warning/50 p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1.5 h-full bg-warning" aria-hidden />
      <div className="relative">
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-warning mb-3">
          Indicative estimate · on-site visit confirms it
        </div>
        <p className="text-base leading-relaxed text-text-pri sm:text-lg">
          The prices below are an estimate from your roof measurement. We confirm the final price with a quick on-site visit before any work is booked.
        </p>

        {reason ? (
          <p className="mt-5 bg-ink-deep border border-ink-line p-4 text-sm text-text-sec">
            <span className="font-semibold text-text-pri">Why a visit:</span> {reason}
          </p>
        ) : null}

        <div className="mt-7 flex items-baseline gap-3">
          <span className="text-text-pri font-extrabold tracking-tight text-4xl sm:text-5xl">$99</span>
          <span className="text-sm text-text-sec">
            refundable site visit · credited toward your final quote
          </span>
        </div>

        <div className="mt-6">
          {paid ? (
            <div className="bg-success/10 border border-success/30 px-5 py-4 text-center">
              <span className="font-mono text-xs uppercase tracking-[0.12em] font-semibold text-success-bright">
                Site visit booked · tradie will be in touch
              </span>
            </div>
          ) : (
            // /r/<token>/inspection mints a fresh $99 Session per click — no
            // stored stripe_links.inspection needed — so this CTA always works.
            <a
              href={`/r/${shareToken}/inspection`}
              className="block bg-accent hover:bg-accent-press text-white px-5 py-4 text-center transition-colors font-mono text-xs sm:text-sm uppercase tracking-[0.15em] font-bold"
            >
              Pay $99 · site visit →
            </a>
          )}
        </div>
      </div>
    </section>
  )
}

function InspectionBlock({
  reason,
  shareToken,
  paid,
}: {
  reason: string | null
  shareToken: string
  paid: boolean
}) {
  return (
    <section className="bg-ink-card border-2 border-warning/50 p-6 sm:p-8 relative overflow-hidden">
      {/* Subtle warning gradient corner accent */}
      <div className="absolute top-0 left-0 w-1.5 h-full bg-warning" aria-hidden />

      <div className="relative">
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-warning mb-3">
          Site visit required
        </div>
        <p className="text-base leading-relaxed text-text-pri sm:text-lg">
          Every site is different. We can&apos;t price this safely without seeing the work in person.
        </p>

        {reason ? (
          <p className="mt-5 bg-ink-deep border border-ink-line p-4 text-sm text-text-sec">
            <span className="font-semibold text-text-pri">Why a visit:</span> {reason}
          </p>
        ) : null}

        <div className="mt-7 flex items-baseline gap-3">
          <span className="text-text-pri font-extrabold tracking-tight text-4xl sm:text-5xl">$99</span>
          <span className="text-sm text-text-sec">
            refundable site visit · credited toward your final quote
          </span>
        </div>

        <div className="mt-6">
          {paid ? (
            <div className="bg-success/10 border border-success/30 px-5 py-4 text-center">
              <span className="font-mono text-xs uppercase tracking-[0.12em] font-semibold text-success-bright">
                Site visit booked · tradie will be in touch
              </span>
            </div>
          ) : (
            // /r/<token>/inspection mints a fresh $99 Session per click — no
            // stored stripe_links.inspection needed — so this CTA always works.
            <a
              href={`/r/${shareToken}/inspection`}
              className="block bg-accent hover:bg-accent-press text-white px-5 py-4 text-center transition-colors font-mono text-xs sm:text-sm uppercase tracking-[0.15em] font-bold"
            >
              Pay $99 · site visit →
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
