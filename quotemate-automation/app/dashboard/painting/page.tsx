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

  const runEstimate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!token) {
        setErrMsg('Sign in to use the estimate tool.')
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
    },
    [token, address, postcode, stateCode, scopes, coats, condition, ceiling, storeys, colourChange, manualArea, tab, useMock],
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
        | { ok: true; id: string }
        | { ok: false; error?: string; detail?: string }
      if (json.ok) {
        setSavedId(json.id)
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
            <input required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="28 Greens Rd, Coorparoo" className={INPUT} />
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
      {estimate && <ResultBlock estimate={estimate} />}

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

      <div className="relative z-10 mt-16 bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">QuoteMate · Paint estimate · two-tab</span>
      </div>
    </main>
  )
}

// ─── Result panel ────────────────────────────────────────────────────

function ResultBlock({ estimate }: { estimate: PaintingEstimate }) {
  const { facts, measurement, price, warnings, provider } = estimate
  return (
    <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-4 sm:px-10">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">Estimate from {provider}</span>
        <ConfidenceBadge confidence={price.confidence} />
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
  'Monument charcoal',
  'Woodland Grey',
  'Sage green',
  'Hamptons blue',
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
          <input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            placeholder="e.g. Surfmist off-white, Monument charcoal, sage green"
            className={INPUT}
          />
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
                // eslint-disable-next-line @next/next/no-img-element
                <img src={beforeSrc} alt="Street View of the house" className="w-full border border-ink-line" />
              ) : (
                <div className="flex h-48 items-center justify-center border border-ink-line bg-ink-deep text-text-dim">{beforeState === 'loading' ? 'Loading…' : '—'}</div>
              )}
            </figure>
            <figure>
              <figcaption className="mb-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">After · AI repaint</figcaption>
              {after ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={after} alt="AI preview of the house repainted" className="w-full border border-accent" />
              ) : (
                <div className="flex h-48 items-center justify-center border border-ink-line bg-ink-deep text-text-dim">{busy ? 'Generating…' : 'Pick a colour and generate'}</div>
              )}
            </figure>
          </div>
        )}
        {after && (
          <p className="mt-3 text-xs text-text-dim">
            AI-generated illustration for discussion only — actual colour and finish may vary.
          </p>
        )}
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
