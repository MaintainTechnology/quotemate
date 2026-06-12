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
//     intake (trade='solar') + solar_estimates + quote, then notifies
//     the tradie (forced review, no auto-send — spec §6).
//
// Next 16: params is a Promise (awaited); force-dynamic; the notify
// SMS runs in after() so the customer response is not blocked.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { SolarEstimateRequestSchema } from '@/lib/solar/request-schema'
import { buildSolarRowPayloads } from '@/lib/solar/persist-helpers'
import { notifySolarEstimate } from '@/lib/solar/notify'
import { runSolarEstimate } from '@/lib/solar/intake'
import { loadSolarConfig } from '@/lib/solar/config'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { geocodeAddress } from '@/lib/solar/geocode'
import { validateSolarAddress } from '@/lib/solar/address-validation'
import { fetchSolarDataLayers } from '@/lib/solar/data-layers'
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
  const { address, manual, panel_type } = parsed.data

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

  // ── Notify the tradie (forced review) after the response. ────────
  const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'
  // The SMS must quote the SAME numbers the share page headlines. The
  // page hero shows the LARGEST tier (resolveSolarQuoteView's
  // headlineTier — last in good→best order); quoting the 'better' tier
  // here produced mismatched figures in pilot (SMS "4.8 kW" vs the
  // linked page's "6.0 kW").
  const headline = estimate.price.tiers[estimate.price.tiers.length - 1]
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
      dispatch: (opts) => dispatchQuoteMessage(opts),
    })
  })

  const shareUrl = `${appUrl}/q/solar/${estimate.token}`
  return Response.json(
    { ok: true, token: estimate.token, shareUrl, coverage_source: estimate.coverage_source },
    { status: 200 },
  )
}
