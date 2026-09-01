import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RoofingRateCard } from './types'
import {
  EDITABLE_MATERIALS,
  MAX_ACCESSORY_RATE_EACH,
  MAX_ACCESSORY_RATE_PER_LM,
  MAX_CALL_OUT_MINIMUM,
  MAX_LOADING_PCT,
  MAX_RATE_PER_M2,
  MAX_SOLAR_ALLOWANCE,
} from './rate-card-overlay'

export type RoofingPricingAuthority = {
  source: 'tenant_pricing_book'
  tenant_id: string
  pricing_book_id: string
  revision: string
}

export type TenantRoofingPricingContext = {
  rateCard: RoofingRateCard
  authority: RoofingPricingAuthority
}

type PricingBookRow = {
  id: string
  trade: string | null
  overlays: Record<string, unknown> | null
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function finiteIn(value: unknown, min: number, max: number, inclusiveMin = true): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (inclusiveMin ? value >= min : value > min) &&
    value <= max
  )
}

/** Parse only a complete tenant-authored card. No key is filled from product
 * defaults; an incomplete editor state remains setup-required. */
export function parseTenantRoofingRateCard(value: unknown): RoofingRateCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const ratesRaw = raw.reroof_rate_per_m2
  if (!ratesRaw || typeof ratesRaw !== 'object' || Array.isArray(ratesRaw)) return null
  const rates = ratesRaw as Record<string, unknown>
  if (
    !EDITABLE_MATERIALS.every((material) =>
      finiteIn(rates[material], 0, MAX_RATE_PER_M2, false),
    )
  ) {
    return null
  }
  if (!finiteIn(raw.multi_storey_loading_pct, 0, MAX_LOADING_PCT)) return null
  if (!finiteIn(raw.asbestos_loading_pct, 0, MAX_LOADING_PCT)) return null
  if (!finiteIn(raw.complexity_loading_pct, 0, MAX_LOADING_PCT)) return null
  if (!EDITABLE_MATERIALS.includes(raw.upgrade_material as never)) return null
  if (typeof raw.gst_registered !== 'boolean') return null
  if (!finiteIn(raw.call_out_minimum_ex_gst, 0, MAX_CALL_OUT_MINIMUM)) return null

  const positiveLm = [
    'gutter_rate_per_lm',
    'fascia_rate_per_lm',
    'soffit_rate_per_lm',
    'ridge_hip_repoint_rate_per_lm',
    'valley_flashing_rate_per_lm',
    'box_gutter_rate_per_lm',
  ] as const
  if (!positiveLm.every((key) => finiteIn(raw[key], 0, MAX_ACCESSORY_RATE_PER_LM, false))) {
    return null
  }
  if (!finiteIn(raw.downpipe_rate_per_each, 0, MAX_ACCESSORY_RATE_EACH, false)) return null
  if (typeof raw.price_edge_works !== 'boolean') return null
  if (!finiteIn(raw.solar_detach_reinstate_base_ex_gst, 0, MAX_SOLAR_ALLOWANCE)) return null
  if (!finiteIn(raw.solar_detach_reinstate_per_array_ex_gst, 0, MAX_SOLAR_ALLOWANCE)) return null

  const rateMap = Object.fromEntries(
    EDITABLE_MATERIALS.map((material) => [material, rates[material] as number]),
  ) as RoofingRateCard['reroof_rate_per_m2']
  rateMap.unknown = 0

  const card: RoofingRateCard = {
    reroof_rate_per_m2: rateMap,
    multi_storey_loading_pct: raw.multi_storey_loading_pct as number,
    asbestos_loading_pct: raw.asbestos_loading_pct as number,
    upgrade_material: raw.upgrade_material as RoofingRateCard['upgrade_material'],
    gst_registered: raw.gst_registered,
    call_out_minimum_ex_gst: raw.call_out_minimum_ex_gst as number,
    gutter_rate_per_lm: raw.gutter_rate_per_lm as number,
    downpipe_rate_per_each: raw.downpipe_rate_per_each as number,
    fascia_rate_per_lm: raw.fascia_rate_per_lm as number,
    soffit_rate_per_lm: raw.soffit_rate_per_lm as number,
    ridge_hip_repoint_rate_per_lm: raw.ridge_hip_repoint_rate_per_lm as number,
    valley_flashing_rate_per_lm: raw.valley_flashing_rate_per_lm as number,
    box_gutter_rate_per_lm: raw.box_gutter_rate_per_lm as number,
    price_edge_works: raw.price_edge_works,
  }
  ;(card as RoofingRateCard & { complexity_loading_pct: number }).complexity_loading_pct =
    raw.complexity_loading_pct as number
  ;(
    card as RoofingRateCard & {
      solar_detach_reinstate_base_ex_gst: number
      solar_detach_reinstate_per_array_ex_gst: number
    }
  ).solar_detach_reinstate_base_ex_gst = raw.solar_detach_reinstate_base_ex_gst as number
  ;(
    card as RoofingRateCard & {
      solar_detach_reinstate_base_ex_gst: number
      solar_detach_reinstate_per_array_ex_gst: number
    }
  ).solar_detach_reinstate_per_array_ex_gst =
    raw.solar_detach_reinstate_per_array_ex_gst as number
  return card
}

