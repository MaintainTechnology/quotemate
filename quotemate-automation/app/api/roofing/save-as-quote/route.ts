// POST /api/roofing/save-as-quote — persist a roofing measurement +
// price as a real `quotes` row and return a /q/[token] link the tradie
// can share with the customer.
//
// Closes Gap #1 from the audit: until now, /api/roofing/measure was
// read-only — every Measure Roof click was throwaway. This route takes
// the measurement payload, creates intakes + quotes rows scoped to the
// tradie's tenant, stamps a share_token, and returns the customer-
// facing URL.
//
// What gets written:
//   • intakes  — job_type='full_reroof' (or whatever the inputs say),
//                trade='roofing', scope holds the measurement, address +
//                suburb derived from the input string
//   • quotes   — good/better/best jsonb tier objects with the line items
//                derived from the deterministic pricing engine,
//                share_token, tenant_id, status='draft',
//                needs_inspection mirrors routing.decision
//
// Note: roofing intakes do NOT flow through lib/intake/structure.ts
// (the IntakeSchema enum is still ['electrical','plumbing']). We write
// the raw intake row directly with trade='roofing' — same shape the
// table accepts, just bypassing the AI structuring step.

import { createClient } from '@supabase/supabase-js'
import { generateShareToken } from '@/lib/stripe/checkout'
import { buildTierObjects, splitAddress } from '@/lib/roofing/save-as-quote-helpers'
import { SaveAsQuoteRequestSchema } from '@/lib/roofing/save-as-quote-schema'
import type { RoofMetrics, RoofingQuotePrice } from '@/lib/roofing/types'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id). This route needs a tenant to attribute the quote to.
  const resolved = await resolveTenantRequest(supabase, req, 'id, business_name')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as { id: string; business_name: string | null } | null
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  // Request contract lives in lib/roofing/save-as-quote-schema.ts so the /m
  // promotion flattening (buildSaveAsQuoteRequest) validates against the ONE
  // schema this route enforces.
  const parsed = SaveAsQuoteRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs, metrics, price, customer, measure_token } = parsed.data
  const m = metrics as RoofMetrics
  const p = price as RoofingQuotePrice
  const { street, suburb } = splitAddress(address.address)

  // Generated up front: the claim below stamps this token on the measurement
  // BEFORE the inserts, and the quote is inserted WITH it — so a racer that
  // loses the claim can return the winner's token even while the winner's
  // insert is still in flight.
  const shareToken = generateShareToken()
  const existingResponse = (quoteId: string | null, token: string) => {
    const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
    return Response.json(
      {
        ok: true,
        existing: true,
        quoteId,
        shareToken: token,
        shareUrl: origin ? `${origin}/q/${token}` : `/q/${token}`,
      },
      { status: 200 },
    )
  }

  // ── 0. Promotion idempotency (spec tradie-onsite-quote-editing R6c,
  //       spec quote-sync-and-roofing-workflow-fix F2) ──
  // When /m promotes a saved measurement, a second promotion must return
  // the existing quote instead of minting a duplicate. The old read-then-
  // insert left a race window (two concurrent promotions each saw a NULL
  // token and both inserted) — now the NULL→token flip is a single
  // conditional UPDATE, so exactly one concurrent promotion can win.
  let claimed = false
  const releaseClaim = async () => {
    // Roll the claim back so a retried promotion isn't stuck pointing at a
    // quote that never got inserted. Scoped to OUR token — never clobbers a
    // token another promotion stamped since. If THIS also fails the
    // measurement is stuck claimed with no quote (hidden from saved jobs,
    // idempotency returns a dead link) — loud log so it's diagnosable.
    const { error } = await supabase
      .from('roofing_measurements')
      .update({ quote_share_token: null })
      .eq('measure_token', measure_token!)
      .eq('tenant_id', tenant.id)
      .eq('quote_share_token', shareToken)
    if (error) {
      console.error(
        '[roofing/save-as-quote] claim rollback FAILED — measurement stuck claimed',
        { measure_token, shareToken, detail: error.message },
      )
    }
  }
  if (measure_token) {
    const { data: measurement } = await supabase
      .from('roofing_measurements')
      .select('id, quote_id, quote_share_token')
      .eq('measure_token', measure_token)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (measurement?.quote_share_token) {
      return existingResponse(
        (measurement.quote_id as string | null) ?? null,
        measurement.quote_share_token as string,
      )
    }
    if (measurement) {
      const { data: won } = await supabase
        .from('roofing_measurements')
        .update({ quote_share_token: shareToken })
        .eq('measure_token', measure_token)
        .eq('tenant_id', tenant.id)
        .is('quote_share_token', null)
        .select('id')
      if (!won || won.length === 0) {
        // Lost the race — return whatever the winner stamped.
        const { data: after } = await supabase
          .from('roofing_measurements')
          .select('quote_id, quote_share_token')
          .eq('measure_token', measure_token)
          .eq('tenant_id', tenant.id)
          .maybeSingle()
        if (after?.quote_share_token) {
          return existingResponse(
            (after.quote_id as string | null) ?? null,
            after.quote_share_token as string,
          )
        }
        return Response.json(
          { ok: false, error: 'promotion_conflict' },
          { status: 409 },
        )
      }
      claimed = true
    }
  }

  // ── 1. Insert intake ─────────────────────────────────────────────
  // Roofing intakes carry their measurement payload in scope jsonb
  // alongside the inputs the tradie provided. The deterministic
  // pricing engine derives everything from this snapshot.
  const intakePayload = {
    tenant_id: tenant.id,
    trade: 'roofing',
    job_type: inputs.intent || 'full_reroof',
    address: street,
    suburb,
    scope: {
      ...inputs,
      ...m,
      polygon_geojson: m.polygon_geojson ?? null,
      state: address.state,
      postcode: address.postcode,
    },
    access: { storeys: m.storeys },
    property: {
      levels: m.storeys ?? null,
      year_built: inputs.building_year_built ?? null,
    },
    risks: [],
    inspection_required: p.routing.decision === 'inspection_required',
    caller: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
    },
    timing: { urgency: null },
    confidence: 'HIGH',
    confidence_reason: `Roofing measurement via ${m.polygon_geojson ? 'Geoscape polygon' : 'mock/manual'} — deterministic pricing engine.`,
  }
  const { data: intakeRow, error: intakeErr } = await supabase
    .from('intakes')
    .insert(intakePayload)
    .select('id')
    .single()
  if (intakeErr || !intakeRow) {
    if (claimed) await releaseClaim()
    return Response.json(
      { ok: false, error: 'intake_insert_failed', detail: intakeErr?.message ?? 'no row' },
      { status: 500 },
    )
  }

  // ── 2. Insert quote ──────────────────────────────────────────────
  // INTENTIONAL: roofing keeps the REAL computed tiers in good/better/best
  // even when the job routes to inspection. The roofing engine is
  // deterministic (priced from the satellite measurement), so an on-site-
  // flagged roof still has grounded numbers — the customer quote pages show
  // them as an INDICATIVE estimate ("subject to on-site confirmation") rather
  // than a blank/$0 quote. Do NOT null these tiers on inspection the way the
  // ungroundable-estimate path (estimate/draft → forceInspectionTiers) does —
  // that would re-introduce the blank-roofing-quote bug. (Genuinely unpriceable
  // roofs — asbestos / unknown material — already compute $0 tiers from the
  // pricer, and the pages fall back to the $99 inspection-only state for those.)
  const tiers = buildTierObjects(p)
  const inspection = p.routing.decision === 'inspection_required'
  const selectedTier =
    p.tiers[1].ex_gst > 0 ? 'better' : p.tiers[2].ex_gst > 0 ? 'best' : 'good'
  const tierTotalEx = p.tiers.find((t) => t.tier === selectedTier)?.ex_gst ?? 0
  const tierTotalInc = p.tiers.find((t) => t.tier === selectedTier)?.inc_gst ?? 0
  const gst = Math.max(0, tierTotalInc - tierTotalEx)

  const quotePayload = {
    tenant_id: tenant.id,
    intake_id: intakeRow.id,
    status: 'draft',
    share_token: shareToken,
    scope_of_works: p.tiers[1].scope,
    assumptions: [
      `Sloped roof area approximately ${p.area_m2.toFixed(0)} m².`,
      `Pitch declared as ${inputs.pitch}.`,
      `Roof material: ${inputs.material}.`,
      ...p.loadings_applied.map((l) => l.detail),
    ],
    risk_flags: p.routing.decision !== 'auto_quote' ? [p.routing.reason] : [],
    good: tiers.good,
    better: tiers.better,
    best: tiers.best,
    needs_inspection: inspection,
    inspection_reason: inspection ? p.routing.reason : null,
    selected_tier: selectedTier,
    subtotal_ex_gst: tierTotalEx,
    gst,
    total_inc_gst: tierTotalInc,
    routing_decision: p.routing.decision,
  }
  const { data: quoteRow, error: quoteErr } = await supabase
    .from('quotes')
    .insert(quotePayload)
    .select('id, share_token')
    .single()
  if (quoteErr || !quoteRow) {
    if (claimed) await releaseClaim()
    return Response.json(
      { ok: false, error: 'quote_insert_failed', detail: quoteErr?.message ?? 'no row' },
      { status: 500 },
    )
  }

  // ── 3. Stamp the quote id onto the claimed measurement (best-effort) ──
  // The share token was already stamped by the claim; a failure here only
  // costs the loser-race response its quoteId, never the link itself.
  if (claimed) {
    const { error: linkErr } = await supabase
      .from('roofing_measurements')
      .update({ quote_id: quoteRow.id })
      .eq('measure_token', measure_token!)
      .eq('tenant_id', tenant.id)
      .eq('quote_share_token', shareToken)
    if (linkErr) {
      console.warn('[roofing/save-as-quote] measurement link-back failed', linkErr.message)
    }
  }

  // ── 4. Build the share URL ───────────────────────────────────────
  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
  const shareUrl = origin ? `${origin}/q/${quoteRow.share_token}` : `/q/${quoteRow.share_token}`

  return Response.json(
    {
      ok: true,
      quoteId: quoteRow.id,
      intakeId: intakeRow.id,
      shareToken: quoteRow.share_token,
      shareUrl,
    },
    { status: 200 },
  )
}
