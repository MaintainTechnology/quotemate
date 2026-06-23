'use client'

// /dashboard/painting — painting estimate tool, two tabs.
//
//   • "realestate.com.au" tab → asks the REA provider. There is no
//     official REA lookup API, so this is inert until a managed scraper
//     or a paste flow is wired — the demo toggle returns sample data so
//     the flow runs end-to-end. The tab carries an honest provenance note.
//   • "Other tools" tab → the Solar / Geoscape / Domain provider stack
//     (mock until those adapters + keys land).
//
// Both tabs feed the SAME deterministic area → G/B/B pricing engine. The
// estimate is always a RANGE with a confidence band; low confidence
// routes to a site measure. Maintain Technology design.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import { AddressAutocomplete } from '../roofing/_components/AddressAutocomplete'
import { PaintRatesEditor } from '../_components/PaintRatesEditor'
import { MaterialCheck } from './_components/MaterialCheck'
import { Paint3DTilesViewer } from './_components/Paint3DTilesViewer'
import { ZoomableImage } from '../_components/ZoomableImage'
import type {
  PaintScope,
  PaintingEstimate,
  PaintingRoutingDecision,
} from '@/lib/painting/types'

type EstimateResponse =
  | { ok: true; estimate: PaintingEstimate }
  | { ok: false; code: string; detail: string }
  | { ok: false; error: string }

type Tab = 'rea' | 'auto'

const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const

const SCOPES: ReadonlyArray<readonly [PaintScope, string]> = [
  ['walls', 'Interior walls'],
  ['ceilings', 'Ceilings'],
  ['trim', 'Trim (skirting / architraves)'],
  ['exterior', 'Exterior'],
]

const CONDITIONS = [
  ['sound', 'Sound — previously painted'],
  ['minor', 'Minor patching'],
  ['bare', 'Bare / new — needs priming'],
  ['poor', 'Poor — flaking / damage (forces inspection)'],
] as const

const CEILINGS = [
  ['standard', 'Standard (~2.4 m)'],
  ['high', 'High (~2.7 m, Queenslander / period)'],
  ['raked', 'Raked / cathedral (forces inspection)'],
] as const

export default function PaintingEstimatePage() {
  return (
    <FeatureGate slug="painting" featureLabel="Paint estimate">
      <PaintingEstimatePageInner />
    </FeatureGate>
  )
}

