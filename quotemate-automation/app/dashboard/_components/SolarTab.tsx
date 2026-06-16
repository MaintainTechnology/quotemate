'use client'

// Solar tab — the tradie's command centre for AI solar estimates.
//
//  • Two sub-tabs (Felt tab spec 2026-06-13): "Instant estimate" — the
//    original path, byte-identical — and "Felt" — the same engine with
//    an interactive Felt roof map (satellite, panel layout, sun heat
//    map) provisioned per estimate. Deep-link: ?tab=solar&sub=felt.
//  • A shareable customer link (/solar/<tenant-id>, +?path=felt on the
//    Felt sub-tab) with a copy button.
//  • The list of drafted estimates as cards: status badge, system kW, net
//    price, customer + address, a "View" link to the public /q/solar/<token>
//    page, and a "Confirm & release" button for awaiting-confirmation
//    estimates (POSTs Bearer-auth to /api/solar/confirm/<token>).
//  • Flagged estimates show a clear "needs review" note and NO confirm
//    button — the tradie must adjust the numbers + re-draft first.
//  • Felt cards add the map provisioning chip (ready / building /
//    unavailable) and an "Open in Felt" editor link.
//
// A CLEAN estimate auto-releases to the customer at creation (Path B,
// docs/strategy.md v12 2026-06-16) — it lands here already "Released". The
// "Confirm & release" button is the manual path for a FLAGGED estimate the
// tradie has re-drafted clean (auto-release skips flagged rows).
// Maintain design system: dark navy, vibrant orange accent, all-caps mono.

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Sun, ExternalLink, RefreshCw, Map as MapIcon } from 'lucide-react'
import type {
  SolarEstimateStatus,
  SolarEstimateViewModel,
} from '@/lib/solar/dashboard-view'
import { PylonHardwareCard } from './PylonHardwareCard'

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

type SolarSub = 'instant' | 'felt'

/** Felt map provisioning chip copy + tone, by felt.status. */
const FELT_CHIP: Record<
  string,
  { label: string; cls: string }
> = {
  ready: { label: 'Map ready', cls: 'border-teal-glow/40 text-teal-glow' },
  partial: { label: 'Map building…', cls: 'border-amber-400/40 text-amber-300' },
  provisioning: { label: 'Map building…', cls: 'border-amber-400/40 text-amber-300' },
  pending: { label: 'Map building…', cls: 'border-amber-400/40 text-amber-300' },
  failed: { label: 'Map unavailable', cls: 'border-warning/50 text-warning' },
}

function TabButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean
  onClick: () => void
  label: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-6 py-4 text-left transition-colors ${active ? 'bg-ink-card' : 'bg-ink-deep hover:bg-ink-card/60'}`}
    >
      <div
        className={`font-mono text-sm font-semibold uppercase tracking-[0.14em] ${active ? 'text-accent' : 'text-text-sec'}`}
      >
        {label}
      </div>
      <div className="mt-1 text-xs text-text-dim">{sub}</div>
    </button>
  )
}

export function SolarTab({ accessToken, tenantId, appUrl }: Props) {
  const [estimates, setEstimates] = useState<SolarEstimateViewModel[] | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Sub-tab (Felt tab spec 2026-06-13). Deep-link ?tab=solar&sub=felt.
  const [sub, setSub] = useState<SolarSub>(() => {
    if (typeof window === 'undefined') return 'instant'
    return new URLSearchParams(window.location.search).get('sub') === 'felt'
      ? 'felt'
      : 'instant'
  })
  // Whether the Felt path is live server-side (FELT_TAB_ENABLED + key).
  const [feltEnabled, setFeltEnabled] = useState<boolean | null>(null)
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
        feltEnabled?: boolean
        error?: string
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setEstimates(json.estimates ?? [])
      if (json.shareUrl) setShareUrl(json.shareUrl)
      setFeltEnabled(json.feltEnabled ?? false)
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
  // origin, all pointing at /solar/<tenant-id>. The Felt sub-tab shares
  // the same entry form with ?path=felt (identical form, Felt layout).
  const baseShareUrl =
    shareUrl ??
    `${(appUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '')}/solar/${tenantId}`
  const resolvedShareUrl = sub === 'felt' ? `${baseShareUrl}?path=felt` : baseShareUrl

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resolvedShareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — link is still visible to copy manually */
    }
  }, [resolvedShareUrl])

  // Cards for the active sub-tab only. Rows predating migration 111 map
  // to 'instant' (dashboard-view defaults the variant).
  const visibleEstimates = (estimates ?? []).filter((e) =>
    sub === 'felt' ? e.quoteVariant === 'felt' : e.quoteVariant !== 'felt',
  )

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
          this block carries only the context line. */}
      <div>
        <p className="max-w-2xl text-base leading-relaxed text-text-sec">
          Share your solar estimate link with a customer. They enter their
          address; the AI sizes the roof, applies the STC rebate, and drafts
          tiered prices. Clean estimates send to the customer automatically;
          flagged estimates wait for your review and re-draft first.
        </p>
      </div>

      {/* ── Sub-tabs: Instant estimate | Felt (spec 2026-06-13) ──── */}
      <div className="flex flex-wrap gap-px border border-ink-line bg-ink-line">
        <TabButton
          active={sub === 'instant'}
          onClick={() => setSub('instant')}
          label="Instant estimate"
          sub="Address → engine → tiered quote"
        />
        <TabButton
          active={sub === 'felt'}
          onClick={() => setSub('felt')}
          label="Felt"
          sub="Same engine · interactive roof map"
        />
      </div>

      {/* Felt setup notice — the sub-tab stays browsable when disabled. */}
      {sub === 'felt' && feltEnabled === false && (
        <div className="border border-ink-line border-l-4 border-l-warning bg-ink-card px-6 py-5">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
            Felt not configured
          </div>
          <p className="mt-1 text-sm leading-relaxed text-text-sec">
            Set <code className="font-mono text-text-pri">FELT_TAB_ENABLED=true</code> and{' '}
            <code className="font-mono text-text-pri">FELT_API_KEY</code> server-side to
            activate the interactive-map quote path. Customer submissions fall
            back to the instant layout until then.
          </p>
        </div>
      )}

      <>
          {/* Shareable customer entry link + copy button */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          {sub === 'felt' ? (
            <MapIcon className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Sun className="h-4 w-4" aria-hidden="true" />
          )}
          Your customer link
        </div>
        <p className="mt-3 text-base leading-relaxed text-text-sec">
          {sub === 'felt'
            ? 'Send this to a customer for a Felt-map solar estimate — same form, and their quote page carries a live satellite map with the panel layout and sun-exposure heat map.'
            : 'Send this to a customer so they can request a solar estimate.'}
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
          the Pylon integration is enabled server-side). Instant path only. */}
      {sub === 'instant' && <PylonHardwareCard accessToken={accessToken} />}

      {/* Estimate list */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
            {sub === 'felt' ? 'Felt estimates' : 'Solar estimates'}
            {estimates ? ` · ${visibleEstimates.length}` : ''}
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
        {!loading && !error && estimates && visibleEstimates.length === 0 && (
          <p className="mt-4 text-base text-text-dim">
            {sub === 'felt'
              ? 'No Felt estimates yet. Share the Felt customer link above — every map-backed estimate a customer requests will show up here for you to review and release.'
              : 'No solar estimates yet. Share your customer link above — every estimate a customer requests will show up here for you to review and release.'}
          </p>
        )}

        {!loading && !error && estimates && visibleEstimates.length > 0 && (
          <ul className="mt-5 space-y-4">
            {visibleEstimates.map((e) => {
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
                      {/* Felt map provisioning state (Felt tab spec
                          2026-06-13) — felt-variant rows only. */}
                      {e.quoteVariant === 'felt' && e.feltStatus && FELT_CHIP[e.feltStatus] && (
                        <span
                          className={`border ${FELT_CHIP[e.feltStatus].cls} px-3 py-1 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em]`}
                        >
                          {FELT_CHIP[e.feltStatus].label}
                        </span>
                      )}
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
                  <div className="mt-4 grid grid-cols-2 gap-px border border-ink-line bg-ink-line/60 sm:grid-cols-4">
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
                    <StatWithHint
                      label="STC rebate"
                      value={
                        e.stcRebateAud != null
                          ? fmtMoney(e.stcRebateAud)
                          : e.stcCertificates != null
                            ? `${e.stcCertificates} certs`
                            : '—'
                      }
                      hint={
                        e.stcCertificates != null
                          ? `${e.stcCertificates} certs · already off net`
                          : 'Already off net'
                      }
                      title={
                        e.stcZoneRating != null
                          ? `CER zone rating ${e.stcZoneRating.toFixed(3)}${
                              e.stcDeemingPeriod != null ? ` × ${e.stcDeemingPeriod} deeming yrs` : ''
                            } — ${e.stcVerified ? 'verified against Pylon' : 'engine estimate (Pylon unconfirmed)'}`
                          : e.stcVerified
                            ? 'Verified against Pylon'
                            : undefined
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
                    {/* Tradie-facing Felt editor link — annotate the map in
                        Felt; the customer embed updates automatically. */}
                    {e.quoteVariant === 'felt' && e.feltMapUrl && (
                      <a
                        href={e.feltMapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-teal-glow hover:text-teal-glow"
                      >
                        <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        Open in Felt
                      </a>
                    )}
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

function StatWithHint({
  label,
  value,
  hint,
  title,
}: {
  label: string
  value: string
  hint: string
  /** Optional native tooltip — carries the CER zone coefficient + formula so
   *  the on-screen hint stays plain-language. */
  title?: string
}) {
  return (
    <div className="bg-ink-deep px-4 py-3" title={title}>
      <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
      <div className="mt-1 font-mono text-base font-bold tabular-nums text-text-pri">
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
        {hint}
      </div>
    </div>
  )
}
