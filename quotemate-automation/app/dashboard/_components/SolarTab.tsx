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
import { Copy, Check, Sun, ExternalLink, RefreshCw } from 'lucide-react'
import type {
  SolarEstimateStatus,
  SolarEstimateViewModel,
} from '@/lib/solar/dashboard-view'
import { PylonPanel } from './PylonTab'
import { PylonHardwareCard } from './PylonHardwareCard'
import { OpenSolarPanel } from './OpenSolarTab'

/** Sub-views of the Solar tab: the Google-path instant estimate plus the
 *  Pylon and OpenSolar design-import paths. Deep-linkable via
 *  ?tab=solar&sub=pylon and ?tab=solar&sub=opensolar. */
type SolarSubTab = 'instant' | 'pylon' | 'opensolar'

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
  // Sub-tab between the instant (Google-path) estimate and the Pylon
  // design-import path. ?sub=pylon deep-links straight to the latter.
  const [sub, setSub] = useState<SolarSubTab>(() => {
    if (typeof window === 'undefined') return 'instant'
    const param = new URLSearchParams(window.location.search).get('sub')
    return param === 'pylon' || param === 'opensolar' ? param : 'instant'
  })
  const [estimates, setEstimates] = useState<SolarEstimateViewModel[] | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Per-token confirm state so each card's button works independently.
  const [confirming, setConfirming] = useState<Record<string, boolean>>({})
  const [confirmError, setConfirmError] = useState<Record<string, string>>({})
  // Per-token re-draft state (the fix loop for flagged estimates).
  const [redrafting, setRedrafting] = useState<Record<string, boolean>>({})
  const [redraftError, setRedraftError] = useState<Record<string, string>>({})
  const [redraftDone, setRedraftDone] = useState<Record<string, string>>({})

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

  const redraftEstimate = useCallback(
    async (token: string) => {
      if (!accessToken) return
      setRedrafting((m) => ({ ...m, [token]: true }))
      setRedraftError((m) => {
        const next = { ...m }
        delete next[token]
        return next
      })
      setRedraftDone((m) => {
        const next = { ...m }
        delete next[token]
        return next
      })
      try {
        const res = await fetch(`/api/solar/redraft/${token}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          guardrail_flags?: string[]
          error?: string
        }
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
        const remaining = json.guardrail_flags?.length ?? 0
        setRedraftDone((m) => ({
          ...m,
          [token]:
            remaining === 0
              ? 'Re-drafted clean — ready to release.'
              : `Re-drafted — ${remaining} check${remaining === 1 ? '' : 's'} still open.`,
        }))
        // Reload the list so the card reflects the fresh numbers + status.
        await load()
      } catch (e) {
        setRedraftError((m) => ({
          ...m,
          [token]: e instanceof Error ? e.message : String(e),
        }))
      } finally {
        setRedrafting((m) => {
          const next = { ...m }
          delete next[token]
          return next
        })
      }
    },
    [accessToken, load],
  )

  return (
    <div className="space-y-7">
      {/* The dashboard shell already renders the tab title (TAB_META), so
          this block carries only the sub-tab-specific context line. */}
      <div>
        <p className="max-w-2xl text-base leading-relaxed text-text-sec">
          {sub === 'instant' ? (
            <>
              Share your solar estimate link with a customer. They enter their
              address; the AI sizes the roof, applies the STC rebate, and drafts
              tiered prices. Nothing reaches the customer until you confirm and
              release — flagged estimates need a re-draft first.
            </>
          ) : sub === 'pylon' ? (
            <>
              Import a design you made in Pylon studio. QuoteMate renders it as
              your branded proposal — layout, single-line diagram, components
              and your exact pricing — with deposit payment and SMS delivery on
              top. Nothing reaches the customer until you confirm and release.
            </>
          ) : (
            <>
              Import a project you designed in OpenSolar studio. QuoteMate
              renders it as your branded proposal — layout render, components,
              shading, engineering documents and your exact pricing — with
              deposit payment and SMS delivery on top. Nothing reaches the
              customer until you confirm and release.
            </>
          )}
        </p>
      </div>

      {/* Sub-tab switch: instant (Google path) vs Pylon (design import) */}
      <div className="flex border-b border-ink-line" role="tablist" aria-label="Solar estimate source">
        {(
          [
            ['instant', 'Instant estimate'],
            ['pylon', 'Pylon'],
            ['opensolar', 'OpenSolar'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={sub === key}
            onClick={() => setSub(key)}
            className={`px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
              sub === key
                ? 'border-b-2 border-accent text-accent'
                : 'border-b-2 border-transparent text-text-dim hover:text-text-pri'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'pylon' && <PylonPanel accessToken={accessToken} />}

      {sub === 'opensolar' && <OpenSolarPanel accessToken={accessToken} />}

      {sub === 'instant' && (
        <>
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

      {/* Pylon supplements — standard-hardware SKUs (renders only when
          the Pylon integration is enabled server-side). */}
      <PylonHardwareCard accessToken={accessToken} />

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
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {/* Live Pylon pipeline stage of the pushed lead
                          (supplements build 2026-06-13). */}
                      {e.pylonStage &&
                        (e.pylonLeadUrl ? (
                          <a
                            href={e.pylonLeadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border border-teal-glow/40 px-3 py-1 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-teal-glow transition-colors hover:border-teal-glow"
                          >
                            Pylon: {e.pylonStage}
                          </a>
                        ) : (
                          <span className="border border-teal-glow/40 px-3 py-1 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-teal-glow">
                            Pylon: {e.pylonStage}
                          </span>
                        ))}
                      {/* OpenSolar project created by the confirm-time lead
                          push (enrichment build 2026-06-13). */}
                      {e.openSolarProjectUrl && (
                        <a
                          href={e.openSolarProjectUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="border border-teal-glow/40 px-3 py-1 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-teal-glow transition-colors hover:border-teal-glow"
                        >
                          OpenSolar project
                        </a>
                      )}
                      <span
                        className={`border ${meta.cls} px-3 py-1 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em]`}
                      >
                        {meta.label}
                      </span>
                    </div>
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
                    <div className="mt-4 border border-warning/40 border-l-4 border-l-warning bg-ink-card px-4 py-3">
                      <p className="text-sm font-semibold text-warning">
                        {e.guardrailCount} open check
                        {e.guardrailCount === 1 ? '' : 's'} blocking release
                      </p>
                      {e.guardrailFlags?.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {e.guardrailFlags.map((flag, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-sm leading-relaxed text-text-sec"
                            >
                              <span className="mt-0.5 font-mono text-xs font-bold text-warning" aria-hidden>
                                {String(i + 1).padStart(2, '0')}
                              </span>
                              {flag}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-2 text-xs leading-relaxed text-text-dim">
                        Fix the underlying data (rates, STC zone, config), then
                        hit Re-draft below — the engine re-prices this estimate
                        and clears any check the fix resolved.
                      </p>
                    </div>
                  )}

                  {cErr && (
                    <p className="mt-3 text-sm text-warning">
                      Couldn&apos;t release: {cErr}
                    </p>
                  )}
                  {redraftError[e.token] && (
                    <p className="mt-3 text-sm text-warning">
                      Couldn&apos;t re-draft: {redraftError[e.token]}
                    </p>
                  )}
                  {redraftDone[e.token] && (
                    <p className="mt-3 text-sm text-emerald-300">
                      {redraftDone[e.token]}
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
                    {e.canRedraft && (
                      <button
                        type="button"
                        onClick={() => void redraftEstimate(e.token)}
                        disabled={!!redrafting[e.token]}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-60 ${
                          e.status === 'flagged'
                            ? 'bg-accent text-white hover:bg-accent-press'
                            : 'border border-ink-line text-text-pri hover:border-accent hover:text-accent'
                        }`}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${redrafting[e.token] ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        {redrafting[e.token] ? 'Re-drafting…' : 'Re-draft'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
          </div>
        </>
      )}
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
