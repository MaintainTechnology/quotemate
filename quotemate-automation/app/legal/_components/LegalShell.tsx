// Shared layout for the legal pages (Privacy / Terms / Cookies).
//
// Server Component — centered prose on the Maintain canvas, a mono eyebrow,
// a "template, not legal advice" banner, an anchor-link table of contents,
// and cross-links to the sibling policies. Section scroll-spy is
// intentionally omitted (it would need a client island); the static TOC
// keeps everything server-rendered and accessible.

import Link from 'next/link'
import { Reveal } from '@/app/_components/Reveal'
import { COMPANY } from './company'

export type TocItem = { id: string; label: string }

const POLICIES: { href: string; label: string }[] = [
  { href: '/legal/privacy', label: 'Privacy policy' },
  { href: '/legal/terms', label: 'Terms & conditions' },
  { href: '/legal/cookies', label: 'Cookie policy' },
]

export function LegalShell({
  eyebrow = 'Legal',
  title,
  intro,
  toc,
  activeHref,
  children,
}: {
  eyebrow?: string
  title: string
  intro: string
  toc: TocItem[]
  activeHref: string
  children: React.ReactNode
}) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <Reveal>
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-text-dim">
          {eyebrow}
        </span>
        <h1 className="mt-4 font-extrabold uppercase text-[clamp(2rem,6vw,3.25rem)] leading-[1.02] tracking-[-0.035em] text-text-pri">
          {title}
        </h1>
        <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
          Last updated {COMPANY.lastUpdated}
        </p>
        <p className="mt-6 text-text-sec leading-relaxed">{intro}</p>

        {/* Template disclaimer — this is the honest "not legal advice" flag. */}
        <div className="mt-8 border border-warning-bright/40 bg-warning-bright/5 px-4 py-3">
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-warning-bright font-bold">
            Template — review before launch
          </div>
          <p className="mt-1 text-sm text-text-sec leading-relaxed">
            This document is a starting template, not legal advice. Replace every
            bracketed placeholder and have a qualified Australian legal
            practitioner review it before you publish or rely on it.
          </p>
        </div>
      </Reveal>

      {/* Table of contents */}
      {toc.length > 0 && (
        <Reveal>
          <nav
            aria-label="On this page"
            className="mt-10 border border-ink-line bg-ink-card px-5 py-5"
          >
            <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              On this page
            </span>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2">
              {toc.map((item, i) => (
                <li key={item.id} className="flex gap-2.5 text-sm">
                  <span className="font-mono text-text-dim tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <a
                    href={`#${item.id}`}
                    className="link-underline text-text-sec hover:text-text-pri"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </Reveal>
      )}

      {/* Body */}
      <div className="mt-12 space-y-10">{children}</div>

      {/* Cross-links + contact */}
      <Reveal>
        <div className="mt-16 border-t border-ink-line pt-8">
          <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            Related policies
          </span>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {POLICIES.map((p) => (
              <li key={p.href}>
                {p.href === activeHref ? (
                  <span className="text-sm font-semibold text-text-pri">{p.label}</span>
                ) : (
                  <Link
                    href={p.href}
                    className="link-underline text-sm text-text-sec hover:text-text-pri"
                  >
                    {p.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-text-sec leading-relaxed">
            Questions about this policy? Contact{' '}
            <span className="text-text-pri">{COMPANY.legalName}</span> at{' '}
            <a
              href={`mailto:${COMPANY.privacyEmail}`}
              className="text-accent hover:text-accent-press font-semibold"
            >
              {COMPANY.privacyEmail}
            </a>
            .
          </p>
        </div>
      </Reveal>
    </section>
  )
}

/** A titled, anchor-linkable section within a legal page. */
export function LegalSection({
  id,
  n,
  heading,
  children,
}: {
  id: string
  n: number
  heading: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="flex items-baseline gap-3 font-extrabold uppercase text-lg tracking-[-0.01em] text-text-pri">
        <span className="font-mono text-sm text-accent tabular-nums">
          {String(n).padStart(2, '0')}
        </span>
        {heading}
      </h2>
      <div className="mt-4 space-y-4 text-text-sec leading-relaxed [&_a]:text-accent [&_a:hover]:text-accent-press [&_strong]:text-text-pri [&_li]:ml-1">
        {children}
      </div>
    </section>
  )
}
