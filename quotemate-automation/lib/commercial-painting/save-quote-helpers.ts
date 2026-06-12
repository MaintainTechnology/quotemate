// Pure row-shaping for the commercial painting save-quote route.
// Mirrors lib/solar/persist-helpers.ts: a PricedPaintBom + run context →
// the two insert payloads (intakes trade='commercial_painting' and a
// quotes row). Single tender price — the one priced tier is wrapped
// into good/better/best identically (roofing's single-price precedent)
// so every existing quotes consumer keeps working.
//
// NO I/O. The route owns the inserts and stamps quote.intake_id.

import type { PricedPaintBom } from './types'

type TierLineItem = {
  unit: string
  quantity: number
  description: string
  unit_price_ex_gst: number
  total_ex_gst: number
  source: string
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** The single tender tier in the established tier-jsonb shape. */
export function buildTenderTier(bom: PricedPaintBom) {
  const lineItems: TierLineItem[] = bom.lines.map((l) => ({
    unit: l.unit === 'm2' ? 'sqm' : 'each',
    quantity: l.quantity,
    description: `${l.room} — ${l.surface} (${l.coats} coats, ${l.product})`,
    unit_price_ex_gst: l.quantity > 0 ? round2(l.lineExGst / l.quantity) : l.lineExGst,
    total_ex_gst: l.lineExGst,
    source: 'paint_rates',
  }))
  for (const e of bom.equipment) {
    lineItems.push({
      unit: 'days',
      quantity: e.days,
      description: `${e.label} — ${e.reason}`,
      unit_price_ex_gst: e.dayRate,
      total_ex_gst: e.costExGst,
      source: 'paint_rates',
    })
  }
  return {
    label: 'Tender price',
    subtotal_ex_gst: bom.subtotalExGst,
    total_inc_gst: bom.totalIncGst,
    line_items: lineItems,
  }
}

export function buildPaintQuotePayloads(args: {
  bom: PricedPaintBom
  tenantId: string
  shareToken: string
  jobName?: string | null
  siteAddress?: string | null
}) {
  const { bom, tenantId, shareToken, jobName, siteAddress } = args
  const tier = buildTenderTier(bom)

  const surfaceCount = bom.lines.length
  const totalM2 = round2(
    bom.lines.filter((l) => l.unit === 'm2').reduce((s, l) => s + l.quantity, 0),
  )

  const intake = {
    tenant_id: tenantId,
    trade: 'commercial_painting' as const,
    job_type: 'commercial_painting',
    address: siteAddress ?? null,
    suburb: null as string | null,
    scope: {
      job_name: jobName ?? null,
      surfaces: surfaceCount,
      total_m2: totalM2,
      labour_hours: bom.labour.hours,
      crew_size: bom.labour.crewSize,
      estimated_days: bom.labour.estimatedDays,
      separate_price_ex_gst: bom.separate.exGst,
    },
    access: {},
    property: {},
    risks: bom.unmatched.map(
      (u) => `Unpriced line: ${u.room} — ${u.surface} (${u.quantity})`,
    ),
    inspection_required: false,
    caller: { name: '', phone: '', email: '' },
    timing: { urgency: null },
    confidence: 'MED',
    confidence_reason:
      'Commercial painting tender priced deterministically from paint_rates over a tradie-confirmed takeoff.',
  }

  const quote = {
    tenant_id: tenantId,
    status: 'draft' as const,
    share_token: shareToken,
    scope_of_works: [
      `Commercial painting${jobName ? ` — ${jobName}` : ''}${siteAddress ? `, ${siteAddress}` : ''}.`,
      `${surfaceCount} surfaces (${totalM2} m²), ${bom.labour.hours}h labour, crew of ${bom.labour.crewSize}, ≈${bom.labour.estimatedDays} days.`,
    ].join(' '),
    assumptions: bom.assumptions,
    risk_flags: bom.unmatched.map(
      (u) => `Unpriced line excluded from total: ${u.room} — ${u.surface}`,
    ),
    needs_inspection: false,
    inspection_reason: null as string | null,
    // Single tender price wrapped into the established triple-tier shape.
    good: tier,
    better: tier,
    best: tier,
    selected_tier: 'better' as const,
    subtotal_ex_gst: bom.subtotalExGst,
    gst: bom.gst,
    total_inc_gst: bom.totalIncGst,
    routing_decision: 'tradie_review' as const,
  }

  return { intake, quote }
}