function PaintingEstimatePageInner() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')

  const [tab, setTab] = useState<Tab>('rea')

  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [stateCode, setStateCode] = useState<(typeof STATES)[number]>('QLD')
  const [scopes, setScopes] = useState<PaintScope[]>(['walls', 'ceilings'])
  const [coats, setCoats] = useState<1 | 2 | 3>(2)
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number][0]>('sound')
  const [ceiling, setCeiling] = useState<(typeof CEILINGS)[number][0]>('standard')
  const [storeys, setStoreys] = useState<1 | 2 | 3>(1)
  const [colourChange, setColourChange] = useState(false)
  const [manualArea, setManualArea] = useState('')
  const [useMock, setUseMock] = useState(true)

  const [busy, setBusy] = useState(false)
  const [resp, setResp] = useState<EstimateResponse | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedToken, setSavedToken] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      setAuthState(t ? 'ready' : 'signed-out')
    })
  }, [])

  const toggleScope = useCallback((s: PaintScope) => {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }, [])

  // Core estimate run, callable without a form event so the "Recalculate"
  // affordance (after the tradie edits their rates) can re-run it. The
  // estimate endpoint re-reads the tenant rate overlay on every call, so a
  // recalc with unchanged inputs returns the same area at the NEW rates.
  const runEstimateCore = useCallback(async () => {
    if (!token) {
      setErrMsg('Sign in to use the estimate tool.')
      return
    }
    if (!address.trim()) {
      setErrMsg('Enter a property address.')
      return
    }
    // Recalculate calls this outside the <form>, so the postcode input's
    // native required/pattern="\d{4}" never fires — guard it here so the
    // recalc path matches the submit path (else the server bounces it with
    // a cryptic invalid_request).
    if (!/^\d{4}$/.test(postcode)) {
      setErrMsg('Enter a 4-digit postcode.')
      return
    }
    if (scopes.length === 0) {
      setErrMsg('Pick at least one surface to paint.')
      return
    }
    setBusy(true)
    setErrMsg(null)
    setSaveState('idle')
    setSavedId(null)
    setSavedToken(null)
    setSaveErr(null)
    try {
      const res = await fetch('/api/painting/estimate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: { address, postcode, state: stateCode },
          inputs: {
            scopes,
            coats,
            condition,
            ceiling_height: ceiling,
            storeys,
            colour_change: colourChange,
            manual_floor_area_m2: manualArea ? Number(manualArea) : null,
          },
          source: tab,
          use_mock_provider: useMock,
        }),
      })
      const json = (await res.json()) as EstimateResponse
      setResp(json)
      if (json.ok !== true) {
        if ('detail' in json) setErrMsg(json.detail)
        else if ('error' in json) setErrMsg(json.error)
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [token, address, postcode, stateCode, scopes, coats, condition, ceiling, storeys, colourChange, manualArea, tab, useMock])

  const runEstimate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      void runEstimateCore()
    },
    [runEstimateCore],
  )

  const estimate = resp && resp.ok === true ? resp.estimate : null

  const onSave = useCallback(async () => {
    if (!token || !estimate) return
    setSaveState('saving')
    setSaveErr(null)
    try {
      const res = await fetch('/api/painting/save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: { address, postcode, state: stateCode },
          source: estimate.provider,
          inputs: {
            scopes,
            coats,
            condition,
            ceiling_height: ceiling,
            storeys,
            colour_change: colourChange,
            manual_floor_area_m2: manualArea ? Number(manualArea) : null,
          },
          estimate,
        }),
      })
      const json = (await res.json()) as
        | { ok: true; id: string; public_token: string }
        | { ok: false; error?: string; detail?: string }
      if (json.ok) {
        setSavedId(json.id)
        setSavedToken(json.public_token)
        setSaveState('saved')
      } else {
        setSaveState('error')
        setSaveErr(json.detail ?? json.error ?? 'Could not save the job.')
      }
    } catch (e) {
      setSaveState('error')
      setSaveErr(e instanceof Error ? e.message : String(e))
    }
  }, [token, estimate, address, postcode, stateCode, scopes, coats, condition, ceiling, storeys, colourChange, manualArea])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 pb-8 sm:px-10 md:pt-20">
        <Breadcrumb />
        <div className="mt-8 grid gap-10 md:grid-cols-[1.5fr_1fr] md:items-end md:gap-16">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.5rem,5.5vw,4.5rem)]">
            Paint <span className="text-accent">estimate</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-text-sec md:text-lg">
            Type an address, pick the surfaces, and we estimate the paintable
            square metres and a Good / Better / Best range. Every number is an
            estimate with a confidence band — low confidence routes to a site
            measure, and the tradie signs off before send.
          </p>
        </div>
        <AuthBadge state={authState} />
      </section>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 sm:px-10">
        <div className="flex flex-wrap gap-px border border-ink-line bg-ink-line">
          <TabButton active={tab === 'rea'} onClick={() => setTab('rea')} label="realestate.com.au" sub="Listing building size" />
          <TabButton active={tab === 'auto'} onClick={() => setTab('auto')} label="Other tools" sub="Footprint · Geoscape · floor plan" />
        </div>

        {tab === 'rea' ? (
          <ProvenanceNote tone="warn" label="realestate.com.au — no official lookup API">
            REA has no API that returns a property&rsquo;s floor area, and scraping the
            listing page is against their terms. This tab is inert until a managed
            scraper or a paste flow is wired. Leave <strong>demo data</strong> on
            below to run the flow end-to-end with sample numbers.
          </ProvenanceNote>
        ) : (
          <ProvenanceNote tone="accent" label="Other tools — Google Solar is live">
            Turn <strong>demo data off</strong> to run a real Google Solar lookup:
            address → building footprint → floor area (× storeys). Works for most
            AU addresses even with no listing. Set the storey count and confirm the
            area for a tight number. Geoscape + floor-plan upload come next.
          </ProvenanceNote>
        )}
      </section>

      {/* ── Form ──────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 sm:px-10">
        <form onSubmit={runEstimate} className="mt-5 grid gap-7 border border-ink-line bg-ink-card p-7 sm:p-9 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Property address</Label>
            <AddressAutocomplete
              accessToken={token}
              value={address}
              onChange={setAddress}
              onSelect={(s) => {
                setAddress(s.address)
                // Only accept a well-formed postcode/state from the
                // suggestion (symmetric guards) — a malformed provider value
                // is ignored, leaving whatever the tradie typed.
                if (s.postcode && /^\d{4}$/.test(s.postcode)) setPostcode(s.postcode)
                if (s.state && (STATES as readonly string[]).includes(s.state)) {
                  setStateCode(s.state as (typeof STATES)[number])
                }
              }}
              placeholder="Start typing — e.g. 28 Greens Rd, Coorparoo"
            />
            <p className="mt-1.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
              Pick a suggestion to auto-fill postcode &amp; state
            </p>
          </div>

          <div>
            <Label>Postcode</Label>
            <input required value={postcode} onChange={(e) => setPostcode(e.target.value.trim())} placeholder="4151" pattern="\d{4}" maxLength={4} className={INPUT} />
          </div>

          <div>
            <Label>State</Label>
            <select aria-label="State" value={stateCode} onChange={(e) => setStateCode(e.target.value as (typeof STATES)[number])} className={INPUT}>
              {STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>

          <div className="md:col-span-2">
            <Label>Surfaces to paint</Label>
            <div className="flex flex-wrap gap-3">
              {SCOPES.map(([v, label]) => (
                <label key={v} className={`inline-flex cursor-pointer items-center gap-2.5 border px-4 py-2.5 transition-colors ${scopes.includes(v) ? 'border-accent text-text-pri' : 'border-ink-line text-text-sec hover:border-accent/50'}`}>
                  <input type="checkbox" checked={scopes.includes(v)} onChange={() => toggleScope(v)} className="h-4 w-4 accent-accent" />
                  <span className="font-mono text-sm font-semibold uppercase tracking-[0.1em]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label>Coats</Label>
            <select aria-label="Coats" value={coats} onChange={(e) => setCoats(Number(e.target.value) as 1 | 2 | 3)} className={INPUT}>
              <option value={1}>1 coat — refresh</option>
              <option value={2}>2 coats — standard</option>
              <option value={3}>3 coats — premium</option>
            </select>
          </div>

          <div>
            <Label>Surface condition</Label>
            <select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as (typeof CONDITIONS)[number][0])} className={INPUT}>
              {CONDITIONS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
            </select>
          </div>

          <div>
            <Label>Ceiling height</Label>
            <select aria-label="Ceiling height" value={ceiling} onChange={(e) => setCeiling(e.target.value as (typeof CEILINGS)[number][0])} className={INPUT}>
              {CEILINGS.map(([v, label]) => (<option key={v} value={v}>{label}</option>))}
            </select>
          </div>

          <div>
            <Label>Storeys</Label>
            <select aria-label="Storeys" value={storeys} onChange={(e) => setStoreys(Number(e.target.value) as 1 | 2 | 3)} className={INPUT}>
              <option value={1}>Single storey</option>
              <option value={2}>Double storey</option>
              <option value={3}>3 storeys (forces inspection)</option>
            </select>
          </div>

          <div>
            <Label>Floor area override (m², optional)</Label>
            <input type="number" min={1} max={2000} value={manualArea} onChange={(e) => setManualArea(e.target.value)} placeholder="from the floor plan" className={INPUT} />
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-5 pt-1">
            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex cursor-pointer items-center gap-3 text-text-sec">
                <input type="checkbox" checked={colourChange} onChange={(e) => setColourChange(e.target.checked)} className="h-4 w-4 accent-accent" />
                <span className="font-mono text-sm font-semibold uppercase tracking-[0.12em]">Colour change</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-3 text-text-sec">
                <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} className="h-4 w-4 accent-accent" />
                <span className="font-mono text-sm font-semibold uppercase tracking-[0.12em]">Demo data</span>
              </label>
            </div>
            <button type="submit" disabled={busy || authState !== 'ready'} className="inline-flex items-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? (<><Spinner /> Estimating…</>) : (<>Estimate paintable area <span aria-hidden="true">&rarr;</span></>)}
            </button>
          </div>
        </form>

        {errMsg && (
          <ProvenanceNote tone="warn" label="Estimate could not complete">{errMsg}</ProvenanceNote>
        )}
      </section>

      {/* ── Result ────────────────────────────────────────────────── */}
      {estimate && (
        <ResultBlock
          estimate={estimate}
          onRecalculate={() => void runEstimateCore()}
          recalculating={busy}
        />
      )}

      {/* ── Exterior wall material (Street View) ──────────────────── */}
      {estimate && (
        <MaterialCheck
          token={token}
          address={address}
          postcode={postcode}
          state={stateCode}
          yearBuilt={estimate.facts.year_built}
        />
      )}

      {/* ── Save job ──────────────────────────────────────────────── */}
      {estimate && (
        <section className="relative z-10 mx-auto mt-6 max-w-6xl px-6 sm:px-10">
          <div className="flex flex-wrap items-center gap-4 border border-ink-line border-l-4 border-l-accent bg-ink-card px-6 py-5">
            <button
              type="button"
              onClick={onSave}
              disabled={saveState === 'saving'}
              className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveState === 'saving' ? (<><Spinner /> Saving…</>) : (<>Save job</>)}
            </button>
            {saveState === 'saved' && savedId && (
              <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-teal-glow">
                ✓ Saved · find it in the Paint tab history
              </span>
            )}
            {saveState === 'saved' && savedToken && estimate.price.routing.decision !== 'inspection_required' && (
              <a
                href={`/api/q/paint/${savedToken}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 border border-ink-line px-4 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
              >
                Download PDF <span aria-hidden="true">↓</span>
              </a>
            )}
            {saveState === 'error' && saveErr && (
              <span className="text-sm text-warning">{saveErr}</span>
            )}
            {saveState !== 'saved' && saveState !== 'error' && (
              <span className="text-sm text-text-dim">Saves this estimate to your Paint tab history.</span>
            )}
          </div>
        </section>
      )}

      {/* ── Visual repaint preview ────────────────────────────────── */}
      {estimate && (
        <PaintPreviewSection
          token={token}
          address={address}
          postcode={postcode}
          state={stateCode}
          scopes={scopes}
        />
      )}

      {/* Your pricing — set/tweak the rates that build every estimate */}
      {authState === 'ready' && (
        <section className="relative z-10 mx-auto mt-8 max-w-6xl px-6 pb-4 sm:px-10">
          <details className="border border-ink-line bg-ink-card">
            <summary className="cursor-pointer list-none px-6 py-5 font-mono text-sm font-semibold uppercase tracking-[0.16em] text-accent hover:text-accent-press">
              ⚙ Your painting pricing — set your own rates
            </summary>
            <div className="border-t border-ink-line p-2 sm:p-4">
              <PaintRatesEditor accessToken={token} />
            </div>
            {estimate && (
              <div className="flex flex-wrap items-center gap-4 border-t border-ink-line bg-ink-deep px-5 py-5 sm:px-6">
                <button
                  type="button"
                  onClick={() => void runEstimateCore()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (<><Spinner /> Recalculating…</>) : (<><span aria-hidden="true">↻</span> Recalculate estimate with these rates</>)}
                </button>
                <span className="text-sm text-text-dim">Re-runs the estimate above with your saved rates — no need to re-enter the address.</span>
              </div>
            )}
          </details>
        </section>
      )}

      <div className="relative z-10 mt-16 bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">QuoteMax · Paint estimate · two-tab</span>
      </div>
    </main>
  )
}

// ─── Result panel ────────────────────────────────────────────────────

function ResultBlock({
  estimate,
  onRecalculate,
  recalculating,
}: {
  estimate: PaintingEstimate
  onRecalculate: () => void
  recalculating: boolean
}) {
  const { facts, measurement, price, warnings, provider } = estimate
  return (
    <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-4 sm:px-10">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">Estimate from {provider}</span>
        <ConfidenceBadge confidence={price.confidence} />
        <button
          type="button"
          onClick={onRecalculate}
          disabled={recalculating}
          title="Re-run this estimate with your current saved rates"
          className="ml-auto inline-flex items-center gap-2 border border-ink-line px-4 py-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recalculating ? (<><Spinner /> Recalculating…</>) : (<><span aria-hidden="true">↻</span> Recalculate</>)}
        </button>
      </div>

      <RoutingStrip routing={price.routing} />

      {/* Floor area + source */}
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <Stat
          label="Floor area"
          value={`${measurement.floor_area_m2.toFixed(0)} m²`}
          hint={`${measurement.floor_area_low_m2.toFixed(0)}–${measurement.floor_area_high_m2.toFixed(0)} m² · ${sourceWords(measurement.floor_area_source)}`}
        />
        <Stat label="Storeys · ceiling" value={`${measurement.storeys} · ${measurement.ceiling_height_m} m`} hint={facts.property_type ?? ''} />
        <Stat label="Beds · baths" value={`${facts.bedrooms ?? '?'} · ${facts.bathrooms ?? '?'}`} hint={facts.year_built ? `Built ${facts.year_built}` : ''} />
      </div>

      {/* Property details — everything the data source told us */}
      <div className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Property details</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Building footprint" value={facts.footprint_m2 != null ? `${Math.round(facts.footprint_m2)} m²` : '—'} hint={facts.footprint_m2 != null ? 'roof outprint' : 'not provided'} />
          <Stat label="Land size" value={facts.land_size_m2 != null ? `${Math.round(facts.land_size_m2)} m²` : '—'} />
          <Stat label="Type · built" value={`${facts.property_type ?? '—'}${facts.year_built ? ` · ${facts.year_built}` : ''}`} hint={facts.has_floor_plan ? 'floor plan available' : ''} />
        </div>
        {facts.capture_note && <p className="mt-3 text-xs text-text-dim">{facts.capture_note}</p>}
      </div>

      {/* Paintable surfaces */}
      <div className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Paintable quantities</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {measurement.surfaces.map((s) => (
            <div key={s.scope} className="flex items-baseline justify-between border border-ink-line bg-ink-deep px-4 py-3">
              <span className="font-mono text-sm font-semibold uppercase tracking-[0.1em] text-text-sec">{s.scope}</span>
              <span className="font-mono text-base tabular-nums text-text-pri">
                {s.quantity.toFixed(0)} {s.unit === 'lm' ? 'lm' : 'm²'}
                <span className="ml-2 text-xs text-text-dim">{s.quantity_low.toFixed(0)}–{s.quantity_high.toFixed(0)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* G/B/B tiers */}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {price.tiers.map((t) => (
          <div key={t.tier} className="border border-ink-line bg-ink-card p-6">
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{t.tier} · {t.label}</div>
            <div className="mt-3 font-mono text-3xl font-bold tabular-nums text-accent">${money(t.inc_gst)}</div>
            <div className="mt-1 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim">
              range ${money(t.inc_gst_low)}–${money(t.inc_gst_high)} inc GST
            </div>
            <p className="mt-3 text-sm leading-relaxed text-text-sec">{t.scope}</p>
          </div>
        ))}
      </div>

      {(price.loadings_applied.length > 0 || price.call_out_minimum_applied) && (
        <div className="mt-5 space-y-1.5 text-sm text-text-sec">
          {price.call_out_minimum_applied && <p>Call-out minimum applied — small job floored to the minimum charge.</p>}
          {price.loadings_applied.map((l) => (<p key={l.code}>+ {l.detail}</p>))}
        </div>
      )}

      {/* How the price was built — every contributor to the tiers */}
      {price.breakdown && (
        <div className="mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-7">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">How the price was built</div>
          <p className="mt-2 text-xs text-text-dim">Better = each surface × your rate × multipliers. Good and Best are derived from Better.</p>
          <div className="mt-4 space-y-2 font-mono text-sm">
            {price.breakdown.surfaces.map((s) => (
              <div key={s.scope} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-line pb-2">
                <span className="uppercase tracking-[0.1em] text-text-sec">{s.scope}</span>
                <span className="tabular-nums text-text-dim">{s.quantity.toFixed(0)} {s.unit === 'lm' ? 'lm' : 'm²'} × ${s.rate_per_unit} → <span className="text-text-pri">${money(s.line_ex_gst)}</span></span>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-text-sec">Coats · prep · colour</span>
              <span className="tabular-nums text-text-pri">× {price.breakdown.coats_multiplier} · {price.breakdown.prep_multiplier} · {price.breakdown.colour_change_multiplier}</span>
            </div>
            {price.breakdown.double_storey_multiplier !== 1 && (
              <div className="flex items-baseline justify-between">
                <span className="text-text-sec">Double-storey exterior</span>
                <span className="tabular-nums text-text-pri">× {price.breakdown.double_storey_multiplier}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-ink-line pt-2">
              <span className="font-semibold text-text-pri">Better subtotal (ex GST)</span>
              <span className="font-bold tabular-nums text-accent">${money(price.breakdown.better_ex_gst)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-text-sec">Good = Better ×</span>
              <span className="tabular-nums text-text-pri">{Math.round(price.breakdown.good_refresh_fraction * 100)}%</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-text-sec">Best = Better ×</span>
              <span className="tabular-nums text-text-pri">{Math.round((1 + price.breakdown.premium_uplift_pct) * 100)}%</span>
            </div>
            {price.breakdown.gst_factor > 1 && (
              <div className="flex items-baseline justify-between">
                <span className="text-text-sec">GST</span>
                <span className="tabular-nums text-text-pri">+ {Math.round((price.breakdown.gst_factor - 1) * 100)}%</span>
              </div>
            )}
            {price.breakdown.call_out_minimum_ex_gst > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-text-sec">Call-out minimum (floor)</span>
                <span className="tabular-nums text-text-pri">${money(price.breakdown.call_out_minimum_ex_gst)}</span>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-text-dim">Tune any of these in &ldquo;Your painting pricing&rdquo; below.</p>
        </div>
      )}

      {/* Derivation notes + warnings */}
      <div className="mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">How this was derived</div>
        <ul className="mt-3 space-y-2 text-sm text-text-sec">
          {measurement.notes.map((n, i) => (
            <li key={i} className="flex items-baseline gap-3"><span className="text-accent">·</span><span>{n}</span></li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`} className="flex items-baseline gap-3"><span className="text-warning">!</span><span>{w}</span></li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─── Visual repaint preview ─────────────────────────────────────────

const COLOUR_SWATCHES = [
  'Surfmist off-white',
  'Dulux Natural White',
  'Dulux Vivid White',
  'Lexicon Quarter',
  'Hog Bristle',
  'Monument charcoal',
  'Basalt grey',
  'Woodland Grey',
  'Shale Grey',
  'Sage green',
  'Hamptons blue',
  'Terracotta',
  'Heritage red',
  'Charcoal black',
] as const

function PaintPreviewSection({
  token,
  address,
  postcode,
  state,
  scopes,
}: {
  token: string | null
  address: string
  postcode: string
  state: string
  scopes: PaintScope[]
}) {
  const [beforeSrc, setBeforeSrc] = useState<string | null>(null)
  const [beforeState, setBeforeState] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle')
  const [colour, setColour] = useState('')
  const [busy, setBusy] = useState(false)
  const [after, setAfter] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Conversational refinement of the preview (Jon's "paint the fence grey too").
  const [changeLog, setChangeLog] = useState<string[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [refineInput, setRefineInput] = useState('')
  const [refining, setRefining] = useState(false)
  const [show3D, setShow3D] = useState(false)

  // Fetch the Street View "before" (cheap, no Gemini) so the tradie sees
  // the house resolved correctly before spending a generation.
  useEffect(() => {
    if (!token || address.trim().length < 3) return
    let cancelled = false
    let objUrl: string | null = null
    setBeforeState('loading')
    setBeforeSrc(null)
    const params = new URLSearchParams({ address, postcode, state })
    fetch(`/api/painting/street-view?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image')) {
          setBeforeState('none')
          return
        }
        const blob = await res.blob()
        objUrl = URL.createObjectURL(blob)
        setBeforeSrc(objUrl)
        setBeforeState('ready')
      })
      .catch(() => {
        if (!cancelled) setBeforeState('none')
      })
    return () => {
      cancelled = true
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [token, address, postcode, state])

  const generate = useCallback(async () => {
    if (!token) return
    setBusy(true)
    setErr(null)
    setAfter(null)
    try {
      const res = await fetch('/api/painting/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, postcode, state, colour, scopes }),
      })
      const json = (await res.json()) as
        | { ok: true; before: string; after: string; imagery_date: string | null }
        | { ok: false; code?: string; detail?: string; error?: string }
      if (json.ok) {
        setAfter(json.after)
        setChangeLog([])
        setHistory([])
        if (json.before) setBeforeSrc(json.before)
      } else {
        setErr(json.detail ?? json.code ?? json.error ?? 'Could not generate the preview.')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [token, address, postcode, state, colour, scopes])

  // Apply one conversational change to the CURRENT preview image.
  const refine = useCallback(async () => {
    const instruction = refineInput.trim()
    if (!token || !after || instruction.length < 2) return
    setRefining(true)
    setErr(null)
    try {
      const res = await fetch('/api/painting/preview/refine', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: after, instruction }),
      })
      const json = (await res.json()) as
        | { ok: true; after: string }
        | { ok: false; code?: string; detail?: string; error?: string }
      if (json.ok) {
        setHistory((h) => [...h, after])
        setAfter(json.after)
        setChangeLog((c) => [...c, instruction])
        setRefineInput('')
      } else {
        setErr(json.detail ?? json.code ?? json.error ?? 'Could not apply that change.')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRefining(false)
    }
  }, [token, after, refineInput])

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      setAfter(h[h.length - 1])
      setChangeLog((c) => c.slice(0, -1))
      return h.slice(0, -1)
    })
  }, [])

  return (
    <section className="relative z-10 mx-auto mt-8 max-w-6xl px-6 pb-4 sm:px-10">
      <div className="border border-ink-line bg-ink-card p-6 sm:p-8">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Visual preview · exterior repaint
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-sec">
          A Google Street View photo of the front of the house, repainted by AI in your
          chosen colour. The structure stays identical — only the paint changes. Great for
          showing the customer what they&rsquo;re buying. (Exterior front only.)
        </p>

        {/* Colour picker */}
        <div className="mt-5">
          <Label>Preview colour</Label>
          <div className="flex items-center gap-3">
            <input
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              placeholder="e.g. Monument charcoal — or pick a colour →"
              className={`${INPUT} flex-1`}
            />
            <input
              type="color"
              aria-label="Pick a custom colour"
              title="Custom colour"
              value={/^#[0-9a-fA-F]{6}$/.test(colour) ? colour : '#777777'}
              onChange={(e) => setColour(e.target.value)}
              className="h-12 w-14 shrink-0 cursor-pointer border border-ink-line bg-ink-deep p-1"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {COLOUR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColour(c)}
                className="border border-ink-line px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-text-sec transition-colors hover:border-accent hover:text-accent"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={busy || !token || beforeState === 'none'}
          className="mt-5 inline-flex items-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (<><Spinner /> Painting… (10–20s)</>) : (<>Generate painted preview <span aria-hidden="true">&rarr;</span></>)}
        </button>

        {beforeState === 'none' && (
          <p className="mt-4 text-sm text-warning">
            No Street View imagery for this address — the visual preview isn&rsquo;t available here.
          </p>
        )}
        {err && <p className="mt-4 text-sm text-warning">{err}</p>}

        {/* Before / after */}
        {(beforeSrc || after) && (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <figure>
              <figcaption className="mb-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">Before</figcaption>
              {beforeSrc ? (
                <ZoomableImage src={beforeSrc} alt="Street View of the house" caption="Before · Street View" className="w-full border border-ink-line" />
              ) : (
                <div className="flex h-48 items-center justify-center border border-ink-line bg-ink-deep text-text-dim">{beforeState === 'loading' ? 'Loading…' : '—'}</div>
              )}
            </figure>
            <figure>
              <figcaption className="mb-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">After · AI repaint</figcaption>
              {after ? (
                <ZoomableImage src={after} alt="AI preview of the house repainted" caption="After · AI repaint" className="w-full border border-accent" />
              ) : (
                <div className="flex h-48 items-center justify-center border border-ink-line bg-ink-deep text-text-dim">{busy ? 'Generating…' : 'Pick a colour and generate'}</div>
              )}
            </figure>
          </div>
        )}
        {/* Conversational refinement — ask for more changes */}
        {after && (
          <div className="mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-deep p-5">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Refine the preview</div>
            <p className="mt-1 text-sm text-text-sec">
              Ask for changes in plain English — e.g. &ldquo;paint the fence grey too&rdquo;, &ldquo;make the front door black&rdquo;, &ldquo;add a darker trim&rdquo;.
            </p>
            {changeLog.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {changeLog.map((c, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-sm text-text-sec">
                    <span className="font-mono text-xs text-accent">{i + 1}.</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void refine()
                  }
                }}
                placeholder="paint the fence grey too…"
                disabled={refining}
                className={`${INPUT} flex-1`}
              />
              <button
                type="button"
                onClick={() => void refine()}
                disabled={refining || refineInput.trim().length < 2}
                className="inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refining ? (<><Spinner /> Applying…</>) : (<>Apply change</>)}
              </button>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={undo}
                  disabled={refining}
                  className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-accent disabled:opacity-50"
                >
                  Undo
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-text-dim">
              Updates the picture only — if a change adds work (e.g. the fence), add it to the price in the estimate above.
            </p>
          </div>
        )}

        {after && (
          <p className="mt-3 text-xs text-text-dim">
            AI-generated illustration for discussion only — actual colour and finish may vary.
          </p>
        )}

        {/* 3D fly-around (Google Photorealistic 3D Tiles, recoloured) */}
        <div className="mt-6 border-t border-ink-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Fly around in 3D</div>
              <p className="mt-1 max-w-2xl text-sm text-text-sec">
                Orbit the property in Google&rsquo;s photorealistic 3D model, tinted to your colour.
                The walls are auto-detected, so it&rsquo;s approximate — drag to orbit, scroll to zoom.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShow3D((v) => !v)}
              disabled={address.trim().length < 3}
              className="inline-flex items-center gap-2 border border-ink-line px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {show3D ? 'Hide 3D' : (<>Fly around in 3D <span aria-hidden="true">&rarr;</span></>)}
            </button>
          </div>
          {show3D && (
            <div className="mt-4">
              <Paint3DTilesViewer token={token} address={address} postcode={postcode} state={state} colour={colour} />
              <p className="mt-2 text-xs text-text-dim">3D imagery © Google. Tint is an AI-approximated preview, not a precise paint match.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Small UI bits ──────────────────────────────────────────────────

function TabButton({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex-1 px-6 py-4 text-left transition-colors ${active ? 'bg-ink-card' : 'bg-ink-deep hover:bg-ink-card/60'}`}>
      <div className={`font-mono text-sm font-semibold uppercase tracking-[0.14em] ${active ? 'text-accent' : 'text-text-sec'}`}>{label}</div>
      <div className="mt-1 text-xs text-text-dim">{sub}</div>
    </button>
  )
}

function ProvenanceNote({ tone, label, children }: { tone: 'warn' | 'accent'; label: string; children: React.ReactNode }) {
  const border = tone === 'warn' ? 'border-l-warning' : 'border-l-accent'
  const labelColour = tone === 'warn' ? 'text-warning' : 'text-accent'
  return (
    <div className={`mt-4 border border-ink-line ${border} border-l-4 bg-ink-card px-5 py-4`}>
      <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${labelColour}`}>{label}</div>
      <p className="mt-1 text-sm leading-relaxed text-text-sec">{children}</p>
    </div>
  )
}

function RoutingStrip({ routing }: { routing: PaintingRoutingDecision }) {
  const warn = routing.decision === 'inspection_required'
  return (
    <div className={`mt-6 border border-ink-line border-l-4 ${warn ? 'border-l-warning' : 'border-l-accent'} bg-ink-card px-6 py-5`}>
      <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${warn ? 'text-warning' : 'text-accent'}`}>
        Routing · {routing.decision.replace(/_/g, ' ')}
      </div>
      <p className="mt-1 text-base text-text-sec">{routing.reason}</p>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const colour = confidence === 'high' ? 'text-teal-glow' : confidence === 'medium' ? 'text-accent' : 'text-warning'
  return (
    <span className={`font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] ${colour}`}>{confidence} confidence</span>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-card p-5">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}

function Breadcrumb() {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/dashboard" className="transition-colors hover:text-text-pri">Dashboard</Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Paint estimate</span>
    </div>
  )
}

function AuthBadge({ state }: { state: 'loading' | 'signed-out' | 'ready' }) {
  const label = state === 'loading' ? 'Checking session…' : state === 'signed-out' ? 'Not signed in — sign in to estimate' : 'Signed in — ready to estimate'
  const dot = state === 'ready' ? 'bg-teal-glow' : state === 'signed-out' ? 'bg-accent' : 'bg-text-dim'
  return (
    <div className="mt-10 inline-flex items-center gap-3 border border-ink-line bg-ink-card px-5 py-3">
      <span className={`h-2.5 w-2.5 ${dot}`} aria-hidden="true" />
      <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec">{label}</span>
    </div>
  )
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" />
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{children}</div>
}

function sourceWords(s: PaintingEstimate['measurement']['floor_area_source']): string {
  switch (s) {
    case 'listing': return 'from listing'
    case 'footprint': return 'from footprint'
    case 'beds_estimate': return 'from bedroom count'
    case 'manual': return 'entered by hand'
    default: return 'estimated'
  }
}

function money(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
