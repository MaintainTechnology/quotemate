// Public, read-only commercial painting tender quote (spec R11/R20).
// Token = paint_runs.public_token (migration 143 — APPLY BEFORE THIS WORKS).
// Service-role read; public sharing surface.
//
// Renders the priced takeoff (PricedPaintBom on the run's latest priced
// plan_extraction) as a tender — surface/room line items, labour + materials +
// equipment, and the inc-GST total — instead of the electrical G/B/B card.
//
// Deposit (R12): commercial painting has no Stripe deposit flow wired; the CTA
// renders in the spec's "no deposit link → clear state" mode (contact to book).

import { createClient } from '@supabase/supabase-js'
import type { PricedPaintBom } from '@/lib/commercial-painting/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const aud = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default async function CommercialPaintQuotePage(props: {
  params: Promise<{ token: string }>
}) {
  const { token } = await props.params

  const { data: run, error } = await supabase
    .from('paint_runs')
    .select('id, job_name, site_address, status, created_at, public_token, tenants:tenant_id(business_name)')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !run) return <NotFound />

  // Latest priced extraction for this run holds the tender BOM.
  const { data: ext } = await supabase
    .from('plan_extractions')
    .select('priced_bom, priced_at')
    .eq('paint_run_id', run.id)
    .not('priced_bom', 'is', null)
    .order('priced_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const bom = (ext?.priced_bom as PricedPaintBom | null) ?? null
  const business =
    (run.tenants as { business_name?: string } | null)?.business_name ?? 'Your painter'
  const date = new Date(run.created_at as string).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <Shell>
      {/* ── Hero ── */}
      <section className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent">
          Commercial painting tender · {business}
        </div>
        <h1 className="mt-3 text-3xl font-extrabold uppercase tracking-tight text-text-pri sm:text-4xl">
          {String(run.job_name ?? 'Painting tender')}
        </h1>
        <div className="mt-2 font-mono text-sm text-text-dim">
          {[run.site_address, date].filter(Boolean).join(' · ')}
        </div>
      </section>

      {!bom ? (
        <section className="mt-6 border border-l-4 border-ink-line border-l-accent bg-ink-card p-6 sm:p-7">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-accent">
            Pricing in progress
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-sec">
            We&apos;re finalising the takeoff for this job. Your detailed tender will appear here
            shortly.
          </p>
        </section>
      ) : (
        <>
          {/* ── Takeoff line items ── */}
          <section className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
            <div className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
              Scope &amp; takeoff
            </div>
            <ul className="divide-y divide-ink-line">
              {bom.lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-pri">
                      {l.surface}
                      {l.room ? <span className="text-text-dim"> · {l.room}</span> : null}
                    </div>
                    <div className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-text-dim">
                      {Math.round(l.quantity)} {l.unit === 'item' ? 'items' : 'm²'} ·{' '}
                      {String(l.system).replace(/_/g, ' ')} · {l.coats} coats
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-sm tabular-nums text-text-pri">
                    {aud(l.lineExGst)}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Cost breakdown ── */}
          <section className="mt-6 grid gap-px border border-ink-line bg-ink-line sm:grid-cols-3">
            <Cell label="Labour" value={aud(bom.labour.costExGst)} sub={`${Math.round(bom.labour.hours)} hrs`} />
            <Cell label="Materials" value={aud(bom.materialsExGst)} />
            <Cell label="Equipment" value={aud(bom.equipmentExGst)} />
          </section>

          {/* ── Total + deposit ── */}
          <section className="mt-6 border border-accent bg-ink-card p-6 sm:p-7">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
                Total inc GST
              </span>
              <span className="font-mono text-3xl font-bold tabular-nums text-text-pri">
                {aud(bom.totalIncGst)}
              </span>
            </div>
            <div className="mt-1 text-right font-mono text-[0.62rem] uppercase tracking-[0.14em] text-text-dim">
              {aud(bom.subtotalExGst)} ex GST + {aud(bom.gst)} GST
            </div>
            <div className="mt-5 border border-ink-line px-4 py-3 text-center font-mono text-[0.72rem] uppercase tracking-[0.14em] text-text-dim">
              Contact us to accept this tender
            </div>
          </section>

          {/* ── Exclusions / assumptions ── */}
          {(bom.exclusions?.length || bom.assumptions?.length) ? (
            <section className="mt-6 grid gap-5 sm:grid-cols-2">
              {bom.assumptions?.length ? (
                <Notes title="Assumptions" items={bom.assumptions} />
              ) : null}
              {bom.exclusions?.length ? (
                <Notes title="Exclusions" items={bom.exclusions} />
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </Shell>
  )
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-ink-card p-5">
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {sub ? <div className="mt-0.5 font-mono text-[0.6rem] text-text-dim">{sub}</div> : null}
    </div>
  )
}

function Notes({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="border border-ink-line bg-ink-card p-5">
      <div className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">{title}</div>
      <ul className="space-y-1.5 text-sm text-text-sec">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-accent">›</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
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
          Tender not found
        </h1>
        <p className="mt-4 text-base leading-relaxed text-text-sec sm:text-lg">
          This tender link is invalid or has expired. Get in touch if you need it re-sent.
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
