'use client'

// /dashboard/aircon — air-conditioning recommendation tool.
//
// The tradie types a home's details; the deterministic engine returns an
// indicative ducted-vs-split recommendation with a price RANGE and a
// "book a site assessment" CTA. Mirrors the painting tool's auth + fetch.
//
// The result view is built for transparency: a Google satellite map +
// weather/footprint evidence, the volumetric sizing working (per-room
// m³ → kW), a line-item price breakdown per option, and an indicative
// system-layout schematic — so the tradie and the customer can both see
// HOW the estimate was reached.
//
// Styling follows the Maintain design system (command-centre dark navy,
// orange accent, uppercase display type, numbered sections, no shadows).

import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { AddressAutocomplete } from '../roofing/_components/AddressAutocomplete'
import { RoofTilesViewer } from '../roofing/_components/RoofTilesViewer'
import { ZoomableImage } from '../_components/ZoomableImage'
import type { AcLocationEvidence } from '@/lib/aircon/location'
import type {
  AcOption,
  AcRecommendation,
  AcSizing,
  AusState,
  CeilingHeight,
  ClimateZone,
  CurrentSituation,
  Insulation,
  RoomLoad,
} from '@/lib/aircon/types'

type RecommendResponse =
  | {
      ok: true
      climate_zone: ClimateZone
      climate_note: string
      location: AcLocationEvidence
      recommendation: AcRecommendation
    }
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
const STOREY_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [1, 'Single storey'],
  [2, 'Two storey'],
  [3, '3+ levels'],
]

const money = (n: number) => `$${n.toLocaleString('en-AU')}`

const FLOOR_AREA_SOURCE_LABEL: Record<AcSizing['floor_area_source'], string> = {
  entered: 'Floor area · entered by hand',
  solar_footprint: 'Floor area · Google Solar satellite footprint',
  typical_room_mix: 'Floor area · AU typical room mix (estimate)',
}

// ── Shared style fragments (Maintain design system) ──────────────────

const FIELD_LABEL =
  'font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text-dim'
const FIELD_INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
const SUMMARY_TOGGLE =
  'cursor-pointer select-none font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-accent hover:text-accent-press'

