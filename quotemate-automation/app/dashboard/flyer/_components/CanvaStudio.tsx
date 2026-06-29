'use client'

// Canva Flyer Studio — an INLINE sub-view of the Flyer tab (not a modal/overlay).
//
// Rendered in place inside the dashboard Flyer tab when the tradie opens Canva,
// with a "Back to flyers" control to return to the list. Canva's editor can't be
// iframed (X-Frame-Options: SAMEORIGIN) and the embeddable Button SDK is
// China-only, so editing still happens on a canva.com tab; everything around it
// — connect, template picking, design list, and import-back — lives here in
// QuoteMax. Server IO here; OAuth/export logic in lib/canva/* (unit-tested).
// Styled to the Maintain design system.

import { useCallback, useEffect, useState } from 'react'
import { FLYER_TEMPLATE_SUGGESTIONS } from '@/lib/canva/templates'
import { FlyerTemplatePreview } from '@/app/dashboard/flyer/_components/FlyerTemplatePreview'

type CanvaDesign = {
  id: string
  title: string | null
  edit_url: string
  view_url: string | null
  status: string
  png_url: string | null
  pdf_url: string | null
  updated_at: string
}

type StatusResponse = {
  configured: boolean
  connected: boolean
  designs: CanvaDesign[]
}

const btn =
  'inline-flex items-center justify-center gap-2 min-h-[44px] border px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.12em] transition-colors disabled:opacity-50 disabled:pointer-events-none'
const btnAccent = `${btn} border-accent/70 text-accent hover:bg-accent hover:text-accent-ink`
const btnFill = `${btn} border-accent bg-accent text-accent-ink hover:bg-accent-press hover:border-accent-press`
const dlLink = 'inline-flex min-h-[44px] items-center font-mono text-xs uppercase tracking-[0.12em] text-accent hover:text-accent-press'
const btnPlain = `${btn} border-ink-line text-text-sec hover:border-accent hover:text-text-pri`
const chip = 'inline-block font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim'

function StepLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-2xl font-bold leading-none text-accent">{n}</span>
      <h3 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-text-dim">{label}</h3>
    </div>
  )
}

