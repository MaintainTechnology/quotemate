// ════════════════════════════════════════════════════════════════════
// POST /api/pylon/confirm/[token] — the forced tradie review step for an
// imported Pylon proposal.
//
// Mirrors /api/solar/confirm/[token]: a flagged proposal (STC / totals
// mismatch) cannot be confirmed — the fix loop is edit-in-Pylon-studio →
// re-import. Confirm stamps confirmed_at, creates the Stripe deposit
// Checkout from the design's own deposit figure, then (after the
// response) renders the PDF and texts the customer their proposal.
//
// Next 16: params is a Promise (await it). Bearer auth required.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { ensurePylonProposalPdf, pylonProposalPdfUrl, signQuotePdfUrl } from '@/lib/quote/pdf'
import { dispatchQuoteWithPdf } from '@/lib/sms/send-quote-pdf'
import { pylonProposalsEnabled, pylonLeadPushEnabled, pushPylonOpportunity } from '@/lib/pylon/client'
import { createPylonDepositCheckoutSession } from '@/lib/pylon/checkout'
import { buildPylonCustomerSms } from '@/lib/pylon/notify'
import {
  buildPylonQuoteUrl,
  formatCentsAud,
  type PylonProposalCustomer,
  type PylonProposalDesign,
} from '@/lib/pylon/proposal'

export const dynamic = 'force-dynamic'

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
  if (
    !pylonProposalsEnabled({
      PYLON_PROPOSALS_ENABLED: process.env.PYLON_PROPOSALS_ENABLED,
      PYLON_API_KEY: process.env.PYLON_API_KEY,
    })
  ) {
    return Response.json({ ok: false, error: 'pylon_disabled' }, { status: 404 })
  }

  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const supabase = getSupabase()
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7).trim())
  if (userErr || !userData?.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: row, error } = await supabase
    .from('pylon_proposals')
    .select('id, tenant_id, public_token, title, address_text, customer, design, flags, confirmed_at')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const flags = Array.isArray(row.flags) ? (row.flags as string[]) : []
  if (flags.length > 0) {
    return Response.json(
      {
        ok: false,
        error:
          'This proposal has open checks. Fix the design in Pylon studio and re-import before confirming.',
      },
      { status: 409 },
    )
  }
  if (row.confirmed_at) {
    return Response.json({ ok: true, confirmed_at: row.confirmed_at })
  }

  const design = (row.design as PylonProposalDesign | null) ?? null
  const customer = (row.customer as PylonProposalCustomer | null) ?? null
  const appUrl = (process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app').replace(/\/$/, '')

  // Deposit Checkout from the design's own deposit figure (best-effort —
  // a Stripe hiccup must not block the release; the page just omits the CTA).
  let checkoutUrl: string | null = null
  if (design) {
    try {
      checkoutUrl = await createPylonDepositCheckoutSession({
        token,
        design,
        customerEmail: customer?.email ?? null,
        appUrl,
      })
    } catch (e) {
      console.warn(
        '[pylon/confirm] deposit session failed (non-fatal)',
        e instanceof Error ? e.message : e,
      )
    }
  }

  const confirmedAt = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('pylon_proposals')
    .update({
      confirmed_at: confirmedAt,
      status: 'confirmed',
      stripe_checkout_url: checkoutUrl,
      updated_at: confirmedAt,
    })
    .eq('id', row.id)
  if (updErr) {
    return Response.json({ ok: false, error: 'confirm_failed' }, { status: 500 })
  }

  // Heavy work after the response: PDF render + customer SMS/MMS + the
  // optional CRM lead push. All best-effort.
  after(() =>
    sendCustomerPylonProposal(supabase, {
      tenantId: (row.tenant_id as string | null) ?? null,
      token,
      title: (row.title as string | null) ?? design?.title ?? null,
      customer,
      design,
      appUrl,
    }),
  )
  after(() =>
    pushPylonProposalLead({
      tenantId: (row.tenant_id as string | null) ?? null,
      customer,
      address: (row.address_text as string | null) ?? null,
      design,
    }),
  )

  return Response.json({ ok: true, confirmed_at: confirmedAt })
}

/** Best-effort customer SMS with the proposal + PDF links. Never throws. */
async function sendCustomerPylonProposal(
  supabase: ReturnType<typeof getSupabase>,
  args: {
    tenantId: string | null
    token: string
    title: string | null
    customer: PylonProposalCustomer | null
    design: PylonProposalDesign | null
    appUrl: string
  },
): Promise<void> {
  try {
    const phone = args.customer?.phone?.trim()
    if (!phone) return

    const { data: tenant } = await supabase
      .from('tenants')
      .select('business_name, twilio_sms_number')
      .eq('id', args.tenantId)
      .maybeSingle()
    const businessName = (tenant?.business_name as string | null) ?? 'Your installer'

    const pdfPath = await ensurePylonProposalPdf(args.token)
    const totalFormatted =
      args.design?.proposal_quote?.total_price_formatted ??
      (args.design?.pricing.total_cents != null
        ? formatCentsAud(args.design.pricing.total_cents)
        : null)

    const body = buildPylonCustomerSms({
      businessName,
      customerName: args.customer?.name ?? null,
      title: args.title,
      totalFormatted,
      quoteUrl: buildPylonQuoteUrl(args.appUrl, args.token),
      pdfUrl: pdfPath ? pylonProposalPdfUrl(args.token) : null,
    })
    await dispatchQuoteWithPdf({
      to: phone,
      text: body,
      from: (tenant?.twilio_sms_number as string | null) ?? process.env.TWILIO_SMS_NUMBER,
      pdfPath,
      signMediaUrl: signQuotePdfUrl,
    })
  } catch (e) {
    console.error(
      '[pylon/confirm] customer proposal send failed (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}

/** Best-effort Pylon CRM lead push (same gate as the solar tab). */
async function pushPylonProposalLead(args: {
  tenantId: string | null
  customer: PylonProposalCustomer | null
  address: string | null
  design: PylonProposalDesign | null
}): Promise<void> {
  try {
    if (
      !pylonLeadPushEnabled(
        {
          PYLON_ENABLED: process.env.PYLON_ENABLED,
          PYLON_API_KEY: process.env.PYLON_API_KEY,
          PYLON_LEAD_PUSH_TENANTS: process.env.PYLON_LEAD_PUSH_TENANTS,
        },
        args.tenantId,
      )
    ) {
      return
    }
    const kw = args.design?.summary.dc_output_kw
    const result = await pushPylonOpportunity({
      name: args.customer?.name?.trim() || 'QuoteMate solar lead',
      phone: args.customer?.phone ?? null,
      email: args.customer?.email ?? null,
      address: args.address,
      title: kw ? `${kw} kW solar — QuoteMate proposal` : 'QuoteMate solar proposal',
      summary: kw
        ? `${kw} kW solar — confirmed QuoteMate Pylon proposal`
        : 'Confirmed QuoteMate Pylon proposal',
    })
    if (!result.ok) {
      console.warn(`[pylon/confirm] lead push skipped (${result.code}): ${result.detail}`)
    }
  } catch (e) {
    console.warn(
      '[pylon/confirm] lead push failed (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}
