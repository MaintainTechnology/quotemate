// Shared layout for the legal pages (Privacy / Terms / Cookies).
//
// Server Component in the QuoteMax Site Kit's legal-page language: a
// centred hero (badge, title, the "last updated" stamp as a black pill, the
// intro lead; left-aligned on phones, where the long intros would run to
// nine ragged centred lines), then the document: a 768px reading column
// centred under the hero (the reference's .section-content-wrapper.legal)
// with a sticky contents rail in the left margin from 1280px. Narrower, the
// rail would push the column off the hero's axis, so the contents fold into
// a native disclosure above the text. Section scroll-spy is intentionally
// omitted (it would need a client island); the static contents keep
// everything server-rendered and accessible.

import { Reveal } from '@/app/_components/Reveal'
import { Button, Chevron, Eyebrow } from '@/app/_components/site'
import { COMPANY } from './company'

export type TocItem = { id: string; label: string }

const POLICIES: { href: string; label: string }[] = [
  { href: '/legal/privacy', label: 'Privacy policy' },
  { href: '/legal/terms', label: 'Terms & conditions' },
  { href: '/legal/cookies', label: 'Cookie policy' },
]

// Reveal holds content back until it scrolls into view; a printed policy
// must never come out blank, so every reveal here is forced visible in print
// (with no transition, or the print snapshot can catch it mid-fade).
const PRINT_SAFE = 'print:opacity-100! print:transform-none! print:transition-none!'

const num = (n: number) => String(n).padStart(2, '0')

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
    <article aria-labelledby="legal-title">
      {/* No-JS visitors: content must never stay hidden behind the observer. */}
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      {/* No Reveal on the hero: it is the first paint, so it must not ship
          at opacity 0 and wait for hydration to fade in. */}
      <header className="qs-page-hero">
        <div className="qs-container qs-page-hero__center items-start text-left sm:items-center sm:text-center">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 id="legal-title" className="qs-h1">
            {title}
          </h1>
          <p className="rounded-[var(--qs-r-pill)] bg-[var(--qs-ink)] px-3.5 py-2 text-sm font-medium text-white">
            Last updated {COMPANY.lastUpdated}
          </p>
          <p className="qs-lead max-w-[40rem]">{intro}</p>
        </div>
      </header>

      <div className="qs-section qs-section--flush-top">
        <div className="qs-container grid gap-6 xl:grid-cols-[minmax(200px,1fr)_minmax(0,768px)_minmax(0,1fr)] xl:gap-x-10">
          {/* Table of contents */}
          {toc.length > 0 && (
            <div className="mx-auto w-full max-w-[768px] print:hidden">
              {/* Below 1280px: folded into a disclosure above the text. */}
              <Reveal className="xl:hidden">
                <nav aria-label="On this page">
                  {/* overflow-visible: the kit's overflow:hidden would clip the
                      summary's focus ring, which sits outside its box. The
                      list's top padding keeps the first link's ring clear of
                      ::details-content's own clip. */}
                  <details className="qs-faq__item overflow-visible">
                    <summary className="qs-faq__q rounded-[var(--qs-r-md)]">
                      <span>On this page</span>
                      <Chevron className="qs-faq__chev" />
                    </summary>
                    <TocList toc={toc} className="pb-3 pt-1.5" linkClassName="px-5 text-[15px]" />
                  </details>
                </nav>
              </Reveal>
              {/* 1280px up: a sticky rail beside the text. */}
              <nav aria-label="On this page" className="sticky top-28 hidden xl:block">
                <p className="qs-title">On this page</p>
                <TocList
                  toc={toc}
                  className="mt-4 border-l border-[var(--qs-line)]"
                  linkClassName="-ml-px border-l border-transparent pl-4 text-sm hover:border-[var(--qs-ink)]"
                />
              </nav>
            </div>
          )}

          <div className="mx-auto w-full min-w-0 max-w-[768px] xl:col-start-2">
            {/* Template disclaimer — this is the honest "not legal advice" flag. */}
            <Reveal className={PRINT_SAFE}>
              <div role="note" className="flex gap-4 rounded-[var(--qs-r-md)] bg-[var(--qs-paper)] p-5 sm:p-6">
                <span className="qs-tab__dot mt-2 flex-none" aria-hidden="true" />
                <div className="flex flex-col gap-1.5">
                  <p className="qs-title">Template: review before launch</p>
                  <p className="qs-small">
                    This document is a starting template, not legal advice. Replace every
                    bracketed placeholder and have a qualified Australian legal
                    practitioner review it before you publish or rely on it.
                  </p>
                </div>
              </div>
            </Reveal>

            {/* Body */}
            <div className="mt-14 flex flex-col gap-14 lg:mt-[72px] lg:gap-[88px]">{children}</div>

            {/* Cross-links + contact */}
            <Reveal className={`mt-20 lg:mt-[88px] ${PRINT_SAFE}`}>
              <div className="qs-card">
                <p className="qs-title">Related policies</p>
                <ul className="flex flex-wrap gap-2.5">
                  {POLICIES.map((p) => (
                    <li key={p.href}>
                      {p.href === activeHref ? (
                        // The page you are on: a state, not an action, so no
                        // fill (the black pill means "click me" in the kit)
                        // and the kit's dot for "you are here".
                        <span
                          aria-current="page"
                          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--qs-r-pill)] border border-[#dbdad9] px-[22px] text-sm font-medium text-[var(--qs-ink)]"
                        >
                          <span className="qs-tab__dot" aria-hidden="true" />
                          {p.label}
                        </span>
                      ) : (
                        <Button href={p.href} variant="secondary">
                          {p.label}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="qs-text">
                  Questions about this policy? Contact{' '}
                  <span className="qs-ink">{COMPANY.legalName}</span> at{' '}
                  <a
                    href={`mailto:${COMPANY.privacyEmail}`}
                    className="qs-link decoration-[var(--qs-muted)] hover:decoration-current"
                  >
                    {COMPANY.privacyEmail}
                  </a>
                  .
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </article>
  )
}

/** The numbered contents list — shared by the phone disclosure and the rail. */
function TocList({
  toc,
  className,
  linkClassName,
}: {
  toc: TocItem[]
  className: string
  linkClassName: string
}) {
  return (
    <ol className={className}>
      {toc.map((item, i) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className={`flex min-h-11 items-baseline gap-3 py-3 leading-[1.4] text-[var(--qs-body)] transition-colors duration-200 hover:text-[var(--qs-ink)] ${linkClassName}`}
          >
            <span className="qs-num text-[var(--qs-muted)]">{num(i + 1)}</span>
            {item.label}
          </a>
        </li>
      ))}
    </ol>
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
    // scroll-mt-6 + the root's 5rem scroll-padding lands the title just
    // under the sticky pill nav (the kit's 104px scroll-margin would stack
    // on that padding and overshoot).
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6">
      <Reveal className={PRINT_SAFE}>
        <h2 id={`${id}-heading`} className="qs-h3 flex gap-[0.45em]">
          <span className="qs-num text-[var(--qs-muted)]">{num(n)}</span>
          {heading}
        </h2>
        <div className="qs-text mt-6 space-y-4 leading-[1.65] marker:text-[var(--qs-ink)] [&_a]:font-medium [&_a]:text-[var(--qs-ink)] [&_a]:underline [&_a]:decoration-[var(--qs-muted)] [&_a]:underline-offset-4 [&_a]:transition-[text-decoration-color] [&_a]:duration-200 [&_a:hover]:decoration-current [&_li]:pl-1">
          {children}
        </div>
      </Reveal>
    </section>
  )
}
