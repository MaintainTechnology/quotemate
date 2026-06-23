// Full-view results dashboard for one estimator run. All data loading +
// interactivity lives in the client workspace (Supabase session → Bearer →
// /api/tenant/estimator/extract/[id]); this page just unwraps the param.

import type { Metadata } from 'next'
import { RunWorkspace } from '../../_components/estimator/RunWorkspace'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'

export const metadata: Metadata = {
  title: 'Plan take-off — QuoteMax Estimator',
  description: 'AI quantity take-off with verified counts, grounded pricing and a full audit trail.',
}

export default async function EstimatorRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  return (
    <FeatureGate slug="electrical" featureLabel="the Estimator">
      <RunWorkspace runId={runId} />
    </FeatureGate>
  )
}
