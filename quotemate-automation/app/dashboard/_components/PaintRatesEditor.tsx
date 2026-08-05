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
import { getAuthToken } from '@/lib/auth/client-token'
import {
  DEFAULT_PAINTING_HOURLY_RATE,
  DEFAULT_PAINTING_PRODUCTION_RATES,
  DEFAULT_PAINTING_RATE_CARD,
} from '@/lib/painting/pricing'
import { DEFAULT_PAINTING_TAKEOFF_CARD } from '@/lib/painting/takeoff'
import type { PaintProduct } from '@/lib/painting/types'

/** Platform deposit default (lib/stripe/painting-checkout.ts) — mirrored
 *  here because that module is server-only (Stripe SDK). */
const DEFAULT_DEPOSIT_PCT = 30

const SCOPES = [
  ['walls', 'Interior walls', 'm²'],
  ['ceilings', 'Ceilings', 'm²'],
  ['trim', 'Trim (skirting / architraves)', 'lm'],
  ['exterior', 'Exterior', 'm²'],
] as const

type ScopeKey = (typeof SCOPES)[number][0]

// Take-off products (lib/painting/takeoff.ts). Trim coverage is linear.
const PRODUCTS = [
  ['wall_paint', 'Wall paint', 'm²/L'],
  ['ceiling_paint', 'Ceiling paint', 'm²/L'],
  ['trim_enamel', 'Trim enamel', 'lm/L'],
  ['exterior_paint', 'Exterior paint', 'm²/L'],
  ['primer_sealer', 'Primer / sealer', 'm²/L'],
] as const

