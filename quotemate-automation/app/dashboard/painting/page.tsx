'use client'

// /dashboard/painting — painting estimate tool.
//
// Address → Google Solar footprint → floor area (× storeys) → the
// deterministic area → G/B/B pricing engine. The estimate is always a
// RANGE with a confidence band; low confidence routes to a site measure.
// Maintain Technology design.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import { AddressAutocomplete } from '../roofing/_components/AddressAutocomplete'
import { MaterialCheck } from './_components/MaterialCheck'
import { Paint3DTilesViewer } from './_components/Paint3DTilesViewer'
import { PaintResultView } from './_components/PaintResultView'
import { ZoomableImage } from '../_components/ZoomableImage'
import type {
  PaintScope,
  PaintingEstimate,
} from '@/lib/painting/types'

type EstimateResponse =
  | { ok: true; estimate: PaintingEstimate }
  | { ok: false; code: string; detail: string }
  | { ok: false; error: string }

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
  ['extra_high', 'Very high (~3 m+, forces inspection)'],
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
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')

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
  }, [token, address, postcode, stateCode, scopes, coats, condition, ceiling, storeys, colourChange, manualArea])

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
        | { ok: true; id: string; public_token: string; estimate_token: string }
        | { ok: false; error?: string; detail?: string }
      if (json.ok) {
        setSavedId(json.id)
        setSavedToken(json.public_token)
        setSaveState('saved')
        // The estimate is now a first-class entity — open its tradie-facing
        // results page on a unique hash link (mirrors roofing's /m redirect).
        router.push(`/p/${json.estimate_token}`)
      } else {
        setSaveState('error')
        setSaveErr(json.detail ?? json.error ?? 'Could not save the job.')
      }
    } catch (e) {
      setSaveState('error')
      setSaveErr(e instanceof Error ? e.message : String(e))
    }
  }, [token, estimate, address, postcode, stateCode, scopes, coats, condition, ceiling, storeys, colourChange, manualArea, router])

  // Auto-persist the moment an estimate completes — no manual "Save job"
  // step needed. onSave writes the painting_measurements row (minting both
  // the customer public_token and the tradie estimate_token) and routes the
  // tradie to /p/[estimate_token]. Mirrors the roofing measure → /m redirect.
  //   • Re-fires on every fresh estimate: runEstimateCore() resets saveState
  //     to 'idle' and sets a new `resp`, so this effect runs again.
  //   • The `!busy` guard stops it firing on a STALE resp mid-estimate.
  //   • The `saveState === 'idle'` guard fires it exactly once per estimate —
  //     onSave flips it to 'saving' immediately, and an 'error' result leaves
  //     the manual Save button below as a retry rather than looping.
  useEffect(() => {
    if (resp?.ok === true && saveState === 'idle' && !busy) {
      void onSave()
    }
  }, [resp, saveState, busy, onSave])

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

      {/* ── Data source note ──────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 sm:px-10">
        <ProvenanceNote tone="accent" label="Google Solar footprint lookup">
          Enter an address and we run a Google Solar lookup: address → building
          footprint → floor area (× storeys). Works for most AU addresses even
          with no listing. Set the storey count and confirm the area for a tight
          number. Geoscape + floor-plan upload come next.
        </ProvenanceNote>
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
      {/* On a clean estimate this is fleeting — the auto-save effect routes
          the tradie to /p/[estimate_token]. It stays visible only when the
          save fails (the manual Save button below is the retry). */}
      {estimate && (
        <PaintResultView
          estimate={estimate}
          headerAction={
            <button
              type="button"
              onClick={() => void runEstimateCore()}
              disabled={busy}
              title="Re-run this estimate with your current saved rates"
              className="inline-flex items-center gap-2 border border-ink-line px-4 py-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (<><Spinner /> Recalculating…</>) : (<><span aria-hidden="true">↻</span> Recalculate</>)}
            </button>
          }
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

      {/* Painting rate-card editor moved to the dashboard Pricing tab
          (PricingTab → PaintRatesEditor). Tune rates there; re-run an
          estimate here with the ↻ button on the result panel. */}

      <div className="relative z-10 mt-16 bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">QuoteMax · Paint estimate</span>
      </div>
    </main>
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

const INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
