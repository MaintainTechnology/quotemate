// ════════════════════════════════════════════════════════════════════
// White-label branding loader for quote PDFs.
//
// Resolves a tenant's display identity from EXISTING columns only (spec
// specs/quote-pdf-branding.md D4 — no new onboarding fields):
//   tenants: business_name, owner_mobile, owner_email, website_url,
//            business_address, logo_url, abn, tagline, licence_*
//   tenant_licences: trade-scoped licence (preferred), else tenant.licence_*
//
// Every field is optional and gracefully omitted downstream (chrome R2/R15).
// Logo is fetched + size-capped to a compact data: URI; on failure the
// chrome falls back to the business-name wordmark. Best-effort, never throws.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TenantBranding } from './report-chrome'
import { prepareLogo } from './image'

/** Neutral wordmark when a tenant has no business name (chrome edge case). */
export const FALLBACK_BUSINESS_NAME = 'Quotation'

type TenantBrandRow = {
  business_name: string | null
  owner_mobile: string | null
  owner_email: string | null
  website_url: string | null
  business_address: string | null
  logo_url: string | null
  abn: string | null
  tagline: string | null
  licence_type: string | null
  licence_number: string | null
}

type LicenceRow = { licence_type: string | null; licence_number: string | null }

function licenceLine(
  licType: string | null,
  licNumber: string | null,
  abn: string | null,
): string | null {
  const parts: string[] = []
  if (licType && licNumber) parts.push(`${licType} Lic. ${licNumber}`)
  else if (licNumber) parts.push(`Lic. ${licNumber}`)
  if (abn) parts.push(`ABN ${abn}`)
  return parts.length ? parts.join(' · ') : null
}

/**
 * Load a tenant's white-label branding for the given trade. Returns a
 * minimal `{ businessName }` when `tenantId` is null or the row is missing.
 */
export async function loadTenantBranding(
  client: SupabaseClient,
  tenantId: string | null,
  trade?: string | null,
): Promise<TenantBranding> {
  if (!tenantId) {
    // Spec quote-pdf-logo-fix R6 — a null tenantId is the #1 reason a quote PDF
    // ships with no logo (e.g. SMS/voice traffic on an unprovisioned number).
    // Log it so a logo-less PDF is traceable to "no tenant" vs "no logo".
    console.warn(
      '[pdf/branding] loadTenantBranding called with null tenantId — PDF uses the wordmark fallback (no logo)',
      { trade: trade ?? null },
    )
    return { businessName: FALLBACK_BUSINESS_NAME }
  }

  try {
    const [{ data: t }, licRes] = await Promise.all([
      client
        .from('tenants')
        .select(
          'business_name, owner_mobile, owner_email, website_url, business_address, logo_url, abn, tagline, licence_type, licence_number',
        )
        .eq('id', tenantId)
        .maybeSingle<TenantBrandRow>(),
      trade
        ? client
            .from('tenant_licences')
            .select('licence_type, licence_number')
            .eq('tenant_id', tenantId)
            .eq('trade', trade)
            .maybeSingle<LicenceRow>()
        : Promise.resolve({ data: null as LicenceRow | null }),
    ])

    if (!t) return { businessName: FALLBACK_BUSINESS_NAME }

    const businessName = t.business_name?.trim() || FALLBACK_BUSINESS_NAME
    const lic = licRes?.data
    const licType = lic?.licence_type ?? t.licence_type
    const licNumber = lic?.licence_number ?? t.licence_number

    const contactLine =
      [t.owner_mobile ? `Tel ${t.owner_mobile}` : null, t.owner_email]
        .filter(Boolean)
        .join(' · ') || null

    // Size-capped logo data URI; null on any failure → wordmark fallback.
    const logoSrc = await prepareLogo(t.logo_url)

    return {
      businessName,
      logoSrc,
      tagline: t.tagline?.trim() || null,
      legalLine: t.abn ? `ABN ${t.abn}` : null,
      contactLine,
      website: t.website_url?.trim() || null,
      address: t.business_address?.trim() || null,
      licenceLine: licenceLine(licType, licNumber, t.abn),
    }
  } catch {
    return { businessName: FALLBACK_BUSINESS_NAME }
  }
}
