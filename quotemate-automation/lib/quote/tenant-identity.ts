// Tradie identity for the quote letterhead (migration 141).
//
// The reference quote surface (quotemax.com.au) prints the owning tradie's
// logo + business name + a Contact / Phone / Email strip. Those fields live on
// `tenants`: business_name / owner_* predate this; contact_name + logo_url
// arrive with migration 141. This loader mirrors the graceful-degradation
// pattern already used in app/q/[token]/page.tsx — a base select for the
// always-present columns plus a best-effort select for the migration-141
// columns, so a pre-141 deploy degrades to null rather than 500-ing a public
// quote page.

import type { SupabaseClient } from '@supabase/supabase-js'
import { tradeVideoUrl, type TradeVideoMap } from '@/lib/videos/trade-videos'

export type TenantIdentity = {
  business_name: string | null
  contact_name: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  owner_mobile: string | null
  owner_email: string | null
  website_url: string | null
  business_address: string | null
  logo_url: string | null
  /** Mig 180 — the tradie's own photo for the quote's "Your tradie" section.
   *  Null renders the placeholder avatar (lib/quote/tradie-profile.ts).
   *  Optional for the same reason as trade_videos below: loadTenantIdentity
   *  always sets it, but hand-built fixtures predate it. */
  photo_url?: string | null
  /** AU state (e.g. 'QLD') — feeds tzForState so booked-visit labels render
   *  in the tenant's timezone, matching how the slots were generated. */
  state: string | null
  /** The tenant's Twilio long code — the number the customer's quote SMS came
   *  from, so "reply to …" CTAs can deep-link back into that thread. */
  twilio_sms_number: string | null
  /** Mig 175 — trust videos filmed by QuoteMax at onboarding. intro plays in
   *  the quote page's trust section; thankyou on the post-booking confirmation
   *  page. v1 renders a face-holder placeholder regardless, so these stay
   *  null until real footage exists. */
  intro_video_url: string | null
  thankyou_video_url: string | null
  /** Per-trade trust videos (trade -> slot -> entry), mig 179. Overrides the
   *  tenant-wide pair above for the trade being quoted; see tradeVideoUrls().
   *  Optional: loadTenantIdentity always sets it, but callers that build an
   *  identity by hand (tests, fixtures) predate it and must keep compiling. */
  trade_videos?: TradeVideoMap | null
}

export async function loadTenantIdentity(
  supabase: SupabaseClient,
  tenantId: string | null | undefined,
): Promise<TenantIdentity | null> {
  if (!tenantId) return null

  const { data: base } = await supabase
    .from('tenants')
    .select('business_name, owner_first_name, owner_last_name, owner_mobile, owner_email, state')
    .eq('id', tenantId)
    .maybeSingle()
  if (!base) return null
  const b = base as Record<string, string | null>

  // Best-effort: a deploy whose tenants table lacks any of these columns
  // (pre-migration-141 for contact/logo; pre-175 for the trust videos;
  // unprovisioned installs for the Twilio number) yields data:null here and
  // degrades to nulls, without taking the whole letterhead down with it.
  const { data: ex } = await supabase
    .from('tenants')
    .select('contact_name, website_url, business_address, logo_url, twilio_sms_number, intro_video_url, thankyou_video_url')
    .eq('id', tenantId)
    .maybeSingle()
  const e = (ex ?? {}) as Record<string, string | null>

  // Per-trade videos get their OWN best-effort select: folding a newer column
  // into the select above would make a pre-migration deploy fail that whole
  // query, nulling the letterhead (contact/logo) and the existing videos too.
  const { data: tv } = await supabase
    .from('tenants')
    .select('trade_videos')
    .eq('id', tenantId)
    .maybeSingle()

  // Same reason as trade_videos: the mig-180 tradie photo gets its own
  // best-effort select so a pre-180 deploy loses only the photo, not the
  // letterhead. Null → the customer surfaces render the placeholder avatar.
  const { data: ph } = await supabase
    .from('tenants')
    .select('photo_url')
    .eq('id', tenantId)
    .maybeSingle()

  return {
    business_name: b.business_name ?? null,
    owner_first_name: b.owner_first_name ?? null,
    owner_last_name: b.owner_last_name ?? null,
    owner_mobile: b.owner_mobile ?? null,
    owner_email: b.owner_email ?? null,
    state: b.state ?? null,
    twilio_sms_number: e.twilio_sms_number ?? null,
    contact_name: e.contact_name ?? null,
    website_url: e.website_url ?? null,
    business_address: e.business_address ?? null,
    logo_url: e.logo_url ?? null,
    photo_url: ((ph ?? {}) as { photo_url?: string | null }).photo_url ?? null,
    intro_video_url: e.intro_video_url ?? null,
    thankyou_video_url: e.thankyou_video_url ?? null,
    trade_videos: ((tv ?? {}) as { trade_videos?: TradeVideoMap | null }).trade_videos ?? null,
  }
}

