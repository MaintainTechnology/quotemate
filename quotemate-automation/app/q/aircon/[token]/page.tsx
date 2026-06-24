// Public, read-only air-conditioning recommendation (spec R11/R22).
// Token = aircon_recommendations.public_token (migration 144 — APPLY BEFORE
// THIS WORKS, and wire /api/aircon/recommend to persist a row + token).
// Service-role read; public sharing surface.
//
// Renders the sized load + the two system options (ducted vs split) with an
// indicative inc-GST price BAND each — an aircon-appropriate format, not the
// electrical G/B/B card. Aircon is always "book an assessment" (indicative
// posture), so there is no deposit CTA — the action is to book the site visit.

import { createClient } from '@supabase/supabase-js'
import type { AcRecommendation, AcOption } from '@/lib/aircon/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const aud = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const SYSTEM_LABEL: Record<AcOption['system_type'], string> = {
  ducted: 'Ducted',
  split: 'Split system',
}

export default async function AirconQuotePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const { data: row, error } = await supabase
    .from('aircon_recommendations')
    .select('address, postcode, state, recommendation, created_at, tenants:tenant_id(business_name)')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !row || !row.recommendation) return <NotFound />

  const rec = row.recommendation as AcRecommendation
  const sizing = rec.sizing
  const options = Array.isArray(rec.options) ? rec.options : []
  const business =
    (row.tenants as { business_name?: string } | null)?.business_name ?? 'Your installer'
  const date = new Date(row.created_at as string).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <Shell>
      {/* ── Hero ── */}
      <section className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent">
          Air-conditioning recommendation · {business}
        </div>
        <h1 className="mt-3 text-3xl font-extrabold uppercase tracking-tight text-text-pri sm:text-4xl">
          {String(row.address ?? 'Your property')}
        </h1>
        <div className="mt-2 font-mono text-sm text-text-dim">
          {[row.postcode, row.state, date].filter(Boolean).join(' · ')}
        </div>
      </section>

      {/* ── Sizing ── */}
      {sizing ? (
        <section className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
            Sized for your home
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Floor area" value={`${Math.round(sizing.total_floor_area_m2)} m²`} />
            <Stat label="Zones" value={String(sizing.conditioned_zones ?? '—')} />
            <Stat label="Ducted size" value={`${round1(sizing.ducted_kw)} kW`} />
            <Stat label="Storeys" value={String(sizing.storeys ?? '—')} />
          </div>
        </section>
      ) : null}

      {/* ── Options ── */}
      <section className="mt-8">
        <h2 className="mb-6 font-mono text-xs uppercase tracking-[0.15em] text-text-dim">
          {options.length === 1 ? 'Your option' : 'Ducted vs split'}
        </h2>
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
          {options.map((opt, i) => (
            <article
              key={i}
              className={`relative flex flex-col border bg-ink-card p-6 sm:p-7 ${
                opt.best_fit ? 'border-accent' : 'border-ink-line'
              }`}
            >
              {opt.best_fit ? (
                <span className="absolute -top-px left-0 bg-accent px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-ink-deep">
                  Best fit
                </span>
              ) : null}
              <div className="mt-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent">
                {SYSTEM_LABEL[opt.system_type]} · {round1(opt.capacity_kw)} kW
              </div>
              <div className="mt-4 border-t border-ink-line pt-4">
                <div className="font-mono text-2xl font-bold tabular-nums text-text-pri">
                  {aud(opt.price.low)}–{aud(opt.price.high)}
                </div>
                <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                  indicative inc GST
                </div>
              </div>
              {opt.pros?.length ? (
                <ul className="mt-4 space-y-1.5 text-sm text-text-sec">
                  {opt.pros.map((p, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="text-success">+</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {opt.cons?.length ? (
                <ul className="mt-2 space-y-1.5 text-sm text-text-dim">
                  {opt.cons.map((c, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="text-text-dim">–</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {/* ── Routing: always an on-site assessment ── */}
      <section className="mt-6 border border-l-4 border-ink-line border-l-accent bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-accent">
          Next step · book an assessment
        </div>
        <p className="mt-2 text-sm leading-relaxed text-text-sec">
          {rec.routing?.reason ??
            'These figures are indicative. We confirm the exact system and a fixed price after a quick on-site assessment.'}
        </p>
      </section>
    </Shell>
  )
}

function round1(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (Math.round(n * 10) / 10).toString()
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
    </div>
  )
}

function NotFound() {
  return (
    <Shell>
      <section className="border-2 border-warning/50 bg-ink-card p-8 sm:p-10">
        <div className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-warning">
          Invalid link
        </div>
        <h1 className="text-3xl font-extrabold uppercase tracking-tight text-text-pri sm:text-4xl">
          Recommendation not found
        </h1>
        <p className="mt-4 text-base leading-relaxed text-text-sec sm:text-lg">
          This link is invalid or has expired. Get in touch if you need it re-sent.
        </p>
      </section>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-deep px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  )
}
