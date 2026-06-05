// ════════════════════════════════════════════════════════════════════
// Signage Compliance — brand resolution (I/O + a pure chooser).
//
// The engine is brand-agnostic: it reads a BrandConfig (a `brands` row)
// for the persona, location noun, HQ name, shot list and Gemini file-search
// store(s). Multi-brand tabs select the active brand per request via a
// `?brand=<slug>` query param; the assessment path resolves the brand from
// the stored request/sweep brand_slug. Both go through `loadBrand`.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandConfig, ShotDef } from './types'

const BRAND_COLUMNS =
  'slug, name, location_noun, location_noun_plural, hq_name, vision_persona, shots, kb_store_ids'

/** A safe, generic fallback so the flow never hard-fails on a missing or
 *  mis-seeded brand row. (Real brands always come from the `brands` table.) */
export const FALLBACK_BRAND: BrandConfig = {
  slug: 'unknown',
  name: 'Brand',
  location_noun: 'location',
  location_noun_plural: 'locations',
  hq_name: 'HQ',
  vision_persona: 'the brand’s locations',
  shots: [],
}

/** Lightweight brand descriptor for the dashboard tab switcher. */
export type BrandSummary = {
  slug: string
  name: string
  location_noun: string
  location_noun_plural: string
}

function mapBrandRow(row: Record<string, unknown>): BrandConfig {
  const shots = Array.isArray(row.shots)
    ? (row.shots as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          slot: String(s.slot ?? ''),
          label: String(s.label ?? s.slot ?? ''),
          instruction: String(s.instruction ?? ''),
        }))
        .filter((s: ShotDef) => s.slot !== '')
    : []
  const kbStoreIds = Array.isArray(row.kb_store_ids)
    ? (row.kb_store_ids as unknown[]).map((x) => String(x)).filter((x) => x !== '')
    : []
  return {
    slug: String(row.slug ?? 'unknown'),
    name: String(row.name ?? 'Brand'),
    location_noun: String(row.location_noun ?? 'location'),
    location_noun_plural: String(row.location_noun_plural ?? 'locations'),
    hq_name: String(row.hq_name ?? 'HQ'),
    vision_persona: String(row.vision_persona ?? 'the brand’s locations'),
    shots,
    kb_store_ids: kbStoreIds,
  }
}

export function brandSummary(b: BrandConfig): BrandSummary {
  return { slug: b.slug, name: b.name, location_noun: b.location_noun, location_noun_plural: b.location_noun_plural }
}

export async function loadBrand(supabase: SupabaseClient, slug: string): Promise<BrandConfig> {
  const { data } = await supabase
    .from('brands')
    .select(BRAND_COLUMNS)
    .eq('slug', slug)
    .maybeSingle()
  return data ? mapBrandRow(data as Record<string, unknown>) : { ...FALLBACK_BRAND, slug }
}

/** All active brands (the tab list). Ordered name-ascending. */
export async function listActiveBrands(supabase: SupabaseClient): Promise<BrandConfig[]> {
  const { data } = await supabase
    .from('brands')
    .select(BRAND_COLUMNS)
    .eq('active', true)
    .order('name')
  return (data ?? []).map((r) => mapBrandRow(r as Record<string, unknown>))
}

/** Resolve the brand for an org (via orgs.brand_slug). The org's brand is the
 *  fallback when no explicit tab/brand is selected. */
export async function brandForOrg(supabase: SupabaseClient, orgId: string): Promise<BrandConfig> {
  const { data: org } = await supabase.from('orgs').select('brand_slug').eq('id', orgId).maybeSingle()
  const slug = (org?.brand_slug as string | null) ?? 'f45'
  return loadBrand(supabase, slug)
}

/** PURE — pick the active brand slug: the requested one if it's a known
 *  active brand (case-insensitive), else the fallback. Never returns an
 *  unknown brand, so a tampered `?brand=` can't escape the org's brands. */
export function chooseBrandSlug(
  requested: string | null | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  const want = (requested ?? '').trim().toLowerCase()
  if (want) {
    const hit = allowed.find((s) => s.toLowerCase() === want)
    if (hit) return hit
  }
  return fallback
}

/** Resolve the brand selected by a dashboard request: read `?brand=`,
 *  validate against the active brands, fall back to the org's brand. Returns
 *  the chosen BrandConfig plus the tab list for the UI. */
export async function resolveSignageBrand(
  supabase: SupabaseClient,
  req: Request,
  orgId: string,
): Promise<{ brand: BrandConfig; brands: BrandSummary[]; slug: string }> {
  const requested = new URL(req.url).searchParams.get('brand')
  const [actives, { data: org }] = await Promise.all([
    listActiveBrands(supabase),
    supabase.from('orgs').select('brand_slug').eq('id', orgId).maybeSingle(),
  ])
  const fallback = (org?.brand_slug as string | null) ?? 'f45'
  const allowed = actives.map((b) => b.slug)
  const slug = chooseBrandSlug(requested, allowed, fallback)
  const brand = actives.find((b) => b.slug === slug) ?? (await loadBrand(supabase, slug))
  return { brand, brands: actives.map(brandSummary), slug }
}
