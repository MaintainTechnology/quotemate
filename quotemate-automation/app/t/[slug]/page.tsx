// /t/<slug> — public, branded per-tenant landing page. A homeowner who
// scanned a QR flyer lands here, uploads a job photo, and gets an
// AI-drafted quote texted back. Server component resolves the tenant by
// slug; the LeadForm (client) handles capture + submit.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { LeadForm } from './LeadForm'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function TenantLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name, brand_color, trade, status, slug')
    .ilike('slug', slug)
    .maybeSingle()

  if (!tenant || tenant.status !== 'active') notFound()

  const accent = tenant.brand_color || '#ff5a1f'
  const trade = tenant.trade === 'plumbing' ? 'plumbing' : 'electrical'

  return (
    <main
      style={{ ['--accent' as string]: accent }}
      className="min-h-screen bg-white text-neutral-900"
    >
      <div className="mx-auto max-w-xl px-5 py-10">
        <header className="text-center">
          <div
            className="mx-auto grid h-12 w-12 place-items-center rounded-lg font-black text-white text-lg"
            style={{ background: accent }}
          >
            {tenant.business_name.slice(0, 1).toUpperCase()}
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">{tenant.business_name}</h1>
          <p className="mt-2 text-neutral-600">
            Snap a photo of the job and we’ll text you a quote — usually within minutes.
          </p>
        </header>

        <div className="mt-8 rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <LeadForm slug={tenant.slug as string} accent={accent} trade={trade} />
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Powered by QuoteMate · Your details are only used to prepare your quote.
        </p>
      </div>
    </main>
  )
}
