'use client'

// The two tradie actions that move a job forward after the site visit
// (spec post-visit-money-sequence R3 + R10).
//
// Before these, an electrical/plumbing job was structurally terminal once the
// customer paid the $99: the quotes row holds exactly one payment, and every
// mutation route 409s on paid_at. The only post-payment action released the
// $99 to the tradie's bank.
//
//   • ISSUE FINAL QUOTE — on the paid site-visit row. Creates the linked
//     'final' child carrying the price confirmed on site and navigates the
//     tradie straight into it to price and send.
//   • REQUEST FINAL PAYMENT — on the final row, once its deposit has landed.
//     Creates the 'balance' child and texts the customer a pay link. Built to
//     be tapped on the job, on a phone, which is why it reports the SMS
//     outcome inline rather than relying on a page refresh.
//
// Both routes are idempotent at the DATABASE (a partial unique index on
// (parent_quote_id, quote_kind) where the child is unpaid), so a double-tap
// returns the existing child instead of creating a second one. The UI still
// disables while in flight — but correctness does not depend on that.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthToken } from '@/lib/auth/client-token'

type State = { pending: boolean; ok: string | null; err: string | null }

const IDLE: State = { pending: false, ok: null, err: null }

/** 409 codes the two routes return, in tradie language. Anything unmapped
 *  falls through to the route's own message rather than a generic failure. */
const REASONS: Record<string, string> = {
  parent_unscoped: 'This quote is not linked to your account.',
  not_initial: 'This is already a follow-up quote.',
  site_visit_not_paid: 'The $99 site visit has not been paid yet.',
  not_site_visit_first: 'Final quotes are for electrical and plumbing jobs.',
  connect_required: 'Finish your Stripe payout setup first — go to the Payouts tab.',
  not_final_quote: 'Open the final quote to request payment.',
  final_not_sent: 'Send the final quote to the customer first.',
  deposit_not_paid: 'The customer has not paid the deposit yet.',
  balance_already_paid: 'This job is already paid in full.',
  nothing_to_charge: 'Nothing left to charge — the site visit covered this job.',
  no_customer_number: 'No mobile on file for this customer.',
  send_failed: 'The payment link could not be texted. Try again.',
}

export default function ChainActions(props: {
  quoteId: string
  /** 'issue-final' on the paid site-visit row; 'request-balance' on the final row. */
  action: 'issue-final' | 'request-balance'
}) {
  const router = useRouter()
  const [state, setState] = useState<State>(IDLE)

  const isIssue = props.action === 'issue-final'
  const label = isIssue ? 'Issue final quote' : 'Request final payment'

  async function run() {
    setState({ pending: true, ok: null, err: null })
    try {
      const token = await getAuthToken()
      if (!token) {
        setState({ pending: false, ok: null, err: 'Sign in as the quote owner.' })
        return
      }
      const path = isIssue ? 'issue-final' : 'request-final-payment'
      const res = await fetch(`/api/quote/${props.quoteId}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        detail?: string
        share_token?: string
        already?: boolean
        sent?: boolean
      }

      if (res.status === 401 || res.status === 403) {
        setState({ pending: false, ok: null, err: 'Sign in as the quote owner.' })
        return
      }
      if (!res.ok || !body.ok) {
        const code = body.error ?? ''
        setState({
          pending: false,
          ok: null,
          err: REASONS[code] ?? body.detail ?? 'That did not work — try again.',
        })
        return
      }

      if (isIssue && body.share_token) {
        // Straight into the new draft: pricing it is the whole point of the click.
        router.push(`/dashboard/quote/${body.share_token}`)
        return
      }
      setState({
        pending: false,
        // Never claim a send that did not happen. The route answers ok:true
        // with sent:false when it suppresses a double tap — reporting that as
        // "re-sent" would tell the tradie a text went out on a turn where
        // nothing was dispatched.
        ok:
          body.sent === false
            ? 'Already requested a moment ago — nothing re-sent.'
            : 'Payment link texted to the customer.',
        err: null,
      })
      router.refresh()
    } catch {
      setState({ pending: false, ok: null, err: 'Network error — try again.' })
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={state.pending}
        className="rounded-ctl inline-flex min-h-[40px] items-center gap-2 bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
      >
        {state.pending ? 'Working…' : label}
      </button>
      {state.err && (
        <p className="max-w-[36ch] text-right text-[0.6rem] uppercase tracking-[0.08em] text-warning">
          {state.err}
        </p>
      )}
      {state.ok && (
        <p className="max-w-[36ch] text-right text-[0.6rem] uppercase tracking-[0.08em] text-text-dim">
          {state.ok}
        </p>
      )}
    </div>
  )
}
