// "How this estimate was built" — the transparency story a tradie can walk a
// customer through before any payment. Four numbered steps, Maintain
// signature pattern; the copy adapts to whether the run has been priced.

import { money, type PricedBom } from './types'

type Props = {
  model: string | null
  runtimeSeconds: number | null
  sheets: string[]
  bom: PricedBom | null
}

export function Methodology({ model, runtimeSeconds, sheets, bom }: Props) {
  const steps: { title: string; body: string }[] = [
    {
      title: 'Count',
      body: `${model || 'The AI'} read the plan’s legend and counted every symbol${
        sheets.length ? ` across ${sheets.join(', ')}` : ''
      }${runtimeSeconds ? ` in ${runtimeSeconds}s` : ''}, pinning each one to its spot on the drawing. Dense areas come back flagged low confidence; a tiled high-resolution recount can re-check them.`,
    },
    {
      title: 'Verify',
      body: 'Your electrician reviews every line against the drawing — correcting counts, removing false positives and adding anything the AI missed. Low-confidence lines are flagged as the first place to look. The corrected ledger is what gets priced.',
    },
    {
      title: 'Match',
      body: 'Each verified line is matched to an assembly in your own catalogue — your custom assemblies first, then the shared trade library. Anything without a match is flagged unpriced, never guessed.',
    },
    {
      title: 'Price',
      body: bom
        ? `Deterministic maths from your pricing book: material = catalogue base price + ${bom.assumptions.markupPct}% markup; labour = assembly hours × ${money(bom.assumptions.hourlyRate)}/hr (never marked up); a ${bom.assumptions.minLabourHours}h minimum-labour floor; then GST. No AI touches a dollar figure.`
        : 'Deterministic maths from your pricing book: material = catalogue base price + your markup; labour = assembly hours × your hourly rate; a minimum-labour floor; then GST. No AI touches a dollar figure.',
    },
  ]

  return (
    <section aria-label="How this estimate was built">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
        Transparency
      </div>
      <h3 className="mt-1.5 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">
        How this estimate was built
      </h3>
      <div className="mt-5 grid gap-px border border-ink-line bg-ink-line lg:grid-cols-2">
        {steps.map((s, i) => (
          <article key={s.title} className="flex items-start gap-5 bg-ink-card p-6">
            <span aria-hidden="true" className="font-mono text-4xl font-bold leading-none text-accent sm:text-5xl">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <h4 className="font-extrabold uppercase tracking-tight text-text-pri">{s.title}</h4>
              <p className="mt-1.5 text-sm leading-relaxed text-text-sec">{s.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
