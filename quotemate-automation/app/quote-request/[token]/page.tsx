// Public self-serve quote-request form — the unique-hash link every SMS
// receptionist offers first (/quote-request/[token]).
//
// spec: specs/generic-quote-request-form.md §2.
//
// Server component: it resolves the token itself (Next 16 async params) so
// the trade is known before the first paint. That is the one deliberate
// divergence from /paint-request, which fetches its context client-side and
// therefore flashes a spinner before the dead-end. An unknown, expired or
// already-submitted token renders a friendly dead-end here — always a 200,
// never a raw 404, because the customer arrives from an SMS link.

import { createClient } from '@supabase/supabase-js'
import { isQuoteRequestTrade } from '@/lib/quote-request/fields'
import { DeadEnd, QuoteRequestForm, Shell, ThankYou } from './QuoteRequestForm'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function QuoteRequestPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // supabase-js RESOLVES { data, error }. An unchecked error here is what
  // makes /paint-request tell a customer their link is invalid during a
  // PostgREST outage.
  const { data: lead, error } = await supabase
    .from('trade_lead_requests')
    .select('trade, tenant_id, status')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    console.error('[quote-request:page] lead lookup failed', error.message)
    return (
      <Shell>
        <DeadEnd message="We could not load your form just now. Refresh in a moment, or reply to our text and we'll sort it out." />
      </Shell>
    )
  }

  if (!lead || !isQuoteRequestTrade(lead.trade)) {
    return (
      <Shell>
        <DeadEnd message="This link is not valid. Reply to our text and we'll send you a fresh one." />
      </Shell>
    )
  }

  let businessName: string | null = null
  if (lead.tenant_id) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('business_name')
      .eq('id', lead.tenant_id as string)
      .maybeSingle()
    businessName = (tenant?.business_name as string | undefined) ?? null
  }

  if (lead.status === 'submitted') {
    return (
      <Shell business={businessName}>
        <ThankYou inspection={false} />
      </Shell>
    )
  }
  if (lead.status !== 'pending') {
    return (
      <Shell business={businessName}>
        <DeadEnd message="This link has expired. Reply to our text and we'll send you a fresh one." />
      </Shell>
    )
  }

  return <QuoteRequestForm token={token} trade={lead.trade} businessName={businessName} />
}
