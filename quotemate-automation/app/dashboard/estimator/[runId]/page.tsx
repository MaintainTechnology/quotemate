// Full-view results dashboard for one estimator run. All data loading +
// interactivity lives in the client workspace (Supabase session → Bearer →
// /api/tenant/estimator/extract/[id]); this page just unwraps the param.

import type { Metadata } from 'next'
import { RunWorkspace } from '../../_components/estimator/RunWorkspace'

export const metadata: Metadata = {
  title: 'Plan take-off — QuoteMate Estimator',
  description: 'AI quantity take-off with verified counts, grounded pricing and a full audit trail.',
}

export default async function EstimatorRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  return <RunWorkspace runId={runId} />
}
