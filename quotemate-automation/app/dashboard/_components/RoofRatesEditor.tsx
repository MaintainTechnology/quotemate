'use client'

// /dashboard Pricing tab — per-tenant "Roof rates" editor (extended).
//
// Wave 1b — exposes the full RoofingRateCard, not just the $/m² rates:
//   • Five $/m² material rates
//   • Multi-storey loading %
//   • Asbestos handling loading %
//   • NEW — Complexity loading % (per the Jobber research learning)
//   • Upgrade material (drives Best tier)
//   • GST registered flag
//
// All fields are independent — leaving any input blank falls back to
// the global default. Numeric validation: rates 0..500 $/m²; loadings
// 0..100%.

import { useCallback, useEffect, useState } from 'react'

const MATERIALS = [
  ['colorbond_corrugated', 'Colorbond Corrugated'],
  ['colorbond_trimdek',  'Colorbond Trimdek'],
  ['colorbond_spandek',  'Colorbond Spandek'],
  ['colorbond_kliplok',  'Colorbond Klip-Lok 700'],
  ['concrete_tile',      'Concrete tile'],
  ['terracotta_tile',    'Terracotta tile'],
  ['cement_sheet',       'Cement sheet (asbestos-suspect)'],
] as const

type MaterialKey = (typeof MATERIALS)[number][0]

type Defaults = {
  reroof_rate_per_m2: Record<MaterialKey, number>
  multi_storey_loading_pct: number
  asbestos_loading_pct: number
  complexity_loading_pct: number
  upgrade_material: MaterialKey
  gst_registered: boolean
}

type Overrides = {
  reroof_rate_per_m2: Partial<Record<MaterialKey, number>>
  multi_storey_loading_pct: number | null
  asbestos_loading_pct: number | null
  complexity_loading_pct: number | null
  upgrade_material: MaterialKey | null
  gst_registered: boolean | null
}

type GetResponse =
  | { ok: true; materials: readonly MaterialKey[]; defaults: Defaults; overrides: Overrides; has_pricing_book: boolean }
  | { ok: false; error: string }

type PatchResponse =
  | { ok: true }
  | { ok: false; error: string; issues?: Array<{ field: string; message: string }> }

type Props = { accessToken: string | null }

