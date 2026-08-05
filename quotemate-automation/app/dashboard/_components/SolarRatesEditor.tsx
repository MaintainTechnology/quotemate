'use client'

// Solar rates editor — the solar twin of RoofRatesEditor. Writes
// pricing_book.overlays.solar_rate_card via /api/tenant/solar-rates; read
// back by the solar estimate/redraft/select-building routes before pricing.
// Blank fields fall back to the global defaults. Existing estimates never
// silently re-price — new rates apply on the next estimate or re-draft.

import { useCallback, useEffect, useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'

type Defaults = {
  install_rate_per_kw: { standard_panels: number; premium_panels: number }
  multi_storey_loading_pct: number
  complex_roof_loading_pct: number
  call_out_minimum_ex_gst: number
  gst_registered: boolean
  stc_price_aud: number
  deposit_pct: number
}

type Overrides = {
  install_rate_per_kw: { standard_panels?: number | null; premium_panels?: number | null }
  multi_storey_loading_pct: number | null
  complex_roof_loading_pct: number | null
  call_out_minimum_ex_gst: number | null
  gst_registered: boolean | null
  stc_price_aud: number | null
  deposit_pct: number | null
}

type GetResponse =
  | { ok: true; defaults: Defaults; overrides: Overrides; has_pricing_book: boolean }
  | { ok: false; error: string }

type PatchResponse =
  | { ok: true }
  | { ok: false; error: string; issues?: Array<{ field: string; message: string }> }

const s = (v: number | null | undefined): string => (typeof v === 'number' ? String(v) : '')
const pct = (v: number | null | undefined): string =>
  typeof v === 'number' ? String(Math.round(v * 1000) / 10) : ''
const toFraction = (v: string): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n / 100 : null
}

