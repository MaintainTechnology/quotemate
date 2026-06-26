// /start/[tenantId] — the public "request a quote" landing a QR-code scan lands
// on. Shown to a cold lead from the announcement email: the tradie's business,
// and a one-tap "text for an instant quote" CTA pointed at their Twilio number.
//
// Server component. No auth — public by tenant id (same trust model as the other
// public /q and /upload pages).

import { notFound } from 'next/navigation'
import { getServiceClient } from '@/lib/supabase/admin'
import { BrandMark } from '@/app/_components/BrandMark'

export const dynamic = 'force-dynamic'

type TenantRow = {
  business_name: string | null
  business_address: string | null
  twilio_sms_number: string | null
  contact_name: string | null
}

export default async function StartPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params

  // Guard against non-UUID ids hitting Postgres with a cast error.
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) notFound()

  const supabase = getServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('business_name, business_address, twilio_sms_number, contact_name')
    .eq('id', tenantId)
    .maybeSingle()

  const tenant = data as TenantRow | null
  if (!tenant || !tenant.business_name) notFound()

  const phone = tenant.twilio_sms_number
  const smsBody = encodeURIComponent(`Hi ${tenant.business_name}, I'd like a quote.`)
  const smsHref = phone ? `sms:${phone}?&body=${smsBody}` : null

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full opacity-[0.10] blur-3xl"
          style={{ background: 'radial-gradient(circle, #FFC400 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col px-6 py-12">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-10 w-10" />
          <span className="font-extrabold uppercase tracking-tight">QuoteMax</span>
        </div>

        <div className="flex flex-1 flex-col justify-center py-12">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
            {tenant.business_name}
          </span>
          <h1 className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.25rem,8vw,3.5rem)]">
            Get an <span className="text-accent">instant quote</span>.
          </h1>
          <p className="mt-5 text-text-sec leading-relaxed">
            Text {tenant.business_name} a quick description of the job (a photo helps) and you&apos;ll get a clear
            Good / Better / Best quote back, usually within minutes.
          </p>

          {smsHref ? (
            <a
              href={smsHref}
              className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-accent px-6 py-4 text-sm font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-accent-press"
            >
              Text us for a quote <span aria-hidden>→</span>
            </a>
          ) : (
            <p className="mt-8 text-sm text-text-dim">This business hasn&apos;t set up text quoting yet.</p>
          )}

          <div className="mt-10 border-t border-ink-line pt-6 font-mono text-[0.7rem] leading-relaxed text-text-dim">
            <div>{tenant.business_name}</div>
            {tenant.business_address && <div>{tenant.business_address}</div>}
            {phone && <div>{phone}</div>}
          </div>
        </div>
      </div>
    </main>
  )
}
