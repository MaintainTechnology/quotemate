// Public self-serve booking page — /book/<tenantId>.
//
// A customer with a tradie's booking link enters their details and picks an
// appointment time. Submitting creates a booking request the tradie sees in
// their dashboard Calendar tab (no estimate, no payment). The slot list is
// resolved server-side with the SAME logic the booking API validates against
// so render and validation always agree. See specs/dashboard-calendar-tab.md.

import { createClient } from '@supabase/supabase-js'
import { resolveBookableSlots } from '@/lib/quote/slots'
import { BookingForm } from './BookingForm'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-deep px-6 py-16 text-text-pri">
      <div className="w-full max-w-md border border-ink-line bg-ink-card p-8 text-center">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-text-dim">
          Booking
        </div>
        <h1 className="mt-3 text-xl font-extrabold uppercase tracking-tight">
          This booking link isn’t valid
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-sec">
          The link may be mistyped or no longer active. Please check with your
          tradie for an up-to-date booking link.
        </p>
      </div>
    </main>
  )
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params

  if (!UUID_RE.test(tenantId)) return <NotFound />

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name, status, available_slots')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant || tenant.status !== 'active') return <NotFound />

  const slots = resolveBookableSlots(tenant.available_slots)

  return (
    <main className="min-h-screen bg-ink-deep px-6 py-12 text-text-pri">
      <div className="mx-auto w-full max-w-lg">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-text-dim">
          Book a time
        </div>
        <h1 className="mt-2 text-2xl font-extrabold uppercase tracking-tight">
          {tenant.business_name ?? 'Book a job'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-sec">
          Tell us about the job and pick a time that suits you. We’ll send your
          details straight to the tradie.
        </p>
        <div className="mt-8">
          <BookingForm
            tenantId={tenant.id}
            businessName={tenant.business_name ?? 'your tradie'}
            slots={slots}
          />
        </div>
      </div>
    </main>
  )
}
