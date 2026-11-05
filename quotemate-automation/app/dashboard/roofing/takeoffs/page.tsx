'use client'

// Plan takeoffs (TKO-19, Design Brief §4.1): the tenant's takeoff runs from
// the takeoff service, newest first.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import type { RunSummary } from '@/lib/roofing/plan-takeoff'
import { Chip, Notice, PRIMARY, Table, TakeoffsOff } from './_components/parts'
import { statusChip, TAKEOFF_API_URL, TakeoffError, takeoffApi, when } from './takeoff-api'

export default function TakeoffsPage() {
  return (
    <FeatureGate slug="roofing" featureLabel="plan takeoffs">
      {TAKEOFF_API_URL ? <TakeoffsList /> : <TakeoffsOff />}
    </FeatureGate>
  )
}

function TakeoffsList() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    // ponytail: the newest 50. Page with next_cursor once a tenant has more.
    takeoffApi<{ runs: RunSummary[] }>('/api/takeoff/runs?limit=50').then(
      (page) => setRuns(page.runs),
      (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))),
    )
  }, [])
  // A tenant the service won't admit hasn't had takeoffs switched on: news, not an alarm.
  const notOnAccount = error instanceof TakeoffError && error.status === 401

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent">Roofing · Plan takeoffs</div>
          <h1 className="mt-2 text-3xl font-extrabold uppercase tracking-[-0.02em] text-text-pri">Takeoffs</h1>
        </div>
        <Link href="/dashboard/roofing/takeoffs/new" className={PRIMARY}>
          New takeoff
        </Link>
      </header>
      {error ? (
        <Notice tone={notOnAccount ? 'neutral' : 'danger'}>{error.message}</Notice>
      ) : runs === null ? (
        <p className="text-text-dim">Loading takeoffs…</p>
      ) : runs.length === 0 ? (
        <p className="text-text-sec">No takeoffs yet. Upload a builder&rsquo;s plans to start.</p>
      ) : (
        // ponytail: the list API carries no structure count or area, so the
        // brief's Structures and Area columns live on the run's own page.
        <Table head={['Job reference', 'Address', 'Status', 'Updated']}>
          {runs.map((run) => (
            <tr key={run.run_id} className="border-b border-ink-line last:border-0">
              <td className="px-4 py-3 font-mono">
                <Link href={`/dashboard/roofing/takeoffs/${run.run_id}`} className="text-text-pri underline-offset-4 hover:text-accent hover:underline">
                  {run.job_ref ?? run.job_name ?? 'Untitled job'}
                </Link>
              </td>
              <td className="px-4 py-3 text-text-sec">{run.site_address}</td>
              <td className="px-4 py-3">
                <Chip chip={statusChip(run.status)} />
              </td>
              <td className="px-4 py-3 font-mono tabular-nums text-text-dim">{when(run.updated_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </main>
  )
}
