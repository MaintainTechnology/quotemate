// app/not-found.tsx — custom 404 for the whole app (Next.js renders this for
// any unmatched URL, and for any notFound() call without a closer
// not-found boundary). Server Component; Next returns a 404 status and
// auto-injects <meta name="robots" content="noindex">.
//
// QuoteMax Site Kit: a centred hero on the white canvas — an oversized
// "404" over a soft warm glow — inside the shared shell, so a lost visitor
// still has the full site (nav + footer) around them.

import Link from 'next/link'
import { SiteShell, Eyebrow, PrimaryCTA, SecondaryCTA } from './_components/site'

export default function NotFound() {
  return (
    <SiteShell>
      <section className="qs-page-hero overflow-hidden">
        <div className="qs-container qs-page-hero__center">
          <Eyebrow>Error 404</Eyebrow>
          <div className="relative" aria-hidden="true">
            <div className="absolute inset-x-[-20%] bottom-[8%] h-[38%] bg-[image:var(--qs-glow)] opacity-60 blur-[48px]" />
            <p className="qs-num relative text-[clamp(6rem,24vw,13rem)] leading-[0.9] tracking-[-0.075em] text-[var(--qs-ink)]">
              404
            </p>
          </div>
          <h1 className="qs-h1">This page went off the grid</h1>
          <p className="qs-lead max-w-md">
            The link may be broken or the page may have moved. Let&rsquo;s get you
            back to somewhere useful.
          </p>
          <div className="qs-actions">
            <PrimaryCTA href="/">Back to home</PrimaryCTA>
            <SecondaryCTA href="/dashboard">Go to dashboard</SecondaryCTA>
          </div>
          <p className="qs-meta mt-4">
            Need a hand?{' '}
            <Link href="/pricing" className="qs-link">
              See plans
            </Link>{' '}
            ·{' '}
            <Link href="/signin" className="qs-link">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </SiteShell>
  )
}
