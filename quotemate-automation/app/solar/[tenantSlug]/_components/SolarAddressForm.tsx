'use client'

// Solar entry form — address typeahead + auto-fill.
//
// Typing in the street-address field queries /api/solar/places (a
// server-side Google Places proxy, AU-restricted) and renders a
// suggestion dropdown. Selecting a suggestion fetches the place details
// and auto-fills the street line, postcode and state. The typeahead is
// best-effort: with no key / no results the form behaves exactly like a
// plain text input, so the quote path never depends on it.

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2, MapPin } from 'lucide-react'
import { buildSolarFormPayload } from '@/lib/solar/form-payload'
import type { AddressSuggestion, PlaceAddressDetails } from '@/lib/solar/places'
import type { DetectedBuilding, LatLng } from '@/lib/solar/types'
import { SolarRoofMap } from './SolarRoofMap'

const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const
const ORIENTATIONS = [
  'north', 'north_east', 'east', 'south_east',
  'south', 'south_west', 'west', 'north_west', 'flat', 'unknown',
] as const

const PANEL_GRADES = [
  { value: 'standard_panels', label: 'Standard' },
  { value: 'premium_panels', label: 'Premium' },
  { value: 'unknown', label: 'Not sure' },
] as const

// Property electrical supply phase (design 2026-06-16). "Not sure" is the
// default and uses a single-phase-safe export cap until confirmed.
const POWER_PHASES = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'single', label: 'Single-phase' },
  { value: 'three', label: '3-phase' },
] as const

/** Quick-pick preferred-size chips, kW. The free-type input still accepts any
 *  value — these are just one tap for the common system sizes. */
const SIZE_CHIPS = [6, 10, 14] as const

const SUGGEST_DEBOUNCE_MS = 250
const SUGGEST_MIN_CHARS = 4

/** Rotating submit-progress copy — the engine really does these steps. */
const BUSY_STEPS = [
  'Reading your roof…',
  'Measuring panel area…',
  'Checking sun exposure…',
  'Pricing your system…',
] as const
const BUSY_STEP_MS = 2600

const inputClass =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 text-[0.95rem] text-text-pri ' +
  'placeholder:text-text-dim outline-none transition-colors ' +
  'focus:border-accent'

const labelClass =
  'font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text-dim'