export function SolarRatesEditor({ accessToken }: { accessToken: string | null }) {
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [standard, setStandard] = useState('')
  const [premium, setPremium] = useState('')
  const [multiStorey, setMultiStorey] = useState('')
  const [complexRoof, setComplexRoof] = useState('')
  const [callOut, setCallOut] = useState('')
  const [stcPrice, setStcPrice] = useState('')
  const [depositPct, setDepositPct] = useState('')
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
      const token = (await getAuthToken()) ?? accessToken
      const res = await fetch('/api/tenant/solar-rates', {
        headers: { Authorization: `Bearer ${token}` },
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
      setStandard(s(o.install_rate_per_kw.standard_panels))
      setPremium(s(o.install_rate_per_kw.premium_panels))
      setMultiStorey(pct(o.multi_storey_loading_pct))
      setComplexRoof(pct(o.complex_roof_loading_pct))
      setCallOut(s(o.call_out_minimum_ex_gst))
      setStcPrice(s(o.stc_price_aud))
      setDepositPct(s(o.deposit_pct))
      setGstMode(o.gst_registered === true ? 'true' : o.gst_registered === false ? 'false' : '')
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
          install_rate_per_kw: {
            standard_panels: standard === '' ? null : standard,
            premium_panels: premium === '' ? null : premium,
          },
          multi_storey_loading_pct: multiStorey === '' ? null : toFraction(multiStorey),
          complex_roof_loading_pct: complexRoof === '' ? null : toFraction(complexRoof),
          call_out_minimum_ex_gst: callOut === '' ? null : callOut,
          stc_price_aud: stcPrice === '' ? null : stcPrice,
          deposit_pct: depositPct === '' ? null : depositPct,
          gst_registered: gstMode === '' ? null : gstMode === 'true',
        }
        const token = (await getAuthToken()) ?? accessToken
        const res = await fetch('/api/tenant/solar-rates', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    [accessToken, standard, premium, multiStorey, complexRoof, callOut, stcPrice, depositPct, gstMode, load],
  )

  const field = (args: {
    key: string
    label: string
    value: string
    onChange: (v: string) => void
    placeholder: string
    hint: string
  }) => (
    <label key={args.key} className="block">
      <span className="mb-2 block font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-sec">
        {args.label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={args.value}
        placeholder={args.placeholder}
        disabled={loading || saving}
        onChange={(e) => args.onChange(e.target.value)}
        aria-label={args.label}
        className={`rounded-ctl w-full border bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none ${
          fieldErrors[args.key] ? 'border-warning' : 'border-ink-line'
        }`}
      />
      <span className={`mt-1.5 block text-xs ${fieldErrors[args.key] ? 'text-warning-bright' : 'text-text-dim'}`}>
        {fieldErrors[args.key] ?? args.hint}
      </span>
    </label>
  )

  return (
    <form
      onSubmit={save}
      className="rounded-card border border-ink-line bg-ink-card p-7 sm:p-8"
      aria-busy={loading || saving}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Solar rates
          </div>
          <h3 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">
            Tune the solar pricing engine
          </h3>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
            Override the global defaults the solar estimator uses. Blank fields
            fall back to the default. New estimates and re-drafts use the
            updated rates instantly; existing estimates don&apos;t re-price.
          </p>
        </div>
        {savedAt && !errMsg && (
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-teal-glow">
            ✓ Saved
          </span>
        )}
      </div>

      {!hasPricingBook && (
        <p className="mt-5 text-sm text-warning-bright">
          No pricing book yet — complete onboarding before setting solar overrides.
        </p>
      )}
      {errMsg && <p className="mt-5 text-sm text-warning-bright">{errMsg}</p>}

      <div className="mt-6 border-t border-ink-line pt-5">
        <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-pri">
          $ per kW by panel grade
        </div>
        <p className="mt-1 text-sm text-text-sec">All-in supply + install rate per kW DC, ex GST.</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {field({
            key: 'install_rate_per_kw.standard_panels',
            label: 'Standard panels ($/kW)',
            value: standard,
            onChange: setStandard,
            placeholder: defaults ? String(defaults.install_rate_per_kw.standard_panels) : '',
            hint: defaults ? `Default $${defaults.install_rate_per_kw.standard_panels}/kW` : '',
          })}
          {field({
            key: 'install_rate_per_kw.premium_panels',
            label: 'Premium panels ($/kW)',
            value: premium,
            onChange: setPremium,
            placeholder: defaults ? String(defaults.install_rate_per_kw.premium_panels) : '',
            hint: defaults ? `Default $${defaults.install_rate_per_kw.premium_panels}/kW` : '',
          })}
        </div>
      </div>

      <div className="mt-6 border-t border-ink-line pt-5">
        <div className="qm-loading font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-pri">
          Loadings
        </div>
        <p className="mt-1 text-sm text-text-sec">Percentages stacked on the base rate. Enter 20 for 20%.</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {field({
            key: 'multi_storey_loading_pct',
            label: 'Multi-storey access (%)',
            value: multiStorey,
            onChange: setMultiStorey,
            placeholder: defaults ? String(defaults.multi_storey_loading_pct * 100) : '',
            hint: defaults
              ? `Default ${defaults.multi_storey_loading_pct * 100}% — fires on 2+ storeys.`
              : '',
          })}
          {field({
            key: 'complex_roof_loading_pct',
            label: 'Complex / steep roof (%)',
            value: complexRoof,
            onChange: setComplexRoof,
            placeholder: defaults ? String(defaults.complex_roof_loading_pct * 100) : '',
            hint: defaults
              ? `Default ${defaults.complex_roof_loading_pct * 100}% — pitch over 35° or many planes.`
              : '',
          })}
        </div>
      </div>

      <div className="mt-6 border-t border-ink-line pt-5">
        <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-pri">
          Job minimum, STC &amp; deposit
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          {field({
            key: 'call_out_minimum_ex_gst',
            label: 'Job minimum (ex GST)',
            value: callOut,
            onChange: setCallOut,
            placeholder: defaults ? String(defaults.call_out_minimum_ex_gst) : '',
            hint: defaults
              ? `Default $${defaults.call_out_minimum_ex_gst} — 0 disables the floor.`
              : '',
          })}
          {field({
            key: 'stc_price_aud',
            label: 'STC price ($/certificate)',
            value: stcPrice,
            onChange: setStcPrice,
            placeholder: defaults ? String(defaults.stc_price_aud) : '',
            hint: defaults
              ? `Default $${defaults.stc_price_aud} — what you redeem per certificate.`
              : '',
          })}
          {field({
            key: 'deposit_pct',
            label: 'Deposit (%)',
            value: depositPct,
            onChange: setDepositPct,
            placeholder: defaults ? String(defaults.deposit_pct) : '',
            hint: defaults
              ? `Default ${defaults.deposit_pct}% of the net inc-GST price at checkout.`
              : '',
          })}
        </div>
      </div>

      <div className="mt-6 border-t border-ink-line pt-5">
        <label className="block max-w-sm">
          <span className="mb-2 block font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-sec">
            GST registered
          </span>
          <select
            aria-label="GST registered"
            value={gstMode}
            onChange={(e) => setGstMode(e.target.value as '' | 'true' | 'false')}
            disabled={loading || saving}
            className="rounded-ctl w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none"
          >
            <option value="">{defaults ? `Default — ${defaults.gst_registered ? 'Yes' : 'No'}` : '—'}</option>
            <option value="true">Yes — add 10% GST</option>
            <option value="false">No — inc-GST equals ex-GST</option>
          </select>
        </label>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={loading || saving || !accessToken || !hasPricingBook}
          aria-busy={loading || saving}
          className="rounded-ctl inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : (<>Save rates <span aria-hidden="true">&rarr;</span></>)}
        </button>
        <button
          type="button"
          onClick={() => {
            setStandard('')
            setPremium('')
            setMultiStorey('')
            setComplexRoof('')
            setCallOut('')
            setStcPrice('')
            setDepositPct('')
            setGstMode('')
          }}
          disabled={loading || saving}
          aria-busy={loading || saving}
          className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-accent disabled:opacity-50"
        >
          Reset all to default
        </button>
      </div>
    </form>
  )
}
