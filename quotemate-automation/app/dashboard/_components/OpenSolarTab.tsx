'use client'

// OpenSolar sub-tab of the dashboard Solar tab — the OpenSolar
// design-import path.
//
// The tradie designs a job in OpenSolar studio; this panel lists their
// OpenSolar projects (via our proxy — credentials never reach the
// browser), imports one as a QuoteMate proposal (with a system picker
// for multi-system projects), and manages the imported proposals:
// review → confirm & release → customer link, plus the lazy install
// pack (BOM, owner's manual, financials, 8760 CSV). Flagged proposals
// (STC / totals mismatch) cannot be released; the fix loop is
// edit-in-OpenSolar-studio → Re-import.
//
// Maintain design system: dark navy, vibrant orange accent, all-caps mono.

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  Sun,
} from 'lucide-react'
import type { OpenSolarProposalViewModel } from '@/lib/opensolar/proposal'
import type { OpenSolarProjectListRow } from '@/lib/opensolar/client'

type Props = {
  accessToken: string | null
}

type SystemOption = {
  uuid: string
  name: string | null
  kw_stc: number | null
  module_quantity: number | null
}

const STATUS_META: Record<
  OpenSolarProposalViewModel['status'],
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

const INSTALL_PACK: Array<{ type: string; label: string }> = [
  { type: 'global_bom', label: 'BOM' },
  { type: 'owners_manual', label: "Owner's manual" },
  { type: 'financials_report', label: 'Financials' },
  { type: 'system_performance_8760', label: '8760 CSV' },
]

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