export function SolarAddressForm({
  tenantSlug,
  variant = 'instant',
}: {
  tenantSlug: string
  /** Quote layout variant (Felt tab spec 2026-06-13). The form UX is
   *  byte-identical either way — the variant only rides the POST body. */
  variant?: 'instant' | 'felt'
}) {
  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [stateCode, setStateCode] = useState<string>('NSW')
  const [manualOpen, setManualOpen] = useState(false)
  const [orientation, setOrientation] = useState<string>('north')
  const [roofSize, setRoofSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [storeys, setStoreys] = useState<1 | 2 | 3>(1)
  const [panelType, setPanelType] =
    useState<'standard_panels' | 'premium_panels' | 'unknown'>('standard_panels')
  // Power-supply phase — drives the export ceiling (3-phase = larger system).
  const [phase, setPhase] = useState<'single' | 'three' | 'unknown'>('unknown')
  // Preferred system size, kW — free-type text; a quick-pick chip just fills
  // it. Blank = no preference (tiers anchor to the roof max).
  const [requestedSizeKw, setRequestedSizeKw] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerMobile, setCustomerMobile] = useState('')
  const [quarterlyBill, setQuarterlyBill] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyStep, setBusyStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // ── Multi-roof building picker (2026-06-16). After the customer fills an
  // address, POST /detect; with ≥2 structures we render a local-mode picker
  // so they pick which roof. The chosen building rides the estimate POST.
  const [buildings, setBuildings] = useState<DetectedBuilding[]>([])
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const [detectBusy, setDetectBusy] = useState(false)
  // Map centre for the ALWAYS-ON picker: the geocoded address from /detect,
  // or the mean building centroid as a fallback. The satellite map renders
  // whenever this is set (even with 0–1 detected buildings). `freePick` is a
  // roof the customer tapped that Geoscape did not outline.
  const [mapCenter, setMapCenter] = useState<LatLng | null>(null)
  const [freePick, setFreePick] = useState<LatLng | null>(null)

  // While submitting, walk the progress copy through the engine's real
  // stages so the wait reads as work, not a stall. The step counter is
  // reset in onSubmit (not here) — all setState happens inside the timer
  // callback (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => {
      setBusyStep((i) => Math.min(i + 1, BUSY_STEPS.length - 1))
    }, BUSY_STEP_MS)
    return () => clearInterval(timer)
  }, [busy])

  // ── Typeahead state ─────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [autoFilled, setAutoFilled] = useState(false)
  const suppressSuggestRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Debounced suggestion fetch while typing. All state updates happen
  // inside the timer callback (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (suppressSuggestRef.current) {
      suppressSuggestRef.current = false
      return
    }
    const query = address.trim()
    const tooShort = query.length < SUGGEST_MIN_CHARS
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      if (tooShort) {
        setSuggestions([])
        setDropdownOpen(false)
        setSuggestBusy(false)
        return
      }
      const controller = new AbortController()
      abortRef.current = controller
      setSuggestBusy(true)
      try {
        const res = await fetch(
          `/api/solar/places?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        )
        const body = await res.json()
        if (controller.signal.aborted) return
        const list: AddressSuggestion[] = body?.ok ? (body.suggestions ?? []) : []
        setSuggestions(list)
        setDropdownOpen(list.length > 0)
        setHighlighted(-1)
      } catch {
        // Aborted or network miss — typeahead silently shows nothing.
      } finally {
        if (!controller.signal.aborted) setSuggestBusy(false)
      }
    }, tooShort ? 0 : SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [address])

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  async function selectSuggestion(s: AddressSuggestion) {
    suppressSuggestRef.current = true
    setAddress(s.main_text || s.full_text)
    setDropdownOpen(false)
    setSuggestions([])
    setSuggestBusy(true)
    try {
      const res = await fetch(
        `/api/solar/places?placeId=${encodeURIComponent(s.place_id)}`,
      )
      const body = await res.json()
      if (body?.ok && body.details) {
        const d = body.details as PlaceAddressDetails
        suppressSuggestRef.current = true
        if (d.street_address) setAddress(d.street_address)
        if (d.postcode) setPostcode(d.postcode)
        if (d.state) setStateCode(d.state)
        setAutoFilled(Boolean(d.postcode || d.state))
        // Auto-reveal the roof map once we have a full address — no extra
        // click. Pass the resolved values directly (state setters are async).
        if (d.street_address && d.postcode && d.state) {
          void detectBuildings({ address: d.street_address, postcode: d.postcode, state: d.state })
        }
      }
    } catch {
      // Details miss — keep the suggestion text; customer fills the rest.
    } finally {
      setSuggestBusy(false)
    }
  }

  function onAddressKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      void selectSuggestion(suggestions[highlighted])
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
    }
  }

  // ── Detect buildings on the entered address (best-effort). Triggered on
  // blur of the address field and by the "Find my roof" button. ≥2
  // structures → render the local picker; otherwise stay on today's flow.
  async function detectBuildings(override?: { address: string; postcode: string; state: string }) {
    const addr = (override?.address ?? address).trim()
    const pc = (override?.postcode ?? postcode).trim()
    const st = override?.state ?? stateCode
    if (addr.length < 3 || pc.length < 3) return
    setDetectBusy(true)
    try {
      const res = await fetch(`/api/solar/${tenantSlug}/detect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: { address: addr, postcode: pc, state: st } }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        buildings?: DetectedBuilding[]
        center?: LatLng | null
      }
      const list = body?.ok ? (body.buildings ?? []) : []
      setBuildings(list)
      // Default the selection to the primary structure (or the first).
      const primary = list.find((b) => b.role === 'primary') ?? list[0] ?? null
      setSelectedBuildingId(primary ? primary.building_id : null)
      setFreePick(null)
      // Always show the map when we have a centre — geocoded address, else a
      // detected building's centroid. Null only when both are unavailable.
      setMapCenter(body?.center ?? buildingsCentroid(list))
    } catch {
      // Detection is pure enrichment — a miss just hides the picker.
      setBuildings([])
      setSelectedBuildingId(null)
      setMapCenter(null)
      setFreePick(null)
    } finally {
      setDetectBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setBusyStep(0)
    setError(null)
    try {
      // Carry the picked roof so the engine targets it: a free-tapped point
      // wins, else the highlighted detected building (if any), else nothing
      // (the engine resolves the address as before).
      const chosenBuilding = selectedBuildingId
        ? buildings.find((b) => b.building_id === selectedBuildingId) ?? null
        : null
      const targetBuilding = freePick
        ? { building_id: 'custom', centroid: freePick }
        : chosenBuilding
          ? { building_id: chosenBuilding.building_id, centroid: chosenBuilding.centroid }
          : null
      const payload = buildSolarFormPayload({
        address, postcode, state: stateCode, manualOpen,
        orientation, roofSize, storeys, panelType,
        phase, requestedSizeKw,
        customerName, customerMobile, quarterlyBill,
        variant,
        targetBuilding,
      })
      const res = await fetch(`/api/solar/${tenantSlug}/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) {
        // Log the real cause so a misclassified failure (the pilot's "40 kW →
        // check your address" report) is diagnosable from the browser console
        // and can be relayed to us — the on-screen copy stays friendly.
        console.warn('[solar/estimate] failed', {
          status: res.status,
          error: body?.error,
          detail: body?.detail,
          issues: body?.issues,
        })
        setError(messageForError(body?.error))
        setBusy(false)
        return
      }
      window.location.href = body.shareUrl as string
    } catch (e) {
      console.warn('[solar/estimate] network error', e)
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="solar-address-form">
      {/* ── Street address + typeahead ─────────────────────────── */}
      <div ref={boxRef} className="relative flex flex-col gap-1.5">
        <label htmlFor="solar-address-input" className={labelClass}>
          Street address
        </label>
        <div className="relative">
          <MapPin
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim"
            aria-hidden
          />
          <input
            id="solar-address-input"
            data-testid="solar-address"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              setAutoFilled(false)
            }}
            onKeyDown={onAddressKeyDown}
            onFocus={() => suggestions.length > 0 && setDropdownOpen(true)}
            onBlur={() => void detectBuildings()}
            required
            minLength={3}
            placeholder="Start typing your address…"
            autoComplete="off"
            role="combobox"
            aria-expanded={dropdownOpen}
            aria-controls="solar-address-suggestions"
            aria-autocomplete="list"
            className={`${inputClass} pl-11 pr-10`}
          />
          {suggestBusy && (
            <Loader2
              className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-accent"
              aria-hidden
            />
          )}
        </div>

        {dropdownOpen && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 border border-ink-line bg-ink-card">
            <div
              id="solar-address-suggestions"
              data-testid="solar-suggestions"
              role="listbox"
              aria-label="Address suggestions"
              className="max-h-72 overflow-auto"
            >
              {suggestions.map((s, i) => (
                <button
                  key={s.place_id}
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  data-testid={`solar-suggestion-${i}`}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => void selectSuggestion(s)}
                  className={`flex w-full items-baseline gap-2 border-l-2 px-4 py-3 text-left transition-colors ${
                    i === highlighted
                      ? 'border-l-accent bg-ink'
                      : 'border-l-transparent'
                  }`}
                >
                  <span className="text-sm text-text-pri">{s.main_text}</span>
                  <span className="truncate text-xs text-text-dim">{s.secondary_text}</span>
                </button>
              ))}
            </div>
            <p className="border-t border-ink-line px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
              Suggestions by Google
            </p>
          </div>
        )}
      </div>

      {/* ── Postcode + state (auto-filled from the suggestion) ──── */}
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="solar-postcode-input" className={labelClass}>
            Postcode
            {autoFilled && (
              <span className="ml-2 normal-case tracking-normal text-accent" data-testid="solar-autofilled">
                · auto-filled
              </span>
            )}
          </label>
          <input
            id="solar-postcode-input"
            data-testid="solar-postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            required
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            title="Australian postcodes are 4 digits"
            placeholder="0000"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="solar-state-input" className={labelClass}>State</label>
          <select
            id="solar-state-input"
            data-testid="solar-state"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
            className={`${inputClass} min-w-24 appearance-none`}
          >
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* ── Roof picker (2026-06-16). "Show my roof" (or blurring the address)
          drops a live satellite map under the address. Detected buildings are
          outlined; the customer taps one — or free-taps ANY roof on the image
          (a shed Geoscape missed) — and that roof is what gets estimated. */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          data-testid="solar-detect"
          onClick={() => void detectBuildings()}
          disabled={detectBusy || address.trim().length < 3 || postcode.trim().length < 3}
          className="self-start inline-flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-soft disabled:opacity-50"
        >
          {detectBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <MapPin className="h-3.5 w-3.5" aria-hidden />}
          {detectBusy ? 'Finding your roof…' : mapCenter ? 'Refresh map' : 'Show my roof'}
        </button>

        {mapCenter && (
          <div data-testid="solar-building-picker">
            <SolarRoofMap
              center={mapCenter}
              buildings={buildings}
              selectedBuildingId={freePick ? null : selectedBuildingId}
              freePick={freePick}
              onSelectBuilding={(id) => { setSelectedBuildingId(id); setFreePick(null) }}
              onFreePick={(c) => { setFreePick(c); setSelectedBuildingId(null) }}
            />
          </div>
        )}
      </div>

      {/* ── Optional contact — opt in to get the quote texted ──── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="solar-name-input" className={labelClass}>
            Your name <span className="normal-case tracking-normal text-text-dim">· optional</span>
          </label>
          <input
            id="solar-name-input"
            data-testid="solar-name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            maxLength={120}
            autoComplete="name"
            placeholder="First name"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="solar-mobile-input" className={labelClass}>
            Mobile <span className="normal-case tracking-normal text-text-dim">· to get it texted</span>
          </label>
          <input
            id="solar-mobile-input"
            data-testid="solar-mobile"
            value={customerMobile}
            onChange={(e) => setCustomerMobile(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="04xx xxx xxx"
            className={inputClass}
          />
        </div>
      </div>

      {/* ── Optional quarterly bill — personalises the savings maths ── */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="solar-bill-input" className={labelClass}>
          Quarterly power bill{' '}
          <span className="normal-case tracking-normal text-text-dim">
            · optional — personalises your savings
          </span>
        </label>
        <div className="relative">
          <span
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-dim"
            aria-hidden
          >
            $
          </span>
          <input
            id="solar-bill-input"
            data-testid="solar-bill"
            value={quarterlyBill}
            onChange={(e) => setQuarterlyBill(e.target.value)}
            inputMode="decimal"
            maxLength={8}
            placeholder="850"
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      {/* ── Panel grade — segmented control ────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Panel grade</span>
        <div className="grid grid-cols-3 border border-ink-line" role="radiogroup" aria-label="Panel grade">
          {PANEL_GRADES.map((g, i) => (
            <button
              key={g.value}
              type="button"
              role="radio"
              aria-checked={panelType === g.value}
              onClick={() => setPanelType(g.value)}
              className={`px-3 py-3 text-sm font-semibold transition-colors ${
                i > 0 ? 'border-l border-ink-line' : ''
              } ${
                panelType === g.value
                  ? 'bg-accent text-ink-deep'
                  : 'bg-ink-deep text-text-sec hover:text-text-pri'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Power supply — drives the export ceiling (3-phase = bigger) ── */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Power supply</span>
        <div
          className="grid grid-cols-3 border border-ink-line"
          role="radiogroup"
          aria-label="Power supply phase"
        >
          {POWER_PHASES.map((p, i) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              data-testid={`solar-phase-${p.value}`}
              aria-checked={phase === p.value}
              onClick={() => setPhase(p.value)}
              className={`px-3 py-3 text-sm font-semibold transition-colors ${
                i > 0 ? 'border-l border-ink-line' : ''
              } ${
                phase === p.value
                  ? 'bg-accent text-ink-deep'
                  : 'bg-ink-deep text-text-sec hover:text-text-pri'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
          Not sure flags larger systems for installer confirmation.
          3-phase allows a larger system.
        </p>
      </div>

      {/* ── Preferred size — quick-pick chips + free-type kW (optional) ── */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="solar-size-input" className={labelClass}>
          Preferred size{' '}
          <span className="normal-case tracking-normal text-text-dim">
            · optional
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {SIZE_CHIPS.map((kw) => {
            const selected = requestedSizeKw.trim() === String(kw)
            return (
              <button
                key={kw}
                type="button"
                data-testid={`solar-size-chip-${kw}`}
                aria-pressed={selected}
                onClick={() =>
                  setRequestedSizeKw((prev) =>
                    prev.trim() === String(kw) ? '' : String(kw),
                  )
                }
                className={`border px-3 py-2 text-sm font-semibold transition-colors ${
                  selected
                    ? 'border-accent bg-accent text-ink-deep'
                    : 'border-ink-line bg-ink-deep text-text-sec hover:text-text-pri'
                }`}
              >
                {kw} kW
              </button>
            )
          })}
          <div className="relative min-w-28 flex-1">
            <input
              id="solar-size-input"
              data-testid="solar-size"
              value={requestedSizeKw}
              onChange={(e) => setRequestedSizeKw(e.target.value)}
              inputMode="decimal"
              maxLength={6}
              placeholder="or type kW"
              aria-label="Preferred system size in kilowatts"
              className={`${inputClass} pr-10`}
            />
            <span
              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-dim"
              aria-hidden
            >
              kW
            </span>
          </div>
        </div>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
          We target this size, then cap it by roof area, power supply, and
          network export limits.
        </p>
      </div>

      {/* ── Manual roof fallback ───────────────────────────────── */}
      <button
        type="button"
        data-testid="solar-manual-toggle"
        onClick={() => setManualOpen((v) => !v)}
        className="self-start font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-soft"
      >
        {manualOpen ? '− Hide manual roof details' : "+ Can't find your roof? Add details"}
      </button>

      {manualOpen && (
        <div
          className="flex flex-col gap-4 border-l-2 border-l-accent bg-ink/40 p-4 motion-safe:animate-[fade-up_200ms_ease-out_both]"
          data-testid="solar-manual-block"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="solar-orientation-input" className={labelClass}>
              Main roof direction
            </label>
            <select
              id="solar-orientation-input"
              data-testid="solar-orientation"
              value={orientation}
              onChange={(e) => setOrientation(e.target.value)}
              className={inputClass}
            >
              {ORIENTATIONS.map((o) => (
                <option key={o} value={o}>{o.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="solar-roof-size-input" className={labelClass}>Roof size</label>
            <select
              id="solar-roof-size-input"
              value={roofSize}
              onChange={(e) => setRoofSize(e.target.value as typeof roofSize)}
              className={inputClass}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={labelClass}>Storeys</span>
            <div className="grid grid-cols-3 border border-ink-line" role="radiogroup" aria-label="Storeys">
              {([1, 2, 3] as const).map((n, i) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={storeys === n}
                  onClick={() => setStoreys(n)}
                  className={`px-3 py-2.5 font-mono text-sm font-bold transition-colors ${
                    i > 0 ? 'border-l border-ink-line' : ''
                  } ${
                    storeys === n
                      ? 'bg-accent text-ink-deep'
                      : 'bg-ink-deep text-text-sec hover:text-text-pri'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p
          className="border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
          data-testid="solar-error"
        >
          {error}
        </p>
      )}

      {/* ── Submit ─────────────────────────────────────────────── */}
      <button
        type="submit"
        data-testid="solar-submit"
        disabled={busy}
        className="group mt-1 inline-flex items-center justify-center gap-2.5 bg-accent px-5 py-4 font-mono text-sm font-bold uppercase tracking-[0.14em] text-ink-deep transition-colors hover:bg-accent-press active:bg-accent-press disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span aria-live="polite">{BUSY_STEPS[busyStep]}</span>
          </>
        ) : (
          <>
            Get my solar estimate
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
              aria-hidden
            />
          </>
        )}
      </button>
    </form>
  )
}

/** Map a server error code to friendly copy. Distinguishes a genuine address
 *  problem from an engine/save failure, so a transient server error is no
 *  longer mislabelled "check your address" (the pilot's confusing 40 kW
 *  report). Unknown codes fall back to a neutral retry message. */
function messageForError(code: unknown): string {
  switch (code) {
    case 'engine_failed':
      return 'We could not generate an estimate just now. Please try again shortly.'
    case 'invalid_request':
    case 'invalid_json':
      return 'Some details look invalid — please check the form and try again.'
    case 'intake_insert_failed':
    case 'estimate_insert_failed':
    case 'quote_insert_failed':
      return 'We could not save your estimate just now. Please try again shortly.'
    case 'tenant_not_found':
      return 'This solar link is not active. Please contact the installer.'
    default:
      return 'Something went wrong generating your estimate. Please try again.'
  }
}

/** Mean of every detected building's centroid — the centre the detect
 *  preview map is rendered at (and the picker projects against), so all
 *  structures sit on one image. Null when nothing has a finite centroid. */
function buildingsCentroid(
  buildings: DetectedBuilding[],
): { lat: number; lng: number } | null {
  let latSum = 0
  let lngSum = 0
  let n = 0
  for (const b of buildings) {
    const { lat, lng } = b.centroid
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      latSum += lat
      lngSum += lng
      n += 1
    }
  }
  return n > 0 ? { lat: latSum / n, lng: lngSum / n } : null
}
