'use client'

// Per-tenant "Paint rates" editor — the painting counterpart to
// RoofRatesEditor. Exposes every lever the painting estimator uses to
// build Good / Better / Best, so a tradie can tune their own pricing:
//   • $/unit per surface (walls / ceilings / trim / exterior)
//   • Good-tier fraction, Best-tier uplift
//   • double-storey exterior loading, colour-change extra
//   • per-job call-out minimum, GST flag
// Blank fields fall back to the global default. New estimates use the
// updated rates instantly; saved jobs don't re-price.

import { useCallback, useEffect, useState } from 'react'

const SCOPES = [
  ['walls', 'Interior walls', 'm²'],
  ['ceilings', 'Ceilings', 'm²'],
  ['trim', 'Trim (skirting / architraves)', 'lm'],
  ['exterior', 'Exterior', 'm²'],
] as const

type ScopeKey = (typeof SCOPES)[number][0]

type Defaults = {
  rate_per_unit: Record<ScopeKey, number>
  double_storey_loading_pct: number
  premium_uplift_pct: number
  good_refresh_fraction: number
  colour_change_extra: number
  call_out_minimum_ex_gst: number
  gst_registered: boolean
}

type GetResponse =
  | { ok: true; defaults: Defaults; overrides: Record<string, unknown>; has_pricing_book: boolean }
  | { ok: false; error: string }

type Props = { accessToken: string | null }

