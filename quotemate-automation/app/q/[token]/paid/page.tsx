// Stripe success URL lands here. Minimal thank-you page; the webhook
// is what authoritatively marks the quote paid (this page is informational).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function PaidPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ tier?: string; session_id?: string; already?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, paid_at, paid_tier, total_inc_gst')
    .eq('share_token', token)
    .single()

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '4rem auto', padding: '0 1rem', color: '#111' }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Payment received</h1>
      <p style={{ color: '#444', lineHeight: 1.5 }}>
        Thanks{sp.already ? '' : '!'} Your deposit{sp.tier ? ` for the ${sp.tier.toUpperCase()} option` : ''} is in.
        Your tradie will be in touch shortly to confirm a time.
      </p>
      {quote ? (
        <ul style={{ marginTop: '1.5rem', padding: 0, listStyle: 'none', borderTop: '1px solid #eee' }}>
          <li style={{ padding: '0.6rem 0', borderBottom: '1px solid #eee' }}>
            <strong>Quote ref</strong>: {quote.id.slice(0, 8)}
          </li>
          {quote.paid_tier ? (
            <li style={{ padding: '0.6rem 0', borderBottom: '1px solid #eee' }}>
              <strong>Tier paid</strong>: {String(quote.paid_tier).toUpperCase()}
            </li>
          ) : null}
          {quote.total_inc_gst ? (
            <li style={{ padding: '0.6rem 0', borderBottom: '1px solid #eee' }}>
              <strong>Quote total (inc GST)</strong>: ${quote.total_inc_gst}
            </li>
          ) : null}
        </ul>
      ) : null}
      <p style={{ marginTop: '2rem', fontSize: '0.85rem', color: '#666' }}>
        Keep the SMS for your records. Receipt will be emailed to you by Stripe shortly.
      </p>
    </main>
  )
}
