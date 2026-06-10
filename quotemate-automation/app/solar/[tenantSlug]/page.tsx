// /solar/[tenantSlug] — PUBLIC per-tenant solar entry page.
//
// Mirrors app/q/roof/[token]/page.tsx: service-role lookup, Next 16
// `await params`, force-dynamic so the tenant is validated fresh. The
// slug carries the tenant id (uuid). Unknown/suspended → notFound().
// Maintain design system: deep-navy canvas, topographic overlay, orange
// accent headline, command-centre card panel around SolarAddressForm.

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

const TRUST_POINTS = [
  ['01', 'Roof-specific', 'Sized from satellite data of your actual roof'],
  ['02', 'STC rebate applied', 'Net price shown after the federal rebate'],
  ['03', 'Installer-confirmed', 'Reviewed by an accredited installer before anything is final'],
] as const

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
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      {/* Topographic background — signature Maintain motif. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <path d="M0,820 Q240,640 480,730 T960,680 T1440,740 T1920,640" stroke="var(--teal-glow)" strokeWidth="1" fill="none" />
        <path d="M0,880 Q260,700 520,790 T1000,740 T1480,800 T1920,700" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.7" />
        <path d="M0,940 Q280,770 560,850 T1040,800 T1520,860 T1920,770" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.45" />
        <path d="M0,180 Q320,300 640,220 T1280,260 T1920,190" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.35" />
        <path d="M0,110 Q300,230 600,150 T1240,190 T1920,120" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.2" />
      </svg>

      <div className="relative z-10 mx-auto grid max-w-6xl gap-12 px-6 py-16 sm:px-10 md:py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        {/* ── Left: headline + trust points ────────────────────── */}
        <div>
          <span className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-text-dim">
            {business}
          </span>
          <h1 className="mt-4 text-4xl font-extrabold uppercase leading-[0.98] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
            Instant <span className="text-accent">solar</span> estimate
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-text-sec">
            Enter your address and see an honest, roof-specific estimate —
            system size, annual production, and your net price after the STC
            rebate. Indicative until {business} confirms it.
          </p>

          <div className="mt-10 hidden flex-col gap-px bg-ink-line lg:flex">
            {TRUST_POINTS.map(([num, title, copy]) => (
              <article key={num} className="flex items-start gap-5 bg-ink-card px-6 py-5">
                <span className="font-mono text-3xl font-bold leading-none text-accent">
                  {num}
                </span>
                <div>
                  <h2 className="text-sm font-extrabold uppercase tracking-tight text-text-pri">
                    {title}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-text-sec">{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* ── Right: the form panel ─────────────────────────────── */}
        <div>
          <div className="border border-ink-line bg-ink-card p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                Your roof, your numbers
              </span>
              <span className="h-px flex-1 bg-ink-line" aria-hidden />
              <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-accent">
                ~30 sec
              </span>
            </div>
            <SolarAddressForm tenantSlug={tenant.id as string} />
          </div>

          <p className="mt-6 text-xs leading-relaxed text-text-dim">
            Final system designed &amp; installed by a Solar Accreditation
            Australia (SAA)-accredited installer using Clean Energy
            Council–approved components. STC rebate subject to eligibility &amp;
            install date. Estimate, not a contract.
          </p>
        </div>
      </div>

      {/* Orange accent bar — the closing punctuation. */}
      <div className="relative z-10 bg-accent px-6 py-3 text-center">
        <span className="font-mono text-xs uppercase tracking-[0.15em] text-ink-deep">
          Powered by {business} · honest solar numbers
        </span>
      </div>
    </main>
  )
}
