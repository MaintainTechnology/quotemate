// /onboard/stripe/return — where Stripe sends the tradie back after the
// hosted Connect onboarding flow. Reaching this page does NOT guarantee
// KYC is complete: Stripe may still be verifying identity/bank details.
// The authoritative readiness signal is the `account.updated` Connect
// webhook, which flips tenants.stripe_connect_payouts_enabled. So this
// page is purely informational — it points the tradie back to the
// dashboard, where live status is shown.

import Link from 'next/link'
import { BrandMark } from "@/app/_components/BrandMark"

export const metadata = {
  title: 'Payout account · QuoteMax',
  description: 'Your QuoteMax payout account is being verified.',
}

export default function StripeConnectReturn() {
  return (
    <main className="min-h-screen flex flex-col">
      <nav className="border-b border-ink-line">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10" />
            <span className="font-extrabold uppercase tracking-tight text-text-pri">
              QuoteMax
            </span>
          </Link>
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent">
            ● Verifying
          </span>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl text-center">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">
            Payout setup
          </span>
          <h1 className="mt-4 font-extrabold uppercase text-[clamp(2rem,6vw,4rem)] leading-[0.95] tracking-[-0.04em]">
            Details received.
            <br />
            <span className="text-accent">Stripe is verifying.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-text-dim">
            Stripe is checking your identity and bank details. This usually
            takes a few minutes, occasionally up to a day. You don&rsquo;t need
            to do anything — we&rsquo;ll show your payout status on the
            dashboard once it&rsquo;s confirmed.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-text-dim">
            You can keep quoting in the meantime. Payouts switch on
            automatically as soon as verification clears.
          </p>
          <Link
            href="/dashboard?tab=payouts"
            className="mt-10 inline-block bg-accent px-8 py-4 font-extrabold uppercase tracking-tight text-white"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
