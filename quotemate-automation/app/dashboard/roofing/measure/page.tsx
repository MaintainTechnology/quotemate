'use client'

// /dashboard/roofing/measure — standalone roofing-measurement tool.
//
// Multi-structure flow: the tradie types an address + declares material /
// pitch / intent, and we measure EVERY structure at the property (the
// dwelling plus detached sheds / garages). Each structure is shown as its
// own card — priced independently with its own material — and the tradie
// can include / exclude each one, override a structure's material, pick a
// single secondary structure on its own, then save the job. A combined
// total sums only the included structures. Maintain Technology design.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import type {
  MultiRoofQuote,
  RoofMaterial,
  RoofMetrics,
  RoofStructurePrice,
  RoofingRoutingDecision,
} from '@/lib/roofing/types'
import { RoofMap, type RoofMapBuilding } from '../_components/RoofMap'
import { AddressAutocomplete } from '../_components/AddressAutocomplete'
import { GoogleStaticMap } from '../_components/GoogleStaticMap'
import { PhotoVerify } from '../_components/PhotoVerify'
import { SolarRoofInsight } from '../_components/SolarRoofInsight'
import { RoofTilesViewer } from '../_components/RoofTilesViewer'
import { SolarCheck } from '../_components/SolarCheck'
import { StreetView } from '../_components/StreetView'

type MultiResponse =
  | {
      ok: true
      provider: 'geoscape' | 'lidar' | 'mock' | 'manual'
      quote: MultiRoofQuote
      warnings: string[]
    }
  | { ok: false; code: string; detail: string }
  | { ok: false; error: string }

const MATERIALS = [
  ['colorbond_trimdek', 'Colorbond Trimdek'],
  ['colorbond_kliplok', 'Colorbond Klip-Lok 700'],
  ['concrete_tile', 'Concrete tile'],
  ['terracotta_tile', 'Terracotta tile'],
  ['cement_sheet', 'Cement sheet (asbestos-suspect)'],
  ['unknown', 'Unknown — confirm on-site'],
] as const

const PITCHES = [
  ['shallow', 'Shallow (under 20°)'],
  ['standard', 'Standard (20–25°, the AU norm)'],
  ['steep', 'Steep (26–35°)'],
  ['very_steep', 'Very steep (over 35°) — forces inspection'],
  ['unknown', 'Unknown — forces inspection'],
] as const

const INTENTS = [
  ['full_reroof', 'Full re-roof'],
  ['patch_repair', 'Patch / spot repair'],
  ['leak_trace', 'Leak trace + minor repair'],
  ['gutter_replace', 'Gutter + downpipe replace'],
  ['ridge_cap', 'Ridge / hip cap rebed'],
  ['flashing_repair', 'Flashing repair'],
] as const

const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const

/** Stable per-structure key (buildingId is normally set; sub-polygon /
 *  manual entries may be null — fall back to the list index). */
function structureKey(s: RoofStructurePrice, i: number): string {
  return s.buildingId ?? `__idx_${i}`
}

export default function RoofingMeasurePage() {
  return (
    <FeatureGate slug="roofing" featureLabel="Roof measure">
      <RoofingMeasurePageInner />
    </FeatureGate>
  )
}

