'use client'

// /dashboard/aircon — air-conditioning recommendation tool.
//
// The tradie types a home's details; the deterministic engine returns an
// indicative ducted-vs-split recommendation with a price RANGE and a
// "book a site assessment" CTA. Mirrors the painting tool's auth + fetch.

import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import type {
  AcRecommendation,
  AusState,
  CeilingHeight,
  ClimateZone,
  CurrentSituation,
  Insulation,
} from '@/lib/aircon/types'

type RecommendResponse =
  | { ok: true; climate_zone: ClimateZone; climate_note: string; recommendation: AcRecommendation }
  | { ok: false; error: string; issues?: unknown }

const STATES: readonly AusState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']
const CEILINGS: ReadonlyArray<readonly [CeilingHeight, string]> = [
  ['standard', 'Standard (~2.4 m)'],
  ['high', 'High (~2.7 m)'],
  ['raked', 'Raked / cathedral'],
]
const INSULATIONS: ReadonlyArray<readonly [Insulation, string]> = [
  ['good', 'Good'],
  ['average', 'Average'],
  ['poor', 'Poor'],
  ['unknown', 'Unknown'],
]
const SITUATIONS: ReadonlyArray<readonly [CurrentSituation, string]> = [
  ['none', 'No system yet'],
  ['replacing', 'Replacing a system'],
  ['adding', 'Adding to existing'],
]

const money = (n: number) => `$${n.toLocaleString('en-AU')}`

export default function AirconRecommendPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')

  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [stateCode, setStateCode] = useState<AusState>('QLD')
  const [bedrooms, setBedrooms] = useState(3)
  const [bathrooms, setBathrooms] = useState(2)
  const [livingSpaces, setLivingSpaces] = useState(2)
  const [floorArea, setFloorArea] = useState('')
  const [ceiling, setCeiling] = useState<CeilingHeight>('standard')
  const [insulation, setInsulation] = useState<Insulation>('average')
  const [situation, setSituation] = useState<CurrentSituation>('replacing')
  const [budget, setBudget] = useState('')

  const [busy, setBusy] = useState(false)
  const [resp, setResp] = useState<RecommendResponse | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      setAuthState(t ? 'ready' : 'signed-out')
    })
  }, [])

  const run = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!token) {
        setErrMsg('Sign in to use the recommender.')
        return
      }
      setBusy(true)
      setErrMsg(null)
      try {
        const res = await fetch('/api/aircon/recommend', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: { address, postcode, state: stateCode },
            inputs: {
              bedrooms,
              bathrooms,
              living_spaces: livingSpaces,
              floor_area_m2: floorArea ? Number(floorArea) : null,
              ceiling_height: ceiling,
              insulation,
              current_situation: situation,
              budget: budget ? Number(budget) : null,
            },
          }),
        })
        setResp((await res.json()) as RecommendResponse)
      } catch (err) {
        setErrMsg(err instanceof Error ? err.message : 'Request failed')
      } finally {
        setBusy(false)
      }
    },
    [token, address, postcode, stateCode, bedrooms, bathrooms, livingSpaces, floorArea, ceiling, insulation, situation, budget],
  )

  if (authState === 'loading') return <main className="p-8 text-ink-muted">Loading…</main>
  if (authState === 'signed-out') return <main className="p-8 text-ink-muted">Sign in to use the AC recommender.</main>

  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="mb-1 text-2xl font-bold">Air-Conditioning Recommender</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Indicative ducted-vs-split sizing from a few questions. Every result needs a site assessment to confirm.
      </p>

      <form onSubmit={run} className="grid grid-cols-2 gap-4">
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          Address
          <input className="border border-ink-line bg-ink-card p-2" value={address} onChange={(e) => setAddress(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Postcode
          <input className="border border-ink-line bg-ink-card p-2" value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          State
          <select className="border border-ink-line bg-ink-card p-2" value={stateCode} onChange={(e) => setStateCode(e.target.value as AusState)}>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Bedrooms
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={bedrooms} onChange={(e) => setBedrooms(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Bathrooms
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={bathrooms} onChange={(e) => setBathrooms(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Living spaces
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={livingSpaces} onChange={(e) => setLivingSpaces(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Floor area m² (optional)
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={floorArea} onChange={(e) => setFloorArea(e.target.value)} placeholder="raises accuracy" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ceiling height
          <select className="border border-ink-line bg-ink-card p-2" value={ceiling} onChange={(e) => setCeiling(e.target.value as CeilingHeight)}>
            {CEILINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Insulation
          <select className="border border-ink-line bg-ink-card p-2" value={insulation} onChange={(e) => setInsulation(e.target.value as Insulation)}>
            {INSULATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Current situation
          <select className="border border-ink-line bg-ink-card p-2" value={situation} onChange={(e) => setSituation(e.target.value as CurrentSituation)}>
            {SITUATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Budget $ (optional)
          <input type="number" min={0} className="border border-ink-line bg-ink-card p-2" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>

        <button type="submit" disabled={busy} className="col-span-2 mt-2 bg-accent p-3 font-semibold text-ink-bg disabled:opacity-50">
          {busy ? 'Calculating…' : 'Get recommendation'}
        </button>
      </form>

      {errMsg && <p className="mt-4 text-sm text-red-500">{errMsg}</p>}

      {resp && resp.ok && <Result resp={resp} />}
      {resp && !resp.ok && (
        <p className="mt-4 text-sm text-red-500">Could not size this job ({resp.error}).</p>
      )}
    </main>
  )
}

function Result({ resp }: { resp: Extract<RecommendResponse, { ok: true }> }) {
  const { recommendation: r, climate_zone, climate_note } = resp
  return (
    <section className="mt-8 flex flex-col gap-4">
      <div className="border border-ink-line bg-ink-card p-4 text-sm">
        <p>
          <strong>{r.sizing.connected_kw} kW</strong> connected load across{' '}
          {r.sizing.conditioned_zones} zones · {r.sizing.total_floor_area_m2} m² ·{' '}
          {r.sizing.total_volume_m3} m³ · climate {climate_zone} · confidence {r.confidence}
        </p>
        <p className="mt-1 text-ink-muted">{climate_note}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {r.options.map((o) => (
          <div
            key={o.system_type}
            className={`border p-4 ${o.best_fit ? 'border-accent' : 'border-ink-line'} bg-ink-card`}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-bold capitalize">{o.system_type}</h2>
              {o.best_fit && <span className="bg-accent px-2 py-0.5 text-xs font-semibold text-ink-bg">Best fit</span>}
            </div>
            <p className="text-sm text-ink-muted">{o.capacity_kw} kW</p>
            <p className="my-2 text-xl font-bold">
              {money(o.price.low)} – {money(o.price.high)}
              <span className="ml-1 text-xs font-normal text-ink-muted">inc GST, indicative</span>
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs text-ink-muted">
              {o.pros.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div className="border border-accent bg-ink-card p-4 text-sm">
        <strong>Next step: book a site assessment.</strong>
        <p className="mt-1 text-ink-muted">{r.routing.reason}</p>
      </div>
    </section>
  )
}
