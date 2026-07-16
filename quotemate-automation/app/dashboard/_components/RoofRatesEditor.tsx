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
import { getAuthToken } from '@/lib/auth/client-token'

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
  gutter_rate_per_lm?: number
  downpipe_rate_per_each?: number
  fascia_rate_per_lm?: number
  soffit_rate_per_lm?: number
  ridge_hip_repoint_rate_per_lm?: number
  valley_flashing_rate_per_lm?: number
  box_gutter_rate_per_lm?: number
  price_edge_works?: boolean
  call_out_minimum_ex_gst?: number
  solar_detach_reinstate_base_ex_gst?: number
  solar_detach_reinstate_per_array_ex_gst?: number
}

type Overrides = {
  reroof_rate_per_m2: Partial<Record<MaterialKey, number>>
  multi_storey_loading_pct: number | null
  asbestos_loading_pct: number | null
  complexity_loading_pct: number | null
  upgrade_material: MaterialKey | null
  gst_registered: boolean | null
  gutter_rate_per_lm?: number | null
  downpipe_rate_per_each?: number | null
  fascia_rate_per_lm?: number | null
  soffit_rate_per_lm?: number | null
  ridge_hip_repoint_rate_per_lm?: number | null
  valley_flashing_rate_per_lm?: number | null
  box_gutter_rate_per_lm?: number | null
  price_edge_works?: boolean | null
  call_out_minimum_ex_gst?: number | null
  solar_detach_reinstate_base_ex_gst?: number | null
  solar_detach_reinstate_per_array_ex_gst?: number | null
}

/** Accessory rate fields — key, label, unit hint. Quantities are entered
 *  per measurement on the measure page; these are the tenant's rates. */
const ACCESSORY_FIELDS = [
  ['gutter_rate_per_lm', 'Gutter (per lm)', '/lm'],
  ['downpipe_rate_per_each', 'Downpipe (each)', ' each'],
  ['fascia_rate_per_lm', 'Fascia (per lm)', '/lm'],
  ['soffit_rate_per_lm', 'Soffit / eave lining (per lm)', '/lm'],
] as const

type AccessoryKey = (typeof ACCESSORY_FIELDS)[number][0]

/** Edge-works per-lm rates (hip repoint / valley flashing / box gutter). */
const EDGE_FIELDS = [
  ['ridge_hip_repoint_rate_per_lm', 'Ridge & hip repoint (per lm)', '/lm'],
  ['valley_flashing_rate_per_lm', 'Valley flashing (per lm)', '/lm'],
  ['box_gutter_rate_per_lm', 'Box gutter (per lm)', '/lm'],
] as const

type EdgeKey = (typeof EDGE_FIELDS)[number][0]

/** Dollar floors / allowances — 0 is meaningful (no floor / no allowance). */
const DOLLAR_FIELDS = [
  ['call_out_minimum_ex_gst', 'Call-out minimum (ex GST)', 'Per-structure floor; small jobs never price below this.'],
  ['solar_detach_reinstate_base_ex_gst', 'Solar detach & reinstate — base', 'Added once when existing panels must come off for a re-roof.'],
  ['solar_detach_reinstate_per_array_ex_gst', 'Solar detach & reinstate — per array', 'Added per detected panel array on top of the base.'],
] as const

