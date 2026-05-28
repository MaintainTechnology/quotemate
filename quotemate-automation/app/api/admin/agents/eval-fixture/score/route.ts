// POST /api/admin/agents/eval-fixture/score
//
// Eval-Agent Phase 2 entry point. The agent on Railway sends a fixture's
// `intake` payload here; we run runEstimation() in-process against a
// designated "eval tenant" (EVAL_TENANT_ID env var), shape the resulting
// draft into the ActualEstimatorOutput contract the scoring rubric
// expects, and return.
//
// No DB pollution: the fixture is NOT inserted into the intakes table.
// runEstimation reads from the catalogue tables (shared_assemblies,
// shared_materials, etc.) — those reads are the real ones we want
// scored. The draft we return is never persisted.
//
// Auth: dedicated `QUOTEMATE_AGENTS_BEARER` header — same secret on both
// sides, no admin Supabase user required. Service-to-service.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { runEstimation } from '@/lib/estimate/run'
import { resolvePricingBookForIntake } from '@/lib/estimate/pricing-book'

export const dynamic = 'force-dynamic'
// Eval runs hit Opus + tool calls — give the function the same headroom
// the live /api/estimate/draft route has so we don't time out mid-pass.
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  // The fixture's intake object — same shape as an intakes row, no id.
  intake: z.object({
    trade: z.enum(['electrical', 'plumbing']),
    job_type: z.string().min(1).max(40),
    scope: z.record(z.string(), z.unknown()).optional(),
    access: z.record(z.string(), z.unknown()).optional(),
    property: z.record(z.string(), z.unknown()).optional(),
    risks: z.array(z.string()).optional(),
    caller: z.record(z.string(), z.unknown()).optional(),
    suburb: z.string().optional(),
    address: z.string().optional(),
  }),
  /** Optional override — defaults to EVAL_TENANT_ID env. Lets the agent
   *  pin a different tenant per fixture in future. */
  tenant_id: z.string().uuid().optional(),
  /** Optional model override — defaults to claude-opus-4-7. */
  model_id: z.string().optional(),
})

function checkBearer(req: Request): boolean {
  const expected = process.env.QUOTEMATE_AGENTS_BEARER
  if (!expected) return false
  const got = req.headers.get('authorization') ?? ''
  if (!got.toLowerCase().startsWith('bearer ')) return false
  return got.slice(7).trim() === expected
}

export async function POST(req: Request) {
  if (!checkBearer(req)) {
    return Response.json(
      { ok: false, error: 'unauthorised' },
      { status: 401 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    )
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const tenantId = parsed.data.tenant_id ?? process.env.EVAL_TENANT_ID
  if (!tenantId) {
    return Response.json(
      {
        ok: false,
        error: 'eval_tenant_not_configured',
        message:
          'Set EVAL_TENANT_ID env var (the tenant whose pricing_book the eval scores against) or pass tenant_id in the body.',
      },
      { status: 503 },
    )
  }

  const { intake } = parsed.data
  const modelId = parsed.data.model_id || 'claude-opus-4-7'

  // ── Load pricing_book for (tenant, trade) ─────────────────────────
  const { data: tenantBook, error: bookErr } = await supabase
    .from('pricing_book')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('trade', intake.trade)
    .maybeSingle()
  if (bookErr) {
    return Response.json({ ok: false, error: bookErr.message }, { status: 500 })
  }
  const bookResolution = resolvePricingBookForIntake({
    intakeTenantId: tenantId,
    intakeTrade: intake.trade,
    tenantBook,
  })
  if (!bookResolution.ok) {
    return Response.json(
      {
        ok: false,
        error: 'pricing_book_unresolved',
        code: bookResolution.code,
        reason: bookResolution.reason,
      },
      { status: 503 },
    )
  }

  // ── Stamp tenant_id on the intake so runEstimation's downstream
  // tools scope catalogue lookups to this tenant's overlays. The fixture
  // doesn't carry one — we inject the eval tenant. ────────────────────
  const stampedIntake = {
    ...intake,
    tenant_id: tenantId,
    // Synthetic id — never persisted, just used for log lines inside
    // runEstimation (pipelineLog + tracer). Prefixed so it can't be
    // confused with a real intake id.
    id: `eval-fixture-${Date.now()}`,
  }

  try {
    const result = await runEstimation(stampedIntake, bookResolution.pricingBook, modelId, null)

    // Shape into the ActualEstimatorOutput contract the agent's scorer
    // expects. Pick the selected tier (mirror /api/estimate/draft logic).
    const draft = result.draft ?? {}
    const isInspection =
      result.downgradedToInspection === true || draft.needs_inspection === true

    if (isInspection) {
      // The validator routes to $99 inspection; that's a real signal —
      // surface it as the actual output so the scorer's "routing"
      // dimension can grade correctly.
      return Response.json({
        ok: true,
        eval_tenant_id: tenantId,
        model_id: modelId,
        downgraded_to_inspection: true,
        actual: {
          total_inc_gst: 99,
          selected_tier: 'inspection',
          materials: [],
          inspection: true,
        },
        grounding_failures: result.groundingFailures ?? [],
      })
    }

    // Pick the live default tier (mirrors draft/route.ts heuristic):
    // honour draft.selected_tier, else 'better', else 'good', else 'best'.
    const selected =
      draft.selected_tier === 'good' || draft.selected_tier === 'better' || draft.selected_tier === 'best'
        ? draft.selected_tier
        : draft.better
          ? 'better'
          : draft.good
            ? 'good'
            : 'best'
    const tier = draft[selected]
    const subtotal = Number(tier?.subtotal_ex_gst ?? 0)
    const gstRegistered = (bookResolution.pricingBook as { gst_registered?: boolean }).gst_registered !== false
    const totalIncGst = gstRegistered
      ? Math.round(subtotal * 1.1 * 100) / 100
      : Math.round(subtotal * 100) / 100

    // Collect material categories used across the selected tier so the
    // scorer's material dimension has something to compare against the
    // expected list.
    const lineItems = Array.isArray(tier?.line_items) ? tier.line_items : []
    const materials = lineItems
      .filter((li: { source?: string }) => {
        const s = String(li?.source ?? '')
        return s.startsWith('material')
      })
      .map((li: { description?: string; catalogue_id?: string }) => ({
        // We don't have a clean category column on the line — fall back
        // to scraping it from the description. Good enough for the
        // category-only scoreMaterial check.
        category: String(li?.description ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .slice(0, 40),
      }))

    return Response.json({
      ok: true,
      eval_tenant_id: tenantId,
      model_id: modelId,
      actual: {
        total_inc_gst: totalIncGst,
        selected_tier: selected,
        materials,
        inspection: false,
      },
      // Optional debug payload — the agent ignores by default, useful for
      // ad-hoc inspection.
      debug: {
        subtotal_ex_gst: subtotal,
        tier_label: tier?.label ?? null,
        line_item_count: lineItems.length,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json(
      { ok: false, error: 'estimator_failed', message: msg.slice(0, 400) },
      { status: 500 },
    )
  }
}
