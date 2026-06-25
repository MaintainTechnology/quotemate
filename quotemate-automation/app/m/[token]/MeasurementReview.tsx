'use client'

// Interactive structure picker for the Measurement Results page (/m/[token]).
// Each structure has an include/exclude toggle; toggling persists to
// PATCH /api/roofing/measurement/[token] (which recomputes the denormalised
// summary and invalidates the cached PDF), so the customer quote + PDF always
// reflect the tradie's selection. At least one structure must stay included.
//
// Indices are 1-based (matches included_indices + narrowQuoteToStructures).

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MultiRoofQuote, RoofMetrics, RoofStructurePrice } from '@/lib/roofing/types'
import type { SolarQuoteAddon } from '@/lib/roofing/solar'
import { combinedTotalsForIndices } from '@/lib/roofing/selection'

function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/** Read a browser File into base64 (no data: prefix) + its mime, for the
 *  solar photo re-scan POST. */
function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve({ base64, mime: file.type || 'image/jpeg' })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formLabel(form: RoofMetrics['form']): string {
  switch (form) {
    case 'gable': return 'Gable'
    case 'hip': return 'Hip'
    case 'skillion': return 'Skillion'
    case 'gable_hip': return 'Gable + hip'
    case 'complex': return 'Complex'
    default: return 'To confirm'
  }
}

const TIER_NAME: Record<'good' | 'better' | 'best', string> = {
  good: 'Patch / repair',
  better: 'Re-roof',
  best: 'Upgrade',
}

/**
 * PURE — combined inc/ex-GST + area over the INCLUDED structures (1-based).
 * Delegates to THE canonical helper so this tradie-facing total matches the
 * customer quote page + PDF exactly: inspection-routed structures stay listed
 * but are never priced into the headline total.
 */
function combine(
  structures: RoofStructurePrice[],
  included: number[],
): { count: number; area: number; exGst: [number, number, number]; incGst: [number, number, number] } {
  return combinedTotalsForIndices({ structures } as unknown as MultiRoofQuote, included)
}