type DollarKey = (typeof DOLLAR_FIELDS)[number][0]

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
  const [accessories, setAccessories] = useState<Record<AccessoryKey, string>>({
    gutter_rate_per_lm: '',
    downpipe_rate_per_each: '',
    fascia_rate_per_lm: '',
    soffit_rate_per_lm: '',
  })
  const [edgeRates, setEdgeRates] = useState<Record<EdgeKey, string>>({
    ridge_hip_repoint_rate_per_lm: '',
    valley_flashing_rate_per_lm: '',
    box_gutter_rate_per_lm: '',
  })
  const [dollars, setDollars] = useState<Record<DollarKey, string>>({
    call_out_minimum_ex_gst: '',
    solar_detach_reinstate_base_ex_gst: '',
    solar_detach_reinstate_per_array_ex_gst: '',
  })
  const [edgeWorksMode, setEdgeWorksMode] = useState<'' | 'true' | 'false'>('')
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
      const token = (await getAuthToken()) ?? accessToken
      const res = await fetch('/api/tenant/roofing-rates', {
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
      setAccessories({
        gutter_rate_per_lm: stringify(o.gutter_rate_per_lm ?? undefined),
        downpipe_rate_per_each: stringify(o.downpipe_rate_per_each ?? undefined),
        fascia_rate_per_lm: stringify(o.fascia_rate_per_lm ?? undefined),
        soffit_rate_per_lm: stringify(o.soffit_rate_per_lm ?? undefined),
      })
      setEdgeRates({
        ridge_hip_repoint_rate_per_lm: stringify(o.ridge_hip_repoint_rate_per_lm ?? undefined),
        valley_flashing_rate_per_lm: stringify(o.valley_flashing_rate_per_lm ?? undefined),
        box_gutter_rate_per_lm: stringify(o.box_gutter_rate_per_lm ?? undefined),
      })
      setDollars({
        call_out_minimum_ex_gst: stringify(o.call_out_minimum_ex_gst ?? undefined),
        solar_detach_reinstate_base_ex_gst: stringify(o.solar_detach_reinstate_base_ex_gst ?? undefined),
        solar_detach_reinstate_per_array_ex_gst: stringify(o.solar_detach_reinstate_per_array_ex_gst ?? undefined),
      })
      setEdgeWorksMode(
        o.price_edge_works === true ? 'true' : o.price_edge_works === false ? 'false' : '',
      )
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
          gutter_rate_per_lm: accessories.gutter_rate_per_lm === '' ? null : accessories.gutter_rate_per_lm,
          downpipe_rate_per_each: accessories.downpipe_rate_per_each === '' ? null : accessories.downpipe_rate_per_each,
          fascia_rate_per_lm: accessories.fascia_rate_per_lm === '' ? null : accessories.fascia_rate_per_lm,
          soffit_rate_per_lm: accessories.soffit_rate_per_lm === '' ? null : accessories.soffit_rate_per_lm,
          ridge_hip_repoint_rate_per_lm: edgeRates.ridge_hip_repoint_rate_per_lm === '' ? null : edgeRates.ridge_hip_repoint_rate_per_lm,
          valley_flashing_rate_per_lm: edgeRates.valley_flashing_rate_per_lm === '' ? null : edgeRates.valley_flashing_rate_per_lm,
          box_gutter_rate_per_lm: edgeRates.box_gutter_rate_per_lm === '' ? null : edgeRates.box_gutter_rate_per_lm,
          price_edge_works: edgeWorksMode === '' ? null : edgeWorksMode === 'true',
          call_out_minimum_ex_gst: dollars.call_out_minimum_ex_gst === '' ? null : dollars.call_out_minimum_ex_gst,
          solar_detach_reinstate_base_ex_gst: dollars.solar_detach_reinstate_base_ex_gst === '' ? null : dollars.solar_detach_reinstate_base_ex_gst,
          solar_detach_reinstate_per_array_ex_gst: dollars.solar_detach_reinstate_per_array_ex_gst === '' ? null : dollars.solar_detach_reinstate_per_array_ex_gst,
        }
        const token = (await getAuthToken()) ?? accessToken
        const res = await fetch('/api/tenant/roofing-rates', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
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
      <div className="rounded-card border border-ink-line bg-ink-card p-6">
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
      className="rounded-card border border-ink-line bg-ink-card p-7 sm:p-8"
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
        <div className="rounded-card mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
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

      {/* ── Accessory rates ─────────────────────────────────────── */}
      <SectionHeader
        title="Gutters, downpipes & extras"
        subtitle="Rates for accessory works. Quantities are confirmed per job on the measurement page — a blank quantity there means no charge."
      />
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {ACCESSORY_FIELDS.map(([key, label, unit]) => {
          const def = defaults?.[key]
          const fe = fieldErrors[key]
          return (
            <label key={key} className="block">
              <FieldLabel>{label}</FieldLabel>
              <CurrencyInput
                value={accessories[key]}
                onChange={(v) => setAccessories((a) => ({ ...a, [key]: v }))}
                placeholder={def !== undefined ? String(def) : ''}
                disabled={loading || saving}
                hasError={!!fe}
                ariaLabel={`${label} rate`}
              />
              <Caption error={fe} defaultHint={def !== undefined ? `Default $${def}${unit}` : 'Default unavailable'} />
            </label>
          )
        })}
      </div>

      {/* ── Edge works ──────────────────────────────────────────── */}
      <SectionHeader
        title="Edge works"
        subtitle="Per-lm rates for hip repoint, valley flashing and box gutter. Charged on repair scopes; included in the full re-roof $/m²."
      />
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {EDGE_FIELDS.map(([key, label, unit]) => {
          const def = defaults?.[key]
          const fe = fieldErrors[key]
          return (
            <label key={key} className="block">
              <FieldLabel>{label}</FieldLabel>
              <CurrencyInput
                value={edgeRates[key]}
                onChange={(v) => setEdgeRates((r) => ({ ...r, [key]: v }))}
                placeholder={def !== undefined ? String(def) : ''}
                disabled={loading || saving}
                hasError={!!fe}
                ariaLabel={`${label} rate`}
              />
              <Caption error={fe} defaultHint={def !== undefined ? `Default $${def}${unit}` : 'Default unavailable'} />
            </label>
          )
        })}
        <label className="block">
          <FieldLabel>Itemise edge works</FieldLabel>
          <select
            aria-label="Itemise edge works"
            value={edgeWorksMode}
            onChange={(e) => setEdgeWorksMode(e.target.value as '' | 'true' | 'false')}
            disabled={loading || saving}
            className="rounded-ctl w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none"
          >
            <option value="">{defaults ? `Default — ${defaults.price_edge_works === false ? 'Off' : 'On'}` : '—'}</option>
            <option value="true">On — hip/valley/box-gutter lines on quotes</option>
            <option value="false">Off — no edge line items</option>
          </select>
          <Caption error={fieldErrors.price_edge_works} defaultHint="Master switch for the edge line items." />
        </label>
      </div>

      {/* ── Job minimum + solar allowance ───────────────────────── */}
      <SectionHeader
        title="Job minimum & solar allowance"
        subtitle="Dollar amounts, ex GST. Enter 0 to disable; blank falls back to the default."
      />
      <div className="mt-4 grid gap-5 sm:grid-cols-3">
        {DOLLAR_FIELDS.map(([key, label, hint]) => {
          const def = defaults?.[key]
          const fe = fieldErrors[key]
          return (
            <label key={key} className="block">
              <FieldLabel>{label}</FieldLabel>
              <CurrencyInput
                value={dollars[key]}
                onChange={(v) => setDollars((d) => ({ ...d, [key]: v }))}
                placeholder={def !== undefined ? String(def) : ''}
                disabled={loading || saving}
                hasError={!!fe}
                ariaLabel={label}
              />
              <Caption error={fe} defaultHint={def !== undefined ? `Default $${def} — ${hint}` : hint} />
            </label>
          )
        })}
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
            className="rounded-ctl w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none"
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
            className="rounded-ctl w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none"
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
          className="rounded-ctl inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
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
            setAccessories({
              gutter_rate_per_lm: '',
              downpipe_rate_per_each: '',
              fascia_rate_per_lm: '',
              soffit_rate_per_lm: '',
            })
            setEdgeRates({
              ridge_hip_repoint_rate_per_lm: '',
              valley_flashing_rate_per_lm: '',
              box_gutter_rate_per_lm: '',
            })
            setDollars({
              call_out_minimum_ex_gst: '',
              solar_detach_reinstate_base_ex_gst: '',
              solar_detach_reinstate_per_array_ex_gst: '',
            })
            setEdgeWorksMode('')
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
        className={`rounded-ctl w-full border bg-ink-deep px-8 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${
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
          className={`rounded-ctl w-full border bg-ink-deep px-4 py-3 pr-10 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${
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