function RoofingMeasurePageInner() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')

  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [state, setState] = useState<(typeof STATES)[number]>('NSW')
  const [material, setMaterial] = useState<(typeof MATERIALS)[number][0]>('colorbond_trimdek')
  const [pitch, setPitch] = useState<(typeof PITCHES)[number][0]>('standard')
  const [intent, setIntent] = useState<(typeof INTENTS)[number][0]>('full_reroof')
  const [yearBuilt, setYearBuilt] = useState<string>('')
  const [useMock, setUseMock] = useState(false)

  const [busy, setBusy] = useState(false)
  const [resp, setResp] = useState<MultiResponse | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // Per-structure UI state — keyed by structureKey, survives re-measures.
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  // Wave 2b — "Send as customer quote" persists into the `quotes` table
  // and returns a /q/[token] link the tradie can copy + share.
  const [quoteState, setQuoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [quoteShareUrl, setQuoteShareUrl] = useState<string | null>(null)
  const [quoteShareToken, setQuoteShareToken] = useState<string | null>(null)
  // The /q/roof customer-quote link auto-produced on measure (the rich
  // satellite + per-structure breakdown + AI-preview page, full prices,
  // no approval). Distinct from the optional /q/[token] deposit page above.
  const [custUrl, setCustUrl] = useState<string | null>(null)

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      setAuthState(t ? 'ready' : 'signed-out')
    })
  }, [])

  /** Measure every structure. `overrides` lets the map-click path pass a
   *  new address triple and lets the material editor pass per-building
   *  overrides without threading through component state. */
  const runMeasure = useCallback(
    async (overrides?: {
      address?: string
      postcode?: string
      state?: (typeof STATES)[number]
      perBuilding?: Record<string, { material?: RoofMaterial }>
    }) => {
      if (!token) {
        setErrMsg('Sign in to use the measurement tool.')
        return
      }
      const a = overrides?.address ?? address
      const pc = overrides?.postcode ?? postcode
      const st = overrides?.state ?? state
      setBusy(true)
      setErrMsg(null)
      setSaveState('idle')
      setSavedId(null)
      // A fresh measurement invalidates any quote sent from the previous
      // one — clear the "customer quote created" panel + its PDF link so
      // they can't point at a stale (different) job's document.
      setQuoteState('idle')
      setQuoteShareUrl(null)
      setQuoteShareToken(null)
      setCustUrl(null)
      try {
        const res = await fetch('/api/roofing/measure-all', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: { address: a, postcode: pc, state: st },
            inputs: { material, pitch, intent, building_year_built: yearBuilt ? Number(yearBuilt) : null },
            perBuilding: overrides?.perBuilding,
            use_mock_provider: useMock,
          }),
        })
        const json = (await res.json()) as MultiResponse
        setResp(json)
        if (json.ok === true) {
          // Initialise / preserve include + selection state by key.
          setIncluded((prev) => {
            const next: Record<string, boolean> = {}
            json.quote.structures.forEach((s, i) => {
              const k = structureKey(s, i)
              next[k] = prev[k] ?? true
            })
            return next
          })
          setSelectedId((prev) => {
            const keys = json.quote.structures.map((s, i) => structureKey(s, i))
            return prev && keys.includes(prev) ? prev : keys[0] ?? null
          })
        } else if ('detail' in json) {
          setErrMsg(json.detail)
        } else if ('error' in json) {
          setErrMsg(json.error)
        }
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [token, address, postcode, state, material, pitch, intent, yearBuilt, useMock],
  )

  const onMeasure = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      await runMeasure()
    },
    [runMeasure],
  )

  const onMapRecenter = useCallback(
    async (lng: number, lat: number) => {
      if (!token) {
        setErrMsg('Sign in to use the measurement tool.')
        return
      }
      try {
        const res = await fetch('/api/roofing/reverse-geocode', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ lng, lat }),
        })
        const json = (await res.json()) as
          | { ok: true; address: string; postcode: string | null; state: (typeof STATES)[number] | null }
          | { ok: false; code: string; detail: string }
        if (!json.ok) {
          setErrMsg(json.detail)
          return
        }
        const nextAddr = json.address
        const nextPc = json.postcode ?? postcode
        const nextSt = (json.state ?? state) as (typeof STATES)[number]
        setAddress(nextAddr)
        setPostcode(nextPc)
        setState(nextSt)
        await runMeasure({ address: nextAddr, postcode: nextPc, state: nextSt })
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : String(e))
      }
    },
    [token, postcode, state, runMeasure],
  )

  const quote = resp && resp.ok === true ? resp.quote : null
  const solarTotals = quote ? combinedIncludedTotals(quote, included) : null

  /** Override one structure's material and re-price the whole property
   *  (Geoscape building set is stable for the same address). */
  const onStructureMaterial = useCallback(
    async (mat: RoofMaterial) => {
      if (!quote) return
      const perBuilding: Record<string, { material?: RoofMaterial }> = {}
      quote.structures.forEach((s, i) => {
        const k = structureKey(s, i)
        if (s.buildingId == null) return
        perBuilding[s.buildingId] = { material: k === selectedId ? mat : s.inputs.material }
      })
      await runMeasure({ perBuilding })
    },
    [quote, selectedId, runMeasure],
  )

  /** Wave 2b — POST to /api/roofing/save-as-quote so a real `quotes` row
   *  exists and the tradie gets a shareable /q/[token] URL. Uses the
   *  COMBINED view across included structures as the customer-facing
   *  single quote; metrics + inputs come from the first included
   *  structure (the "primary" one). */
  const onSendAsQuote = useCallback(async () => {
    if (!token || !resp || resp.ok !== true) return
    const includedStructures = resp.quote.structures.filter(
      (s, i) => included[structureKey(s, i)] !== false,
    )
    if (includedStructures.length === 0) {
      setErrMsg('Include at least one structure before saving.')
      return
    }
    const primary = includedStructures[0]
    const combined = resp.quote.combined
    setQuoteState('saving')
    setQuoteShareUrl(null)
    setQuoteShareToken(null)
    setErrMsg(null)
    try {
      const res = await fetch('/api/roofing/save-as-quote', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address: { address, postcode, state },
          inputs: {
            material: primary.inputs.material,
            pitch: primary.inputs.pitch,
            intent: primary.inputs.intent,
            building_year_built: primary.inputs.building_year_built ?? null,
          },
          metrics: {
            footprint_m2: primary.metrics.footprint_m2,
            sloped_area_m2: combined.area_m2,
            storeys: primary.metrics.storeys,
            form: primary.metrics.form,
            hips: primary.metrics.hips,
            valleys: primary.metrics.valleys,
            ridge_lm: primary.metrics.ridge_lm ?? null,
            polygon_geojson: primary.metrics.polygon_geojson ?? null,
            capture_date: primary.metrics.capture_date ?? null,
          },
          price: {
            area_m2: combined.area_m2,
            effective_rate_per_m2: primary.price.effective_rate_per_m2,
            tiers: combined.tiers,
            // `combined` carries only area + tiers; routing + loadings
            // live per-structure. Take them from the primary structure
            // — its routing decision propagates to the whole job
            // (inspection_required on any structure forces the whole
            // quote to inspection).
            loadings_applied: primary.price.loadings_applied,
            routing: primary.price.routing,
          },
        }),
      })
      const json = (await res.json()) as
        | { ok: true; shareUrl: string; shareToken: string }
        | { ok: false; error: string; detail?: string }
      if (json.ok) {
        setQuoteShareUrl(json.shareUrl)
        setQuoteShareToken(json.shareToken)
        setQuoteState('saved')
      } else {
        setQuoteState('error')
        setErrMsg(json.detail ?? json.error)
      }
    } catch (e) {
      setQuoteState('error')
      setErrMsg(e instanceof Error ? e.message : String(e))
    }
  }, [token, resp, included, address, postcode, state])

  const onSave = useCallback(async () => {
    if (!token || !resp || resp.ok !== true) return
    const includedStructures = resp.quote.structures.filter((s, i) => included[structureKey(s, i)] !== false)
    if (includedStructures.length === 0) {
      setErrMsg('Include at least one structure before saving.')
      return
    }
    setSaveState('saving')
    setErrMsg(null)
    try {
      const res = await fetch('/api/roofing/save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: { address, postcode, state },
          provider: resp.provider,
          structures: includedStructures.map((s) => ({
            buildingId: s.buildingId,
            role: s.role,
            label: s.label,
            inputs: s.inputs,
          })),
          quote: resp.quote,
        }),
      })
      const json = (await res.json()) as
        | { ok: true; id: string; public_token: string }
        | { ok: false; error: string; detail?: string }
      if (json.ok) {
        setSavedId(json.id)
        setSaveState('saved')
        // Surface the customer-facing /q/roof page — full prices shown, no
        // approval. `?s=` pins it to exactly the structures the tradie
        // included, reusing the page's existing narrowing logic.
        const includedIdx = resp.quote.structures
          .map((s, i) => (included[structureKey(s, i)] !== false ? i + 1 : 0))
          .filter((n) => n > 0)
        const qs = includedIdx.length > 0 ? `?s=${includedIdx.join(',')}` : ''
        setCustUrl(`${window.location.origin}/q/roof/${json.public_token}${qs}`)
      } else {
        setSaveState('error')
        setErrMsg(json.detail ?? json.error)
      }
    } catch (e) {
      setSaveState('error')
      setErrMsg(e instanceof Error ? e.message : String(e))
    }
  }, [token, resp, included, address, postcode, state])

  // Auto-generate the customer quote the moment a measurement completes —
  // no tradie approval step. onSave persists the measurement and produces
  // the rich /q/roof customer page (full prices + AI preview); the link
  // surfaces on its own below.
  //   • Re-fires on every fresh measurement: runMeasure() resets saveState
  //     to 'idle' and sets a new `resp`, so this effect runs again.
  //   • The `!busy` guard stops it firing on a STALE resp while a new
  //     measurement is still in flight.
  //   • The `saveState === 'idle'` guard makes it fire exactly once per
  //     measurement — onSave flips it to 'saving' immediately, and an
  //     'error' result leaves the manual button as a retry rather than looping.
  useEffect(() => {
    if (resp?.ok === true && saveState === 'idle' && !busy) {
      void onSave()
    }
  }, [resp, saveState, busy, onSave])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <TopographicBackdrop />

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 pb-10 sm:px-10 md:pt-20">
        <Breadcrumb />
        <div className="mt-8 grid gap-10 md:grid-cols-[1.5fr_1fr] md:items-end md:gap-16">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.5rem,5.5vw,4.5rem)]">
            Roof <span className="text-accent">measure</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-text-sec md:text-lg">
            Type an address and we measure every structure on the property —
            the house plus any sheds or garages. Price each one its own way,
            include or drop structures, and get a combined total. The
            customer quote is generated automatically — no sign-off needed.
          </p>
        </div>
        <AuthBadge state={authState} />
      </section>

      {/* ── Measurement form ───────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 sm:px-10">
        <form onSubmit={onMeasure} className="grid gap-7 border border-ink-line bg-ink-card p-7 sm:p-9 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Property address</Label>
            <AddressAutocomplete
              accessToken={token}
              value={address}
              onChange={setAddress}
              onSelect={(s) => {
                setAddress(s.address)
                if (s.postcode) setPostcode(s.postcode)
                if (s.state && (STATES as readonly string[]).includes(s.state)) {
                  setState(s.state as (typeof STATES)[number])
                }
              }}
              state={state}
            />
          </div>

          <div>
            <Label>Postcode</Label>
            <input
              required
              value={postcode}
              onChange={(e) => setPostcode(e.target.value.trim())}
              placeholder="2750"
              pattern="\d{4}"
              maxLength={4}
              className={INPUT}
            />
          </div>

          <div>
            <Label>State</Label>
            <select aria-label="State" value={state} onChange={(e) => setState(e.target.value as (typeof STATES)[number])} className={INPUT}>
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Default roof material</Label>
            <select aria-label="Roof material" value={material} onChange={(e) => setMaterial(e.target.value as (typeof MATERIALS)[number][0])} className={INPUT}>
              {MATERIALS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Roof pitch</Label>
            <select aria-label="Roof pitch" value={pitch} onChange={(e) => setPitch(e.target.value as (typeof PITCHES)[number][0])} className={INPUT}>
              {PITCHES.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Job intent</Label>
            <select aria-label="Job intent" value={intent} onChange={(e) => setIntent(e.target.value as (typeof INTENTS)[number][0])} className={INPUT}>
              {INTENTS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Year built (optional)</Label>
            <input type="number" min={1850} max={2100} value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} placeholder="1985" className={INPUT} />
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-5 pt-2">
            <label className="inline-flex cursor-pointer items-center gap-3 text-text-sec">
              <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} className="h-4 w-4 accent-accent" />
              <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em]">
                Use mock provider (demo · returns a house + shed)
              </span>
            </label>
            <button
              type="submit"
              disabled={busy || authState !== 'ready'}
              className="inline-flex items-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (<><Spinner /> Measuring…</>) : (<>Measure all structures <span aria-hidden="true">&rarr;</span></>)}
            </button>
          </div>
        </form>

        {errMsg && <Notice tone="warn" label="Measurement could not complete">{errMsg}</Notice>}
      </section>

      {/* ── Results ────────────────────────────────────────────── */}
      {quote && resp && resp.ok === true && (
        <MultiResultBlock
          quote={quote}
          provider={resp.provider}
          warnings={resp.warnings}
          address={address}
          accessToken={token}
          busy={busy}
          included={included}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleInclude={(k) => setIncluded((prev) => ({ ...prev, [k]: prev[k] === false }))}
          onStructureMaterial={onStructureMaterial}
          onMapRecenter={onMapRecenter}
          onSave={onSave}
          saveState={saveState}
          savedId={savedId}
          onSendAsQuote={onSendAsQuote}
          quoteState={quoteState}
          quoteShareUrl={quoteShareUrl}
          quoteShareToken={quoteShareToken}
          onMaterialDetected={setMaterial}
        />
      )}

      {(custUrl || saveState === 'saving') && (
        <section className="relative z-10 mx-auto mt-6 max-w-6xl px-6 sm:px-10">
          <div className="border border-ink-line border-l-4 border-l-teal-glow bg-ink-card p-6 sm:p-7">
            {custUrl ? (
              <>
                <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-teal-glow">
                  ✓ Customer quote ready · full prices, no approval needed
                </div>
                <p className="mt-2 text-base text-text-sec">
                  Auto-generated the moment you measured — the customer page shows the
                  satellite overlay, every structure&rsquo;s breakdown, the Good / Better /
                  Best prices and the AI &ldquo;after re-roof&rdquo; preview. Share it as-is:
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a
                    href={custUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sm text-accent underline-offset-4 hover:underline break-all"
                  >
                    {custUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(custUrl)
                    }}
                    className="inline-flex items-center gap-2 border border-ink-line px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-sec hover:border-accent hover:text-accent"
                  >
                    Copy
                  </button>
                  <a
                    href={custUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 bg-accent px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press"
                  >
                    Open <span aria-hidden="true">&rarr;</span>
                  </a>
                </div>
              </>
            ) : (
              <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                Generating customer quote…
              </div>
            )}
          </div>
        </section>
      )}

      {quote && solarTotals && (
        <section className="relative z-10 mx-auto mt-6 max-w-6xl px-6 pb-8 sm:px-10">
          <SolarCheck
            accessToken={token}
            address={address}
            intent={intent}
            betterIncGst={solarTotals.incGst[1]}
            bestIncGst={solarTotals.incGst[2]}
          />
        </section>
      )}

      {quote && (
        <section className="relative z-10 mx-auto mt-6 max-w-6xl px-6 pb-8 sm:px-10">
          <RoofTilesViewer token={token} address={address} postcode={postcode} state={state} />
        </section>
      )}

      <div className="relative z-10 bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMax · Roof measure · multi-structure
        </span>
      </div>
    </main>
  )
}

