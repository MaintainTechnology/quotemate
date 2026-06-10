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

const SUGGEST_DEBOUNCE_MS = 250
const SUGGEST_MIN_CHARS = 4

const inputClass =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 text-[0.95rem] text-text-pri ' +
  'placeholder:text-text-dim outline-none transition-colors ' +
  'focus:border-accent'

const labelClass =
  'font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text-dim'

export function SolarAddressForm({ tenantSlug }: { tenantSlug: string }) {
  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [stateCode, setStateCode] = useState<string>('NSW')
  const [manualOpen, setManualOpen] = useState(false)
  const [orientation, setOrientation] = useState<string>('north')
  const [roofSize, setRoofSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [storeys, setStoreys] = useState<1 | 2 | 3>(1)
  const [panelType, setPanelType] =
    useState<'standard_panels' | 'premium_panels' | 'unknown'>('standard_panels')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload = buildSolarFormPayload({
        address, postcode, state: stateCode, manualOpen,
        orientation, roofSize, storeys, panelType,
      })
      const res = await fetch(`/api/solar/${tenantSlug}/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setError(body?.error === 'engine_failed'
          ? 'We could not generate an estimate just now. Please try again shortly.'
          : 'Please check your address and try again.')
        setBusy(false)
        return
      }
      window.location.href = body.shareUrl as string
    } catch {
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
        <div className="flex flex-col gap-4 border-l-2 border-l-accent bg-ink/40 p-4" data-testid="solar-manual-block">
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
        className="mt-1 inline-flex items-center justify-center gap-2.5 bg-accent px-5 py-4 font-mono text-sm font-bold uppercase tracking-[0.14em] text-ink-deep transition-colors hover:bg-accent-press disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Reading your roof…
          </>
        ) : (
          <>
            Get my solar estimate
            <ArrowRight className="h-4 w-4" aria-hidden />
          </>
        )}
      </button>
    </form>
  )
}