const EMPTY_PRODUCTS: Record<PaintProduct, string> = {
  wall_paint: '',
  ceiling_paint: '',
  trim_enamel: '',
  exterior_paint: '',
  primer_sealer: '',
}

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
  // Materials & labour take-off knobs (+ production rates for labour hours).
  const [coverage, setCoverage] = useState<Record<PaintProduct, string>>(EMPTY_PRODUCTS)
  const [litrePrice, setLitrePrice] = useState<Record<PaintProduct, string>>(EMPTY_PRODUCTS)
  const [production, setProduction] = useState<Record<ScopeKey, string>>({ walls: '', ceilings: '', trim: '', exterior: '' })
  const [crew, setCrew] = useState('')
  const [sundries, setSundries] = useState('')
  // Pricing model + hourly rate (schema-supported since onboarding; now
  // finally surfaced here so a tenant can switch models post-onboarding).
  const [pricingModel, setPricingModel] = useState<'' | 'sqm' | 'hourly'>('')
  const [hourlyRate, setHourlyRate] = useState('')
  // Coats + condition multipliers (previously code-only defaults).
  const [coatsMult, setCoatsMult] = useState<Record<'1' | '2' | '3', string>>({ '1': '', '2': '', '3': '' })
  const [condMult, setCondMult] = useState<Record<'sound' | 'minor' | 'bare', string>>({ sound: '', minor: '', bare: '' })
  // Deposit % + the two takeoff knobs the save previously DROPPED
  // (hours_per_day / premium_price_uplift_pct — the silent-wipe bug).
  const [depositPct, setDepositPct] = useState('')
  const [hoursPerDay, setHoursPerDay] = useState('')
  const [premiumMaterialUplift, setPremiumMaterialUplift] = useState('')
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
      const res = await fetch('/api/tenant/painting-rates', {
        headers: { Authorization: `Bearer ${token}` },
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
        production_rate_per_unit?: Partial<Record<ScopeKey, number>>
        takeoff?: {
          coverage_per_litre?: Partial<Record<PaintProduct, number>>
          price_per_litre?: Partial<Record<PaintProduct, number>>
          sundries_pct?: number | null
          crew_size?: number | null
          hours_per_day?: number | null
          premium_price_uplift_pct?: number | null
        }
        pricing_model?: 'sqm' | 'hourly' | null
        hourly_rate?: number | null
        coats_multiplier?: Partial<Record<'1' | '2' | '3', number>>
        condition_multiplier?: Partial<Record<'sound' | 'minor' | 'bare', number>>
        deposit_pct?: number | null
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
      setCoverage({
        wall_paint: numStr(o.takeoff?.coverage_per_litre?.wall_paint),
        ceiling_paint: numStr(o.takeoff?.coverage_per_litre?.ceiling_paint),
        trim_enamel: numStr(o.takeoff?.coverage_per_litre?.trim_enamel),
        exterior_paint: numStr(o.takeoff?.coverage_per_litre?.exterior_paint),
        primer_sealer: numStr(o.takeoff?.coverage_per_litre?.primer_sealer),
      })
      setLitrePrice({
        wall_paint: numStr(o.takeoff?.price_per_litre?.wall_paint),
        ceiling_paint: numStr(o.takeoff?.price_per_litre?.ceiling_paint),
        trim_enamel: numStr(o.takeoff?.price_per_litre?.trim_enamel),
        exterior_paint: numStr(o.takeoff?.price_per_litre?.exterior_paint),
        primer_sealer: numStr(o.takeoff?.price_per_litre?.primer_sealer),
      })
      setProduction({
        walls: numStr(o.production_rate_per_unit?.walls),
        ceilings: numStr(o.production_rate_per_unit?.ceilings),
        trim: numStr(o.production_rate_per_unit?.trim),
        exterior: numStr(o.production_rate_per_unit?.exterior),
      })
      setCrew(numStr(o.takeoff?.crew_size))
      setSundries(pctStr(o.takeoff?.sundries_pct))
      setPricingModel(o.pricing_model === 'sqm' || o.pricing_model === 'hourly' ? o.pricing_model : '')
      setHourlyRate(numStr(o.hourly_rate))
      setCoatsMult({
        '1': numStr(o.coats_multiplier?.['1']),
        '2': numStr(o.coats_multiplier?.['2']),
        '3': numStr(o.coats_multiplier?.['3']),
      })
      setCondMult({
        sound: numStr(o.condition_multiplier?.sound),
        minor: numStr(o.condition_multiplier?.minor),
        bare: numStr(o.condition_multiplier?.bare),
      })
      setDepositPct(numStr(o.deposit_pct))
      setHoursPerDay(numStr(o.takeoff?.hours_per_day))
      setPremiumMaterialUplift(pctStr(o.takeoff?.premium_price_uplift_pct))
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
          production_rate_per_unit: {
            walls: blankNull(production.walls),
            ceilings: blankNull(production.ceilings),
            trim: blankNull(production.trim),
            exterior: blankNull(production.exterior),
          },
          takeoff: {
            coverage_per_litre: Object.fromEntries(
              PRODUCTS.map(([k]) => [k, blankNull(coverage[k])]),
            ),
            price_per_litre: Object.fromEntries(
              PRODUCTS.map(([k]) => [k, blankNull(litrePrice[k])]),
            ),
            crew_size: blankNull(crew),
            sundries_pct: pctToFrac(sundries),
            // Round-tripped so a save can no longer wipe stored values
            // (previously omitted — the silent-wipe bug).
            hours_per_day: blankNull(hoursPerDay),
            premium_price_uplift_pct: pctToFrac(premiumMaterialUplift),
          },
          pricing_model: pricingModel === '' ? null : pricingModel,
          hourly_rate: blankNull(hourlyRate),
          coats_multiplier: {
            '1': blankNull(coatsMult['1']),
            '2': blankNull(coatsMult['2']),
            '3': blankNull(coatsMult['3']),
          },
          condition_multiplier: {
            sound: blankNull(condMult.sound),
            minor: blankNull(condMult.minor),
            bare: blankNull(condMult.bare),
          },
          deposit_pct: blankNull(depositPct),
        }
        const token = (await getAuthToken()) ?? accessToken
        const res = await fetch('/api/tenant/painting-rates', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    [accessToken, rates, doubleStorey, premium, goodFrac, colourExtra, callOut, gstMode, coverage, litrePrice, production, crew, sundries, pricingModel, hourlyRate, coatsMult, condMult, depositPct, hoursPerDay, premiumMaterialUplift, load],
  )

  if (!hasPricingBook) {
    return (
      <div className="rounded-card border border-ink-line bg-ink-card p-6">
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
    <form onSubmit={save} className="rounded-card border border-ink-line bg-ink-card p-7 sm:p-8" aria-busy={loading || saving}>
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
        <div className="rounded-card mt-5 border border-warning-bright/40 bg-ink-deep px-4 py-3">
          <div className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-warning">Could not save</div>
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

      <SectionHeader title="Pricing model" subtitle="Price per m²/lm (default), or hourly: your charge-out rate × the labour hours derived from the production paces below." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Model</FieldLabel>
          <select aria-label="Pricing model" value={pricingModel} onChange={(e) => setPricingModel(e.target.value as '' | 'sqm' | 'hourly')} disabled={loading || saving} className="rounded-ctl mt-2 w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none">
            <option value="">Default — per m² / lm</option>
            <option value="sqm">Per m² / lm rates</option>
            <option value="hourly">Hourly rate × production pace</option>
          </select>
          <Caption error={fieldErrors.pricing_model} defaultHint="Switchable any time — set at onboarding, editable here." />
        </label>
        <label className="block">
          <FieldLabel>Hourly rate (ex GST)</FieldLabel>
          <UnitInput value={hourlyRate} onChange={setHourlyRate} placeholder={String(DEFAULT_PAINTING_HOURLY_RATE)} unit="hr" disabled={loading || saving} hasError={!!fieldErrors.hourly_rate} ariaLabel="Hourly rate" />
          <Caption error={fieldErrors.hourly_rate} defaultHint={`Default $${DEFAULT_PAINTING_HOURLY_RATE}/hr — used only in hourly mode.`} />
        </label>
      </div>

      <SectionHeader title="Coats & condition multipliers" subtitle="Scale the base rate by coat count and substrate prep. 1.0 is neutral; 'poor' condition always routes to inspection." />
      <div className="mt-4 grid gap-5 sm:grid-cols-3">
        {([['1', '1 coat'], ['2', '2 coats'], ['3', '3 coats']] as const).map(([k, label]) => (
          <label key={`coats-${k}`} className="block">
            <FieldLabel>{label}</FieldLabel>
            <PlainInput value={coatsMult[k]} onChange={(v) => setCoatsMult((m) => ({ ...m, [k]: v }))} placeholder={String(DEFAULT_PAINTING_RATE_CARD.coats_multiplier[Number(k) as 1 | 2 | 3])} suffix="×" disabled={loading || saving} hasError={!!fieldErrors[`coats_multiplier.${k}`]} ariaLabel={`${label} multiplier`} />
            <Caption error={fieldErrors[`coats_multiplier.${k}`]} defaultHint={`Default ${DEFAULT_PAINTING_RATE_CARD.coats_multiplier[Number(k) as 1 | 2 | 3]}×`} />
          </label>
        ))}
        {([['sound', 'Sound surface'], ['minor', 'Minor prep'], ['bare', 'Bare / full prep']] as const).map(([k, label]) => (
          <label key={`cond-${k}`} className="block">
            <FieldLabel>{label}</FieldLabel>
            <PlainInput value={condMult[k]} onChange={(v) => setCondMult((m) => ({ ...m, [k]: v }))} placeholder={String(DEFAULT_PAINTING_RATE_CARD.condition_multiplier[k])} suffix="×" disabled={loading || saving} hasError={!!fieldErrors[`condition_multiplier.${k}`]} ariaLabel={`${label} multiplier`} />
            <Caption error={fieldErrors[`condition_multiplier.${k}`]} defaultHint={`Default ${DEFAULT_PAINTING_RATE_CARD.condition_multiplier[k]}×`} />
          </label>
        ))}
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

      <SectionHeader title="Materials take-off" subtitle="Litres = area × coats ÷ coverage, rounded up to 1/4/10/15 L packs. Blank = the AU default. Feeds the Materials & labour panel, never the quoted price." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {PRODUCTS.map(([key, label, covUnit]) => {
          const covDef = DEFAULT_PAINTING_TAKEOFF_CARD.coverage_per_litre[key]
          const priceDef = DEFAULT_PAINTING_TAKEOFF_CARD.price_per_litre[key]
          const covErr = fieldErrors[`takeoff.coverage_per_litre.${key}`]
          const priceErr = fieldErrors[`takeoff.price_per_litre.${key}`]
          return (
            <div key={key} className="grid grid-cols-2 gap-3">
              <label className="block">
                <FieldLabel>{label} coverage</FieldLabel>
                <PlainInput value={coverage[key]} onChange={(v) => setCoverage((c) => ({ ...c, [key]: v }))} placeholder={covDef !== undefined ? String(covDef) : ''} suffix={covUnit} disabled={loading || saving} hasError={!!covErr} ariaLabel={`${label} coverage`} />
                <Caption error={covErr} defaultHint={covDef !== undefined ? `Default ${covDef} ${covUnit}` : ''} />
              </label>
              <label className="block">
                <FieldLabel>{label} price</FieldLabel>
                <UnitInput value={litrePrice[key]} onChange={(v) => setLitrePrice((c) => ({ ...c, [key]: v }))} placeholder={priceDef !== undefined ? String(priceDef) : ''} unit="L" disabled={loading || saving} hasError={!!priceErr} ariaLabel={`${label} price per litre`} />
                <Caption error={priceErr} defaultHint={priceDef !== undefined ? `Default $${priceDef}/L ex GST` : ''} />
              </label>
            </div>
          )
        })}
      </div>

      <SectionHeader title="Labour take-off" subtitle="Production rates convert measured area into hours; crew size turns hours into days on site." />
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {SCOPES.map(([key, label, unit]) => {
          const def = DEFAULT_PAINTING_PRODUCTION_RATES[key]
          const fe = fieldErrors[`production_rate_per_unit.${key}`]
          return (
            <label key={key} className="block">
              <FieldLabel>{label} pace</FieldLabel>
              <PlainInput value={production[key]} onChange={(v) => setProduction((p) => ({ ...p, [key]: v }))} placeholder={String(def)} suffix={`${unit}/hr`} disabled={loading || saving} hasError={!!fe} ariaLabel={`${label} production rate`} />
              <Caption error={fe} defaultHint={`Default ${def} ${unit}/hr`} />
            </label>
          )
        })}
        <label className="block">
          <FieldLabel>Crew size</FieldLabel>
          <PlainInput value={crew} onChange={setCrew} placeholder={String(DEFAULT_PAINTING_TAKEOFF_CARD.crew_size)} suffix="painters" disabled={loading || saving} hasError={!!fieldErrors['takeoff.crew_size']} ariaLabel="Crew size" />
          <Caption error={fieldErrors['takeoff.crew_size']} defaultHint={`Default ${DEFAULT_PAINTING_TAKEOFF_CARD.crew_size} · turns hours into days on site`} />
        </label>
        <PctInput label="Prep & sundries" value={sundries} onChange={setSundries} defaultValue={DEFAULT_PAINTING_TAKEOFF_CARD.sundries_pct * 100} error={fieldErrors['takeoff.sundries_pct']} disabled={loading || saving} hint="Filler, caulk, tape, drop sheets — % of materials." />
        <label className="block">
          <FieldLabel>Hours per day</FieldLabel>
          <PlainInput value={hoursPerDay} onChange={setHoursPerDay} placeholder={String(DEFAULT_PAINTING_TAKEOFF_CARD.hours_per_day)} suffix="hrs" disabled={loading || saving} hasError={!!fieldErrors['takeoff.hours_per_day']} ariaLabel="Working hours per day" />
          <Caption error={fieldErrors['takeoff.hours_per_day']} defaultHint={`Default ${DEFAULT_PAINTING_TAKEOFF_CARD.hours_per_day} — turns crew hours into days on site.`} />
        </label>
        <PctInput label="Premium paint uplift" value={premiumMaterialUplift} onChange={setPremiumMaterialUplift} defaultValue={DEFAULT_PAINTING_TAKEOFF_CARD.premium_price_uplift_pct * 100} error={fieldErrors['takeoff.premium_price_uplift_pct']} disabled={loading || saving} hint="Best-tier paint cost uplift over the trade $/L." />
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
          <select aria-label="GST registered" value={gstMode} onChange={(e) => setGstMode(e.target.value as '' | 'true' | 'false')} disabled={loading || saving} className="rounded-ctl mt-2 w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri focus:border-accent focus:outline-none">
            <option value="">{defaults ? `Default — ${defaults.gst_registered ? 'Yes' : 'No'}` : '—'}</option>
            <option value="true">Yes — add 10% GST</option>
            <option value="false">No — inc-GST equals ex-GST</option>
          </select>
          <Caption error={fieldErrors.gst_registered} defaultHint={defaults ? `Default ${defaults.gst_registered ? 'Yes' : 'No'}` : ''} />
        </label>
        <label className="block">
          <FieldLabel>Deposit (%)</FieldLabel>
          <div className="relative mt-2">
            <input type="number" inputMode="decimal" min={0} step={1} value={depositPct} onChange={(e) => setDepositPct(e.target.value)} placeholder={String(DEFAULT_DEPOSIT_PCT)} disabled={loading || saving} aria-label="Deposit percentage" className={`rounded-ctl w-full border bg-ink-deep px-4 py-3 pr-10 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${fieldErrors.deposit_pct ? 'border-warning' : 'border-ink-line focus:border-accent'}`} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-text-dim">%</span>
          </div>
          <Caption error={fieldErrors.deposit_pct} defaultHint={`Default ${DEFAULT_DEPOSIT_PCT}% of the inc-GST tier price at Stripe checkout.`} />
        </label>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-4 pt-2">
        <button type="submit" disabled={loading || saving || !accessToken} aria-busy={loading || saving} className="rounded-ctl inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? (<><span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" /> Saving…</>) : (<>Save rates <span aria-hidden="true">&rarr;</span></>)}
        </button>
        <button type="button" onClick={() => { setRates({ walls: '', ceilings: '', trim: '', exterior: '' }); setDoubleStorey(''); setPremium(''); setGoodFrac(''); setColourExtra(''); setCallOut(''); setGstMode(''); setCoverage(EMPTY_PRODUCTS); setLitrePrice(EMPTY_PRODUCTS); setProduction({ walls: '', ceilings: '', trim: '', exterior: '' }); setCrew(''); setSundries(''); setPricingModel(''); setHourlyRate(''); setCoatsMult({ '1': '', '2': '', '3': '' }); setCondMult({ sound: '', minor: '', bare: '' }); setDepositPct(''); setHoursPerDay(''); setPremiumMaterialUplift('') }} disabled={loading || saving} aria-busy={loading || saving} className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-accent disabled:opacity-50">
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
      <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">{title}</div>
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

/** Bare numeric input with a unit suffix (no $ prefix) — coverage / pace / crew. */
function PlainInput({ value, onChange, placeholder, suffix, disabled, hasError, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder: string; suffix: string; disabled: boolean; hasError: boolean; ariaLabel: string }) {
  return (
    <div className="relative mt-2">
      {/* step="any": coverage (m²/L) and pace (m²/hr) are naturally
          fractional — step={1} would make the browser block the submit on a
          stepMismatch with no visible error. The server clamps ranges. */}
      <input type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} className={`rounded-ctl w-full border bg-ink-deep px-4 py-3 pr-16 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${hasError ? 'border-warning' : 'border-ink-line focus:border-accent'}`} />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-text-dim">{suffix}</span>
    </div>
  )
}

function UnitInput({ value, onChange, placeholder, unit, disabled, hasError, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder: string; unit: string; disabled: boolean; hasError: boolean; ariaLabel: string }) {
  return (
    <div className="relative mt-2">
      <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-base text-text-dim">$</span>
      <input type="number" inputMode="decimal" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} className={`rounded-ctl w-full border bg-ink-deep px-8 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${hasError ? 'border-warning' : 'border-ink-line focus:border-accent'}`} />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-text-dim">/{unit}</span>
    </div>
  )
}

function PctInput({ label, value, onChange, defaultValue, error, disabled, hint }: { label: string; value: string; onChange: (v: string) => void; defaultValue: number | null; error?: string; disabled: boolean; hint: string }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative mt-2">
        <input type="number" inputMode="decimal" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={defaultValue !== null ? String(Math.round(defaultValue)) : ''} disabled={disabled} aria-label={label} className={`rounded-ctl w-full border bg-ink-deep px-4 py-3 pr-10 font-mono text-base text-text-pri placeholder:text-text-dim focus:outline-none ${error ? 'border-warning' : 'border-ink-line focus:border-accent'}`} />
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
