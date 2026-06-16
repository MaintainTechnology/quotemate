// POST /api/solar/[tenantSlug]/estimate — PUBLIC, customer-facing.
//
// The front door for a solar estimate. Mirrors
// app/api/roofing/save-as-quote/route.ts, but:
//   • PUBLIC (no bearer) — it is the customer entry flow, like /q/roof.
//     The tenant is resolved from the [tenantSlug] path segment, which
//     carries the tenant id (uuid). We look it up with the service-role
//     client, same as /api/q/[token]/book resolves tenant by id.
//   • The deterministic lib/solar engine (runSolarEstimate) owns
//     geocode → coverage gate → roof normalise (or manual fallback) →
//     sizing/production/pricing/economics → token. This route persists
//     intake (trade='solar') + solar_estimates + quote, then — for a
//     CLEAN estimate — auto-releases it to the customer (Path B,
//     docs/strategy.md v12 2026-06-16) and notifies the tradie after the
//     fact. A FLAGGED estimate is NOT auto-sent: it lands awaiting the
//     tradie's confirm, since the publish gate hides prices on a flagged
//     row regardless of confirmed_at.
//
// Next 16: params is a Promise (awaited); force-dynamic; the notify SMS,
// enrichment, and auto-release all run in after() so the customer
// response is not blocked.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { SolarEstimateRequestSchema } from '@/lib/solar/request-schema'
import { buildSolarRowPayloads } from '@/lib/solar/persist-helpers'
import { notifySolarEstimate } from '@/lib/solar/notify'
import { runSolarEstimate } from '@/lib/solar/intake'
import { loadSolarConfig } from '@/lib/solar/config'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { applyPylonStcCrossCheck } from '@/lib/solar/pylon-aftercheck'
import { applyOpenSolarSupplement } from '@/lib/solar/opensolar-supplement'
import { geocodeAddress } from '@/lib/solar/geocode'
import { validateSolarAddress } from '@/lib/solar/address-validation'
import { fetchSolarDataLayers } from '@/lib/solar/data-layers'
import { applySolarSunAssets } from '@/lib/solar/sun-assets'
import { solarAutoReleaseEnabled, autoReleaseSolarEstimate } from '@/lib/solar/release'
import { applySolarFeltMap } from '@/lib/solar/felt-provision'
import { applySolarAiBrief } from '@/lib/solar/ai-brief'
import { feltTabEnabled } from '@/lib/felt/client'
import { resolveNetworkFromPostcode } from '@/lib/solar/network-lookup'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await ctx.params

  // ── Resolve the tenant from the path segment (tenant id). ────────
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, status, business_name, owner_first_name, owner_mobile, twilio_sms_number')
    .eq('id', tenantSlug)
    .maybeSingle()
  if (!tenant || tenant.status === 'suspended') {
    return Response.json({ ok: false, error: 'tenant_not_found' }, { status: 404 })
  }

  // ── Parse + validate the body. ───────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = SolarEstimateRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { address, manual, panel_type, customer, energy } = parsed.data
  // Felt tab spec 2026-06-13: a 'felt' submission runs the IDENTICAL
  // engine; the variant only selects the quote layout + map provisioning.
  // When the tab is disabled server-side, fall back to the instant
  // variant (degradation matrix §4.9).
  const quoteVariant: 'instant' | 'felt' =
    parsed.data.variant === 'felt' && feltTabEnabled(process.env) ? 'felt' : 'instant'

  // ── Run the deterministic engine. ────────────────────────────────
  const config = await loadSolarConfig(supabase)
  // Derive DNSP/network from the postcode (for feed-in tariff + export
  // limit). Falls back to 'default' when no exact match is found, which
  // routes through config.feed_in.default_aud_per_kwh — always safe.
  const resolvedNetwork = resolveNetworkFromPostcode(address.postcode)
  let estimate
  try {
    estimate = await runSolarEstimate({
      input: address,
      manual,
      panelType: panel_type,
      // Optional quarterly bill (premium quote §4.1) — personalises the
      // utility-cost section; intake.ts guards non-finite/non-positive.
      quarterlyBillAud: energy?.quarterly_bill_aud ?? null,
      config,
      opts: {
        geocode: async (input) => {
          const r = await geocodeAddress(
            input.address + ', ' + input.state,
            // Geocoding uses a Maps-Platform key. Prefer a dedicated
            // GOOGLE_GEOCODE_API_KEY if set, else fall back to the
            // provisioned GOOGLE_MAPS_API_KEY (same key family).
            { apiKey: process.env.GOOGLE_GEOCODE_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY },
          )
          if (!r.ok) throw new Error(r.detail)
          return r.location
        },
        // Best-effort Google Address Validation — refines the coordinate
        // when it resolves to premise level; never blocks the quote.
        addressValidation: async (input) =>
          validateSolarAddress(input, {
            apiKey:
              process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY ??
              process.env.GOOGLE_MAPS_API_KEY,
          }),
        // Best-effort Solar dataLayers (imagery/shade availability) — pure
        // enrichment persisted on the estimate for a future heatmap view.
        dataLayers: async (location) =>
          fetchSolarDataLayers(location, {
            apiKey:
              process.env.GOOGLE_SOLAR_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
          }),
        network: resolvedNetwork,
      },
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: 'engine_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }

  // ── Persist intake → solar_estimates → quote. ────────────────────
  const payloads = buildSolarRowPayloads({
    estimate,
    tenantId: tenant.id as string,
    address,
    // Optional customer contact — persisted on intake.caller so the
    // tradie-confirm step can text the customer their quote. mobile→phone.
    customer: customer
      ? { name: customer.name, phone: customer.mobile }
      : undefined,
    quoteVariant,
  })

  const { data: intakeRow, error: intakeErr } = await supabase
    .from('intakes')
    .insert(payloads.intake)
    .select('id')
    .single()
  if (intakeErr || !intakeRow) {
    return Response.json(
      { ok: false, error: 'intake_insert_failed', detail: intakeErr?.message ?? 'no row' },
      { status: 500 },
    )
  }

  const { error: estErr } = await supabase
    .from('solar_estimates')
    .insert({ ...payloads.solarEstimate, intake_id: intakeRow.id })
  if (estErr) {
    return Response.json(
      { ok: false, error: 'estimate_insert_failed', detail: estErr.message },
      { status: 500 },
    )
  }

  const { data: quoteRow, error: quoteErr } = await supabase
    .from('quotes')
    .insert({ ...payloads.quote, intake_id: intakeRow.id })
    .select('id, share_token')
    .single()
  if (quoteErr || !quoteRow) {
    return Response.json(
      { ok: false, error: 'quote_insert_failed', detail: quoteErr?.message ?? 'no row' },
      { status: 500 },
    )
  }

  // ── Decide auto-release (Path B). A CLEAN, priced estimate is sent to
  // the customer automatically — no forced confirm click. A flagged or
  // inspection-routed estimate stays human-in-loop. Decided synchronously
  // off the engine's guardrail_flags (autoReleaseSolarEstimate re-checks
  // the freshly-read row inside after(), so a Pylon-appended flag is still
  // caught when the cross-check runs first). Gated by SOLAR_AUTO_RELEASE.
  const eligibleForAutoRelease =
    solarAutoReleaseEnabled(process.env) &&
    (estimate.guardrail_flags ?? []).length === 0 &&
    estimate.routing?.decision !== 'inspection_required'

  // ── Notify the tradie after the response. ────────────────────────
  const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'
  // The SMS must quote the SAME numbers the share page headlines. The
  // page hero shows the LARGEST tier (resolveSolarQuoteView's
  // headlineTier — last in good→best order); quoting the 'better' tier
  // here produced mismatched figures in pilot (SMS "4.8 kW" vs the
  // linked page's "6.0 kW").
  const headline = estimate.price.tiers[estimate.price.tiers.length - 1]

  // ── Pylon STC cross-check (premium quote §4.5, behind PYLON_ENABLED).
  // Compares our deterministic certificate counts against Pylon's
  // official calculator. |Δ| > 1 cert appends a guardrail flag, which
  // the confirm gate already turns into "cannot confirm until
  // re-drafted clean". Pylon down ⇒ nothing changes. Runs in after()
  // so the customer response is never blocked.
  after(() => applyPylonStcCrossCheck(supabase, estimate, tenant.id as string))

  // ── OpenSolar supplements (enrichment build 2026-06-13, behind
  // OPENSOLAR_ENRICHMENT_ENABLED): the tradie's activated hardware
  // catalogue (display-only product cards) + their own pricing scheme as
  // a cross-check guardrail. Never changes a price; OpenSolar down ⇒
  // the row is bit-identical. Runs in after() like the Pylon checks.
  after(() => applyOpenSolarSupplement(supabase, estimate))

  // ── Sun & shade assets (full-exploitation build 2026-06-13): download
  // the dataLayers GeoTIFFs, render the roof irradiance heatmap, derive
  // the shade-free window / monthly weights / building height, cache the
  // PNG and merge context.sun into the persisted estimate. Google-covered
  // estimates only (manual path has no imagery). Best-effort in after().
  if (estimate.coverage_source === 'google' && estimate.context.location) {
    const location = estimate.context.location
    after(() => applySolarSunAssets(supabase, { publicToken: estimate.token, location }))
  }

  // ── Felt map provisioning (Felt tab spec 2026-06-13 §4.5): create the
  // per-estimate interactive map (satellite basemap, unlisted view_only),
  // upload the panel/plane GeoJSON + flux/DSM GeoTIFF layers, style with
  // FSL, and persist the provisioning record on the row's felt jsonb.
  // Felt-variant rows only; best-effort in after() — a Felt outage leaves
  // the estimate fully valid (the page falls back to the instant layout).
  if (quoteVariant === 'felt') {
    const feltLocation = estimate.context.location ?? null
    after(() =>
      applySolarFeltMap(supabase, { publicToken: estimate.token, location: feltLocation }),
    )
    // AI roof-intelligence brief (§4.6): Anthropic prose grounded on the
    // frozen roof facts — never prices. A grounding violation discards
    // the brief; the page falls back to the sun-score copy. Best-effort.
    after(() => applySolarAiBrief(supabase, { publicToken: estimate.token }))
  }

  // ── Auto-release the clean estimate to the customer (Path B). Runs
  // after the enrichment above so a Pylon-appended guardrail flag is seen;
  // re-checks eligibility on the freshly-read row, stamps confirmed_at and
  // fires the customer SMS + CRM leads. No-op for flagged/inspection rows.
  if (eligibleForAutoRelease) {
    after(() => autoReleaseSolarEstimate(supabase, { token: estimate.token }))
  }

  after(async () => {
    await notifySolarEstimate({
      tenant: {
        owner_mobile: (tenant.owner_mobile as string | null) ?? null,
        owner_first_name: (tenant.owner_first_name as string | null) ?? null,
        twilio_sms_number: (tenant.twilio_sms_number as string | null) ?? null,
      },
      customerName: null,
      systemKw: headline?.system_kw_dc ?? 0,
      netIncGst: headline?.net_inc_gst ?? 0,
      shareToken: estimate.token,
      appUrl,
      // Clean estimate already auto-sent → "sent to your customer" wording;
      // flagged estimate → "review and confirm before it goes live".
      released: eligibleForAutoRelease,
      dispatch: (opts) => dispatchQuoteMessage(opts),
    })
  })

  const shareUrl = `${appUrl}/q/solar/${estimate.token}`
  return Response.json(
    { ok: true, token: estimate.token, shareUrl, coverage_source: estimate.coverage_source },
    { status: 200 },
  )
}
