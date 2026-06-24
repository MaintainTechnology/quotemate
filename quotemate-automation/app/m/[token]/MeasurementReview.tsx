'use client'

// Interactive structure picker for the Measurement Results page (/m/[token]).
// Each structure has an include/exclude toggle; toggling persists to
// PATCH /api/roofing/measurement/[token] (which recomputes the denormalised
// summary and invalidates the cached PDF), so the customer quote + PDF always
// reflect the tradie's selection. At least one structure must stay included.
//
// Indices are 1-based (matches included_indices + narrowQuoteToStructures).

import { useCallback, useMemo, useState } from 'react'
import type { MultiRoofQuote, RoofMetrics, RoofStructurePrice } from '@/lib/roofing/types'
import { combinedTotalsForIndices } from '@/lib/roofing/selection'

function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
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
  initialIncluded,
}: {
  measureToken: string
  publicToken: string
  routing: string | null
  structures: RoofStructurePrice[]
  initialIncluded: number[]
}) {
  const [included, setIncluded] = useState<number[]>(initialIncluded)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const combined = useMemo(() => combine(structures, included), [structures, included])
  const inspection = routing === 'inspection_required'

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
            </div>
          ))}
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
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {structure.role === 'primary' ? 'Main dwelling' : 'Secondary structure'} · {String(index + 1).padStart(2, '0')}
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
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em]">In job</span>
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
          {p.routing?.reason ?? 'This structure needs a quick look on site before we can price it.'}
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
