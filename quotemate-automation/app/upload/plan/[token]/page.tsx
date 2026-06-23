// Customer-facing plan-PDF upload page (SMS estimator flow).
// Reached via the SMS link "/upload/plan/{token}" sent by the
// plan-estimation branch. Token = plan_upload_requests.token (unguessable).
//
// Maintain Technology brand — same chrome as the photo-upload page
// (app/upload/[token]/page.tsx) so customers see one visual identity.

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { PlanUploadForm } from './PlanUploadForm'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** Server component renders per-request (force-dynamic), so wall-clock
 *  expiry here is a data check, not a render-purity hazard. */
function linkExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now()
}

export default async function PlanUploadPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const { data: request } = await supabase
    .from('plan_upload_requests')
    .select('id, status, expires_at, tenant_id, tenants(business_name)')
    .eq('token', token)
    .maybeSingle()

  const business =
    (request?.tenants as { business_name?: string } | null)?.business_name ?? 'your tradie'

  if (!request || linkExpired(request.expires_at as string)) {
    return (
      <Shell>
        <StateCard
          eyebrow="Invalid link"
          title="LINK NOT FOUND"
          body="This upload link is invalid or has expired. Text us again and we'll send you a fresh one."
          tone="warning"
        />
      </Shell>
    )
  }

  if (request.status === 'complete') {
    return (
      <Shell>
        <StateCard
          eyebrow="All done"
          title="PLAN ANALYSED"
          body="Your plan has been read and your results were sent by SMS. Check your messages for the link."
          tone="success"
        />
      </Shell>
    )
  }

  if (request.status === 'analysing') {
    return (
      <Shell>
        <StateCard
          eyebrow="In progress"
          title="READING YOUR PLAN"
          body="We're counting every light, power point and data point off your drawing right now. Results land in your messages in a couple of minutes."
          tone="success"
        />
      </Shell>
    )
  }

  // status: awaiting_upload | failed → live upload form
  return (
    <Shell>
      <section>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-text-dim">
          Plan estimation · {business}
        </span>
        <h1 className="mt-4 font-extrabold uppercase tracking-[-0.03em] text-[clamp(1.75rem,5vw,3rem)] leading-none">
          Upload your <span className="text-accent">electrical plan</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-text-sec sm:text-lg">
          Send the PDF of your plans and our AI reads the drawing itself — every light, power
          point and data point counted off the legend. Results come back to your phone in a
          couple of minutes.
        </p>
        {request.status === 'failed' ? (
          <p className="mt-4 font-mono text-xs uppercase tracking-widest text-[#fbbf24] bg-warning/10 border-l-2 border-warning px-3 py-2.5">
            The last upload couldn&apos;t be read — try a clearer PDF (an original export reads
            better than a scan).
          </p>
        ) : null}
      </section>

      <section className="mt-10 bg-ink-card border border-ink-line p-6 sm:p-8">
        <div className="flex items-start gap-5 sm:gap-6">
          <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">
            01
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
              Pick your plan PDF
            </h2>
            <p className="mt-1 text-xs text-text-dim">
              One PDF, up to 32MB. The whole plan set is fine — we find the electrical sheets.
            </p>
            <div className="mt-5">
              <PlanUploadForm token={token} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 bg-ink-card border border-ink-line p-6 sm:p-8">
        <div className="flex items-start gap-5 sm:gap-6">
          <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">
            02
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
              What reads best
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-text-sec">
              <li className="flex gap-3">
                <span className="text-accent shrink-0 font-mono">›</span>
                <span>An original PDF export from the designer — not a photo of paper plans</span>
              </li>
              <li className="flex gap-3">
                <span className="text-accent shrink-0 font-mono">›</span>
                <span>Include the legend page — our reader identifies symbols from it</span>
              </li>
              <li className="flex gap-3">
                <span className="text-accent shrink-0 font-mono">›</span>
                <span>Power &amp; lighting layout sheets are the ones that matter</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </Shell>
  )
}

/* ── Layout chrome — mirrors app/upload/[token]/page.tsx ── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-deep text-text-pri relative">
      <header className="relative z-10 border-b border-ink-line bg-ink-deep/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="font-extrabold uppercase tracking-tight text-lg" aria-label="QuoteMax">
            Quote<span className="text-accent">Max</span>
          </Link>
          <div className="text-right">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-text-dim">Plan upload</div>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        {children}
        <p className="mt-12 text-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-text-dim">
          Powered by <Link href="/" className="text-text-sec hover:text-accent transition-colors">QuoteMax</Link> · Built in Australia
        </p>
      </div>
    </main>
  )
}

function StateCard({
  eyebrow,
  title,
  body,
  tone,
}: {
  eyebrow: string
  title: string
  body: string
  tone: 'success' | 'warning'
}) {
  const toneStyles =
    tone === 'success' ? 'border-success/40 text-[#34d399]' : 'border-warning/50 text-[#fbbf24]'
  return (
    <section className={`bg-ink-card border-2 ${toneStyles} p-8 sm:p-10`}>
      <div className="font-mono text-[0.7rem] uppercase tracking-[0.15em] mb-4">{eyebrow}</div>
      <h1 className="text-text-pri font-extrabold uppercase tracking-tight text-3xl sm:text-4xl">{title}</h1>
      <p className="mt-4 text-base leading-relaxed text-text-sec sm:text-lg">{body}</p>
    </section>
  )
}