export function OpenSolarPanel({ accessToken }: Props) {
  const [proposals, setProposals] = useState<OpenSolarProposalViewModel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Project picker state.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [projects, setProjects] = useState<OpenSolarProjectListRow[] | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)

  // System picker per project (lazy-loaded when a project has many).
  const [systems, setSystems] = useState<Record<string, SystemOption[]>>({})

  // Per-project / per-token action state.
  const [importing, setImporting] = useState<Record<string, boolean>>({})
  const [importError, setImportError] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<Record<string, boolean>>({})
  const [confirmError, setConfirmError] = useState<Record<string, string>>({})
  const [docBusy, setDocBusy] = useState<Record<string, boolean>>({})
  const [docError, setDocError] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!accessToken) {
      setError('Not signed in')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tenant/opensolar', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        proposals?: OpenSolarProposalViewModel[]
        error?: string
      }
      if (res.status === 404 && json.error === 'opensolar_disabled') {
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

  const loadProjects = useCallback(async () => {
    if (!accessToken) return
    setProjectsLoading(true)
    setProjectsError(null)
    try {
      const res = await fetch('/api/tenant/opensolar/designs', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        projects?: OpenSolarProjectListRow[]
        error?: string
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setProjects(json.projects ?? [])
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : String(e))
    } finally {
      setProjectsLoading(false)
    }
  }, [accessToken])

  const openPicker = useCallback(() => {
    setPickerOpen(true)
    void loadProjects()
  }, [loadProjects])

  const loadSystems = useCallback(
    async (projectId: string) => {
      if (!accessToken) return
      try {
        const res = await fetch(
          `/api/tenant/opensolar/designs?project_id=${encodeURIComponent(projectId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
        )
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          systems?: SystemOption[]
          error?: string
        }
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setSystems((m) => ({ ...m, [projectId]: json.systems ?? [] }))
      } catch (e) {
        setImportError((m) => ({
          ...m,
          [projectId]: e instanceof Error ? e.message : String(e),
        }))
      }
    },
    [accessToken],
  )

  const importProject = useCallback(
    async (projectId: string, systemUuid?: string | null) => {
      if (!accessToken) return
      setImporting((m) => ({ ...m, [projectId]: true }))
      setImportError((m) => {
        const next = { ...m }
        delete next[projectId]
        return next
      })
      try {
        const res = await fetch('/api/tenant/opensolar/import', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ project_id: projectId, system_uuid: systemUuid ?? undefined }),
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
          [projectId]: e instanceof Error ? e.message : String(e),
        }))
      } finally {
        setImporting((m) => {
          const next = { ...m }
          delete next[projectId]
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
        const res = await fetch(`/api/opensolar/confirm/${token}`, {
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

  const fetchDocument = useCallback(
    async (token: string, type: string) => {
      if (!accessToken) return
      const key = `${token}:${type}`
      setDocBusy((m) => ({ ...m, [key]: true }))
      setDocError((m) => {
        const next = { ...m }
        delete next[key]
        return next
      })
      try {
        const res = await fetch(`/api/tenant/opensolar/document/${token}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          url?: string
          error?: string
        }
        if (!res.ok || !json.ok || !json.url) throw new Error(json.error || `HTTP ${res.status}`)
        window.open(json.url, '_blank', 'noopener,noreferrer')
      } catch (e) {
        setDocError((m) => ({
          ...m,
          [key]: e instanceof Error ? e.message : String(e),
        }))
      } finally {
        setDocBusy((m) => {
          const next = { ...m }
          delete next[key]
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
          <Sun className="h-4 w-4" aria-hidden="true" />
          OpenSolar integration
        </div>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          The OpenSolar proposal path isn&rsquo;t switched on for this environment.
          It needs <code className="font-mono text-sm text-text-pri">OPENSOLAR_PROPOSALS_ENABLED=true</code>,
          an <code className="font-mono text-sm text-text-pri">OPENSOLAR_ORG_ID</code> and machine-user
          credentials configured on the server. The other solar paths keep working as normal.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {/* Import from OpenSolar */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
            <Download className="h-4 w-4" aria-hidden="true" />
            Import from OpenSolar
          </div>
          {pickerOpen && (
            <button
              type="button"
              onClick={() => void loadProjects()}
              className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent"
            >
              Refresh projects
            </button>
          )}
        </div>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          Design the job in OpenSolar studio, then import it here. QuoteMate
          pulls the panel layout render, components, shading and your exact
          pricing &mdash; verbatim &mdash; plus the engineering documents
          (shade report, energy yield, site plan), and wraps them in your
          branded proposal with deposit payment and SMS delivery.
        </p>

        {!pickerOpen && (
          <button
            type="button"
            onClick={openPicker}
            className="mt-5 inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press"
          >
            Browse my OpenSolar projects
          </button>
        )}

        {pickerOpen && projectsLoading && (
          <p className="mt-5 text-base text-text-dim">Loading projects from OpenSolar&hellip;</p>
        )}
        {pickerOpen && projectsError && !projectsLoading && (
          <p className="mt-5 text-base text-warning">
            Couldn&rsquo;t reach OpenSolar: {projectsError}
          </p>
        )}
        {pickerOpen && !projectsLoading && !projectsError && projects && projects.length === 0 && (
          <p className="mt-5 text-base text-text-dim">
            No projects found in your OpenSolar org yet. Create one in
            OpenSolar studio first &mdash; it will appear here ready to import.
          </p>
        )}
        {pickerOpen && !projectsLoading && projects && projects.length > 0 && (
          <ul className="mt-5 space-y-3">
            {projects.map((p) => {
              const opts = systems[p.id]
              return (
                <li
                  key={p.id}
                  className="border border-ink-line bg-ink-deep px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-text-pri">
                        {p.address || p.identifier || `Project ${p.id}`}
                      </div>
                      <div className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
                        {[p.locality, p.state, p.zip].filter(Boolean).join(' · ') || 'No address'}
                        {p.modified_at ? ` · updated ${fmtDate(p.modified_at)}` : ''}
                      </div>
                      {importError[p.id] && (
                        <p className="mt-1 text-sm text-warning">{importError[p.id]}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadSystems(p.id)}
                        className="px-3 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent"
                      >
                        Systems
                      </button>
                      <button
                        type="button"
                        onClick={() => void importProject(p.id)}
                        disabled={!!importing[p.id]}
                        className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:opacity-60"
                      >
                        {importing[p.id] ? 'Importing\u2026' : 'Import'}
                      </button>
                    </div>
                  </div>
                  {opts && (
                    <div className="mt-3 border-t border-ink-line pt-3">
                      {opts.length === 0 ? (
                        <p className="text-sm text-text-dim">
                          No designed systems on this project yet — design one in studio first.
                        </p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {opts.map((s) => (
                            <li key={s.uuid}>
                              <button
                                type="button"
                                onClick={() => void importProject(p.id, s.uuid)}
                                disabled={!!importing[p.id]}
                                className="inline-flex items-center gap-2 border border-ink-line px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
                              >
                                {s.name || `System (${fmtKw(s.kw_stc)})`}
                                {s.module_quantity != null ? ` · ${s.module_quantity} panels` : ''}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Imported proposals */}
      <div className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
            OpenSolar proposals{proposals ? ` · ${proposals.length}` : ''}
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
            Nothing imported yet. Browse your OpenSolar projects above &mdash;
            every imported design shows up here for review and release.
          </p>
        )}

        {!loading && !error && proposals && proposals.length > 0 && (
          <ul className="mt-5 space-y-4">
            {proposals.map((p) => {
              const meta = STATUS_META[p.status]
              const busyConfirm = !!confirming[p.token]
              const busyReimport = !!importing[p.projectId]
              return (
                <li key={p.token} className="border border-ink-line bg-ink-deep p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-extrabold uppercase tracking-[-0.02em] text-lg text-text-pri">
                        {p.title || p.customerName || 'OpenSolar design'}
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
                    <OpenSolarStat label="System" value={fmtKw(p.systemKw)} />
                    <OpenSolarStat label="Storage" value={fmtKwh(p.storageKwh)} />
                    <OpenSolarStat label="Total (inc GST)" value={p.totalFormatted ?? '\u2014'} accent />
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
                        Fix the design in OpenSolar studio, then hit Re-import &mdash;
                        the checks re-run against the fresh numbers.
                      </p>
                    </div>
                  )}

                  {confirmError[p.token] && (
                    <p className="mt-3 text-sm text-warning">
                      Couldn&rsquo;t release: {confirmError[p.token]}
                    </p>
                  )}
                  {importError[p.projectId] && (
                    <p className="mt-3 text-sm text-warning">
                      Couldn&rsquo;t re-import: {importError[p.projectId]}
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
                        onClick={() => void importProject(p.projectId, p.systemUuid || null)}
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
                    <a
                      href={p.openSolarProjectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-2 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      OpenSolar project
                    </a>
                  </div>

                  {/* Install pack — lazily generated OpenSolar documents. */}
                  <div className="mt-4 border-t border-ink-line pt-4">
                    <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                      Install pack
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {INSTALL_PACK.map((doc) => {
                        const key = `${p.token}:${doc.type}`
                        return (
                          <button
                            key={doc.type}
                            type="button"
                            onClick={() => void fetchDocument(p.token, doc.type)}
                            disabled={!!docBusy[key]}
                            className="inline-flex items-center gap-2 border border-ink-line px-3 py-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-text-sec transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
                          >
                            <Download className="h-3 w-3" aria-hidden="true" />
                            {docBusy[key] ? 'Generating\u2026' : doc.label}
                          </button>
                        )
                      })}
                    </div>
                    {INSTALL_PACK.some((doc) => docError[`${p.token}:${doc.type}`]) && (
                      <p className="mt-2 text-xs text-warning">
                        {INSTALL_PACK.flatMap((doc) => {
                          const e = docError[`${p.token}:${doc.type}`]
                          return e ? [`${doc.label}: ${e}`] : []
                        }).join(' · ')}
                      </p>
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

function OpenSolarStat({
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
