// /t/<slug> — public, branded per-tenant landing page (QR destination).
//
// A homeowner who scanned a tradie's QR flyer lands here. The page is the
// tradie's marketing surface: it shows ONLY the services that tradie has
// enabled (tenants.trades[]) and converts the visitor into a photo-first
// lead that runs the same AI quote pipeline as voice/SMS.
//
// Maintain Technology design system: deep slate-navy canvas, all-caps
// display, monospace eyebrows, numbered cards, square corners. The tenant's
// brand_color is the per-page accent (white-label), falling back to the
// Maintain orange. Server component resolves the tenant + capabilities; the
// LeadForm (client) handles capture + submit.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { resolveTenantCapabilities } from '@/lib/marketing/capabilities'
import { LeadForm } from './LeadForm'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAINTAIN_ORANGE = '#FFC400'

// Static, hoisted — a low-opacity topographic line motif (Maintain
// signature). Coordinates kept coarse (rendering-svg-precision).
function TopoBackground() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12]"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
    >
      {[0, 60, 120, 180, 240, 300, 360].map((dy) => (
        <path
          key={dy}
          d={`M-40,${360 + dy} Q260,${180 + dy} 560,${300 + dy} T1160,${260 + dy} T1480,${300 + dy}`}
          fill="none"
          stroke="#14B8A6"
          strokeWidth="1"
        />
      ))}
    </svg>
  )
}

