'use client'

// Pylon sub-tab of the dashboard Solar tab — the design-import path.
//
// The tradie designs a job properly in Pylon studio; this panel lists
// their Pylon designs (via our proxy — the API key never reaches the
// browser), imports one as a QuoteMate proposal, and manages the
// imported proposals: review → confirm & release → customer link.
// Flagged proposals (STC / totals mismatch) cannot be released; the fix
// loop is edit-in-Pylon-studio → Re-import.
//
// Maintain design system: dark navy, vibrant orange accent, all-caps mono.

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  Zap,
} from 'lucide-react'
import type { PylonProposalViewModel } from '@/lib/pylon/proposal'
import type { PylonDesignListRow } from '@/lib/pylon/client'

type Props = {
  accessToken: string | null
}

const STATUS_META: Record<
  PylonProposalViewModel['status'],
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

function fmtKw(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '\u2014'
  return `${n.toFixed(2)} kW`
}

function fmtKwh(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return '\u2014'
  return `${n.toFixed(1)} kWh`
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function PylonPanel({ accessToken }: Props) {
  const [proposals, setProposals] = useState<PylonProposalViewModel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Design picker state.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [designs, setDesigns] = useState<PylonDesignListRow[] | null>(null)
  const [designsLoading, setDesignsLoading] = useState(false)
  const [designsError, setDesignsError] = useState<string | null>(null)

  // Per-design / per-token action state.
  const [importing, setImporting] = useState<Record<string, boolean>>({})
  const [importError, setImportError] = useState<Record<string, string>>({})
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
      const res = await fetch('/api/tenant/pylon', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        proposals?: PylonProposalViewModel[]
        error?: string
      }
      if (res.status === 404 && json.error === 'pylon_disabled') {
        setDisabled(true)
        setProposals([])
        return
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setDisabled(false)
      setProposals(json.proposals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void load()
  }, [load])

  const loadDesigns = useCallback(async () => {
    if (!accessToken) return
    setDesignsLoading(true)
    setDesignsError(null)
    try {
      const res = await fetch('/api/tenant/pylon/designs', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        designs?: PylonDesignListRow[]
        error?: string
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setDesigns(json.designs ?? [])
    } catch (e) {
      setDesignsError(e instanceof Error ? e.message : String(e))
    } finally {
      setDesignsLoading(false)
    }
  }, [accessToken])

  const openPicker = useCallback(() => {
    setPickerOpen(true)
    void loadDesigns()
  }, [loadDesigns])

  const importDesign = useCallback(
    async (designId: string) => {
      if (!accessToken) return
      setImporting((m) => ({ ...m, [designId]: true }))
      setImportError((m) => {
        const next = { ...m }
        delete next[designId]
        return next
      })
      try {
        const res = await fetch('/api/tenant/pylon/import', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ design_id: designId }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
        }
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
        await load()
      } catch (e) {
        setImportError((m) => ({
          ...m,
          [designId]: e instanceof Error ? e.message : String(e),
        }))
      } finally {
        setImporting((m) => {
          const next = { ...m }
          delete next[designId]
          return next
        })
      }
    },
    [accessToken, load],
  )

  const confirmProposal = useCallback(
    async (token: string) => {
      if (!accessToken) return
      setConfirming((m) => ({ ...m, [token]: true }))
      setConfirmError((m) => {
        const next = { ...m }
        delete next[token]
        return next
      })
      try {
        const res = await fetch(`/api/pylon/confirm/${token}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
        }
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setProposals((rows) =>
          (rows ?? []).map((r) =>
            r.token === token
              ? { ...r, status: 'confirmed', canConfirm: false, canReimport: false }
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

  if (disabled) {
    return (
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          <Zap className="h-4 w-4" aria-hidden="true" />
          Pylon integration
        </div>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          The Pylon proposal path isn&rsquo;t switched on for this environment.
          It needs <code className="font-mono text-sm text-text-pri">PYLON_PROPOSALS_ENABLED=true</code> and
          a <code className="font-mono text-sm text-text-pri">PYLON_API_KEY</code> configured on the server.
          The instant-estimate path keeps working as normal.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {/* Import from Pylon */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
            <Download className="h-4 w-4" aria-hidden="true" />
            Import from Pylon
          </div>
          {pickerOpen && (
            <button
              type="button"
              onClick={() => void loadDesigns()}
              className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent"
            >
              Refresh designs
            </button>
          )}
        </div>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          Design the job in Pylon studio, then import it here. QuoteMate pulls
          the panel layout, single-line diagram, components and your line-item
          pricing &mdash; verbatim &mdash; and wraps them in your branded
          proposal with deposit payment and SMS delivery.
        </p>

        {!pickerOpen && (
          <button
            type="button"
            onClick={openPicker}
            className="mt-5 inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press"
          >
            Browse my Pylon designs
          </button>
        )}

        {pickerOpen && designsLoading && (
          <p className="mt-5 text-base text-text-dim">Loading designs from Pylon&hellip;</p>
        )}
        {pickerOpen && designsError && !designsLoading && (
          <p className="mt-5 text-base text-warning">
            Couldn&rsquo;t reach Pylon: {designsError}
          </p>
        )}
        {pickerOpen && !designsLoading && !designsError && designs && designs.length === 0 && (
          <p className="mt-5 text-base text-text-dim">
            No designs found in your Pylon account yet. Create one in Pylon
            studio first &mdash; it will appear here ready to import.
          </p>
        )}
        {pickerOpen && !designsLoading && designs && designs.length > 0 && (
          <ul className="mt-5 space-y-3">
            {designs.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-ink-line bg-ink-deep px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-text-pri">
                    {d.label || d.title || d.description || d.id}
                  </div>
                  <div className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
                    {fmtKw(d.dc_output_kw)}
                    {d.storage_kwh ? ` · ${fmtKwh(d.storage_kwh)} storage` : ''}
                    {d.updated_at ? ` · updated ${fmtDate(d.updated_at)}` : ''}
                  </div>
                  {importError[d.id] && (
                    <p className="mt-1 text-sm text-warning">{importError[d.id]}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void importDesign(d.id)}
                  disabled={!!importing[d.id]}
                  className="inline-flex shrink-0 items-center gap-2 bg-accent px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:opacity-60"
                >
                  {importing[d.id] ? 'Importing\u2026' : 'Import'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Imported proposals */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
            Pylon proposals{proposals ? ` · ${proposals.length}` : ''}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent"
          >
            Refresh
          </button>
        </div>

        {loading && <p className="mt-4 text-base text-text-dim">Loading proposals&hellip;</p>}
        {error && !loading && (
          <p className="mt-4 text-base text-warning">Couldn&rsquo;t load proposals: {error}</p>
        )}
        {!loading && !error && proposals && proposals.length === 0 && (
          <p className="mt-4 text-base text-text-dim">
            Nothing imported yet. Browse your Pylon designs above &mdash; every
            imported design shows up here for review and release.
          </p>
        )}

        {!loading && !error && proposals && proposals.length > 0 && (
          <ul className="mt-5 space-y-4">
            {proposals.map((p) => {
              const meta = STATUS_META[p.status]
              const busyConfirm = !!confirming[p.token]
              const busyReimport = !!importing[p.designId]
              return (
                <li key={p.token} className="border border-ink-line bg-ink-deep p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-extrabold uppercase tracking-[-0.02em] text-lg text-text-pri">
                        {p.title || p.customerName || 'Pylon design'}
                      </div>
                      {p.customerName && (
                        <div className="mt-1 text-sm text-text-sec">{p.customerName}</div>
                      )}
                      {p.address && <div className="mt-1 text-sm text-text-sec">{p.address}</div>}
                      <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                        Imported {fmtDate(p.createdAt)}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 border ${meta.cls} px-3 py-1 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em]`}
                    >
                      {meta.label}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-px border border-ink-line bg-ink-line/60 sm:grid-cols-3">
                    <PylonStat label="System" value={fmtKw(p.systemKw)} />
                    <PylonStat label="Storage" value={fmtKwh(p.storageKwh)} />
                    <PylonStat label="Total (inc GST)" value={p.totalFormatted ?? '\u2014'} accent />
                  </div>

                  {p.status === 'flagged' && (
                    <div className="mt-4 border border-warning/40 border-l-4 border-l-warning bg-ink-card px-4 py-3">
                      <p className="text-sm font-semibold text-warning">
                        {p.flags.length} open check{p.flags.length === 1 ? '' : 's'} blocking release
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {p.flags.map((flag, i) => (
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
                      <p className="mt-2 text-xs leading-relaxed text-text-dim">
                        Fix the design in Pylon studio, then hit Re-import &mdash;
                        the checks re-run against the fresh numbers.
                      </p>
                    </div>
                  )}

                  {confirmError[p.token] && (
                    <p className="mt-3 text-sm text-warning">
                      Couldn&rsquo;t release: {confirmError[p.token]}
                    </p>
                  )}
                  {importError[p.designId] && (
                    <p className="mt-3 text-sm text-warning">
                      Couldn&rsquo;t re-import: {importError[p.designId]}
                    </p>
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <a
                      href={p.quoteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      View
                    </a>
                    {p.canConfirm && (
                      <button
                        type="button"
                        onClick={() => void confirmProposal(p.token)}
                        disabled={busyConfirm}
                        className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:opacity-60"
                      >
                        {busyConfirm ? (
                          'Releasing\u2026'
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            Confirm &amp; release
                          </>
                        )}
                      </button>
                    )}
                    {p.canReimport && (
                      <button
                        type="button"
                        onClick={() => void importDesign(p.designId)}
                        disabled={busyReimport}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-60 ${
                          p.status === 'flagged'
                            ? 'bg-accent text-white hover:bg-accent-press'
                            : 'border border-ink-line text-text-pri hover:border-accent hover:text-accent'
                        }`}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${busyReimport ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        {busyReimport ? 'Re-importing\u2026' : 'Re-import'}
                      </button>
                    )}
                    {p.pylonWebProposalUrl && (
                      <a
                        href={p.pylonWebProposalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-2 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        Pylon original
                      </a>
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

function PylonStat({
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
