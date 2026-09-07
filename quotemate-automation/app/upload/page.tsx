// /upload with NO token.
//
// Reached when a customer taps a photo link that their phone split across
// lines. iOS linkifies the fragments separately, so tapping the first one
// opens ".../upload/" — which matched no route and served the marketing 404
// ("THIS PAGE WENT OFF THE GRID"), complete with our nav, pricing and a
// "Go to dashboard" button. A customer who did exactly what the SMS asked
// was shown a broken marketing page and had no way back.
//
// Reported live 2026-09-06 on an EV charger photo link.
//
// This is deliberately NOT the tenant-branded chrome: with no token there is
// no conversation and therefore no tradie to attribute, and guessing would be
// worse than staying neutral. It just tells them what happened and what to do.

export const metadata = {
  title: 'Photo upload · QuoteMax',
  robots: { index: false, follow: false },
}

export default function UploadNoTokenPage() {
  return (
    <main className="min-h-screen bg-ink-deep text-text-pri flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-text-dim">
          Photo upload
        </span>

        <h1 className="mt-4 font-extrabold uppercase tracking-[-0.03em] text-[clamp(1.6rem,5vw,2.5rem)] leading-none">
          We need your <span className="text-accent">full link</span>
        </h1>

        <p className="mt-5 text-base leading-relaxed text-text-sec">
          This page opens with a personal upload link, and the one you tapped came
          through without its code on the end. Long links sometimes get split across
          two lines in a text message.
        </p>

        <div className="mt-8 bg-ink-card border border-ink-line p-6">
          <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-sm">
            How to get back in
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-text-sec">
            <li className="flex gap-3">
              <span className="text-accent shrink-0 font-mono">›</span>
              <span>
                Open your text message and press and hold the link, then choose
                <span className="text-text-pri font-semibold"> Copy</span> — that
                takes the whole thing, including the part after
                <span className="font-mono text-text-pri"> /upload/</span>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent shrink-0 font-mono">›</span>
              <span>Paste it into your browser&apos;s address bar.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent shrink-0 font-mono">›</span>
              <span>
                Or just reply <span className="text-text-pri font-semibold">PHOTO</span> to
                the same conversation and your tradie will send a fresh link.
              </span>
            </li>
          </ul>
        </div>

        <p className="mt-8 text-sm text-text-dim">
          Photos are optional on most jobs — if you can&apos;t get the link working,
          reply to the text and your tradie will carry on from there.
        </p>
      </div>
    </main>
  )
}
