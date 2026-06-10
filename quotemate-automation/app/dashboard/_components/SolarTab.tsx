'use client'

// Solar tab — the tradie's command centre for AI solar estimates.
//
//  • A shareable customer link (/solar/<tenant-id>) with a copy button —
//    the entry-form a customer fills to request an estimate.
//  • The list of drafted estimates as cards: status badge, system kW, net
//    price, customer + address, a "View" link to the public /q/solar/<token>
//    page, and a "Confirm & release" button for clean, awaiting-confirmation
//    estimates (POSTs Bearer-auth to /api/solar/confirm/<token>).
//  • Flagged estimates show a clear "needs review" note and NO confirm
//    button — the tradie must adjust the numbers + re-draft first.
//
// No solar estimate auto-sends; confirm is the forced human-in-loop gate.
// Maintain design system: dark navy, vibrant orange accent, all-caps mono.

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Sun, ExternalLink } from 'lucide-react'
import type {
  SolarEstimateStatus,
  SolarEstimateViewModel,
} from '@/lib/solar/dashboard-view'

type Props = {
  accessToken: string | null
  tenantId: string
  /** Public base url, exposed to the browser. Falls back to the API's own
   *  shareUrl (server APP_URL) and finally to window.location.origin. */
  appUrl?: string | null
}

const STATUS_META: Record<
  SolarEstimateStatus,
  { label: string; cls: string }
> = {
  awaiting_confirmation: {
    label: 'Awaiting review',
    cls: 'border-amber-400/40 text-amber-300',
  },
  confirmed: {
    label: 'Released',
    cls: 'border-emerald-400/40 text-emerald-300',
  },
  paid: {
    label: 'Deposit paid',
    cls: 'border-emerald-400/60 text-emerald-200',
  },
  flagged: {
    label: 'Needs review',
    cls: 'border-warning/50 text-warning',
  },
}

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return '$' + Math.round(n).toLocaleString('en-AU')
}