// ─── Multi-structure result panel ────────────────────────────────────

function MultiResultBlock({
  quote,
  provider,
  warnings,
  address,
  accessToken,
  busy,
  included,
  selectedId,
  onSelect,
  onToggleInclude,
  onStructureMaterial,
  onMapRecenter,
  onSave,
  saveState,
  savedId,
  onSendAsQuote,
  quoteState,
  quoteShareUrl,
  quoteShareToken,
  onMaterialDetected,
}: {
  quote: MultiRoofQuote
  provider: 'geoscape' | 'lidar' | 'mock' | 'manual'
  warnings: string[]
  address: string
  accessToken: string | null
  busy: boolean
  included: Record<string, boolean>
  selectedId: string | null
  onSelect: (key: string) => void
  onToggleInclude: (key: string) => void
  onStructureMaterial: (m: RoofMaterial) => void | Promise<void>
  onMapRecenter: (lng: number, lat: number) => void | Promise<void>
  onSave: () => void | Promise<void>
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  savedId: string | null
  onSendAsQuote: () => void | Promise<void>
  quoteState: 'idle' | 'saving' | 'saved' | 'error'
  quoteShareUrl: string | null
  quoteShareToken: string | null
  onMaterialDetected: (m: RoofMaterial) => void
}) {
  const keyOf = (i: number) => structureKey(quote.structures[i], i)
  const selectedIndex = quote.structures.findIndex((_s, i) => keyOf(i) === selectedId)
  const selected = selectedIndex >= 0 ? quote.structures[selectedIndex] : quote.structures[0]
  const selectedMetrics: RoofMetrics | null = selected?.metrics ?? null

  const mapBuildings: RoofMapBuilding[] = quote.structures.map((s, i) => ({
    id: keyOf(i),
    polygon: s.metrics.polygon_geojson,
    role: s.role,
    included: included[keyOf(i)] !== false,
  }))

  const combined = combinedIncludedTotals(quote, included)

  return (
    <section className="relative z-10 mx-auto mt-12 max-w-6xl px-6 pb-20 sm:px-10 md:pb-24">
      <SectionHeading
        eyebrow={`Measurement from ${provider}`}
        title={`${quote.structures.length} structure${quote.structures.length === 1 ? '' : 's'} at this property`}
      />

      {/* Two-source verification — Google + Geoscape multi-building map */}
      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <GoogleStaticMap
          accessToken={accessToken}
          address={address}
          marker={
            selectedMetrics?.polygon_geojson
              ? {
                  lat: selectedMetrics.polygon_geojson.coordinates[0][0][1],
                  lng: selectedMetrics.polygon_geojson.coordinates[0][0][0],
                }
              : undefined
          }
        />
        <RoofMap
          polygon={null}
          form={selectedMetrics?.form ?? 'unknown'}
          stats={
            selectedMetrics
              ? {
                  sloped_area_m2: selectedMetrics.sloped_area_m2,
                  hips: selectedMetrics.hips,
                  valleys: selectedMetrics.valleys,
                  storeys: selectedMetrics.storeys,
                }
              : null
          }
          buildings={mapBuildings}
          selectedId={selectedId}
          onRecenter={onMapRecenter}
        />
      </div>

      {/* Street-level front elevation — access / height / scaffold read.
          DISPLAY-ONLY: never feeds area / pitch / price. The cinematic 3D
          fly-around lives below in <RoofTilesViewer/>. */}
      <div className="mt-5">
        <StreetView accessToken={accessToken} address={address} />
      </div>

      {/* Google Solar — aerial roof breakdown (planes, area, measured pitch).
          AU-covered; complements the satellite + 3D views with estimation data. */}
      <SolarRoofInsight accessToken={accessToken} metrics={selectedMetrics} />

      {/* Job-level routing strip */}
      <RoutingStrip routing={quote.routing} />

      {/* Per-structure cards */}
      <div className="mt-8 grid gap-6">
        {quote.structures.map((s, i) => {
          const k = keyOf(i)
          return (
            <StructureCard
              key={k}
              structure={s}
              index={i}
              isSelected={k === selectedId}
              isIncluded={included[k] !== false}
              busy={busy}
              onSelect={() => onSelect(k)}
              onToggleInclude={() => onToggleInclude(k)}
              onMaterialChange={onStructureMaterial}
            />
          )
        })}
      </div>

      {/* Combined total */}
      <div className="mt-10 border border-ink-line border-l-4 border-l-accent bg-ink-card p-7 sm:p-9">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Combined total · {combined.count} structure{combined.count === 1 ? '' : 's'} included
          </div>
          <h3 className="mt-2 font-extrabold uppercase tracking-[-0.02em] text-2xl text-text-pri">
            {combined.area.toFixed(0)} m² across the job
          </h3>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {(['good', 'better', 'best'] as const).map((tier, i) => (
            <div key={tier} className="border border-ink-line bg-ink-deep p-6">
              <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{tier} · combined</div>
              <div className="mt-3 font-mono text-3xl font-bold tabular-nums text-accent sm:text-4xl">
                ${formatMoney(combined.incGst[i])}
              </div>
              <div className="mt-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
                inc GST · ${formatMoney(combined.exGst[i])} ex GST
              </div>
            </div>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onSave}
            disabled={saveState === 'saving' || combined.count === 0}
            className="inline-flex items-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveState === 'saving' ? (<><Spinner /> Saving…</>) : (<>Save job ({combined.count})</>)}
          </button>
          {saveState === 'saved' && savedId && (
            <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-teal-glow">
              ✓ Saved · {savedId.slice(0, 8)}
            </span>
          )}
          <button
            type="button"
            onClick={onSendAsQuote}
            disabled={quoteState === 'saving' || combined.count === 0}
            className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {quoteState === 'saving'
              ? (<><Spinner /> Creating deposit page…</>)
              : quoteState === 'saved'
                ? (<>Deposit checkout page ready ✓</>)
                : (<>Optional: add a deposit checkout page</>)}
          </button>
        </div>
        {quoteState === 'saved' && quoteShareUrl && (
          <div className="mt-4 border border-ink-line border-l-4 border-l-teal-glow bg-ink-deep p-5">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-teal-glow">
              ✓ Deposit checkout page created
            </div>
            <p className="mt-2 text-base text-text-sec">
              Optional alternative to the roof quote above — this page lets the customer pay a per-tier deposit via Stripe:
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={quoteShareUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-accent underline-offset-4 hover:underline break-all"
              >
                {quoteShareUrl}
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(quoteShareUrl)
                }}
                className="inline-flex items-center gap-2 border border-ink-line px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-sec hover:border-accent hover:text-accent"
              >
                Copy
              </button>
              <a
                href={quoteShareUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 bg-accent px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press"
              >
                Open <span aria-hidden="true">&rarr;</span>
              </a>
              {quoteShareToken && (
                <a
                  href={`/api/q/${quoteShareToken}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 border border-ink-line px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-sec hover:border-accent hover:text-accent"
                >
                  Download PDF <span aria-hidden="true">&darr;</span>
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI photo verification — for the selected structure */}
      <div className="mt-6">
        <PhotoVerify accessToken={accessToken} address={address} onMaterialDetected={onMaterialDetected} />
      </div>

      {/* Provider warnings */}
      {warnings.length > 0 && (
        <div className="mt-8 border border-ink-line bg-ink-card p-7 sm:p-8">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Provider warnings</div>
          <ul className="mt-3 space-y-2 text-base text-text-sec">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-baseline gap-3">
                <span className="text-accent">·</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function StructureCard({
  structure,
  index,
  isSelected,
  isIncluded,
  busy,
  onSelect,
  onToggleInclude,
  onMaterialChange,
}: {
  structure: RoofStructurePrice
  index: number
  isSelected: boolean
  isIncluded: boolean
  busy: boolean
  onSelect: () => void
  onToggleInclude: () => void
  onMaterialChange: (m: RoofMaterial) => void | Promise<void>
}) {
  const m = structure.metrics
  const p = structure.price
  const inspection = p.routing.decision === 'inspection_required'
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer border bg-ink-card p-6 transition-colors sm:p-7 ${
        isSelected ? 'border-accent' : 'border-ink-line hover:border-accent/50'
      } ${isIncluded ? '' : 'opacity-55'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {structure.role === 'primary' ? 'Main dwelling' : 'Secondary structure'} · {String(index + 1).padStart(2, '0')}
          </div>
          <h3 className="mt-1.5 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">{structure.label}</h3>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-text-sec" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isIncluded} onChange={onToggleInclude} className="h-4 w-4 accent-accent" />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em]">In job</span>
        </label>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <MiniStat label="Sloped area" value={m.sloped_area_m2 !== null ? `${m.sloped_area_m2.toFixed(0)} m²` : '—'} hint={m.footprint_m2 ? `Footprint ${m.footprint_m2.toFixed(0)} m²` : ''} />
        <MiniStat label="Roof form" value={m.form} hint={m.storeys !== null ? `${m.storeys}-storey` : ''} />
        <MiniStat label="Hips · valleys" value={`${m.hips ?? '?'} · ${m.valleys ?? '?'}`} hint={m.buildingId ? `ID ${String(m.buildingId).slice(0, 10)}` : ''} />
      </div>

      <PitchProvenance metrics={m} declaredPitch={structure.inputs.pitch} />

      {/* Per-structure material override */}
      <div className="mt-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          Material for this structure
        </div>
        <select
          aria-label={`Material for ${structure.label}`}
          value={structure.inputs.material}
          disabled={busy || structure.buildingId == null}
          onChange={(e) => void onMaterialChange(e.target.value as RoofMaterial)}
          className={`${INPUT} max-w-sm disabled:opacity-50`}
        >
          {MATERIALS.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {/* Tier prices for this structure */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {p.tiers.map((t) => (
          <div key={t.tier} className="border border-ink-line bg-ink-deep p-5">
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{t.tier} · {t.label}</div>
            <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-accent">${formatMoney(t.inc_gst)}</div>
            <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">inc GST</div>
          </div>
        ))}
      </div>

      {(inspection || p.call_out_minimum_applied || p.loadings_applied.length > 0) && (
        <div className="mt-5 space-y-1.5 text-sm text-text-sec">
          {inspection && <p className="text-warning">⚠ {p.routing.reason}</p>}
          {p.call_out_minimum_applied && <p>Call-out minimum applied — small structure floored to the minimum job charge.</p>}
          {p.loadings_applied.map((l) => (
            <p key={l.code}>+ {l.detail}</p>
          ))}
        </div>
      )}
    </article>
  )
}

function RoutingStrip({ routing }: { routing: RoofingRoutingDecision }) {
  const tone =
    routing.decision === 'inspection_required' ? 'warn' :
    routing.decision === 'auto_quote' ? 'good' : 'accent'
  return (
    <div className={`mt-8 border border-ink-line border-l-4 ${routingBorder(tone)} bg-ink-card px-6 py-5 sm:px-8`}>
      <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${routingLabelColour(tone)}`}>
        Job routing · {routing.decision.replace('_', ' ')}
      </div>
      <p className="mt-1 text-base text-text-sec">{routing.reason}</p>
    </div>
  )
}

/** PURE — sum the included structures' tiers for the combined total. */
function combinedIncludedTotals(
  quote: MultiRoofQuote,
  included: Record<string, boolean>,
): { count: number; area: number; exGst: [number, number, number]; incGst: [number, number, number] } {
  const exGst: [number, number, number] = [0, 0, 0]
  const incGst: [number, number, number] = [0, 0, 0]
  let area = 0
  let count = 0
  quote.structures.forEach((s, i) => {
    if (included[structureKey(s, i)] === false) return
    count += 1
    area += s.price.area_m2
    for (let t = 0; t < 3; t++) {
      exGst[t] += s.price.tiers[t].ex_gst
      incGst[t] += s.price.tiers[t].inc_gst
    }
  })
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    count,
    area: Math.round(area * 10) / 10,
    exGst: [round2(exGst[0]), round2(exGst[1]), round2(exGst[2])],
    incGst: [round2(incGst[0]), round2(incGst[1]), round2(incGst[2])],
  }
}

// ─── Small UI bits ──────────────────────────────────────────────────

function Breadcrumb() {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/dashboard" className="transition-colors hover:text-text-pri">Dashboard</Link>
      <span className="text-ink-line">/</span>
      <Link href="/dashboard?tab=roofing" className="transition-colors hover:text-text-pri">Roof</Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Measure</span>
    </div>
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</div>
      <h2 className="mt-3 font-extrabold uppercase tracking-[-0.025em] text-[clamp(1.5rem,2.6vw,2.25rem)] leading-[1.1]">{title}</h2>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{children}</div>
  )
}

/** Shows where the pitch driving sloped area came from. When the Google
 *  Solar API measured it, surface the degrees + imagery provenance so the
 *  tradie can trust or override it (imagery can be several years old). When
 *  it fell back to the customer's declared bucket, say so plainly. */
function PitchProvenance({ metrics, declaredPitch }: { metrics: RoofMetrics; declaredPitch: string }) {
  const measured = metrics.pitch_source === 'measured' && metrics.pitch_degrees != null
  if (measured) {
    return (
      <div className="mt-4 inline-flex flex-wrap items-center gap-x-2 gap-y-1 border border-accent/40 bg-accent/5 px-3 py-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em]">
        <span className="text-accent">◳ Pitch {metrics.pitch_degrees}° measured</span>
        <span className="text-text-dim">
          · Google aerial {metrics.imagery_date ?? 'date n/a'}
          {metrics.imagery_quality ? ` · ${metrics.imagery_quality} quality` : ''}
          {metrics.roof_segment_count != null ? ` · ${metrics.roof_segment_count} planes` : ''}
        </span>
      </div>
    )
  }
  return (
    <div className="mt-4 inline-flex items-center gap-2 border border-ink-line bg-ink-deep px-3 py-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-text-dim">
      <span>◳ Pitch declared · {declaredPitch}</span>
    </div>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-xl font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}

function Notice({ tone, label, children }: { tone: 'warn' | 'accent'; label: string; children: React.ReactNode }) {
  const border = tone === 'warn' ? 'border-l-warning' : 'border-l-accent'
  const labelColour = tone === 'warn' ? 'text-warning' : 'text-accent'
  return (
    <div className={`mt-6 border border-ink-line ${border} border-l-4 bg-ink-card px-5 py-4`}>
      <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${labelColour}`}>{label}</div>
      <p className="mt-1 text-base text-text-sec">{children}</p>
    </div>
  )
}

function AuthBadge({ state }: { state: 'loading' | 'signed-out' | 'ready' }) {
  const label =
    state === 'loading' ? 'Checking session…' :
    state === 'signed-out' ? 'Not signed in — sign in to measure' :
    'Signed in — ready to measure'
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

function routingBorder(t: 'warn' | 'good' | 'accent'): string {
  if (t === 'warn') return 'border-l-warning'
  if (t === 'good') return 'border-l-teal-glow'
  return 'border-l-accent'
}
function routingLabelColour(t: 'warn' | 'good' | 'accent'): string {
  if (t === 'warn') return 'text-warning'
  if (t === 'good') return 'text-teal-glow'
  return 'text-accent'
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'

function TopographicBackdrop() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="roof-topo-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14B8A6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#14B8A6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="url(#roof-topo-fade)" strokeWidth="1" fill="none">
        <path d="M0,820 Q220,700 460,760 T940,720 T1420,760 T1920,700" />
        <path d="M0,760 Q220,640 460,700 T940,660 T1420,700 T1920,640" />
        <path d="M0,700 Q220,580 460,640 T940,600 T1420,640 T1920,580" />
        <path d="M0,640 Q220,520 460,580 T940,540 T1420,580 T1920,520" />
        <path d="M0,580 Q220,460 460,520 T940,480 T1420,520 T1920,460" />
      </g>
    </svg>
  )
}