export default function AirconRecommendPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')

  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [stateCode, setStateCode] = useState<AusState>('QLD')
  const [bedrooms, setBedrooms] = useState(3)
  const [bathrooms, setBathrooms] = useState(2)
  const [livingSpaces, setLivingSpaces] = useState(2)
  const [storeys, setStoreys] = useState(1)
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
              storeys,
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
    [token, address, postcode, stateCode, bedrooms, bathrooms, livingSpaces, storeys, floorArea, ceiling, insulation, situation, budget],
  )

  if (authState === 'loading') {
    return (
      <main className="min-h-screen bg-ink-deep p-10">
        <p className="font-mono text-sm uppercase tracking-[0.14em] text-text-dim">Loading…</p>
      </main>
    )
  }
  if (authState === 'signed-out') {
    return (
      <main className="min-h-screen bg-ink-deep p-10">
        <p className="font-mono text-sm uppercase tracking-[0.14em] text-text-dim">
          Sign in to use the AC recommender.
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <div className="mx-auto max-w-6xl px-6 py-12 sm:px-8 sm:py-16">
        {/* ── Header ── */}
        <header className="mb-10 sm:mb-14">
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-dim">
            Trade tool · HVAC sizing &amp; pricing
          </span>
          <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.5rem)] font-extrabold uppercase leading-none tracking-[-0.03em]">
            Air-conditioning <span className="text-accent">recommender</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-text-sec">
            Indicative ducted-vs-split sizing from a few questions — volumetric load, satellite
            evidence and a line-item price working. Every result needs a site assessment to confirm.
          </p>
        </header>

        {/* ── Form ── */}
        <form onSubmit={run} className="border border-ink-line bg-ink-card p-6 sm:p-9">
          <FormSectionHeading num="01" title="Property" sub="Address drives climate zone + satellite evidence" />
          <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-4">
            <label className="flex flex-col gap-2 sm:col-span-2">
              <span className={FIELD_LABEL}>Address</span>
              <AddressAutocomplete
                accessToken={token}
                value={address}
                onChange={setAddress}
                onSelect={(s) => {
                  setAddress(s.address)
                  if (s.postcode) setPostcode(s.postcode)
                  if (s.state && (STATES as readonly string[]).includes(s.state)) {
                    setStateCode(s.state as AusState)
                  }
                }}
                placeholder="Start typing — e.g. 27 Smith Street, Penrith"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Postcode</span>
              <input className={FIELD_INPUT} value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>State</span>
              <select className={FIELD_INPUT} value={stateCode} onChange={(e) => setStateCode(e.target.value as AusState)}>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <FormSectionHeading num="02" title="Rooms & levels" sub="Conditioned zones set the volumetric load" />
          <div className="mb-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Bedrooms</span>
              <input type="number" min={0} className={FIELD_INPUT} value={bedrooms} onChange={(e) => setBedrooms(Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Bathrooms</span>
              <input type="number" min={0} className={FIELD_INPUT} value={bathrooms} onChange={(e) => setBathrooms(Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Living spaces</span>
              <input type="number" min={0} className={FIELD_INPUT} value={livingSpaces} onChange={(e) => setLivingSpaces(Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Storeys / levels</span>
              <select className={FIELD_INPUT} value={storeys} onChange={(e) => setStoreys(Number(e.target.value))}>
                {STOREY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Floor area m²</span>
              <input type="number" min={0} className={FIELD_INPUT} value={floorArea} onChange={(e) => setFloorArea(e.target.value)} placeholder="blank = satellite" />
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Ceiling height</span>
              <select className={FIELD_INPUT} value={ceiling} onChange={(e) => setCeiling(e.target.value as CeilingHeight)}>
                {CEILINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          <FormSectionHeading num="03" title="Conditions & budget" sub="Tunes the load factors and routing" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Insulation</span>
              <select className={FIELD_INPUT} value={insulation} onChange={(e) => setInsulation(e.target.value as Insulation)}>
                {INSULATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Current situation</span>
              <select className={FIELD_INPUT} value={situation} onChange={(e) => setSituation(e.target.value as CurrentSituation)}>
                {SITUATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className={FIELD_LABEL}>Budget $ (optional)</span>
              <input type="number" min={0} className={FIELD_INPUT} value={budget} onChange={(e) => setBudget(e.target.value)} />
            </label>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-9 inline-flex w-full items-center justify-center gap-3 bg-accent px-8 py-4 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-accent-press disabled:opacity-50 sm:w-auto"
          >
            {busy ? 'Calculating…' : 'Get recommendation'}
            {!busy && <span aria-hidden>→</span>}
          </button>
        </form>

        {errMsg && <p className="mt-5 text-sm text-red-400">{errMsg}</p>}

        {resp && resp.ok && (
          <Result
            resp={resp}
            token={token}
            addressInput={{ address, postcode, state: stateCode }}
          />
        )}
        {resp && !resp.ok && (
          <p className="mt-5 text-sm text-red-400">Could not size this job ({resp.error}).</p>
        )}
      </div>
    </main>
  )
}

function FormSectionHeading({ num, title, sub }: { num: string; title: string; sub: string }) {
  return (
    <div className="mb-5 flex items-baseline gap-4 border-b border-ink-line pb-3">
      <span className="font-mono text-xl font-bold leading-none text-accent">{num}</span>
      <h2 className="text-sm font-extrabold uppercase tracking-[0.04em]">{title}</h2>
      <span className="hidden font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim sm:inline">
        {sub}
      </span>
    </div>
  )
}

// ── Result ────────────────────────────────────────────────────────────

function SectionHeader({ num, title, sub }: { num: string; title: string; sub?: string }) {
  return (
    <div className="mb-6 flex items-end gap-5">
      <span className="font-mono text-5xl font-bold leading-none text-accent sm:text-6xl">{num}</span>
      <div>
        <h2 className="text-xl font-extrabold uppercase leading-tight tracking-[-0.01em] sm:text-2xl">
          {title}
        </h2>
        {sub && (
          <p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-dim">{sub}</p>
        )}
      </div>
    </div>
  )
}

function Result({
  resp,
  token,
  addressInput,
}: {
  resp: Extract<RecommendResponse, { ok: true }>
  token: string | null
  addressInput: { address: string; postcode: string; state: AusState }
}) {
  const { recommendation: r, climate_zone, climate_note, location } = resp
  return (
    <section className="mt-16 flex flex-col gap-14 sm:mt-20 sm:gap-16">
      <div>
        <SectionHeader num="01" title="Property evidence" sub="Google Maps Platform · satellite + weather" />
        <LocationPanel location={location} token={token} />
        <div className="mt-5">
          <RoofTilesViewer
            token={token}
            address={location.geocode.ok ? (location.geocode.formatted_address ?? addressInput.address) : addressInput.address}
            postcode={addressInput.postcode}
            state={addressInput.state}
          />
        </div>
      </div>

      <div>
        <SectionHeader num="02" title="Volumetric sizing" sub="How the kW was calculated" />
        <SizingPanel sizing={r.sizing} climateZone={climate_zone} climateNote={climate_note} />
      </div>

      <div>
        <SectionHeader num="03" title="System options" sub="Both systems priced from the same load" />
        <div className="grid gap-5 lg:grid-cols-2">
          {r.options.map((o) => (
            <OptionCard key={o.system_type} option={o} rooms={r.sizing.rooms} />
          ))}
        </div>
      </div>

      <div>
        <SectionHeader num="04" title="Next step" />
        <div className="border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-8">
          <p className="text-lg font-extrabold uppercase tracking-[0.02em]">
            Book a <span className="text-accent">site assessment</span>
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-sec">{r.routing.reason}</p>
        </div>
      </div>
    </section>
  )
}

// ── Location evidence: satellite map + weather + footprint ───────────

function LocationPanel({ location, token }: { location: AcLocationEvidence; token: string | null }) {
  const { geocode, weather, building } = location
  return (
    <div className="grid gap-0 border border-ink-line bg-ink-card sm:grid-cols-[380px_1fr]">
      <AcStaticMap token={token} geocode={geocode} />
      <div className="flex flex-col gap-3 p-6 text-sm sm:p-8">
        {geocode.ok ? (
          <p className="text-base font-bold">{geocode.formatted_address ?? 'Address resolved'}</p>
        ) : (
          <p className="text-text-sec">
            Address could not be pinpointed — map and satellite evidence unavailable.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {weather.ok && weather.temperature_c != null && (
            <Chip label={`Now ${weather.temperature_c}°C${weather.condition ? ` · ${weather.condition}` : ''}`} />
          )}
          {weather.ok && weather.feels_like_c != null && <Chip label={`Feels like ${weather.feels_like_c}°C`} />}
          {weather.ok && weather.humidity_pct != null && <Chip label={`${weather.humidity_pct}% humidity`} />}
          {building.ok && <Chip label={`Roof footprint ${building.footprint_m2} m²`} accent />}
          {building.ok && (
            <Chip
              label={`≈ ${building.estimated_floor_area_m2} m² over ${building.storeys_assumed} level${building.storeys_assumed === 1 ? '' : 's'}`}
              accent
            />
          )}
        </div>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-text-dim">
          {location.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>
    </div>
  )
}

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`border px-3 py-1 font-mono text-[0.68rem] uppercase tracking-widest ${
        accent ? 'border-accent text-accent' : 'border-ink-line text-text-sec'
      }`}
    >
      {label}
    </span>
  )
}

function AcStaticMap({
  token,
  geocode,
}: {
  token: string | null
  geocode: AcLocationEvidence['geocode']
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !geocode.ok) {
      setSrc(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const params = new URLSearchParams({ lat: String(geocode.lat), lng: String(geocode.lng) })
        const res = await fetch(`/api/aircon/static-map?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancelled || !res.ok) return
        objectUrl = URL.createObjectURL(await res.blob())
        if (!cancelled) setSrc(objectUrl)
      } catch {
        // map is evidence, not the money path — fail silently
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [token, geocode])

  return (
    <div className="relative h-56 w-full overflow-hidden border-b border-ink-line bg-ink-deep sm:h-full sm:border-b-0 sm:border-r">
      <div className="pointer-events-none absolute left-3 top-3 z-10 border border-ink-line bg-ink-deep/95 px-3 py-1.5">
        <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          Google satellite
        </span>
      </div>
      {src ? (
        <ZoomableImage
          src={src}
          alt="Google satellite view of the property"
          caption="Google satellite · click anywhere to close"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center p-4 text-center font-mono text-xs uppercase tracking-widest text-text-dim">
          {geocode.ok ? 'Loading satellite view…' : 'No map — address not resolved'}
        </div>
      )}
    </div>
  )
}

// ── Volumetric sizing: the working behind the kW number ──────────────

function roomLabels(rooms: RoomLoad[]): string[] {
  let bed = 0
  let liv = 0
  return rooms.map((r) => (r.room_type === 'bedroom' ? `Bed ${++bed}` : `Living ${++liv}`))
}

function Stat({
  value,
  unit,
  label,
  text,
}: {
  value: string | number
  unit?: string
  label: string
  /** Word values (e.g. "subtropical") render smaller so they fit the tile. */
  text?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 border border-ink-line bg-ink-deep px-4 py-4 sm:px-5">
      <p
        className={`wrap-break-word font-mono font-bold leading-tight text-text-pri ${
          text ? 'text-base uppercase tracking-wide sm:text-lg' : 'text-2xl leading-none sm:text-3xl'
        }`}
      >
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-text-dim">{unit}</span>}
      </p>
      <p className="font-mono text-[0.62rem] leading-snug uppercase tracking-[0.14em] text-text-dim">{label}</p>
    </div>
  )
}

function SizingPanel({
  sizing,
  climateZone,
  climateNote,
}: {
  sizing: AcSizing
  climateZone: ClimateZone
  climateNote: string
}) {
  const labels = roomLabels(sizing.rooms)
  return (
    <div className="border border-ink-line bg-ink-card p-6 sm:p-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat value={sizing.connected_kw} unit="kW" label="Connected load" />
        <Stat value={sizing.total_volume_m3} unit="m³" label="Conditioned air" />
        <Stat value={sizing.total_floor_area_m2} unit="m²" label="Floor area" />
        <Stat value={sizing.conditioned_zones} label="Zones" />
        <Stat value={`${sizing.storeys}`} label={`Storey${sizing.storeys === 1 ? '' : 's'}`} />
        <Stat value={climateZone} label={`Climate · ${sizing.confidence} confidence`} text />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Chip
          label={FLOOR_AREA_SOURCE_LABEL[sizing.floor_area_source]}
          accent={sizing.floor_area_source !== 'typical_room_mix'}
        />
        <Chip label={`kW = m³ × ${sizing.volumetric_factor_kw_m3} (${climateZone}) × room type × insulation × storeys`} />
      </div>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-text-sec">{climateNote}</p>

      <details className="group mt-6 border-t border-ink-line pt-5">
        <summary className={SUMMARY_TOGGLE}>
          Per-room volumetric working <span aria-hidden>↓</span>
        </summary>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink-line font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
                <th className="py-2.5 pr-4 font-semibold">Room</th>
                <th className="py-2.5 pr-4 font-semibold">Area m²</th>
                <th className="py-2.5 pr-4 font-semibold">Volume m³</th>
                <th className="py-2.5 font-semibold">Load kW</th>
              </tr>
            </thead>
            <tbody>
              {sizing.rooms.map((room, i) => (
                <tr key={`${labels[i]}`} className="border-b border-ink-line/50">
                  <td className="py-2.5 pr-4">{labels[i]}</td>
                  <td className="py-2.5 pr-4 font-mono">{room.area_m2}</td>
                  <td className="py-2.5 pr-4 font-mono">{room.volume_m3}</td>
                  <td className="py-2.5 font-mono">{room.kw}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-2.5 pr-4 uppercase">Total</td>
                <td className="py-2.5 pr-4 font-mono">{sizing.total_floor_area_m2}</td>
                <td className="py-2.5 pr-4 font-mono">{sizing.total_volume_m3}</td>
                <td className="py-2.5 font-mono text-accent">{sizing.connected_kw}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-text-sec">
          {sizing.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
        {sizing.warnings.length > 0 && (
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-amber-500">
            {sizing.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </details>
    </div>
  )
}

// ── Option card: price range + line-item breakdown + layout ──────────

function OptionCard({ option: o, rooms }: { option: AcOption; rooms: RoomLoad[] }) {
  const p = o.pricing
  return (
    <div className={`flex flex-col border bg-ink-card p-6 sm:p-8 ${o.best_fit ? 'border-accent' : 'border-ink-line'}`}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
            {o.capacity_kw} kW system
          </p>
          <h3 className="mt-1 text-2xl font-extrabold uppercase tracking-[-0.01em]">{o.system_type}</h3>
        </div>
        {o.best_fit && (
          <span className="bg-accent px-3 py-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-white">
            Best fit
          </span>
        )}
      </div>

      <p className="mt-3 text-3xl font-extrabold leading-none sm:text-4xl">
        {money(o.price.low)} <span className="text-text-dim">–</span> {money(o.price.high)}
      </p>
      <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-text-dim">
        inc GST · indicative · point estimate{' '}
        <span className="text-text-sec">{money(p.point_estimate_inc_gst)}</span> ±{p.confidence_band_pct}%
      </p>

      <details className="mt-6 border-t border-ink-line pt-4 text-sm">
        <summary className={SUMMARY_TOGGLE}>How this price was calculated</summary>
        <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">{p.formula}</p>
        <table className="mt-3 w-full border-collapse text-left text-xs">
          <tbody>
            {p.components.map((c) => (
              <tr key={c.label} className="border-b border-ink-line/40 align-top">
                <td className="py-2 pr-2">
                  <span className="text-text-pri">{c.label}</span>
                  {c.note && <div className="mt-0.5 text-[0.68rem] leading-snug text-text-dim">{c.note}</div>}
                </td>
                <td className="whitespace-nowrap py-2 pr-2 font-mono text-text-sec">
                  {c.quantity} {c.unit} {c.rate_ex_gst > 0 ? `× ${money(c.rate_ex_gst)}` : ''}
                </td>
                <td className="whitespace-nowrap py-2 text-right font-mono">{money(c.total_ex_gst)}</td>
              </tr>
            ))}
            {p.adjustments.map((a) => (
              <tr key={a.label} className="border-b border-ink-line/40 align-top text-text-sec">
                <td className="py-2 pr-2">
                  {a.label}
                  {a.note && <div className="mt-0.5 text-[0.68rem] leading-snug text-text-dim">{a.note}</div>}
                </td>
                <td className="whitespace-nowrap py-2 pr-2 font-mono">
                  {a.unit === '%' ? `${a.quantity}%` : ''}
                </td>
                <td className="whitespace-nowrap py-2 text-right font-mono">
                  {a.total_ex_gst < 0 ? `−${money(Math.abs(a.total_ex_gst))}` : `+${money(a.total_ex_gst)}`}
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="py-2 pr-2 uppercase">Point estimate ex GST</td>
              <td />
              <td className="whitespace-nowrap py-2 text-right font-mono">{money(p.point_estimate_ex_gst)}</td>
            </tr>
            {p.gst_registered && (
              <tr className="font-bold">
                <td className="py-2 pr-2 uppercase">+ 10% GST</td>
                <td />
                <td className="whitespace-nowrap py-2 text-right font-mono text-accent">
                  {money(p.point_estimate_inc_gst)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs leading-relaxed text-text-dim">{p.band_reason}</p>
      </details>

      <details className="mt-4 border-t border-ink-line pt-4 text-sm">
        <summary className={SUMMARY_TOGGLE}>Indicative {o.system_type} layout</summary>
        <SystemSchematic system={o.system_type} rooms={rooms} />
        <p className="mt-2 text-[0.68rem] leading-snug text-text-dim">
          Schematic only — zone shapes and duct/head positions are confirmed at the site assessment.
        </p>
      </details>

      <ul className="mt-5 flex list-disc flex-col gap-1 border-t border-ink-line pl-5 pt-4 text-xs leading-relaxed text-text-sec">
        {o.pros.map((pr) => <li key={pr}>{pr}</li>)}
      </ul>
    </div>
  )
}

// ── Indicative system-layout schematic (pure SVG, deterministic) ─────

const SCHEMATIC_MAX_ROOMS = 9

function SystemSchematic({ system, rooms }: { system: 'ducted' | 'split'; rooms: RoomLoad[] }) {
  const shown = rooms.slice(0, SCHEMATIC_MAX_ROOMS)
  const hidden = rooms.length - shown.length
  const labels = roomLabels(rooms).slice(0, SCHEMATIC_MAX_ROOMS)

  const cols = 3
  const roomW = 100
  const roomH = 64
  const gap = 10
  const topPad = system === 'ducted' ? 52 : 14
  const rows = Math.max(1, Math.ceil(shown.length / cols))
  const width = cols * roomW + (cols - 1) * gap + 8
  const height = topPad + rows * roomH + (rows - 1) * gap + (system === 'split' ? 44 : 12)

  const centre = { x: width / 2, y: 24 }
  const pos = (i: number) => ({
    x: 4 + (i % cols) * (roomW + gap),
    y: topPad + Math.floor(i / cols) * (roomH + gap),
  })

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" role="img" aria-label={`Indicative ${system} layout`}>
      {/* Ducted: central roof unit + duct runs */}
      {system === 'ducted' && (
        <>
          {shown.map((_, i) => {
            const p = pos(i)
            return (
              <line
                key={`duct-${i}`}
                x1={centre.x}
                y1={centre.y}
                x2={p.x + roomW / 2}
                y2={p.y + 12}
                className="stroke-accent/50"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )
          })}
          <rect x={centre.x - 34} y={centre.y - 14} width={68} height={28} className="fill-ink-deep stroke-accent" strokeWidth={1.5} />
          <text x={centre.x} y={centre.y + 4} textAnchor="middle" className="fill-accent" fontSize={10} fontFamily="monospace">
            ROOF UNIT
          </text>
        </>
      )}

      {/* Rooms */}
      {shown.map((room, i) => {
        const p = pos(i)
        return (
          <g key={`room-${i}`}>
            <rect x={p.x} y={p.y} width={roomW} height={roomH} className="fill-ink-deep stroke-ink-line" strokeWidth={1} />
            <text x={p.x + 8} y={p.y + 26} className="fill-text-sec" fontSize={11}>
              {labels[i]}
            </text>
            <text x={p.x + 8} y={p.y + 42} className="fill-text-dim" fontSize={9} fontFamily="monospace">
              {room.area_m2} m² · {room.kw} kW
            </text>
            {system === 'ducted' ? (
              // ceiling supply vent
              <circle cx={p.x + roomW / 2} cy={p.y + 12} r={4} className="fill-none stroke-accent" strokeWidth={1.5} />
            ) : (
              // wall-mounted indoor head
              <rect x={p.x + roomW - 34} y={p.y + 6} width={26} height={9} rx={2} className="fill-accent" />
            )}
          </g>
        )
      })}

      {/* Split: shared outdoor unit */}
      {system === 'split' && (
        <>
          <rect x={width - 84} y={height - 36} width={76} height={26} className="fill-ink-deep stroke-accent" strokeWidth={1.5} />
          <text x={width - 46} y={height - 19} textAnchor="middle" className="fill-accent" fontSize={9} fontFamily="monospace">
            OUTDOOR UNIT{rooms.length > 1 ? 'S' : ''}
          </text>
        </>
      )}

      {hidden > 0 && (
        <text x={4} y={height - 4} className="fill-text-dim" fontSize={9} fontFamily="monospace">
          +{hidden} more room{hidden === 1 ? '' : 's'} not drawn
        </text>
      )}
    </svg>
  )
}