function fmtKw(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(1)} kW`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function SolarTab({ accessToken, tenantId, appUrl }: Props) {
  const [estimates, setEstimates] = useState<SolarEstimateViewModel[] | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Per-token confirm state so each card's button works independently.
  const [confirming, setConfirming] = useState<Record<string, boolean>>({})
  const [confirmError, setConfirmError] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!accessToken) {
      setError('Not signed in')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tenant/solar', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        estimates?: SolarEstimateViewModel[]
        shareUrl?: string
        error?: string
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setEstimates(json.estimates ?? [])
      if (json.shareUrl) setShareUrl(json.shareUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  // The link the tradie shares with customers. Prefer the server-built
  // shareUrl (uses APP_URL); fall back to appUrl prop, then the browser
  // origin, all pointing at /solar/<tenant-id>.
  const resolvedShareUrl =
    shareUrl ??
    `${(appUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '')}/solar/${tenantId}`

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resolvedShareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — link is still visible to copy manually */
    }
  }, [resolvedShareUrl])

  const confirmEstimate = useCallback(
    async (token: string) => {
      if (!accessToken) return
      setConfirming((m) => ({ ...m, [token]: true }))
      setConfirmError((m) => {
        const next = { ...m }
        delete next[token]
        return next
      })
      try {
        const res = await fetch(`/api/solar/confirm/${token}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          confirmed_at?: string
          error?: string
        }
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
        // Optimistically flip this row to confirmed (released) in place.
        setEstimates((rows) =>
          (rows ?? []).map((r) =>
            r.token === token
              ? { ...r, status: 'confirmed', canConfirm: false }
              : r,
          ),
        )
      } catch (e) {
        setConfirmError((m) => ({
          ...m,
          [token]: e instanceof Error ? e.message : String(e),
        }))
      } finally {
        setConfirming((m) => {
          const next = { ...m }
          delete next[token]
          return next
        })
      }
    },
    [accessToken],
  )

  return (
    <div className="space-y-7">
      <div>
        <h2 className="font-extrabold uppercase tracking-[-0.025em] text-[clamp(1.5rem,2.6vw,2.25rem)] leading-[1.1] text-text-pri">
          Solar
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          Share your solar estimate link with a customer. They enter their
          address; the AI sizes the roof, applies the STC rebate, and drafts
          tiered prices. Nothing reaches the customer until you confirm and
          release — flagged estimates need a re-draft first.
        </p>
      </div>

      {/* Shareable customer entry link + copy button */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          <Sun className="h-4 w-4" aria-hidden="true" />
          Your customer link
        </div>
        <p className="mt-3 text-base leading-relaxed text-text-sec">
          Send this to a customer so they can request a solar estimate.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="flex-1 break-all border border-ink-line bg-ink-deep px-4 py-3 font-mono text-sm text-text-pri">
            {resolvedShareUrl}
          </code>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex shrink-0 items-center justify-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden="true" /> Copy link
              </>
            )}
          </button>
        </div>
      </div>

      {/* Estimate list */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
            Solar estimates{estimates ? ` · ${estimates.length}` : ''}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent"
          >
            Refresh
          </button>
        </div>

        {loading && (
          <p className="mt-4 text-base text-text-dim">Loading estimates…</p>
        )}
        {error && !loading && (
          <p className="mt-4 text-base text-warning">
            Couldn&apos;t load estimates: {error}
          </p>
        )}
        {!loading && !error && estimates && estimates.length === 0 && (
          <p className="mt-4 text-base text-text-dim">
            No solar estimates yet. Share your customer link above — every
            estimate a customer requests will show up here for you to review
            and release.
          </p>
        )}

        {!loading && !error && estimates && estimates.length > 0 && (
          <ul className="mt-5 space-y-4">
            {estimates.map((e) => {
              const meta = STATUS_META[e.status]
              const busy = !!confirming[e.token]
              const cErr = confirmError[e.token]
              return (
                <li
                  key={e.token}
                  className="border border-ink-line bg-ink-deep p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-extrabold uppercase tracking-[-0.02em] text-lg text-text-pri">
                        {e.customerName || 'Customer'}
                      </div>
                      {e.address && (
                        <div className="mt-1 text-sm text-text-sec">
                          {e.address}
                        </div>
                      )}
                      <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                        {fmtDate(e.createdAt)}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 border ${meta.cls} px-3 py-1 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em]`}
                    >
                      {meta.label}
                    </span>
                  </div>

                  {/* Headline stats */}
                  <div className="mt-4 grid grid-cols-2 gap-px border border-ink-line bg-ink-line/60 sm:grid-cols-3">
                    <Stat label="System" value={fmtKw(e.systemKw)} />
                    <Stat label="Net (inc GST)" value={fmtMoney(e.netIncGst)} accent />
                    <Stat
                      label="Routing"
                      value={
                        e.routing === 'inspection_required'
                          ? 'Site visit'
                          : e.routing === 'auto_quote'
                            ? 'Auto'
                            : 'Tradie review'
                      }
                    />
                  </div>

                  {e.status === 'flagged' && (
                    <p className="mt-4 border border-warning/40 border-l-4 border-l-warning bg-ink-card px-4 py-3 text-sm text-warning">
                      {e.guardrailCount} open check
                      {e.guardrailCount === 1 ? '' : 's'} — adjust the numbers and
                      re-draft before this can be released.
                    </p>
                  )}

                  {cErr && (
                    <p className="mt-3 text-sm text-warning">
                      Couldn&apos;t release: {cErr}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <a
                      href={e.quoteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      View
                    </a>
                    {e.canConfirm && (
                      <button
                        type="button"
                        onClick={() => void confirmEstimate(e.token)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:opacity-60"
                      >
                        {busy ? 'Releasing…' : 'Confirm & release'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="bg-ink-deep px-4 py-3">
      <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-base font-bold tabular-nums ${accent ? 'text-accent' : 'text-text-pri'}`}
      >
        {value}
      </div>
    </div>
  )
}
