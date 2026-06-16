// ════════════════════════════════════════════════════════════════════
// POST /api/solar/redraft/[token] — re-run the deterministic engine over
// an UNRELEASED solar estimate, in place.
//
// This is the action behind the dashboard's "adjust the numbers and
// re-draft" message: after the underlying data is corrected (rate card,
// STC zone table, config version), re-drafting re-prices the same row
// with the SAME public_token (the customer link never changes) and
// re-evaluates every guardrail. Flags that the data fix resolved clear;
// flags that persist keep blocking the confirm gate.
//
// Released (confirmed) estimates 409 — re-pricing under a customer who
// already saw the figures is not allowed; create a new estimate instead.
//
// Bearer auth — same trust model as POST /api/solar/confirm/[token].
// Next 16: params is a Promise; heavy Pylon cross-check runs in after().
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { runSolarEstimate } from '@/lib/solar/intake'
import { loadSolarConfig } from '@/lib/solar/config'
import { geocodeAddress } from '@/lib/solar/geocode'
import { validateSolarAddress } from '@/lib/solar/address-validation'
import { fetchSolarDataLayers } from '@/lib/solar/data-layers'
import { applySolarSunAssets } from '@/lib/solar/sun-assets'
import { applySolarFeltMap } from '@/lib/solar/felt-provision'
import { applySolarAiBrief } from '@/lib/solar/ai-brief'
import { resolveNetworkFromPostcode } from '@/lib/solar/network-lookup'
import { redraftEligibility, reconstructSolarInputs } from '@/lib/solar/redraft'
import { applyPylonStcCrossCheck } from '@/lib/solar/pylon-aftercheck'
import { applyOpenSolarSupplement } from '@/lib/solar/opensolar-supplement'
import { buildSolarRowPayloads } from '@/lib/solar/persist-helpers'
import type { SolarEstimate } from '@/lib/solar/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const supabase = getSupabase()
  const { data: userData, error: userErr } = await supabase.auth.getUser(
    auth.slice(7).trim(),
  )
  if (userErr || !userData?.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: row, error } = await supabase
    .from('solar_estimates')
    .select('id, tenant_id, public_token, address, state, postcode, confirmed_at, estimate, quote_variant')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const eligibility = redraftEligibility({
    confirmedAt: (row.confirmed_at as string | null) ?? null,
  })
  if (!eligibility.ok) {
    return Response.json(
      { ok: false, error: eligibility.error },
      { status: eligibility.status },
    )
  }

  const previous = (row.estimate as SolarEstimate | null) ?? null
  if (!previous) {
    return Response.json(
      { ok: false, error: 'estimate_missing — this row predates the engine jsonb; re-draft is unavailable.' },
      { status: 422 },
    )
  }

  const inputs = reconstructSolarInputs({
    row: {
      address: (row.address as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      postcode: (row.postcode as string | null) ?? null,
    },
    estimate: previous,
  })
  if (!inputs) {
    return Response.json(
      { ok: false, error: 'inputs_unreconstructable — the saved row lacks an address/state/postcode.' },
      { status: 422 },
    )
  }

  // Re-run the engine with the current config — identical wiring to the
  // estimate creation route, so a re-draft prices exactly like a fresh
  // submission of the same details.
  const config = await loadSolarConfig(supabase)
  let redrafted: SolarEstimate
  try {
    const result = await runSolarEstimate({
      input: inputs.input,
      manual: inputs.manual,
      panelType: inputs.panelType,
      quarterlyBillAud: inputs.quarterlyBillAud,
      // Carry the prior estimate's phase + preferred size so a re-draft keeps
      // the same export ceiling + tier anchor (reconstructed from context).
      phase: inputs.phase,
      requestedSizeKw: inputs.requestedSizeKw,
      config,
      opts: {
        geocode: async (input) => {
          const r = await geocodeAddress(input.address + ', ' + input.state, {
            apiKey: process.env.GOOGLE_GEOCODE_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
          })
          if (!r.ok) throw new Error(r.detail)
          return r.location
        },
        addressValidation: async (input) =>
          validateSolarAddress(input, {
            apiKey:
              process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY ??
              process.env.GOOGLE_MAPS_API_KEY,
          }),
        dataLayers: async (location) =>
          fetchSolarDataLayers(location, {
            apiKey: process.env.GOOGLE_SOLAR_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
          }),
        network: resolveNetworkFromPostcode(inputs.input.postcode),
      },
    })
    // KEEP the existing public token — the customer link must not change.
    redrafted = { ...result, token: row.public_token as string }
  } catch (e) {
    return Response.json(
      { ok: false, error: 'engine_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }

  // Shape the refreshed engine output with the same payload builder the
  // creation route uses, then strip insert-only identity fields.
  const quoteVariant: 'instant' | 'felt' =
    row.quote_variant === 'felt' ? 'felt' : 'instant'
  const payloads = buildSolarRowPayloads({
    estimate: redrafted,
    tenantId: (row.tenant_id as string | null) ?? '',
    address: inputs.input,
    // Keep the row's variant — a re-draft must never flip a Felt quote
    // back to the instant layout (Felt tab spec 2026-06-13 §4.5).
    quoteVariant,
  })
  const {
    tenant_id: _t,
    public_token: _p,
    address: _a,
    state: _s,
    postcode: _pc,
    ...estimateUpdate
  } = payloads.solarEstimate

  const { error: updErr } = await supabase
    .from('solar_estimates')
    .update({
      ...estimateUpdate,
      // Stale artefacts must regenerate against the new numbers: the PDF
      // on next request, and the AI "panels installed" concept (its
      // prompt is grounded on the headline tier's panel layout).
      pdf_path: null,
      panels_image_status: 'idle',
      panels_image_path: null,
    })
    .eq('id', row.id)
  if (updErr) {
    return Response.json(
      { ok: false, error: 'update_failed', detail: updErr.message },
      { status: 500 },
    )
  }

  // Refresh the linked quotes row (same share_token) so the dashboard
  // pipeline shows the new totals. Best-effort — the solar_estimates row
  // is the source of truth for the customer page.
  const { tenant_id: _qt, status: _qs, share_token: _qst, ...quoteUpdate } = payloads.quote
  const { error: quoteErr } = await supabase
    .from('quotes')
    .update(quoteUpdate)
    .eq('share_token', row.public_token)
  if (quoteErr) {
    console.warn('[solar/redraft] quotes row refresh failed (non-fatal)', quoteErr.message)
  }

  // Re-run the Pylon STC cross-check against the new numbers (spec §4.5
  // "and on re-draft"). After the response; never blocks.
  after(() => applyPylonStcCrossCheck(supabase, redrafted, (row.tenant_id as string | null) ?? null))

  // Re-run the OpenSolar supplements (hardware + pricing cross-check)
  // against the fresh numbers too — same after() semantics.
  after(() => applyOpenSolarSupplement(supabase, redrafted))

  // Regenerate the sun & shade assets against the fresh estimate (the
  // redraft wiped context.sun with the rest of the jsonb). Google path
  // only; best-effort.
  if (redrafted.coverage_source === 'google' && redrafted.context.location) {
    const location = redrafted.context.location
    after(() => applySolarSunAssets(supabase, { publicToken: row.public_token as string, location }))
  }

  // Re-provision the Felt map against the fresh layout (the panel
  // placements/sizing may have changed). applySolarFeltMap deletes the
  // previous map first; best-effort, felt-variant rows only.
  if (quoteVariant === 'felt') {
    const feltLocation = redrafted.context.location ?? null
    after(() =>
      applySolarFeltMap(supabase, {
        publicToken: row.public_token as string,
        location: feltLocation,
      }),
    )
    // Regenerate the AI brief — the facts hash changed with the layout,
    // and applySolarAiBrief skips itself when it didn't. Best-effort.
    after(() => applySolarAiBrief(supabase, { publicToken: row.public_token as string }))
  }

  return Response.json({
    ok: true,
    token: redrafted.token,
    guardrail_flags: redrafted.guardrail_flags,
    routing: redrafted.routing.decision,
    config_version: redrafted.config_version,
  })
}
