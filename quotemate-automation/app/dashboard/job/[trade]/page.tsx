// /dashboard/job/electrical and /dashboard/job/plumbing — the tradie-typed
// job quoter. One page for both trades: the field sets differ per JOB TYPE
// (lib/quote/job-fields.ts), not per trade, so the trade only selects which
// job types the dropdown offers and which feature slug gates the page.

import { notFound } from 'next/navigation'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import JobQuoteForm from '../_components/JobQuoteForm'

const TRADES = ['electrical', 'plumbing'] as const
type JobTrade = (typeof TRADES)[number]

export default async function JobQuotePage({ params }: { params: Promise<{ trade: string }> }) {
  const { trade } = await params
  if (!(TRADES as readonly string[]).includes(trade)) notFound()

  return (
    <FeatureGate slug={trade} featureLabel={`the ${trade} job quoter`}>
      <JobQuoteForm trade={trade as JobTrade} />
    </FeatureGate>
  )
}