/**
 * The two trust-video slots (spec customer-quote-five-sections R4). Jon's
 * model: QuoteMax films each tradie at onboarding; until then every tenant
 * ships with the two QuoteMax DEFAULT placeholder videos ("we will default
 * it with a quote max video" — one per slot, mig 177 public bucket). A
 * tenant's own video (tenants.intro_video_url / thankyou_video_url, mig 175)
 * replaces its default independently, so the trust section is never empty.
 */
export const TRUST_VIDEO_DEFAULT_PATHS = {
  intro: 'defaults/welcome.mp4',
  thankyou: 'defaults/thank-you.mp4',
} as const

export function trustVideoUrls(
  t: Pick<TenantIdentity, 'intro_video_url' | 'thankyou_video_url'> | null,
  supabaseUrl: string | null | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): { intro: string | null; thankyou: string | null } {
  const base = (supabaseUrl ?? '').replace(/\/$/, '')
  const publicUrl = (path: string) =>
    base ? `${base}/storage/v1/object/public/tenant-videos/${path}` : null
  return {
    intro: t?.intro_video_url?.trim() || publicUrl(TRUST_VIDEO_DEFAULT_PATHS.intro),
    thankyou: t?.thankyou_video_url?.trim() || publicUrl(TRUST_VIDEO_DEFAULT_PATHS.thankyou),
  }
}

/**
 * Trust videos for the TRADE being quoted. A tradie records one welcome +
 * thank-you pair per trade they have switched on, so an electrical customer
 * hears the electrical intro and a roofing customer hears the roofing one.
 *
 * Chain, per slot and independently: the trade's own video → the tenant-wide
 * pair (mig 175, so an existing tenant never loses a working video) → the
 * QuoteMax default. `trade` accepts any spelling, including the hyphenated
 * customer-surface TradeKey; an unknown trade simply yields the tenant-wide
 * result. Stays pure + synchronous — every caller is a server component that
 * already holds the identity.
 */
export function tradeVideoUrls(
  t:
    | (Pick<TenantIdentity, 'intro_video_url' | 'thankyou_video_url'> & {
        trade_videos?: TradeVideoMap | null
      })
    | null,
  trade: string | null | undefined,
  supabaseUrl: string | null | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): { intro: string | null; thankyou: string | null } {
  const fallback = trustVideoUrls(t, supabaseUrl)
  const map = t?.trade_videos ?? null
  return {
    intro: tradeVideoUrl(map, trade, 'welcome') ?? fallback.intro,
    thankyou: tradeVideoUrl(map, trade, 'thankyou') ?? fallback.thankyou,
  }
}

/**
 * A tenant website link safe to render on a public customer page: https only,
 * so a typo'd or plain-text value can never render a broken or javascript:
 * link. Tradies type their site scheme-less ("www.bobsroofing.com.au" — the
 * live tenant rows all look like this), so a bare domain is normalised to
 * https:// rather than dropped; every other scheme (http:, javascript:, …)
 * is rejected.
 */
export function safeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Scheme-less domain ("www.site.com.au", "site.com/page") → assume https.
  // Anything with an explicit scheme must BE https. The ':' check stops
  // "javascript:alert(1)" being treated as a bare domain.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'https:') return null
    // A real site link needs a dotted hostname — rejects "https://foo" typos.
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/** The person a customer contacts — contact_name, else owner full name, else
 *  owner first name. Returns null when nothing is set (letterhead hides the row). */
export function contactDisplayName(t: TenantIdentity | null): string | null {
  if (!t) return null
  const full = [t.owner_first_name, t.owner_last_name].filter(Boolean).join(' ').trim()
  return (t.contact_name?.trim() || full || t.owner_first_name || null) ?? null
}
