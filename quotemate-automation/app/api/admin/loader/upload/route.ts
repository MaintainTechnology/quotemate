// POST /api/admin/loader/upload — admin bulk loader: upload + validate +
// stage a trade bundle (spec §8 steps 1-5).
//
// Accepts any of: a `newTrade` (creates a trade — §2.1 install/job-based
// gate enforced), a Categories CSV, a Services CSV, a Materials CSV. They
// stage into ONE batch; the commit transaction (migration 053) applies them
// in dependency order (trade → categories → services/materials).
//
// Admin-only (§9 rule 4). Structural-then-row validation (§9 rule 10): a
// structurally-bad CSV is rejected WHOLE before any batch is created. Valid
// rows are staged in import_staged_rows; nothing touches a live table until
// Approve. Idempotent on idempotencyKey (§9 rule 12).

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import {
  planServicesUpload,
  planMaterialsUpload,
  planCategoriesUpload,
  type UploadPlan,
  type StagedRow,
} from '@/lib/admin-loader/batch'
import {
  serviceKey,
  type ServicesRowContext,
} from '@/lib/admin-loader/services-csv'
import { tradeNameKey } from '@/lib/admin-loader/csv'
import type { MaterialsRowContext } from '@/lib/admin-loader/materials-csv'
import type { CategoriesRowContext } from '@/lib/admin-loader/categories-csv'
import { createBatch, stageRows, loadBatch } from '@/lib/admin-loader/store'
import {
  smokeTestServiceRow,
  type SmokeContext,
  type SmokeTradeContext,
} from '@/lib/admin-loader/smoke'

export const dynamic = 'force-dynamic'
// CSV parse + staging inserts can exceed Vercel Hobby's 10s — mirrors the
// raised limit on the other CSV / LLM routes (CLAUDE.md conventions).
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Trade-defaults block (spec §7.5) → trade_pricing_defaults. Required for a
// new trade — §10 step 2 seeds a tenant's pricing_book from this row, and
// without it every quote for the trade fails (the WP1 failure class).
const TradeDefaultsSchema = z.object({
  hourlyRate: z.number().positive().max(10_000),
  callOutMinimum: z.number().nonnegative().max(100_000),
  apprenticeRate: z.number().nonnegative().max(10_000),
  seniorRate: z.number().nonnegative().max(10_000).optional(),
  defaultMarkupPct: z.number().nonnegative().max(500),
  riskBufferPct: z.number().nonnegative().max(500),
  minLabourHours: z.number().nonnegative().max(100),
  gstRegistered: z.boolean(),
  licenceLabel: z.string().trim().max(120).optional(),
})

// Prompt pack (spec §6) → trade_prompts. Authored, not CSV. Optional at
// trade-creation — the §8 smoke-test is the backstop for a missing/bad pack.
const TradePromptsSchema = z.object({
  estimatorSystemPrompt: z.string().trim().max(60_000).optional(),
  smsScopeBlurb: z.string().trim().max(4_000).optional(),
  smsTradeRules: z.string().trim().max(4_000).optional(),
  voiceGreeting: z.string().trim().max(2_000).optional(),
  voiceSystemPrompt: z.string().trim().max(20_000).optional(),
})

const UploadSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  services: z.string().max(2_000_000).optional(),
  materials: z.string().max(2_000_000).optional(),
  categories: z.string().max(2_000_000).optional(),
  // New-trade creation. `name` is a lowercase slug; `isJobBased` is the
  // §2.1 gate — the loader serves install/job-based trades only. `defaults`
  // is the §7.5 trade-defaults block; `prompts` is the optional §6 pack.
  newTrade: z
    .object({
      name: z
        .string()
        .trim()
        .min(2)
        .max(40)
        .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscore only'),
      displayName: z.string().trim().max(80).optional(),
      isJobBased: z.boolean(),
      defaults: TradeDefaultsSchema,
      prompts: TradePromptsSchema.optional(),
    })
    .optional(),
})

