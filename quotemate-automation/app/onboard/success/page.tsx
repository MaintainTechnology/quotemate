// /onboard/success — Maintain design. Dramatic phone number reveal.

import Link from 'next/link'
import { BrandMark } from '@/app/_components/BrandMark'
import { RetryPanel } from './RetryPanel'

type Props = {
  searchParams: Promise<{
    tenant?: string
    phone?: string
    name?: string
    warning?: string
  }>
}

export const metadata = {
  title: "You're live · QuoteMax",
  description: 'Your AI receptionist is up and ready for customer messages.',
}

export default async function OnboardSuccess({ searchParams }: Props) {
  const { tenant, phone, name, warning } = await searchParams
  const firstName = name ?? 'mate'
  const phoneNumber = phone || null
  const smsHref = phoneNumber
    ? `sms:${phoneNumber}?body=${encodeURIComponent('test from owner')}`
    : null

  return (
    <main className="min-h-screen flex flex-col">
      {/* nav */}
      <nav className="border-b border-ink-line">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10" />
            <span className="font-extrabold uppercase tracking-tight text-text-pri">
              QuoteMax
            </span>
          </Link>
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent">
            ● Live
          </span>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl text-center">
          <span className="inline-block bg-accent font-mono text-[0.7rem] font-bold uppercase tracking-[0.2em] px-3 py-1.5">
            Welcome to QuoteMax
          </span>
          <h1 className="mt-6 font-extrabold uppercase text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.95] tracking-[-0.04em]">
            G&rsquo;day {firstName}.
            <br />
            <span className="text-accent">You&rsquo;re on the line.</span>
          </h1>
          <p className="mt-6 mx-auto max-w-xl text-base md:text-lg leading-relaxed text-text-sec">
            You&rsquo;re all set, {firstName}. From here on, QuoteMax answers,
            quotes, and books your jobs round the clock. You do the trade &mdash;
            we&rsquo;ll do the quoting.
          </p>

          {/* Big phone number reveal */}
          <div className="mt-14">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">
              Your QuoteMax number
            </span>
            {phoneNumber ? (
              <div
                data-testid="success-phone-number"
                className="mt-4 font-mono text-[clamp(2rem,6vw,4rem)] font-bold text-text-pri tracking-tight leading-none"
              >
                {formatAuMobile(phoneNumber)}
              </div>
            ) : (
              <>
                <div
                  data-testid="success-no-number"
                  className="mt-4 text-amber-300"
                >
                  Number not yet assigned — provisioning didn&rsquo;t finish.
                </div>
                <RetryPanel warning={warning ?? null} />
              </>
            )}
            <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
              {phoneNumber
                ? 'Real Twilio number routed to your AI receptionist'
                : 'Hit retry above once your Twilio account is funded'}
            </p>
          </div>

          <div className="mt-12 flex flex-col items-center gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-10 py-4 text-sm uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
            >
              Open my dashboard
              <Arrow />
            </Link>
            {smsHref && (
              <a
                href={smsHref}
                className="font-mono text-xs uppercase tracking-[0.14em] text-text-dim hover:text-text-pri transition-colors"
              >
                Or send yourself a test text &rarr;
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: what's active vs deferred */}
      <section className="border-t border-ink-line">
        <div className="mx-auto max-w-5xl px-6 py-16 grid md:grid-cols-2 gap-6">
          <StatusBlock
            label="Active now"
            items={[
              'Account + pricing book saved',
              'Auto-quote services enabled',
              'QuoteMax number assigned',
              'AI receptionist linked',
            ]}
            tone="active"
          />
          <StatusBlock
            label="Up next (from dashboard)"
            items={[
              'Stripe Connect for deposits',
              'Logo + licence details',
              'Pricing fine-tuning',
              'Real Twilio number (Phase 1b)',
            ]}
            tone="next"
          />
        </div>
      </section>

      {/* Foot */}
      <div className="border-t border-ink-line">
        <div className="mx-auto max-w-7xl px-6 py-8 flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-transparent border border-ink-line hover:bg-ink-card text-text-pri font-semibold px-5 py-3 text-xs uppercase tracking-wider transition-colors"
          >
            ← Go home
          </Link>
          {tenant && (
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
              tenant_id: {tenant.slice(0, 8)}…
            </span>
          )}
        </div>
      </div>

      {/* Orange CTA bar */}
      <div className="bg-accent text-white text-center py-4 px-6">
        <span className="font-mono text-xs md:text-sm uppercase tracking-[0.16em] font-semibold">
          QuoteMax · You&rsquo;re live · Tradies, by tradies
        </span>
      </div>
    </main>
  )
}

function StatusBlock({
  label,
  items,
  tone,
}: {
  label: string
  items: string[]
  tone: 'active' | 'next'
}) {
  const marker = tone === 'active' ? '→' : '○'
  const markerColor = tone === 'active' ? 'text-accent' : 'text-text-dim'
  return (
    <div className="bg-ink-card border border-ink-line p-6 md:p-7">
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
        {label}
      </span>
      <ul className="mt-4 space-y-2.5">
        {items.map((it) => (
          <li key={it} className="flex items-baseline gap-3 text-text-sec text-sm">
            <span className={`${markerColor} font-mono text-xs`}>{marker}</span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

function formatAuMobile(e164: string): string {
  const cleaned = e164.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('+61') && cleaned.length === 12) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9, 12)}`
  }
  return e164
}
