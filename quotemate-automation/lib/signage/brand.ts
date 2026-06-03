// ════════════════════════════════════════════════════════════════════
// Signage Compliance — brand resolution (I/O).
//
// The engine is brand-agnostic: it reads a BrandConfig (a `brands` row)
// for the persona, location noun, HQ name and shot list, instead of the
// old F45 constants. Resolve the brand from the org that owns a sweep /
// request / assessment.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandConfig, ShotDef } from './types'

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
  return {
    slug: String(row.slug ?? 'unknown'),
    name: String(row.name ?? 'Brand'),
    location_noun: String(row.location_noun ?? 'location'),
    location_noun_plural: String(row.location_noun_plural ?? 'locations'),
    hq_name: String(row.hq_name ?? 'HQ'),
    vision_persona: String(row.vision_persona ?? 'the brand’s locations'),
    shots,
  }
}

export async function loadBrand(supabase: SupabaseClient, slug: string): Promise<BrandConfig> {
  const { data } = await supabase
    .from('brands')
    .select('slug, name, location_noun, location_noun_plural, hq_name, vision_persona, shots')
    .eq('slug', slug)
    .maybeSingle()
  return data ? mapBrandRow(data as Record<string, unknown>) : { ...FALLBACK_BRAND, slug }
}

/** Resolve the brand for an org (via orgs.brand_slug). */
export async function brandForOrg(supabase: SupabaseClient, orgId: string): Promise<BrandConfig> {
  const { data: org } = await supabase.from('orgs').select('brand_slug').eq('id', orgId).maybeSingle()
  const slug = (org?.brand_slug as string | null) ?? 'f45'
  return loadBrand(supabase, slug)
}