export async function POST(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = UploadSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { idempotencyKey, services, materials, categories, newTrade } = parsed.data
  if (!services && !materials && !categories && !newTrade) {
    return Response.json(
      { error: 'no_input', message: 'Provide a new trade and/or at least one CSV.' },
      { status: 400 },
    )
  }

  // §2.1 hard gate — recurring-service trades are out of scope.
  if (newTrade && !newTrade.isJobBased) {
    return Response.json(
      {
        error: 'not_job_based',
        message:
          'The loader serves install/job-based trades only — ones that quote a discrete Good/Better/Best job. Confirm the §2.1 gate to proceed.',
      },
      { status: 400 },
    )
  }

  // Validation context — every DB-derived input the planners + the
  // smoke-test harness need. Assemblies/materials also carry price +
  // category so they can seed the smoke-test's grounding candidate pool.
  const [tradesRes, catsRes, asmRes, matRes, tenantsRes, defaultsRes] =
    await Promise.all([
      supabase.from('trades').select('name'),
      supabase.from('categories').select('name, trades(name)'),
      supabase
        .from('shared_assemblies')
        .select('trade, name, default_unit_price_ex_gst, category'),
      supabase
        .from('shared_materials')
        .select('trade, name, default_unit_price_ex_gst'),
      supabase.from('tenants').select('trade, trades'),
      supabase
        .from('trade_pricing_defaults')
        .select(
          'hourly_rate, apprentice_rate, senior_rate, call_out_minimum, default_markup_pct, min_labour_hours, trades(name)',
        ),
    ])

  const knownTrades = new Set(
    (tradesRes.data ?? []).map((r) => r.name as string),
  )
  const knownCategories = new Set(
    (catsRes.data ?? []).map((r) => r.name as string),
  )
  // existingCategoryKeys keys on (trade, category) — the categories embed
  // resolves trade_id back to the trade name.
  const existingCategoryKeys = new Set(
    (catsRes.data ?? [])
      .map((r) => {
        const tradeRel = r.trades as { name?: string } | { name?: string }[] | null
        const tradeName = Array.isArray(tradeRel) ? tradeRel[0]?.name : tradeRel?.name
        return tradeName ? tradeNameKey(tradeName, r.name as string) : null
      })
      .filter((k): k is string => k !== null),
  )
  const existingServiceKeys = new Set(
    (asmRes.data ?? []).map((r) => serviceKey(r.trade as string, r.name as string)),
  )
  const existingMaterialKeys = new Set(
    (matRes.data ?? []).map((r) =>
      tradeNameKey(r.trade as string, r.name as string),
    ),
  )
  // §9 rule 3 — a trade is "live" if any tenant covers it.
  const liveTrades = new Set<string>()
  for (const t of tenantsRes.data ?? []) {
    if (t.trade) liveTrades.add(t.trade as string)
    for (const x of (t.trades as string[] | null) ?? []) liveTrades.add(x)
  }
  const tradeHasLiveTenants = (t: string) => liveTrades.has(t)

  // A trade being created in this batch is valid for the CSVs in the same
  // batch (commit ordering inserts the trade first). A new-trade bundle
  // stages three rows up front — the trade, its pricing defaults (§7.5,
  // always) and its prompt pack (§6, when authored) — all keyed to the
  // trade by name; the commit resolves trade_id after the trade is inserted.
  const effectiveTrades = new Set(knownTrades)
  const tradeBundleRows: StagedRow[] = []
  if (newTrade) {
    if (knownTrades.has(newTrade.name)) {
      return Response.json(
        {
          error: 'trade_exists',
          message: `Trade "${newTrade.name}" already exists — drop the newTrade field to add to it.`,
        },
        { status: 400 },
      )
    }
    effectiveTrades.add(newTrade.name)
    tradeBundleRows.push({
      target_table: 'trades',
      row_class: 'NEW',
      payload: {
        name: newTrade.name,
        display_name: newTrade.displayName ?? '',
        is_job_based: true,
      },
    })
    const d = newTrade.defaults
    tradeBundleRows.push({
      target_table: 'trade_pricing_defaults',
      row_class: 'NEW',
      payload: {
        trade: newTrade.name,
        hourly_rate: d.hourlyRate,
        call_out_minimum: d.callOutMinimum,
        apprentice_rate: d.apprenticeRate,
        senior_rate: d.seniorRate ?? '',
        default_markup_pct: d.defaultMarkupPct,
        risk_buffer_pct: d.riskBufferPct,
        min_labour_hours: d.minLabourHours,
        gst_registered: d.gstRegistered,
        licence_label: d.licenceLabel ?? '',
      },
    })
    const p = newTrade.prompts
    // Stage a trade_prompts row only when the pack carries at least one
    // non-empty field — an all-blank pack is left for later authoring.
    if (
      p &&
      (p.estimatorSystemPrompt ||
        p.smsScopeBlurb ||
        p.smsTradeRules ||
        p.voiceGreeting ||
        p.voiceSystemPrompt)
    ) {
      tradeBundleRows.push({
        target_table: 'trade_prompts',
        row_class: 'NEW',
        payload: {
          trade: newTrade.name,
          estimator_system_prompt: p.estimatorSystemPrompt ?? '',
          sms_scope_blurb: p.smsScopeBlurb ?? '',
          sms_trade_rules: p.smsTradeRules ?? '',
          voice_greeting: p.voiceGreeting ?? '',
          voice_system_prompt: p.voiceSystemPrompt ?? '',
        },
      })
    }
  }

  // Plan categories FIRST so the new category names are available to the
  // services validation (a service may name a category created this batch).
  const plans: UploadPlan[] = []
  if (categories) {
    plans.push(
      planCategoriesUpload(categories, {
        knownTrades: effectiveTrades,
        existingCategoryKeys,
      } satisfies CategoriesRowContext),
    )
  }
  const catPlan = plans.find((p) => p.ok && p.csv === 'categories')
  const batchCategories = new Set<string>(
    catPlan && catPlan.ok
      ? catPlan.stagedRows.map((r) => String(r.payload.name))
      : [],
  )

  const svcCtx: ServicesRowContext = {
    knownTrades: effectiveTrades,
    knownCategories,
    batchCategories,
    existingServiceKeys,
    tradeHasLiveTenants,
  }
  const matCtx: MaterialsRowContext = {
    knownTrades: effectiveTrades,
    existingMaterialKeys,
  }

  if (services) plans.push(planServicesUpload(services, svcCtx))
  if (materials) plans.push(planMaterialsUpload(materials, matCtx))

  // §9 rule 10 — a structurally-bad CSV is rejected whole, no batch created.
  const structural = plans.filter(
    (p): p is Extract<UploadPlan, { ok: false }> => !p.ok,
  )
  if (structural.length > 0) {
    return Response.json(
      {
        error: 'structural_validation_failed',
        csvs: structural.map((p) => ({ csv: p.csv, errors: p.structuralErrors })),
      },
      { status: 400 },
    )
  }
  const okPlans = plans as Extract<UploadPlan, { ok: true }>[]

  // ── §8 step 7 — smoke-test every NEW service ──────────────────────
  // Build per-trade grounding context (pricing defaults + candidate rows
  // = live shared_* PLUS this batch's NEW staged rows) and stamp each NEW
  // shared_assemblies staged row with a smoke_status. A row whose sample
  // quote will not ground is held in staging — commit_import_batch gates
  // on smoke_status (§9 rule 7). UPDATE service rows + non-service rows
  // are left unstamped → stageRows persists 'skipped'.
  const stagedAssemblyRows = okPlans
    .filter((p) => p.target_table === 'shared_assemblies')
    .flatMap((p) => p.stagedRows)
  const stagedMaterialRows = okPlans
    .filter((p) => p.target_table === 'shared_materials')
    .flatMap((p) => p.stagedRows)

  const smokeByTrade = new Map<string, SmokeTradeContext>()
  for (const trade of effectiveTrades) {
    let defaults: SmokeTradeContext['defaults'] | null = null
    if (newTrade && trade === newTrade.name) {
      const d = newTrade.defaults
      defaults = {
        hourly_rate: d.hourlyRate,
        apprentice_rate: d.apprenticeRate,
        senior_rate: d.seniorRate ?? null,
        call_out_minimum: d.callOutMinimum,
        default_markup_pct: d.defaultMarkupPct,
        min_labour_hours: d.minLabourHours,
      }
    } else {
      const row = (defaultsRes.data ?? []).find((r) => {
        const rel = r.trades as { name?: string } | { name?: string }[] | null
        const name = Array.isArray(rel) ? rel[0]?.name : rel?.name
        return name === trade
      })
      if (row) {
        defaults = {
          hourly_rate: Number(row.hourly_rate),
          apprentice_rate: Number(row.apprentice_rate),
          senior_rate:
            row.senior_rate != null ? Number(row.senior_rate) : null,
          call_out_minimum: Number(row.call_out_minimum),
          default_markup_pct: Number(row.default_markup_pct),
          min_labour_hours: Number(row.min_labour_hours),
        }
      }
    }
    // A trade with no pricing defaults is simply absent from the context;
    // smokeTestServiceRow then fails its rows loud with a clear reason.
    if (!defaults) continue

    const liveAsm = (asmRes.data ?? [])
      .filter((r) => r.trade === trade)
      .map((r) => ({
        name: r.name as string,
        price: r.default_unit_price_ex_gst as number | string | null,
        category: (r.category as string | null) ?? null,
      }))
    const batchAsm = stagedAssemblyRows
      .filter((r) => String(r.payload.trade) === trade)
      .map((r) => ({
        name: String(r.payload.name),
        price: r.payload.default_unit_price_ex_gst as number | string | null,
        category: (r.payload.category as string | null) ?? null,
      }))
    const liveMat = (matRes.data ?? [])
      .filter((r) => r.trade === trade)
      .map((r) => ({
        name: r.name as string,
        price: r.default_unit_price_ex_gst as number | string | null,
      }))
    const batchMat = stagedMaterialRows
      .filter((r) => String(r.payload.trade) === trade)
      .map((r) => ({
        name: String(r.payload.name),
        price: r.payload.default_unit_price_ex_gst as number | string | null,
      }))

    smokeByTrade.set(trade, {
      defaults,
      candidateAssemblies: [...liveAsm, ...batchAsm],
      candidateMaterials: [...liveMat, ...batchMat],
    })
  }
  const smokeCtx: SmokeContext = { byTrade: smokeByTrade }

  let smokeFailedCount = 0
  for (const row of stagedAssemblyRows) {
    if (row.row_class !== 'NEW') continue
    const res = smokeTestServiceRow(row.payload, smokeCtx)
    row.smoke_status = res.status
    row.smoke_reason = res.reason
    if (res.status === 'failed') smokeFailedCount++
  }

  const source =
    [
      newTrade ? 'trade' : null,
      categories ? 'categories' : null,
      services ? 'services' : null,
      materials ? 'materials' : null,
    ]
      .filter(Boolean)
      .join('+') || 'manual'

  const batch = await createBatch(supabase, {
    idempotencyKey,
    adminUserId: adminId,
    source,
  })
  if (!batch.ok) {
    return Response.json(
      { error: 'batch_create_failed', message: batch.error },
      { status: 500 },
    )
  }

  // Idempotent replay — the rows were already staged on the first call.
  if (batch.alreadyExists) {
    const loaded = await loadBatch(supabase, batch.batchId)
    return Response.json({
      ok: true,
      idempotentReplay: true,
      batchId: batch.batchId,
      batch: loaded.ok ? loaded.batch : null,
    })
  }

  const allStaged: StagedRow[] = [
    ...tradeBundleRows,
    ...okPlans.flatMap((p) => p.stagedRows),
  ]
  const staged = await stageRows(supabase, batch.batchId, allStaged)
  if (!staged.ok) {
    return Response.json(
      { error: 'staging_failed', message: staged.error },
      { status: 500 },
    )
  }

  return Response.json({
    ok: true,
    batchId: batch.batchId,
    newTrade: newTrade
      ? { name: newTrade.name, displayName: newTrade.displayName ?? null }
      : null,
    // §8 step 7 — count of NEW services held back by the smoke-test. A
    // non-zero count means the commit will skip those rows (§9 rule 7).
    smokeFailedCount,
    preview: okPlans.map((p) => ({
      csv: p.csv,
      target_table: p.target_table,
      summary: p.summary,
      forcedDisabledCount: p.forcedDisabledCount,
      stagedRows: p.stagedRows.map((r) => ({
        row_class: r.row_class,
        payload: r.payload,
        smoke_status: r.smoke_status ?? 'skipped',
        smoke_reason: r.smoke_reason ?? null,
      })),
      rejected: p.rejected,
    })),
  })
}
