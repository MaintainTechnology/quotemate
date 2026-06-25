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
import { z } from 'zod'
import { generateShareToken } from '@/lib/stripe/checkout'
import { buildTierObjects, splitAddress } from '@/lib/roofing/save-as-quote-helpers'
import type { RoofMetrics, RoofingQuotePrice } from '@/lib/roofing/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const SaveRequestSchema = z.object({
  address: z.object({
    address: z.string().min(3),
    postcode: z.string(),
    state: z.string(),
  }),
  inputs: z.object({
    material: z.string(),
    pitch: z.string(),
    intent: z.string(),
    building_year_built: z.number().int().nullable().optional(),
  }),
  metrics: z.object({
    footprint_m2: z.number(),
    sloped_area_m2: z.number().nullable(),
    storeys: z.number().nullable(),
    form: z.string(),
    hips: z.number().nullable(),
    valleys: z.number().nullable(),
    ridge_lm: z.number().nullable().optional(),
    polygon_geojson: z.unknown().nullable().optional(),
    capture_date: z.string().nullable().optional(),
  }),
  price: z.object({
    area_m2: z.number(),
    effective_rate_per_m2: z.number(),
    tiers: z.array(
      z.object({
        tier: z.enum(['good', 'better', 'best']),
        label: z.string(),
        ex_gst: z.number(),
        inc_gst: z.number(),
        scope: z.string(),
        line_items: z
          .array(
            z.object({
              unit: z.string(),
              quantity: z.number(),
              description: z.string(),
              unit_price_ex_gst: z.number(),
              total_ex_gst: z.number(),
              source: z.string(),
            }),
          )
          .optional(),
      }),
    ).length(3),
    loadings_applied: z.array(
      z.object({ code: z.string(), pct: z.number(), detail: z.string() }),
    ),
    routing: z.object({
      decision: z.enum(['auto_quote', 'tradie_review', 'inspection_required']),
      reason: z.string(),
    }),
  }),
  customer: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
})

async function userAndTenant(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  if (!tenant) return null
  return { user: data.user, tenant }
}

export async function POST(req: Request) {
  const ctx = await userAndTenant(req)
  if (!ctx) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = SaveRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs, metrics, price, customer } = parsed.data
  const m = metrics as RoofMetrics
  const p = price as RoofingQuotePrice
  const { street, suburb } = splitAddress(address.address)

  // ── 1. Insert intake ─────────────────────────────────────────────
  // Roofing intakes carry their measurement payload in scope jsonb
  // alongside the inputs the tradie provided. The deterministic
  // pricing engine derives everything from this snapshot.
  const intakePayload = {
    tenant_id: ctx.tenant.id,
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
  const shareToken = generateShareToken()
  const inspection = p.routing.decision === 'inspection_required'
  const selectedTier =
    p.tiers[1].ex_gst > 0 ? 'better' : p.tiers[2].ex_gst > 0 ? 'best' : 'good'
  const tierTotalEx = p.tiers.find((t) => t.tier === selectedTier)?.ex_gst ?? 0
  const tierTotalInc = p.tiers.find((t) => t.tier === selectedTier)?.inc_gst ?? 0
  const gst = Math.max(0, tierTotalInc - tierTotalEx)

  const quotePayload = {
    tenant_id: ctx.tenant.id,
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
    return Response.json(
      { ok: false, error: 'quote_insert_failed', detail: quoteErr?.message ?? 'no row' },
      { status: 500 },
    )
  }

  // ── 3. Build the share URL ───────────────────────────────────────
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
