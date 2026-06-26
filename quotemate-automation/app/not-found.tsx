// app/not-found.tsx — custom 404 for the whole app (Next.js renders this for
// any unmatched URL, and for any notFound() call without a closer
// not-found boundary). Server Component; Next returns a 404 status and
// auto-injects <meta name="robots" content="noindex">.
//
// Maintain design system: deep navy canvas, drifting topography, oversized
// mono "404", and the shared Nav/Footer so a lost visitor still has the full
// site around them.

import Link from 'next/link'
import { Nav, Footer, Topography, PrimaryCTA, SecondaryCTA } from './_components/site'

export default function NotFound() {
  return (
    <div className="marketing-canvas flex min-h-screen flex-col">
      <div className="noise-overlay" aria-hidden="true" />
      <Nav />

      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-20">
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <Topography />
        </div>

        <div className="relative mx-auto max-w-2xl text-center">
          <div className="font-mono text-[clamp(5rem,22vw,12rem)] font-bold leading-none tracking-[-0.04em] text-accent">
            404
          </div>
          <h1 className="mt-4 font-extrabold uppercase text-[clamp(1.75rem,5vw,2.75rem)] leading-[1.04] tracking-[-0.035em] text-text-pri">
            This page went off the grid
          </h1>
          <p className="mx-auto mt-5 max-w-md text-text-sec leading-relaxed">
            The link may be broken or the page may have moved. Let&rsquo;s get you
            back to somewhere useful.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <PrimaryCTA href="/">Back to home</PrimaryCTA>
            <SecondaryCTA href="/dashboard">Go to dashboard</SecondaryCTA>
          </div>

          <p className="mt-8 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
            Need a hand?{' '}
            <Link href="/pricing" className="link-underline text-text-sec hover:text-text-pri">
              See plans
            </Link>{' '}
            ·{' '}
            <Link href="/signin" className="link-underline text-text-sec hover:text-text-pri">
              Sign in
            </Link>
          </p>
        </div>
      </main>

      <Footer />
    </div>
  )
}
