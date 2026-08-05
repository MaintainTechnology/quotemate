'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import { getAuthToken } from '@/lib/auth/client-token'
import type { RoofTopologyPreviewResponse } from '@/lib/roofing/topology-preview'
import { TopologyEvidencePanel } from './TopologyEvidencePanel'

export default function RoofingTopologyEvidencePage() {
  return (
    <FeatureGate slug="roofing" featureLabel="Roof topology evidence">
      <RoofingTopologyEvidencePageInner />
    </FeatureGate>
  )
}

function RoofingTopologyEvidencePageInner() {
  const params = useParams<{ id: string }>()
  const measurementId = typeof params.id === 'string' ? params.id : ''
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; payload: RoofTopologyPreviewResponse }
    | { status: 'error'; message: string }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = await getAuthToken()
      if (!token) {
        if (!cancelled) setState({ status: 'error', message: 'Sign in to open topology evidence.' })
        return
      }
      try {
        const response = await fetch(`/api/dashboard/roofing/measurements/${encodeURIComponent(measurementId)}/topology`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const body = await response.json().catch(() => ({})) as RoofTopologyPreviewResponse | { error?: string }
        if (cancelled) return
        if (!response.ok || !('ok' in body) || body.ok !== true) {
          setState({ status: 'error', message: 'error' in body && body.error ? body.error : `Could not load this measurement (${response.status}).` })
          return
        }
        setState({ status: 'ready', payload: body })
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Could not reach the topology-evidence service.' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [measurementId])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-7xl px-6 py-14 sm:px-10 md:py-20">
        <nav className="flex flex-wrap items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim" aria-label="Breadcrumb">
          <Link href="/dashboard" className="transition-colors hover:text-text-pri">Dashboard</Link>
          <span className="text-ink-line">/</span>
          <Link href="/dashboard?tab=roofing" className="transition-colors hover:text-text-pri">Roofing</Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">Topology evidence</span>
        </nav>

        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && <ErrorState message={state.message} />}
        {state.status === 'ready' && (
          <>
            <div className="mt-9 grid gap-8 border-b border-ink-line pb-9 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
              <div>
                <div className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">Saved roofing measurement</div>
                <h1 className="mt-3 max-w-4xl font-extrabold uppercase leading-[0.96] tracking-[-0.04em] text-[clamp(2.5rem,5.2vw,4.5rem)]">
                  Roof <span className="text-accent">topology</span> evidence
                </h1>
              </div>
              <div className="border border-ink-line bg-ink-card p-5 text-sm leading-relaxed text-text-sec">
                <div className="font-mono text-micro font-semibold uppercase tracking-[0.15em] text-text-dim">Measured property</div>
                <p className="mt-2 font-semibold text-text-pri">{state.payload.measurement.address ?? 'Address unavailable'}</p>
                <p className="mt-1 font-mono text-xs text-text-dim">{[state.payload.measurement.postcode, state.payload.measurement.state].filter(Boolean).join(' · ')}</p>
              </div>
            </div>

            <TopologyEvidencePanel
              structures={state.payload.measurement.structures}
              gate={state.payload.topology.gate}
              disclaimer={state.payload.topology.disclaimer}
            />
          </>
        )}
      </section>
      <div className="bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">QuoteMax · Roofing · Topology evidence</span>
      </div>
    </main>
  )
}

function LoadingState() {
  return (
    <div className="mt-10 border border-ink-line bg-ink-card p-8" role="status">
      <div className="flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/30 border-t-accent motion-reduce:animate-none" aria-hidden="true" />
        Loading topology evidence
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="mt-10 border border-warning-bright/40 bg-ink-card p-7">
      <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-warning">Topology evidence unavailable</div>
      <p className="mt-3 text-sm leading-relaxed text-text-sec">{message}</p>
      <Link href="/dashboard?tab=roofing" className="mt-5 inline-flex font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent hover:underline">Back to roofing &rarr;</Link>
    </div>
  )
}