export function PaintRatesEditor({ accessToken }: Props) {
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [rates, setRates] = useState<Record<ScopeKey, string>>({ walls: '', ceilings: '', trim: '', exterior: '' })
  const [doubleStorey, setDoubleStorey] = useState('')
  const [premium, setPremium] = useState('')
  const [goodFrac, setGoodFrac] = useState('')
  const [colourExtra, setColourExtra] = useState('')
  const [callOut, setCallOut] = useState('')
  const [gstMode, setGstMode] = useState<'' | 'true' | 'false'>('')
  const [hasPricingBook, setHasPricingBook] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setErrMsg(null)
    try {
      const res = await fetch('/api/tenant/painting-rates', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as GetResponse
      if (!json.ok) { setErrMsg(json.error); return }
      setDefaults(json.defaults)
      setHasPricingBook(json.has_pricing_book)
      const o = json.overrides as {
        rate_per_unit?: Partial<Record<ScopeKey, number>>
        double_storey_loading_pct?: number | null
        premium_uplift_pct?: number | null
        good_refresh_fraction?: number | null
        colour_change_extra?: number | null
        call_out_minimum_ex_gst?: number | null
        gst_registered?: boolean | null
      }
      setRates({
        walls: numStr(o.rate_per_unit?.walls),
        ceilings: numStr(o.rate_per_unit?.ceilings),
        trim: numStr(o.rate_per_unit?.trim),
        exterior: numStr(o.rate_per_unit?.exterior),
      })
      setDoubleStorey(pctStr(o.double_storey_loading_pct))
      setPremium(pctStr(o.premium_uplift_pct))
      setGoodFrac(pctStr(o.good_refresh_fraction))
      setColourExtra(pctStr(o.colour_change_extra))
      setCallOut(numStr(o.call_out_minimum_ex_gst))
      setGstMode(o.gst_registered === true ? 'true' : o.gst_registered === false ? 'false' : '')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => { void load() }, [load])

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!accessToken) return
      setSaving(true)
      setErrMsg(null)
      setFieldErrors({})
      try {
        const body = {
          rate_per_unit: {
            walls: blankNull(rates.walls),
            ceilings: blankNull(rates.ceilings),
            trim: blankNull(rates.trim),
            exterior: blankNull(rates.exterior),
          },
          double_storey_loading_pct: pctToFrac(doubleStorey),
          premium_uplift_pct: pctToFrac(premium),
          good_refresh_fraction: pctToFrac(goodFrac),
          colour_change_extra: pctToFrac(colourExtra),
          call_out_minimum_ex_gst: blankNull(callOut),
          gst_registered: gstMode === '' ? null : gstMode === 'true',
        }
        const res = await fetch('/api/tenant/painting-rates', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as
          | { ok: true }
          | { ok: false; error: string; issues?: Array<{ field: string; message: string }> }
        if (!json.ok) {
          if (json.issues?.length) {
            const fe: Record<string, string> = {}
            for (const i of json.issues) fe[i.field] = i.message
            setFieldErrors(fe)
            setErrMsg('Fix the highlighted fields and try again.')
          } else {
            setErrMsg(json.error || 'Failed to save.')
          }
          return
        }
        setSavedAt(Date.now())
        await load()
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [accessToken, rates, doubleStorey, premium, goodFrac, colourExtra, callOut, gstMode, load],
  )

  if (!hasPricingBook) {
    return (
      <div className="border border-ink-line bg-ink-card p-6">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
          Paint rates · pricing book missing
        </div>
        <p className="mt-2 text-base text-text-sec">
          Complete onboarding for your primary trade first — painting rate overrides
          piggyback on the same pricing-book row.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={save} className="border border-ink-line bg-ink-card p-7 sm:p-8" aria-busy={loading || saving}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Paint rates</div>
          <h3 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">Tune the painting pricing engine</h3>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
            Override the defaults the painting estimator uses. Blank fields fall back to the
            default. New estimates use the updated rates instantly.
          </p>
        </div>
        {savedAt && !errMsg && <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-teal-glow">✓ Saved</span>}
      </div>

      {errMsg && (
        <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">Could not save</div>
          <p className="mt-1 text-sm text-text-sec">{errMsg}</p>
        </div>
      )}

      <SectionHeader title="$ per unit, per surface" subtitle="The base rate (2 coats, sound surface) the estimator multiplies the measured area by." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {SCOPES.map(([key, label, unit]) => {
          const def = defaults?.rate_per_unit[key]
          const fe = fieldErrors[`rate_per_unit.${key}`]
          return (
            <label key={key} className="block">
              <FieldLabel>{label}</FieldLabel>
              <UnitInput value={rates[key]} onChange={(v) => setRates((r) => ({ ...r, [key]: v }))} placeholder={def !== undefined ? String(def) : ''} unit={unit} disabled={loading || saving} hasError={!!fe} ariaLabel={`${label} rate`} />
              <Caption error={fe} defaultHint={def !== undefined ? `Default $${def}/${unit}` : ''} />
            </label>
          )
        })}
      </div>

      <SectionHeader title="Tier framing" subtitle="Good is a lighter 1-coat refresh; Best is premium paint + full prep." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <PctInput label="Good tier (% of Better)" value={goodFrac} onChange={setGoodFrac} defaultValue={defaults ? defaults.good_refresh_fraction * 100 : null} error={fieldErrors.good_refresh_fraction} disabled={loading || saving} hint="Good = Better × this." />
        <PctInput label="Best uplift over Better" value={premium} onChange={setPremium} defaultValue={defaults ? defaults.premium_uplift_pct * 100 : null} error={fieldErrors.premium_uplift_pct} disabled={loading || saving} hint="Best = Better × (1 + this)." />
      </div>

      <SectionHeader title="Loadings" subtitle="Extra cost for harder jobs. Stored as fractions (50% = 0.50)." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <PctInput label="Double-storey exterior" value={doubleStorey} onChange={setDoubleStorey} defaultValue={defaults ? defaults.double_storey_loading_pct * 100 : null} error={fieldErrors.double_storey_loading_pct} disabled={loading || saving} hint="Added to exterior on 2-storey jobs." />
        <PctInput label="Colour change" value={colourExtra} onChange={setColourExtra} defaultValue={defaults ? defaults.colour_change_extra * 100 : null} error={fieldErrors.colour_change_extra} disabled={loading || saving} hint="Extra prep when the colour changes." />
      </div>

      <SectionHeader title="Minimum & GST" subtitle="A per-job floor so tiny jobs aren't underpriced, plus the GST flag." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Call-out minimum (ex GST)</FieldLabel>
          <UnitInput value={callOut} onChange={setCallOut} placeholder={defaults ? String(defaults.call_out_minimum_ex_gst) : ''} unit="job" disabled={loading || saving} hasError={!!fieldErrors.call_out_minimum_ex_gst} ariaLabel="Call-out minimum" />
          <Caption error={fieldErrors.call_out_minimum_ex_gst} defaultHint={defaults ? `Default $${defaults.call_out_minimum_ex_gst}` : ''} />
        </label>
        <label className="block">
          <FieldLabel>GST registered</FieldLabel>
          <select aria-label="GST registered" value={gstMode} onChange={(e) => setGstMode(e.target.value as '' | 'true' | 'false')} disabled={loading || saving} className="mt-2 w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none">
            <option value="">{defaults ? `Default — ${defaults.gst_registered ? 'Yes' : 'No'}` : '—'}</option>
            <option value="true">Yes — add 10% GST</option>
            <option value="false">No — inc-GST equals ex-GST</option>
          </select>
          <Caption error={fieldErrors.gst_registered} defaultHint={defaults ? `Default ${defaults.gst_registered ? 'Yes' : 'No'}` : ''} />
        </label>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-4 pt-2">
        <button type="submit" disabled={loading || saving || !accessToken} className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? (<><span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" /> Saving…</>) : (<>Save rates <span aria-hidden="true">&rarr;</span></>)}
        </button>
        <button type="button" onClick={() => { setRates({ walls: '', ceilings: '', trim: '', exterior: '' }); setDoubleStorey(''); setPremium(''); setGoodFrac(''); setColourExtra(''); setCallOut(''); setGstMode('') }} disabled={loading || saving} className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-accent disabled:opacity-50">
          Reset all to default
        </button>
      </div>
    </form>
  )
}

// ─── Sub-components ────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mt-7 border-t border-ink-line pt-5">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">{title}</div>
      <p className="mt-1 text-sm text-text-sec">{subtitle}</p>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{children}</div>
}

function Caption({ error, defaultHint }: { error?: string; defaultHint?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-text-dim">
      <span>{defaultHint ?? ''}</span>
      {error && <span className="text-warning">{error}</span>}
    </div>
  )
}

function UnitInput({ value, onChange, placeholder, unit, disabled, hasError, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder: string; unit: string; disabled: boolean; hasError: boolean; ariaLabel: string }) {
  return (
    <div className="relative mt-2">
      <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-base text-text-dim">$</span>
      <input type="number" inputMode="decimal" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} className={`w-full border bg-ink-deep px-8 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${hasError ? 'border-warning' : 'border-ink-line focus:border-accent'}`} />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-text-dim">/{unit}</span>
    </div>
  )
}

function PctInput({ label, value, onChange, defaultValue, error, disabled, hint }: { label: string; value: string; onChange: (v: string) => void; defaultValue: number | null; error?: string; disabled: boolean; hint: string }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative mt-2">
        <input type="number" inputMode="decimal" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={defaultValue !== null ? String(Math.round(defaultValue)) : ''} disabled={disabled} aria-label={label} className={`w-full border bg-ink-deep px-4 py-3 pr-10 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${error ? 'border-warning' : 'border-ink-line focus:border-accent'}`} />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-text-dim">%</span>
      </div>
      <Caption error={error} defaultHint={defaultValue !== null ? `Default ${Math.round(defaultValue)}% · ${hint}` : hint} />
    </label>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────

function numStr(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v)
}
function pctStr(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(Math.round(v * 100))
}
function pctToFrac(s: string): number | null {
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n / 100 : null
}
function blankNull(s: string): string | null {
  return s === '' ? null : s
}