export function MeasurementReview({
  measureToken,
  publicToken,
  routing,
  structures,
  solar,
  initialIncluded,
  primaryIndices,
  selectionWasPersisted,
}: {
  measureToken: string
  publicToken: string
  routing: string | null
  structures: RoofStructurePrice[]
  initialIncluded: number[]
  /** 1-based index of the main dwelling (the roof-only default selection). */
  primaryIndices: number[]
  /** Persisted existing-solar/skylight detection + allowance (job level). */
  solar: SolarQuoteAddon | null
  /** True when included_indices was actually saved (vs the read-time default). */
  selectionWasPersisted: boolean
}) {
  const [included, setIncluded] = useState<number[]>(initialIncluded)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()
  const [photos, setPhotos] = useState<File[]>([])
  const [rescanState, setRescanState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
  const [rescanMsg, setRescanMsg] = useState<string | null>(null)

  // Tradie photo source (R2): attach close-up roof photos and re-scan. The POST
  // merges the Anthropic photo pass with the per-structure aerial read and
  // persists onto roofing_measurements.quote.solar; router.refresh() reloads
  // the server page with the updated detection.
  const rescan = useCallback(async () => {
    if (photos.length === 0) {
      setRescanMsg('Attach at least one roof photo first.')
      setRescanState('error')
      return
    }
    setRescanState('scanning')
    setRescanMsg(null)
    try {
      const encoded = await Promise.all(photos.slice(0, 6).map(fileToBase64))
      const res = await fetch(`/api/roofing/measurement/${measureToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos: encoded }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        solar?: unknown
        detail?: string
        error?: string
      }
      if (!res.ok || !json.ok) {
        setRescanState('error')
        setRescanMsg(json.detail ?? json.error ?? 'Re-scan failed.')
        return
      }
      setRescanState('done')
      setRescanMsg(json.solar ? 'Updated from your photos.' : json.detail ?? 'No solar or skylights found.')
      setPhotos([])
      router.refresh()
    } catch (e) {
      setRescanState('error')
      setRescanMsg(e instanceof Error ? e.message : String(e))
    }
  }, [photos, measureToken, router])

  const combined = useMemo(() => combine(structures, included), [structures, included])
  const inspection = routing === 'inspection_required'
  const solarApplies = solar?.allowance?.applies === true

  // Secondary-structure contribution. The headline total is canonical
  // (combinedTotalsForIndices); the secondaries' marginal $ is derived as
  // combined(included) − combined(included ∩ primary) through the SAME helper,
  // never a free-form re-sum — so it can never drift from the headline. An
  // included-but-inspection secondary contributes $0 (the helper prices only
  // quotable structures), so the delta is honest about what actually adds money.
  const secondaryIncluded = useMemo(
    () => included.filter((i) => !primaryIndices.includes(i)),
    [included, primaryIndices],
  )
  const secondaryCount = secondaryIncluded.length
  const baseTotals = useMemo(() => {
    const primaryWithin = included.filter((i) => primaryIndices.includes(i))
    return combine(structures, primaryWithin)
  }, [structures, included, primaryIndices])
  const secondaryDeltaIncGst = useMemo(
    () => combined.incGst.map((v, i) => v - baseTotals.incGst[i]) as [number, number, number],
    [combined, baseTotals],
  )
  const secondaryAddsMoney = secondaryDeltaIncGst.some((v) => v > 0)

  // The non-default-selection notice fires only when the current set differs
  // from the roof-only default (i.e. ≥1 secondary is in) and there is more than
  // one structure to choose from — so it never nags on a primary-only or
  // single-structure job.
  const isPrimaryOnly = useMemo(() => {
    const primarySet = new Set(primaryIndices)
    return included.length === primaryIndices.length && included.every((i) => primarySet.has(i))
  }, [included, primaryIndices])
  const showSelectionNotice = structures.length > 1 && !isPrimaryOnly

  const persist = useCallback(
    async (next: number[]): Promise<boolean> => {
      setSaving(true)
      setErr(null)
      try {
        const res = await fetch(`/api/roofing/measurement/${measureToken}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ included_indices: next }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          detail?: string
        }
        if (!res.ok || !json.ok) {
          setErr(json.detail ?? json.error ?? `Couldn't save (HTTP ${res.status})`)
          return false
        }
        return true
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setSaving(false)
      }
    },
    [measureToken],
  )

  const onToggle = useCallback(
    async (index1: number) => {
      const isIn = included.includes(index1)
      if (isIn && included.length === 1) {
        setErr('Keep at least one structure in the job.')
        return
      }
      const next = isIn
        ? included.filter((x) => x !== index1)
        : [...included, index1].sort((a, b) => a - b)
      const prev = included
      setIncluded(next) // optimistic
      const ok = await persist(next)
      if (!ok) setIncluded(prev) // revert on failure
    },
    [included, persist],
  )

  return (
    <div className="mt-10">
      {/* Cross-links to the customer-facing views of the SAME record. */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/q/roof/${publicToken}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press"
        >
          Open customer quote <span aria-hidden="true">&rarr;</span>
        </a>
        {!inspection && (
          <a
            href={`/api/q/roof/${publicToken}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-sec hover:border-accent hover:text-accent"
          >
            Download PDF <span aria-hidden="true">&darr;</span>
          </a>
        )}
        {saving && (
          <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
            Saving…
          </span>
        )}
      </div>

      {err && (
        <div className="mt-4 border border-ink-line border-l-4 border-l-warning bg-ink-card px-5 py-3">
          <p className="font-mono text-[0.74rem] font-semibold uppercase tracking-[0.14em] text-warning">{err}</p>
        </div>
      )}

      {/* Non-default selection notice — only when ≥1 secondary is in the job. */}
      {showSelectionNotice && (
        <div className="mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-card px-5 py-3">
          <p className="text-sm text-text-sec">
            {selectionWasPersisted
              ? `Showing your saved selection: main dwelling + ${secondaryCount} secondary structure${secondaryCount === 1 ? '' : 's'}. Untick any to remove it from the quote.`
              : `Including ${secondaryCount} secondary structure${secondaryCount === 1 ? '' : 's'} by default — untick any you don’t want in the quote.`}
          </p>
        </div>
      )}

      {/* Per-structure cards */}
      <div className="mt-6 space-y-5">
        {structures.map((s, i) => {
          const index1 = i + 1
          const isIncluded = included.includes(index1)
          return (
            <StructureCard
              key={s.buildingId ?? i}
              structure={s}
              index={i}
              isIncluded={isIncluded}
              disabled={saving}
              onToggle={() => void onToggle(index1)}
            />
          )
        })}
      </div>

      {/* Combined total of the included structures */}
      <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-8">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Combined total · {combined.count} structure{combined.count === 1 ? '' : 's'} included
          {combined.area ? ` · ${combined.area.toFixed(0)} m²` : ''}
        </div>
        {secondaryCount > 0 && (
          <div className="mt-1.5 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-text-dim">
            Includes {secondaryCount} secondary structure{secondaryCount === 1 ? '' : 's'}
            {secondaryAddsMoney
              ? ` adding $${money(secondaryDeltaIncGst[1])} (re-roof, inc GST)`
              : ' — quoted on site'}
          </div>
        )}
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          {(['good', 'better', 'best'] as const).map((tier, i) => (
            <div key={tier} className="border border-ink-line bg-ink-deep p-5">
              <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                {TIER_NAME[tier]}
              </div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-accent sm:text-4xl">
                ${money(combined.incGst[i])}
              </div>
              <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                inc GST · ${money(combined.exGst[i])} ex GST
              </div>
              {secondaryCount > 0 && secondaryDeltaIncGst[i] > 0 && (
                <div className="mt-1 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
                  incl. +${money(secondaryDeltaIncGst[i])} from secondaries
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Existing solar / skylights — persisted detection (save-time aerial +
          any tradie photo re-scan). Applied solar is added to ALL tier totals on
          the customer quote; skylights are flagged only (never auto-priced). */}
      <div className="mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Existing solar &amp; skylights
        </div>
        <p className="mt-2 text-base text-text-sec">
          {solar?.detection
            ? solar.detection.summary_note
            : 'Not scanned yet — attach close-up roof photos below to check for panels and skylights.'}
        </p>

        {solar?.detection?.has_solar && solar.allowance && (
          <div className={`mt-4 border border-ink-line border-l-4 ${solarApplies ? 'border-l-accent' : 'border-l-warning'} bg-ink-deep p-4`}>
            <div className={`font-mono text-[0.74rem] font-semibold uppercase tracking-[0.16em] ${solarApplies ? 'text-accent' : 'text-warning'}`}>
              {solarApplies
                ? `Solar detach & reinstate · +$${money(solar.allowance.inc_gst)} inc GST added to every tier`
                : 'Solar flagged — not auto-priced (low confidence or not a full re-roof)'}
            </div>
            <p className="mt-2 text-sm text-text-sec">{solar.allowance.electrician_note}</p>
          </div>
        )}

        {solar?.detection?.has_skylight && (
          <p className="mt-3 text-sm text-text-sec">
            {solar.detection.skylight_count} skylight{solar.detection.skylight_count === 1 ? '' : 's'} flagged — add a re-flash line if the re-roof disturbs {solar.detection.skylight_count === 1 ? 'it' : 'them'} (not auto-priced).
          </p>
        )}

        {/* Per-structure attribution — which building each read came from (R3). */}
        {solar?.perStructure && solar.perStructure.length > 0 && (
          <div className="mt-4 space-y-2">
            {solar.perStructure.map((ps, i) => (
              <div key={ps.buildingId ?? i} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-ink-line pt-2 text-sm">
                <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-dim">{ps.label}</span>
                <span className="text-text-sec">{ps.detection.summary_note}</span>
              </div>
            ))}
          </div>
        )}

        {solar?.structuresSkipped ? (
          <p className="mt-3 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-warning">
            {solar.structuresSkipped} more structure{solar.structuresSkipped === 1 ? '' : 's'} not scanned — re-scan with photos to cover {solar.structuresSkipped === 1 ? 'it' : 'them'}.
          </p>
        ) : null}

        {/* Tradie photo source (R2) — attach close-up roof photos and re-scan. */}
        <div className="mt-5 border-t border-ink-line pt-4">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            Attach roof photos &amp; re-scan
          </div>
          <p className="mt-1 text-sm text-text-sec">
            Close-up photos sharpen the read. We merge them with the aerial scan and update the quote.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept="image/*"
              multiple
              aria-label="Attach roof photos"
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 6))}
              className="text-sm text-text-sec file:mr-3 file:border file:border-ink-line file:bg-ink-deep file:px-3 file:py-1.5 file:font-mono file:text-[0.72rem] file:font-semibold file:uppercase file:tracking-[0.14em] file:text-text-pri"
            />
            <button
              type="button"
              onClick={rescan}
              disabled={rescanState === 'scanning' || photos.length === 0}
              className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rescanState === 'scanning' ? 'Scanning…' : `Re-scan${photos.length ? ` (${photos.length})` : ''}`}
            </button>
          </div>
          {rescanMsg && (
            <p className={`mt-2 text-sm ${rescanState === 'error' ? 'text-warning' : 'text-text-sec'}`}>{rescanMsg}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StructureCard({
  structure,
  index,
  isIncluded,
  disabled,
  onToggle,
}: {
  structure: RoofStructurePrice
  index: number
  isIncluded: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const m = structure.metrics
  const p = structure.price
  const inspection = p.routing?.decision === 'inspection_required'
  return (
    <article
      className={`border bg-ink-card p-6 transition-colors sm:p-7 ${
        isIncluded ? 'border-ink-line' : 'border-ink-line opacity-55'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              {structure.role === 'primary' ? 'Main dwelling' : 'Secondary structure'} · {String(index + 1).padStart(2, '0')}
            </div>
            {/* Explicit state — legible from text alone, not just the card opacity. */}
            <span
              className={`inline-flex items-center border px-2 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${
                isIncluded ? 'border-accent text-accent' : 'border-ink-line text-text-dim'
              }`}
            >
              {isIncluded ? 'In job' : 'Not in job'}
            </span>
          </div>
          <h3 className="mt-1.5 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">{structure.label}</h3>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-text-sec">
          <input
            type="checkbox"
            checked={isIncluded}
            disabled={disabled}
            onChange={onToggle}
            className="h-4 w-4 accent-accent"
          />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em]">Include in job</span>
        </label>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <MiniStat
          label="Sloped area"
          value={m.sloped_area_m2 != null ? `${Math.round(m.sloped_area_m2)} m²` : '—'}
          hint={m.footprint_m2 ? `Footprint ${Math.round(m.footprint_m2)} m²` : ''}
        />
        <MiniStat label="Roof form" value={formLabel(m.form)} hint={m.storeys != null ? `${m.storeys}-storey` : ''} />
        <MiniStat label="Hips · valleys" value={`${m.hips ?? '?'} · ${m.valleys ?? '?'}`} />
        <MiniStat
          label="Pitch"
          value={m.pitch_source === 'measured' && m.pitch_degrees != null ? `${m.pitch_degrees}°` : structure.inputs.pitch}
          hint={m.pitch_source === 'measured' ? 'measured' : 'declared'}
        />
      </div>

      {/* Per-structure tier prices */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {p.tiers.map((t) => (
          <div key={t.tier} className="border border-ink-line bg-ink-deep p-5">
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              {TIER_NAME[t.tier]}
            </div>
            <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-accent">${money(t.inc_gst)}</div>
            <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-dim">inc GST</div>
          </div>
        ))}
      </div>

      {inspection && (
        <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3 text-sm text-text-sec">
          <span className="font-semibold text-text-pri">Indicative — confirmed on site.</span>{' '}
          {p.routing?.reason ?? 'This structure needs a quick look on site before we can price it.'}{' '}
          The customer sees these prices as an indicative estimate, subject to the on-site visit.
        </div>
      )}
    </article>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}