export function roofingPricingRevision(
  pricingBookId: string,
  rateCard: RoofingRateCard,
): string {
  return createHash('sha256')
    .update(stableJson({ pricingBookId, rateCard }))
    .digest('hex')
}

export async function loadTenantRoofingPricingContext(
  db: SupabaseClient,
  tenantId: string,
  primaryTrade: string | null,
): Promise<TenantRoofingPricingContext | null> {
  try {
    const { data, error } = await db
      .from('pricing_book')
      .select('id, trade, overlays')
      .eq('tenant_id', tenantId)
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as PricingBookRow[]
    const carded = rows
      .map((row) => ({
        row,
        rateCard: parseTenantRoofingRateCard(row.overlays?.roofing_rate_card),
      }))
      .filter(
        (entry): entry is { row: PricingBookRow; rateCard: RoofingRateCard } =>
          entry.rateCard !== null,
      )
    const selected =
      (primaryTrade ? carded.find(({ row }) => row.trade === primaryTrade) : undefined) ??
      carded.find(({ row }) => row.trade === 'roofing') ??
      [...carded].sort((a, b) => String(a.row.trade).localeCompare(String(b.row.trade)))[0]
    if (!selected?.row.id) return null
    return {
      rateCard: selected.rateCard,
      authority: {
        source: 'tenant_pricing_book',
        tenant_id: tenantId,
        pricing_book_id: selected.row.id,
        revision: roofingPricingRevision(selected.row.id, selected.rateCard),
      },
    }
  } catch {
    return null
  }
}

export function roofRunRequestDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

export type RoofPricingRunProof = {
  v: 1
  run_id: string
  tenant_id: string
  pricing_book_id: string
  pricing_revision: string
  request_digest: string
  issued_at: number
  expires_at: number
}

function signPayload(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url')
}

export function createRoofPricingRun(args: {
  context: TenantRoofingPricingContext
  requestDigest: string
  secret: string
  nowMs?: number
  ttlMs?: number
  runId?: string
}): { token: string; proof: RoofPricingRunProof } {
  const nowMs = args.nowMs ?? Date.now()
  const proof: RoofPricingRunProof = {
    v: 1,
    run_id: args.runId ?? randomBytes(16).toString('hex'),
    tenant_id: args.context.authority.tenant_id,
    pricing_book_id: args.context.authority.pricing_book_id,
    pricing_revision: args.context.authority.revision,
    request_digest: args.requestDigest,
    issued_at: nowMs,
    expires_at: nowMs + (args.ttlMs ?? 30 * 60 * 1000),
  }
  const encoded = Buffer.from(JSON.stringify(proof)).toString('base64url')
  return { token: `${encoded}.${signPayload(encoded, args.secret)}`, proof }
}

export type RoofRunVerification =
  | { ok: true; proof: RoofPricingRunProof }
  | {
      ok: false
      error:
        | 'invalid_run'
        | 'wrong_tenant'
        | 'pricing_stale'
        | 'run_expired'
        | 'run_mismatch'
    }

export function verifyRoofPricingRun(args: {
  token: string
  secret: string
  tenantId: string
  currentAuthority: RoofingPricingAuthority
  requestDigest: string
  nowMs?: number
}): RoofRunVerification {
  try {
    const [encoded, signature, extra] = args.token.split('.')
    if (!encoded || !signature || extra) return { ok: false, error: 'invalid_run' }
    const expected = Buffer.from(signPayload(encoded, args.secret))
    const actual = Buffer.from(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, error: 'invalid_run' }
    }
    const proof = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as RoofPricingRunProof
    if (
      proof.v !== 1 ||
      typeof proof.run_id !== 'string' ||
      !/^[a-f0-9]{32}$/.test(proof.run_id) ||
      !/^[a-f0-9]{64}$/.test(proof.request_digest) ||
      typeof proof.issued_at !== 'number' ||
      typeof proof.expires_at !== 'number'
    ) {
      return { ok: false, error: 'invalid_run' }
    }
    if (proof.tenant_id !== args.tenantId) return { ok: false, error: 'wrong_tenant' }
    if (
      proof.pricing_book_id !== args.currentAuthority.pricing_book_id ||
      proof.pricing_revision !== args.currentAuthority.revision
    ) {
      return { ok: false, error: 'pricing_stale' }
    }
    if ((args.nowMs ?? Date.now()) >= proof.expires_at) return { ok: false, error: 'run_expired' }
    if (proof.request_digest !== args.requestDigest) return { ok: false, error: 'run_mismatch' }
    return { ok: true, proof }
  } catch {
    return { ok: false, error: 'invalid_run' }
  }
}

export function roofMeasurementTokensForRun(args: {
  runId: string
  secret: string
}): { public_token: string; measure_token: string } {
  const token = (purpose: 'public' | 'measure') =>
    createHmac('sha256', args.secret)
      .update(`roof:${purpose}:${args.runId}`)
      .digest('hex')
      .slice(0, 32)
  return { public_token: token('public'), measure_token: token('measure') }
}
