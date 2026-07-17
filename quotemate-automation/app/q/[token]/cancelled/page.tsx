// Stripe cancel URL lands here. Previously a 17-line unstyled stub with no
// way back into the funnel — a cancelled customer dead-ended (spec
// customer-quote-five-sections R8). Now styled on the command-centre tokens
// with one clear route back to the quote.

export const dynamic = 'force-dynamic'

export default async function CancelledPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  return (
    <main className="relative min-h-screen bg-ink-deep text-text-pri">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="relative z-10 mx-auto max-w-xl px-5 py-16 sm:px-6">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
          Payment cancelled
        </span>
        <h1 className="mt-5 text-[clamp(1.8rem,5vw,3rem)] font-extrabold uppercase leading-[1.05] tracking-[-0.03em]">
          No worries, <span className="text-accent">nothing was charged</span>.
        </h1>
        <p className="mt-5 max-w-[55ch] text-base leading-relaxed text-text-sec">
          Your quote is still valid. Head back whenever you are ready, or reply
          to your tradie&apos;s SMS if anything looks off.
        </p>
        <a
          href={`/q/${token}`}
          className="mt-8 inline-block bg-accent px-6 py-3.5 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink-deep transition-colors hover:bg-accent-press"
        >
          Back to your quote
        </a>
        <p className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
          Quote ref: {token.slice(0, 8)}
        </p>
      </div>
    </main>
  )
}
