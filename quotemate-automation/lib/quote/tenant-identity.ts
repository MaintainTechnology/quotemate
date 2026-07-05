// Tradie identity for the quote letterhead (migration 141).
//
// The reference quote surface (quotemax.com.au) prints the owning tradie's
// logo + business name + a Contact / Phone / Email strip. Those fields live on
// `tenants`: business_name / owner_* predate this; contact_name + logo_url
// arrive with migration 141. This loader mirrors the graceful-degradation
// pattern already used in app/q/[token]/page.tsx — a base select for the
// always-present columns plus a best-effort select for the migration-141
// columns, so a pre-141 deploy degrades to null rather than 500-ing a public
// quote page.

import type { SupabaseClient } from '@supabase/supabase-js'

export type TenantIdentity = {
  business_name: string | null
  contact_name: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  owner_mobile: string | null
  owner_email: string | null
  website_url: string | null
  business_address: string | null
  logo_url: string | null
}

export async function loadTenantIdentity(
  supabase: SupabaseClient,
  tenantId: string | null | undefined,
): Promise<TenantIdentity | null> {
  if (!tenantId) return null

  const { data: base } = await supabase
    .from('tenants')
    .select('business_name, owner_first_name, owner_last_name, owner_mobile, owner_email')
    .eq('id', tenantId)
    .maybeSingle()
  if (!base) return null
  const b = base as Record<string, string | null>

  // Best-effort: a pre-migration-141 deploy lacks these columns, in which case
  // supabase-js yields data:null and we fall back to nulls (no logo/contact).
  const { data: ex } = await supabase
    .from('tenants')
    .select('contact_name, website_url, business_address, logo_url')
    .eq('id', tenantId)
    .maybeSingle()
  const e = (ex ?? {}) as Record<string, string | null>

  return {
    business_name: b.business_name ?? null,
    owner_first_name: b.owner_first_name ?? null,
    owner_last_name: b.owner_last_name ?? null,
    owner_mobile: b.owner_mobile ?? null,
    owner_email: b.owner_email ?? null,
    contact_name: e.contact_name ?? null,
    website_url: e.website_url ?? null,
    business_address: e.business_address ?? null,
    logo_url: e.logo_url ?? null,
  }
}

/** The person a customer contacts — contact_name, else owner full name, else
 *  owner first name. Returns null when nothing is set (letterhead hides the row). */
export function contactDisplayName(t: TenantIdentity | null): string | null {
  if (!t) return null
  const full = [t.owner_first_name, t.owner_last_name].filter(Boolean).join(' ').trim()
  return (t.contact_name?.trim() || full || t.owner_first_name || null) ?? null
}
