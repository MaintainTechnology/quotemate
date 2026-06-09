// /solar/[tenantSlug] — PUBLIC per-tenant solar entry page.
//
// Mirrors app/q/roof/[token]/page.tsx: service-role lookup, Next 16
// `await params`, force-dynamic so the tenant is validated fresh. The
// slug carries the tenant id (uuid). Unknown/suspended → notFound().
// Renders the Maintain-styled shell + the SolarAddressForm client
// component which POSTs to /api/solar/[tenantSlug]/estimate.

import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { SolarAddressForm } from './_components/SolarAddressForm'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// A tenant id is a uuid (36 chars). Cheap pre-check before the DB hit.
function looksLikeTenantId(slug: string): boolean {
  return /^[0-9a-fA-F-]{8,40}$/.test(slug)
}

export default async function SolarEntryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  if (!tenantSlug || !looksLikeTenantId(tenantSlug)) notFound()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, status, business_name')
    .eq('id', tenantSlug)
    .maybeSingle()
  if (!tenant || tenant.status === 'suspended') notFound()

  const business = (tenant.business_name as string) ?? 'Your installer'

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:px-10">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-text-dim">
          {business}
        </p>
        <h1 className="mt-2 text-3xl font-extrabold uppercase tracking-[-0.035em] sm:text-4xl">
          Instant solar estimate
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-sec">
          Enter your address and see an honest, roof-specific estimate —
          system size, annual production, and your net price after the STC
          rebate. Indicative until {business} confirms it.
        </p>

        <div className="mt-8">
          <SolarAddressForm tenantSlug={tenant.id as string} />
        </div>

        <p className="mt-8 text-xs leading-relaxed text-text-dim">
          Final system designed &amp; installed by a Solar Accreditation
          Australia (SAA)-accredited installer using Clean Energy
          Council–approved components. STC rebate subject to eligibility &amp;
          install date. Estimate, not a contract.
        </p>
      </div>
    </main>
  )
}