export default function CanvaStudio({
  accessToken,
  onBack,
  onImported,
}: {
  accessToken: string | null
  onBack: () => void
  onImported?: () => void
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)

  const authHeaders = useCallback(
    (): Record<string, string> => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    [accessToken],
  )

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/flyer/canva/status', { headers: authHeaders(), cache: 'no-store' })
      const json = (await res.json()) as StatusResponse & { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'status_failed')
      setStatus({ configured: json.configured, connected: json.connected, designs: json.designs ?? [] })
      setError(null)
    } catch {
      setError('Could not load your Canva status.')
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  // Initial load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await loadStatus()
    })()
    return () => {
      cancelled = true
    }
  }, [loadStatus])

  // The OAuth popup posts back here when the connection completes.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return
      const data = ev.data as { type?: string; ok?: boolean; error?: string } | null
      if (!data || data.type !== 'canva-oauth') return
      if (data.ok) {
        void loadStatus()
      } else {
        setError(`Canva connection failed: ${data.error ?? 'unknown'}`)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [loadStatus])

  const connect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/flyer/canva/connect', { headers: authHeaders(), cache: 'no-store' })
      const json = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? 'connect_failed')
      window.open(json.url, 'canva-oauth', 'popup,width=620,height=760')
    } catch {
      setError('Could not start the Canva connection. Check the integration is configured and try again.')
    } finally {
      setBusy(false)
    }
  }, [authHeaders])

  const disconnect = useCallback(async () => {
    setBusy(true)
    try {
      await fetch('/api/dashboard/flyer/canva/disconnect', { method: 'POST', headers: authHeaders() })
      await loadStatus()
    } finally {
      setBusy(false)
    }
  }, [authHeaders, loadStatus])

  const createDesign = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/flyer/canva/designs', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = (await res.json()) as { id?: string; editUrl?: string; error?: string }
      if (!res.ok || !json.editUrl) {
        setError(json.error === 'not_connected' ? 'Connect your Canva account first.' : 'Could not create a Canva design.')
        return
      }
      window.open(json.editUrl, '_blank', 'noopener')
      await loadStatus()
    } finally {
      setBusy(false)
    }
  }, [authHeaders, loadStatus])

  const importDesign = useCallback(
    async (designId: string) => {
      setImportingId(designId)
      setError(null)
      try {
        const res = await fetch(`/api/dashboard/flyer/canva/designs/${designId}/import`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const json = (await res.json()) as { ok?: boolean; error?: string }
        if (!res.ok || !json.ok) {
          setError('Import failed — make sure you saved the design in Canva, then try again.')
          return
        }
        await loadStatus()
        onImported?.()
      } finally {
        setImportingId(null)
      }
    },
    [authHeaders, loadStatus, onImported],
  )

  const deleteDesign = useCallback(
    async (designId: string) => {
      setBusy(true)
      try {
        await fetch(`/api/dashboard/flyer/canva/designs/${designId}`, { method: 'DELETE', headers: authHeaders() })
        await loadStatus()
      } finally {
        setBusy(false)
      }
    },
    [authHeaders, loadStatus],
  )

  const connected = status?.connected ?? false
  const configured = status?.configured ?? false

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <button onClick={onBack} className={`${btnPlain} mb-4`}>
          &larr; Back to flyers
        </button>
        <span className={chip}>Canva · Flyer Studio</span>
        <h2 className="mt-2 text-2xl font-extrabold uppercase leading-none tracking-[-0.02em] text-text-pri sm:text-3xl">
          Design with <span className="text-accent">Canva</span>
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-sec">
          Pick a ready-made template or start fresh, design in the real Canva editor, then import the finished PNG
          &amp; PDF straight back into QuoteMax.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="border border-warning-bright/50 bg-warning-bright/5 px-4 py-3 text-sm text-warning-bright"
        >
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="h-6 w-40 animate-pulse bg-ink-card" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="aspect-[100/141] animate-pulse border border-ink-line bg-ink-card" />
            ))}
          </div>
        </div>
      ) : !configured ? (
        <p className="border border-ink-line bg-ink-card px-4 py-4 text-sm text-text-sec">
          The Canva integration isn’t configured on the server yet (missing{' '}
          <code className="font-mono text-text-dim">CANVA_CLIENT_ID</code> /{' '}
          <code className="font-mono text-text-dim">CANVA_CLIENT_SECRET</code>).
        </p>
      ) : (
        <div className="space-y-10">
          {/* 01 — Connect */}
          <section className="space-y-4">
            <StepLabel n="01" label="Connect" />
            {connected ? (
              <div className="flex flex-wrap items-center gap-3 border border-ink-line bg-ink-card px-4 py-3">
                <span className="inline-flex items-center gap-2 text-sm text-text-sec">
                  <span className="h-2 w-2 bg-accent" aria-hidden="true" />
                  Canva account connected
                </span>
                <button onClick={disconnect} disabled={busy} className={`${btnPlain} ml-auto`}>
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-3 border border-ink-line bg-ink-card p-5">
                <p className="text-sm text-text-sec">
                  Connect your Canva account to design without leaving QuoteMax. A Canva window opens for you to
                  approve access.
                </p>
                <button onClick={connect} disabled={busy} className={btnFill}>
                  {busy ? 'Opening Canva…' : 'Connect Canva'}
                </button>
              </div>
            )}
          </section>

          {/* 02 — Suggested templates */}
          <section className="space-y-4">
            <StepLabel n="02" label="Pick a starting point" />
            <p className="max-w-2xl text-sm text-text-sec">
              Hand-picked flyer styles for trades. Each opens Canva’s template gallery in a new tab — choose one, make
              it yours.
            </p>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {FLYER_TEMPLATE_SUGGESTIONS.map((t) => (
                <li key={t.id}>
                  <a
                    href={t.canvaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex h-full flex-col border border-ink-line bg-ink-card transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
                  >
                    <div className="aspect-[100/141] overflow-hidden border-b border-ink-line bg-ink-deep p-3">
                      <FlyerTemplatePreview layout={t.layout} accent={t.accent} />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <span className={chip}>{t.category}</span>
                      <span className="font-semibold leading-tight text-text-pri">{t.name}</span>
                      <span className="text-xs leading-relaxed text-text-sec">{t.description}</span>
                      <span className="mt-auto pt-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-accent group-hover:text-accent-press">
                        Open in Canva ↗
                      </span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {/* 03 — Create blank + import (connected only) */}
          <section className="space-y-4">
            <StepLabel n="03" label="Create & import back" />
            {!connected ? (
              <p className="border border-ink-line bg-ink-card px-4 py-3 text-sm text-text-dim">
                Connect your Canva account (step 01) to create a tracked flyer you can import straight back into
                QuoteMax.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 border border-ink-line bg-ink-card px-4 py-3">
                  <p className="min-w-0 flex-1 text-sm text-text-sec">
                    Start a blank Canva flyer linked to QuoteMax, design it, then import the PNG &amp; PDF back here.
                  </p>
                  <button onClick={createDesign} disabled={busy} className={btnFill}>
                    {busy ? 'Working…' : '+ New Canva flyer'}
                  </button>
                </div>

                {status && status.designs.length > 0 && (
                  <ul className="divide-y divide-ink-line border border-ink-line">
                    {status.designs.map((d) => (
                      <li key={d.id} className="space-y-2 bg-ink-card px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-text-pri">{d.title || 'Untitled Canva flyer'}</p>
                            <p className="font-mono text-xs text-text-dim">{d.status}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <a href={d.edit_url} target="_blank" rel="noopener noreferrer" className={btnPlain}>
                              Open in Canva
                            </a>
                            <button onClick={() => importDesign(d.id)} disabled={importingId === d.id} className={btnAccent}>
                              {importingId === d.id ? 'Importing…' : 'Import'}
                            </button>
                            <button
                              onClick={() => deleteDesign(d.id)}
                              disabled={busy}
                              className={btnPlain}
                              aria-label={`Delete ${d.title || 'flyer'}`}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {(d.png_url || d.pdf_url) && (
                          <div className="flex gap-4">
                            {d.png_url && (
                              <a href={d.png_url} target="_blank" rel="noopener noreferrer" className={dlLink}>
                                PNG ↓
                              </a>
                            )}
                            {d.pdf_url && (
                              <a href={d.pdf_url} target="_blank" rel="noopener noreferrer" className={dlLink}>
                                PDF ↓
                              </a>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
