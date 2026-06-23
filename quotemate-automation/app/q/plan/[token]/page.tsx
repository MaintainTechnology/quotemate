// Public, read-only plan take-off results (SMS estimator flow).
// Token = plan_extractions.share_token — unguessable, same trust model as
// the /q/[token] quote page. The tradie's editable view stays behind
// /dashboard/estimator/[runId]; this page only ever reads.
//
// Shows the reviewed counts (corrected_items when the tradie has edited,
// else the AI's items) + the indicative grounded estimate when priced.
// PRICING-VISIBILITY DECISION (flagged for business review): pricing IS
// shown to the customer, framed as indicative and subject to confirmation.

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import type { ExtractionItem } from '@/lib/estimation/extract'
import type { PricedBom } from '@/lib/estimation/price'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const aud = (n: number) =>
  '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function PlanResultsPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const { data: extraction } = await supabase
    .from('plan_extractions')
    .select(
      'id, items, corrected_items, sheets_used, overall_note, priced_bom, report_pdf_path, created_at, tenant_id, plan_uploads(filename), tenants:tenant_id(business_name)',
    )
    .eq('share_token', token)
    .maybeSingle()

  if (!extraction) {
    return (
      <Shell>
        <section className="bg-ink-card border-2 border-warning/50 p-8 sm:p-10">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-[#fbbf24] mb-4">
            Invalid link
          </div>
          <h1 className="text-text-pri font-extrabold uppercase tracking-tight text-3xl sm:text-4xl">
            RESULTS NOT FOUND
          </h1>
          <p className="mt-4 text-base leading-relaxed text-text-sec sm:text-lg">
            This results link is invalid or has expired. Text us if you need it re-sent.
          </p>
        </section>
      </Shell>
    )
  }

  const business =
    (extraction.tenants as { business_name?: string } | null)?.business_name ?? 'Your tradie'
  const filename = (extraction.plan_uploads as { filename?: string } | null)?.filename ?? 'plan.pdf'
  const corrected = extraction.corrected_items as ExtractionItem[] | null
  const items: ExtractionItem[] =
    Array.isArray(corrected) && corrected.length > 0
      ? corrected
      : ((extraction.items as ExtractionItem[]) ?? [])
  const bom = (extraction.priced_bom as PricedBom | null) ?? null
  const sheets = (extraction.sheets_used as string[] | null) ?? []
  const deviceCount = items.reduce((sum, it) => sum + (it.count || 0), 0)
  const date = new Date(extraction.created_at as string).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <Shell>
      <section>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-text-dim">
          Plan take-off · {business} · {date}
        </span>
        <h1 className="mt-4 font-extrabold uppercase tracking-[-0.03em] text-[clamp(1.75rem,5vw,3rem)] leading-none">
          Your plan, <span className="text-accent">counted</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-text-sec sm:text-lg">
          Every electrical item read off <span className="font-semibold text-text-pri">{filename}</span>
          {sheets.length > 0 ? <> (sheets: {sheets.join(', ')})</> : null}. {business} reviews and
          confirms before anything is final.
        </p>
      </section>

      {/* ── Stat strip ── */}
      <section className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat value={String(items.length)} label="Item types" />
        <Stat value={String(deviceCount)} label="Devices counted" />
        {bom ? <Stat value={aud(bom.totalIncGst)} label={`Indicative total${bom.gstRegistered ? ' inc GST' : ''}`} accent /> : null}
      </section>

      {/* ── PDF download ── */}
      {extraction.report_pdf_path ? (
        <a
          href={`/api/q/plan/${token}/pdf`}
          className="mt-6 block w-full bg-accent hover:bg-accent-press text-white text-center px-5 py-4 font-mono text-xs sm:text-sm uppercase tracking-[0.15em] font-bold transition-colors"
        >
          Download PDF report ↓
        </a>
      ) : null}

      {/* ── Counted items ── */}
      <section className="mt-8 bg-ink-card border border-ink-line p-6 sm:p-8">
        <div className="flex items-start gap-5 sm:gap-6">
          <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">01</span>
          <div className="flex-1 min-w-0 overflow-x-auto">
            <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
              Counted items
            </h2>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[0.6rem] uppercase tracking-[0.15em] text-text-dim border-b border-ink-line">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right">Count</th>
                  <th className="py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-ink-line/50">
                    <td className="py-2.5 pr-3 text-text-pri">{it.type}</td>
                    <td className="py-2.5 pr-3 text-right font-mono font-bold text-text-pri">{it.count}</td>
                    <td className="py-2.5">
                      <span
                        className={`font-mono text-[0.6rem] uppercase tracking-widest border px-1.5 py-0.5 ${
                          it.confidence === 'high'
                            ? 'text-[#34d399] border-success/40'
                            : it.confidence === 'low'
                              ? 'text-[#fca5a5] border-danger/40'
                              : 'text-[#fbbf24] border-warning/40'
                        }`}
                      >
                        {it.confidence}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {extraction.overall_note ? (
              <p className="mt-4 text-xs leading-relaxed text-text-dim">
                Reader&apos;s note: {String(extraction.overall_note)}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Indicative estimate ── */}
      {bom ? (
        <section className="mt-6 bg-ink-card border border-ink-line p-6 sm:p-8">
          <div className="flex items-start gap-5 sm:gap-6">
            <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">02</span>
            <div className="flex-1 min-w-0">
              <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
                Indicative estimate
              </h2>
              <p className="mt-1 text-xs text-text-dim">
                Generated from {business}&apos;s standard rates — {business} confirms the final
                price before any work is booked.
              </p>
              <div className="mt-4 space-y-1.5 text-sm">
                <Row label="Materials (ex GST)" value={aud(bom.materialExGst)} />
                <Row label="Labour (ex GST)" value={aud(bom.labourExGst)} />
                {bom.labourFloorAddedExGst > 0 ? (
                  <Row label="Minimum-labour adjustment" value={aud(bom.labourFloorAddedExGst)} />
                ) : null}
                <Row label="Subtotal (ex GST)" value={aud(bom.subtotalExGst)} />
                {bom.gstRegistered ? <Row label="GST" value={aud(bom.gstExGst)} /> : null}
                <div className="flex items-baseline justify-between border-t-2 border-ink-line pt-2.5 mt-2.5">
                  <span className="font-extrabold uppercase tracking-tight text-text-pri">
                    Indicative total{bom.gstRegistered ? ' (inc GST)' : ''}
                  </span>
                  <span className="font-mono font-bold text-xl text-accent">{aud(bom.totalIncGst)}</span>
                </div>
              </div>
              {bom.unmatched.length > 0 ? (
                <p className="mt-4 text-xs leading-relaxed text-text-dim">
                  Not yet priced (needs {business}&apos;s manual look):{' '}
                  {bom.unmatched.map((u) => `${u.type} × ${u.count}`).join(' · ')}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </Shell>
  )
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="bg-ink-card border border-ink-line p-4">
      <div className={`text-xl sm:text-2xl font-extrabold ${accent ? 'text-accent' : 'text-text-pri'}`}>{value}</div>
      <div className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-text-dim">{label}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-text-sec">{label}</span>
      <span className="font-mono text-text-pri">{value}</span>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-deep text-text-pri relative">
      <header className="relative z-10 border-b border-ink-line bg-ink-deep/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="font-extrabold uppercase tracking-tight text-lg" aria-label="QuoteMax">
            Quote<span className="text-accent">Max</span>
          </Link>
          <div className="text-right">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-text-dim">Take-off results</div>
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
