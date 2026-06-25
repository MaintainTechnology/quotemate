// POST /api/quote/[id]/chat-edit
//
// PROPOSE-ONLY. Turns a tradie's plain-English instruction into a proposed,
// catalogue-grounded edit of an existing quote's Good/Better/Best line items,
// and returns it as a reviewable diff. It persists NOTHING — no DB write, no
// Stripe call, no PDF render, no SMS. The client reviews the proposal and, on
// the tradie's explicit Save, POSTs it to the UNCHANGED
// POST /api/quote/[id]/edit endpoint which does the grounded write.
//
// Auth + guards mirror /api/quote/[id]/edit exactly: Bearer Supabase token →
// must be the owner of the quote's tenant; paid / inspection / misconfigured-
// pricing_book quotes are refused with the same status codes. The grounding
// gate that /edit enforces on Save is re-run here (lib/quote/chat-edit) so the
// `grounded` flags shown to the tradie match what Save will accept or reject.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { loadCandidatePrices } from '@/lib/estimate/run'
import type { PricingBookForValidation } from '@/lib/estimate/validate'
import {
  proposeQuoteEdit,
  type ChatEditTier,
  type ChatEditTiers,
} from '@/lib/quote/chat-edit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Opus + tool-calling is slow; match the edit route's ceiling (Vercel Hobby's
// 10s would time out — needs Pro or Railway).
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().min(0),
  unit: z.string().trim().max(20).optional().or(z.literal('')),
  unit_price_ex_gst: z.coerce.number().min(0),
  source: z.string().trim().max(120).optional().or(z.literal('')),
})

const TierSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    timeframe: z.string().trim().max(60).optional().or(z.literal('')),
    line_items: z.array(LineItemSchema).min(1),
  })
  .nullable()

const BodySchema = z.object({
  instruction: z.string().trim().min(1).max(1000),
  // The live tiers as the tradie sees them on screen (so follow-up
  // instructions build on the working set). Optional — when absent the
  // endpoint edits the persisted good/better/best instead.
  currentTiers: z
    .object({
      good: TierSchema.optional(),
      better: TierSchema.optional(),
      best: TierSchema.optional(),
    })
    .optional(),
})

type DbTier = {
  label?: string
  timeframe?: string
  subtotal_ex_gst?: number
  line_items?: Array<{
    description: string
    quantity: number
    unit?: string
    unit_price_ex_gst: number
    total_ex_gst?: number
    source?: string
  }>
} | null

/** Map a persisted quote tier JSONB to the chat-edit tier shape. */
function dbTierToChatEdit(t: DbTier, key: string): ChatEditTier {
  if (!t) return null
  return {
    label: t.label ?? `${key} option`,
    timeframe: t.timeframe || undefined,
    line_items: (t.line_items ?? []).map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unit: li.unit || undefined,
      unit_price_ex_gst: Number(li.unit_price_ex_gst),
      ...(li.source ? { source: li.source } : {}),
    })),
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quoteId } = await params

  // ─── Auth ───────────────────────────────────────────────────
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice(7).trim()
  if (!token) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // ─── Parse body ─────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: 'validation_failed',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }
  const { instruction, currentTiers: bodyTiers } = parsed.data

  // ─── Load + authorise (same guards as /edit) ───────────────
  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, tenant_id, intake_id, status, paid_at, good, better, best, needs_inspection, scope_of_works, assumptions',
    )
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) return Response.json({ ok: false, error: 'no_quote' }, { status: 404 })
  if (!quote.tenant_id) {
    return Response.json({ ok: false, error: 'unscoped_quote' }, { status: 403 })
  }
  if (quote.paid_at) {
    return Response.json({ ok: false, error: 'quote_already_paid' }, { status: 409 })
  }
  if (quote.needs_inspection) {
    return Response.json(
      {
        ok: false,
        error: 'cannot_edit_inspection_quote',
        hint: 'Inspection-required quotes are flat $99 — there are no tiers to edit.',
      },
      { status: 409 },
    )
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, owner_user_id')
    .eq('id', quote.tenant_id)
    .maybeSingle()
  if (!tenant || tenant.owner_user_id !== userId) {
    return Response.json({ ok: false, error: 'not_owner' }, { status: 403 })
  }

  // ─── Pricing context (GST handling + grounding) ────────────
  const { data: pricingBook } = await supabase
    .from('pricing_book')
    .select(
      'trade, hourly_rate, apprentice_rate, senior_rate, call_out_minimum, default_markup_pct, min_labour_hours, after_hours_multiplier',
    )
    .eq('tenant_id', quote.tenant_id)
    .limit(1)
    .maybeSingle()
  if (!pricingBook || pricingBook.hourly_rate == null || pricingBook.default_markup_pct == null) {
    return Response.json(
      {
        ok: false,
        error: 'pricing_book_misconfigured',
        hint:
          "This tenant's pricing_book is missing required fields (hourly_rate, " +
          'default_markup_pct). Cannot propose grounded edits. Re-check the Pricing tab.',
      },
      { status: 409 },
    )
  }

  const { data: intake } = await supabase
    .from('intakes')
    .select('trade')
    .eq('id', quote.intake_id)
    .maybeSingle()

  const trade =
    (intake?.trade as string | null | undefined) ??
    (pricingBook.trade as string | null | undefined) ??
    'electrical'

  const pricingBookForValidation: PricingBookForValidation = {
    hourly_rate: pricingBook.hourly_rate as number | string,
    apprentice_rate: (pricingBook.apprentice_rate ?? pricingBook.hourly_rate) as number | string,
    senior_rate: pricingBook.senior_rate as number | string | null | undefined,
    call_out_minimum: (pricingBook.call_out_minimum ?? 0) as number | string,
    default_markup_pct: pricingBook.default_markup_pct as number | string,
    min_labour_hours: pricingBook.min_labour_hours as number | string | undefined,
    after_hours_multiplier: pricingBook.after_hours_multiplier as
      | number
      | string
      | null
      | undefined,
  }

  // ─── Resolve the tiers to edit ─────────────────────────────
  const currentTiers: ChatEditTiers = bodyTiers
    ? {
        ...(bodyTiers.good !== undefined ? { good: bodyTiers.good as ChatEditTier } : {}),
        ...(bodyTiers.better !== undefined ? { better: bodyTiers.better as ChatEditTier } : {}),
        ...(bodyTiers.best !== undefined ? { best: bodyTiers.best as ChatEditTier } : {}),
      }
    : {
        good: dbTierToChatEdit(quote.good as DbTier, 'good'),
        better: dbTierToChatEdit(quote.better as DbTier, 'better'),
        best: dbTierToChatEdit(quote.best as DbTier, 'best'),
      }

  // ─── Candidates + propose ──────────────────────────────────
  try {
    const candidates = await loadCandidatePrices(
      pricingBookForValidation,
      trade,
      quote.tenant_id as string,
    )
    const result = await proposeQuoteEdit({
      instruction,
      currentTiers,
      trade,
      tenantId: quote.tenant_id as string,
      pricingBook: pricingBookForValidation,
      candidates,
      scopeOfWorks: (quote.scope_of_works as string | null) ?? null,
      assumptions: (quote.assumptions as unknown) ?? null,
    })
    return Response.json({ ok: true, ...result })
  } catch (e: unknown) {
    console.error('[quote/chat-edit] propose failed', {
      quoteId,
      error: e instanceof Error ? e.message : String(e),
    })
    return Response.json(
      {
        ok: false,
        error: 'propose_failed',
        hint: "Couldn't draft that change — try rephrasing the instruction.",
      },
      { status: 502 },
    )
  }
}
