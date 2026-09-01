import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseTenantAcRateCard } from './recommend'
import type { AcRateCard } from './types'

export type AcPricingAuthority = {
  source: 'tenant_pricing_book'
  tenant_id: string
  pricing_book_id: string
  revision: string
}

export type TenantAcPricingContext = {
  rateCard: AcRateCard
  authority: AcPricingAuthority
}

export function acPricingAuthorityMatches(
  stored: AcPricingAuthority,
  current: TenantAcPricingContext | null,
  tenantId: string,
): boolean {
  return Boolean(
    current &&
      stored.source === 'tenant_pricing_book' &&
      stored.tenant_id === tenantId &&
      stored.pricing_book_id === current.authority.pricing_book_id &&
      stored.revision === current.authority.revision,
  )
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

/** A deterministic server revision over the exact complete card used for money. */
export function acPricingRevision(pricingBookId: string, rateCard: AcRateCard): string {
  return createHash('sha256')
    .update(stableJson({ pricingBookId, rateCard }))
    .digest('hex')
}

/** Load only a complete tenant-authored card and its persisted book identity.
 * Missing/malformed cards never inherit a global or hard-coded price. */
export async function loadTenantAcPricingContext(
  db: SupabaseClient,
  tenantId: string,
  primaryTrade: string | null,
): Promise<TenantAcPricingContext | null> {
  try {
    const { data, error } = await db
      .from('pricing_book')
      .select('id, trade, overlays')
      .eq('tenant_id', tenantId)
    if (error) return null
    const rows = (Array.isArray(data) ? data : []) as PricingBookRow[]
    const carded = rows
      .map((row) => ({ row, rateCard: parseTenantAcRateCard(row.overlays?.aircon_rate_card) }))
      .filter(
        (entry): entry is { row: PricingBookRow; rateCard: AcRateCard } => entry.rateCard !== null,
      )
    const selected =
      (primaryTrade ? carded.find(({ row }) => row.trade === primaryTrade) : undefined) ??
      carded.find(({ row }) => row.trade === 'aircon') ??
      [...carded].sort((a, b) => String(a.row.trade).localeCompare(String(b.row.trade)))[0]
    if (!selected?.row.id) return null
    return {
      rateCard: selected.rateCard,
      authority: {
        source: 'tenant_pricing_book',
        tenant_id: tenantId,
        pricing_book_id: selected.row.id,
        revision: acPricingRevision(selected.row.id, selected.rateCard),
      },
    }
  } catch {
    return null
  }
}

/** Back-compat read helper for non-customer-facing internal callers. New money
 * paths should retain and persist the full context above. */
export async function loadTenantAcRateCard(
  db: SupabaseClient,
  tenantId: string,
  primaryTrade: string | null,
): Promise<AcRateCard | null> {
  return (await loadTenantAcPricingContext(db, tenantId, primaryTrade))?.rateCard ?? null
}