export default async function TenantLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name, brand_color, trade, trades, status, slug')
    .ilike('slug', slug)
    .maybeSingle()

  if (!tenant || tenant.status !== 'active') notFound()

  const accent = (tenant.brand_color as string | null) || MAINTAIN_ORANGE
  const businessName = tenant.business_name as string
  const monogram = businessName.slice(0, 1).toUpperCase()
  const capabilities = resolveTenantCapabilities(
    tenant.trades as string[] | null,
    tenant.trade as string | null,
  )
  const serviceCount = capabilities.length

  const steps = [
    {
      title: 'Snap the job',
      body: 'Take a photo of what needs doing — a switchboard, a leaking tap, your roof, anything.',
    },
    {
      title: 'We draft the quote',
      body: `${businessName} uses QuoteMax AI to price it against their real rates — itemised, not a guess.`,
    },
    {
      title: 'You get a text',
      body: 'An itemised quote lands on your phone, usually within minutes. No call-backs, no waiting.',
    },
  ]

  return (
    <main
      style={{ ['--brand' as string]: accent }}
      className="min-h-screen bg-ink-deep text-text-pri antialiased"
    >
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <header className="relative z-10 border-b border-ink-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="grid h-9 w-9 place-items-center text-base font-extrabold text-white"
              style={{ background: accent }}
            >
              {monogram}
            </span>
            <span className="text-sm font-extrabold uppercase tracking-tight">
              {businessName}
            </span>
          </div>
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">
            Instant quotes
          </span>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <TopoBackground />
        <div className="relative z-10 mx-auto grid max-w-5xl gap-10 px-5 py-16 md:grid-cols-[1.7fr_1fr] md:py-24">
          <div>
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-text-dim">
              {businessName} · powered by QuoteMax&nbsp;AI
            </span>
            <h1 className="mt-5 text-[clamp(2.6rem,7vw,4.75rem)] font-extrabold uppercase leading-[0.96] tracking-[-0.035em]">
              A real quote in{' '}
              <span style={{ color: accent }}>minutes</span>,
              <br className="hidden sm:block" /> not days.
            </h1>
            <a
              href="#quote"
              className="mt-8 inline-flex items-center gap-2 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90"
              style={{ background: accent }}
            >
              Get my quote
              <span aria-hidden>↓</span>
            </a>
          </div>
          <aside className="self-end text-base leading-relaxed text-text-sec">
            Snap a photo of the job and {businessName} texts you an itemised
            quote — usually within minutes. Licensed, local, and no obligation.
          </aside>
        </div>
      </section>

      {/* ── What you can request (per-tenant capabilities) ───────── */}
      {serviceCount > 0 && (
        <section className="border-b border-ink-line">
          <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-text-dim">
              What you can request
            </span>
            <h2 className="mt-4 max-w-2xl text-[clamp(1.6rem,3.5vw,2.4rem)] font-extrabold uppercase leading-tight tracking-[-0.03em]">
              {serviceCount === 1
                ? `${businessName} quotes`
                : 'Everything this team quotes'}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-sec">
              {businessName} only lists the work they actually do — so anything
              below, you can request right now and get a quote back.
            </p>

            <div className="mt-10 space-y-4">
              {capabilities.map((cap, i) => (
                <article
                  key={cap.key}
                  className="border border-ink-line bg-ink-card p-6 transition-colors hover:border-ink-line/0 md:p-8"
                  style={{ borderLeft: `3px solid ${accent}` }}
                >
                  <div className="flex items-start gap-5 md:gap-7">
                    <span
                      className="font-mono text-3xl font-bold leading-none md:text-5xl"
                      style={{ color: accent }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-extrabold uppercase tracking-tight md:text-xl">
                        {cap.label}
                      </h3>
                      <p className="mt-1 text-sm text-text-sec">{cap.tagline}</p>
                      <ul className="mt-4 flex flex-wrap gap-2">
                        {cap.examples.map((ex) => (
                          <li
                            key={ex}
                            className="border border-ink-line px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-text-sec"
                          >
                            {ex}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── How it works ─────────────────────────────────────────── */}
      <section className="border-b border-ink-line">
        <div className="mx-auto max-w-5xl px-5 py-16 md:py-20">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-text-dim">
            How it works
          </span>
          <div className="mt-8 grid gap-px overflow-hidden border border-ink-line bg-ink-line md:grid-cols-3">
            {steps.map((step, i) => (
              <div key={step.title} className="bg-ink-card p-6 md:p-7">
                <span
                  className="font-mono text-2xl font-bold leading-none"
                  style={{ color: accent }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-4 text-sm font-extrabold uppercase tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-sec">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Lead form (conversion) ───────────────────────────────── */}
      <section id="quote" className="border-b border-ink-line scroll-mt-4">
        <div className="mx-auto max-w-2xl px-5 py-16 md:py-20">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-text-dim">
            Get your quote
          </span>
          <h2 className="mt-4 text-[clamp(1.6rem,3.5vw,2.4rem)] font-extrabold uppercase leading-tight tracking-[-0.03em]">
            Tell us about the job
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-text-sec">
            One photo and your mobile is all it takes. {businessName} reviews
            every quote before it&rsquo;s final.
          </p>

          <div className="mt-8 border border-ink-line bg-ink-card p-5 md:p-7">
            <LeadForm
              slug={tenant.slug as string}
              accent={accent}
              services={capabilities.map((c) => ({ key: c.key, label: c.label }))}
            />
          </div>
        </div>
      </section>

      {/* ── Trust strip ──────────────────────────────────────────── */}
      <section className="border-b border-ink-line">
        <div className="mx-auto grid max-w-5xl gap-px overflow-hidden border-x border-ink-line bg-ink-line px-0 sm:grid-cols-3">
          {[
            ['Licensed & insured', 'Quotes from a real, registered tradie'],
            ['No obligation', 'A quote, not a commitment'],
            ['Your details stay private', 'Used only to prepare your quote'],
          ].map(([t, d]) => (
            <div key={t} className="bg-ink-deep px-5 py-6">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.12em]" style={{ color: accent }}>
                {t}
              </p>
              <p className="mt-1.5 text-sm text-text-sec">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Brand accent CTA bar + footer ────────────────────────── */}
      <div className="px-5 py-3.5 text-center" style={{ background: accent }}>
        <a
          href="#quote"
          className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white"
        >
          Snap a photo · Get a quote from {businessName}
        </a>
      </div>
      <footer className="mx-auto max-w-5xl px-5 py-8 text-center">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-text-dim">
          Powered by QuoteMax · Your details are only used to prepare your quote
        </p>
      </footer>
    </main>
  )
}