export function RoofRatesEditor({ accessToken }: Props) {
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [rates, setRates] = useState<Record<MaterialKey, string>>({
    colorbond_corrugated: '',
    colorbond_trimdek: '',
    colorbond_spandek: '',
    colorbond_kliplok: '',
    concrete_tile: '',
    terracotta_tile: '',
    cement_sheet: '',
  })
  const [multiStorey, setMultiStorey] = useState<string>('')
  const [asbestos, setAsbestos] = useState<string>('')
  const [complexity, setComplexity] = useState<string>('')
  const [upgradeMat, setUpgradeMat] = useState<MaterialKey | ''>('')
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
      const res = await fetch('/api/tenant/roofing-rates', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as GetResponse
      if (!json.ok) {
        setErrMsg(json.error)
        return
      }
      setDefaults(json.defaults)
      setHasPricingBook(json.has_pricing_book)
      const o = json.overrides
      setRates({
        colorbond_corrugated: stringify(o.reroof_rate_per_m2.colorbond_corrugated),
        colorbond_trimdek: stringify(o.reroof_rate_per_m2.colorbond_trimdek),
        colorbond_spandek: stringify(o.reroof_rate_per_m2.colorbond_spandek),
        colorbond_kliplok: stringify(o.reroof_rate_per_m2.colorbond_kliplok),
        concrete_tile: stringify(o.reroof_rate_per_m2.concrete_tile),
        terracotta_tile: stringify(o.reroof_rate_per_m2.terracotta_tile),
        cement_sheet: stringify(o.reroof_rate_per_m2.cement_sheet),
      })
      setMultiStorey(stringifyPct(o.multi_storey_loading_pct))
      setAsbestos(stringifyPct(o.asbestos_loading_pct))
      setComplexity(stringifyPct(o.complexity_loading_pct))
      setUpgradeMat((o.upgrade_material as MaterialKey | null) ?? '')
      setGstMode(
        o.gst_registered === true ? 'true' : o.gst_registered === false ? 'false' : '',
      )
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!accessToken) return
      setSaving(true)
      setErrMsg(null)
      setFieldErrors({})
      try {
        const body = {
          reroof_rate_per_m2: {
            colorbond_corrugated: rates.colorbond_corrugated === '' ? null : rates.colorbond_corrugated,
            colorbond_trimdek: rates.colorbond_trimdek === '' ? null : rates.colorbond_trimdek,
            colorbond_spandek: rates.colorbond_spandek === '' ? null : rates.colorbond_spandek,
            colorbond_kliplok: rates.colorbond_kliplok === '' ? null : rates.colorbond_kliplok,
            concrete_tile: rates.concrete_tile === '' ? null : rates.concrete_tile,
            terracotta_tile: rates.terracotta_tile === '' ? null : rates.terracotta_tile,
            cement_sheet: rates.cement_sheet === '' ? null : rates.cement_sheet,
          },
          multi_storey_loading_pct: multiStorey === '' ? null : parsePctToFraction(multiStorey),
          asbestos_loading_pct: asbestos === '' ? null : parsePctToFraction(asbestos),
          complexity_loading_pct: complexity === '' ? null : parsePctToFraction(complexity),
          upgrade_material: upgradeMat === '' ? null : upgradeMat,
          gst_registered: gstMode === '' ? null : gstMode === 'true',
        }
        const res = await fetch('/api/tenant/roofing-rates', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as PatchResponse
        if (!json.ok) {
          if (json.issues && json.issues.length > 0) {
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
    [accessToken, rates, multiStorey, asbestos, complexity, upgradeMat, gstMode, load],
  )

  if (!hasPricingBook) {
    return (
      <div className="border border-ink-line bg-ink-card p-6">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
          Roof rates · pricing book missing
        </div>
        <p className="mt-2 text-base text-text-sec">
          Complete onboarding for your primary trade first — roofing rate overrides
          piggyback on the same pricing-book row.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={save}
      className="border border-ink-line bg-ink-card p-7 sm:p-8"
      aria-busy={loading || saving}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Roof rates
          </div>
          <h3 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">
            Tune the roofing pricing engine
          </h3>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
            Override the global defaults the roofing estimator uses. Blank fields
            fall back to the default. New measurements use the updated rates
            instantly; existing quotes don&apos;t re-price.
          </p>
        </div>
        {savedAt && !errMsg && (
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-teal-glow">
            ✓ Saved
          </span>
        )}
      </div>

      {errMsg && (
        <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">
            Could not save
          </div>
          <p className="mt-1 text-sm text-text-sec">{errMsg}</p>
        </div>
      )}

      {/* ── Material rates ──────────────────────────────────────── */}
      <SectionHeader title="$/m² per material" subtitle="The base rate the estimator multiplies sloped area by." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {MATERIALS.map(([key, label]) => {
          const def = defaults?.reroof_rate_per_m2[key]
          const fe = fieldErrors[`reroof_rate_per_m2.${key}`]
          return (
            <label key={key} className="block">
              <FieldLabel>{label}</FieldLabel>
              <CurrencyInput
                value={rates[key]}
                onChange={(v) => setRates((r) => ({ ...r, [key]: v }))}
                placeholder={def !== undefined ? String(def) : ''}
                disabled={loading || saving}
                hasError={!!fe}
                ariaLabel={`${label} $/m²`}
              />
              <Caption error={fe} defaultHint={def !== undefined ? `Default $${def}/m²` : 'Default unavailable'} />
            </label>
          )
        })}
      </div>

      {/* ── Loadings ────────────────────────────────────────────── */}
      <SectionHeader
        title="Loadings"
        subtitle="Percentages that stack multiplicatively on the base rate. Stored as fractions (20% = 0.20)."
      />
      <div className="mt-4 grid gap-5 sm:grid-cols-3">
        <PctInput
          label="Multi-storey access"
          value={multiStorey}
          onChange={setMultiStorey}
          defaultValue={defaults ? defaults.multi_storey_loading_pct * 100 : null}
          error={fieldErrors.multi_storey_loading_pct}
          disabled={loading || saving}
          hint="Fires when 2+ storeys."
        />
        <PctInput
          label="Asbestos handling"
          value={asbestos}
          onChange={setAsbestos}
          defaultValue={defaults ? defaults.asbestos_loading_pct * 100 : null}
          error={fieldErrors.asbestos_loading_pct}
          disabled={loading || saving}
          hint="Only on cement-sheet roofs after inspection."
        />
        <PctInput
          label="Complexity (always on)"
          value={complexity}
          onChange={setComplexity}
          defaultValue={defaults ? defaults.complexity_loading_pct * 100 : null}
          error={fieldErrors.complexity_loading_pct}
          disabled={loading || saving}
          hint="Always-applied buffer (industry norm 10–25%)."
        />
      </div>

      {/* ── Upgrade material + GST ──────────────────────────────── */}
      <SectionHeader
        title="Tier framing"
        subtitle="Which material drives the Best tier upgrade, and whether GST is added."
      />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Best-tier upgrade material</FieldLabel>
          <select
            aria-label="Upgrade material"
            value={upgradeMat}
            onChange={(e) => setUpgradeMat(e.target.value as MaterialKey | '')}
            disabled={loading || saving}
            className="w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none"
          >
            <option value="">
              {defaults ? `Default — ${displayMaterial(defaults.upgrade_material)}` : '—'}
            </option>
            {MATERIALS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <Caption error={fieldErrors.upgrade_material} defaultHint={defaults ? `Default ${displayMaterial(defaults.upgrade_material)}` : ''} />
        </label>
        <label className="block">
          <FieldLabel>GST registered</FieldLabel>
          <select
            aria-label="GST registered"
            value={gstMode}
            onChange={(e) => setGstMode(e.target.value as '' | 'true' | 'false')}
            disabled={loading || saving}
            className="w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none"
          >
            <option value="">{defaults ? `Default — ${defaults.gst_registered ? 'Yes' : 'No'}` : '—'}</option>
            <option value="true">Yes — add 10% GST to inc-GST tier</option>
            <option value="false">No — inc-GST equals ex-GST</option>
          </select>
          <Caption error={fieldErrors.gst_registered} defaultHint={defaults ? `Default ${defaults.gst_registered ? 'Yes' : 'No'}` : ''} />
        </label>
      </div>

      {/* ── Actions ─────────────────────────────────────────────── */}
      <div className="mt-7 flex flex-wrap items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={loading || saving || !accessToken}
          className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <>
              <span
                className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              Saving…
            </>
          ) : (
            <>
              Save rates <span aria-hidden="true">&rarr;</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setRates({
              colorbond_corrugated: '',
              colorbond_trimdek: '',
              colorbond_spandek: '',
              colorbond_kliplok: '',
              concrete_tile: '',
              terracotta_tile: '',
              cement_sheet: '',
            })
            setMultiStorey('')
            setAsbestos('')
            setComplexity('')
            setUpgradeMat('')
            setGstMode('')
          }}
          disabled={loading || saving}
          className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-accent disabled:opacity-50"
        >
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
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
        {title}
      </div>
      <p className="mt-1 text-sm text-text-sec">{subtitle}</p>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
      {children}
    </div>
  )
}

function Caption({ error, defaultHint }: { error?: string; defaultHint?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-text-dim">
      <span>{defaultHint ?? ''}</span>
      {error && <span className="text-warning">{error}</span>}
    </div>
  )
}

function CurrencyInput({
  value,
  onChange,
  placeholder,
  disabled,
  hasError,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  disabled: boolean
  hasError: boolean
  ariaLabel: string
}) {
  return (
    <div className="relative mt-2">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-base text-text-dim"
      >
        $
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={500}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`w-full border bg-ink-deep px-8 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${
          hasError ? 'border-warning' : 'border-ink-line focus:border-accent'
        }`}
      />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-text-dim">
        /m²
      </span>
    </div>
  )
}

function PctInput({
  label,
  value,
  onChange,
  defaultValue,
  error,
  disabled,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  defaultValue: number | null
  error?: string
  disabled: boolean
  hint: string
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative mt-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultValue !== null ? String(Math.round(defaultValue)) : ''}
          disabled={disabled}
          aria-label={label}
          className={`w-full border bg-ink-deep px-4 py-3 pr-10 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${
            error ? 'border-warning' : 'border-ink-line focus:border-accent'
          }`}
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-text-dim">
          %
        </span>
      </div>
      <Caption
        error={error}
        defaultHint={defaultValue !== null ? `Default ${Math.round(defaultValue)}% · ${hint}` : hint}
      />
    </label>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────

function stringify(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** Convert a stored fraction (0.20) to a display string ("20"). */
function stringifyPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return String(Math.round(v * 100))
}

/** Convert a display string ("20") to a stored fraction (0.20). */
function parsePctToFraction(s: string): number | null {
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n / 100
}

function displayMaterial(m: MaterialKey): string {
  const pair = MATERIALS.find(([k]) => k === m)
  return pair ? pair[1] : m
}
