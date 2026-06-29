'use client'

// Reusable address typeahead — a controlled text input that queries the
// public /api/solar/places proxy (server-side Google Places, AU-restricted)
// and renders a suggestion dropdown. Selecting a suggestion fills the field
// with the resolved formatted address. Best-effort: with no Places key / no
// results it behaves exactly like a plain text input, so nothing that uses it
// ever depends on the typeahead being available.
//
// Extracted from the Solar entry form's inline typeahead (SolarAddressForm)
// so other surfaces — the tradie onboarding "Business address" — get the same
// dynamic address behaviour from one component.

import { useEffect, useRef, useState } from 'react'
import type { AddressSuggestion, PlaceAddressDetails } from '@/lib/solar/places'

const DEBOUNCE_MS = 250
const MIN_CHARS = 4

type Props = {
  value: string
  onChange: (next: string) => void
  id?: string
  /** Instructional placeholder (NOT a fake value). Defaults to a typing hint. */
  placeholder?: string
  className?: string
  maxLength?: number
  'aria-label'?: string
}

export function AddressAutocomplete({
  value,
  onChange,
  id,
  placeholder = 'Start typing your address…',
  className,
  maxLength = 200,
  'aria-label': ariaLabel,
}: Props) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [busy, setBusy] = useState(false)
  // Set just before we programmatically set `value` (on select) so the
  // resulting effect run doesn't immediately re-query for the chosen address.
  const suppressRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Debounced suggestion fetch while typing.
  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false
      return
    }
    const q = value.trim()
    const tooShort = q.length < MIN_CHARS
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      if (tooShort) {
        setSuggestions([])
        setOpen(false)
        setBusy(false)
        return
      }
      const controller = new AbortController()
      abortRef.current = controller
      setBusy(true)
      try {
        const res = await fetch(`/api/solar/places?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        })
        const body = await res.json()
        if (controller.signal.aborted) return
        const list: AddressSuggestion[] = body?.ok ? (body.suggestions ?? []) : []
        setSuggestions(list)
        setOpen(list.length > 0)
        setHighlighted(-1)
      } catch {
        // Aborted or network miss — typeahead silently shows nothing.
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }, tooShort ? 0 : DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])

  // Close on outside click.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  async function select(s: AddressSuggestion) {
    suppressRef.current = true
    onChange(s.full_text || s.main_text)
    setOpen(false)
    setSuggestions([])
    try {
      const res = await fetch(`/api/solar/places?placeId=${encodeURIComponent(s.place_id)}`)
      const body = await res.json()
      if (body?.ok && body.details) {
        const d = body.details as PlaceAddressDetails
        const formatted =
          d.formatted_address ||
          [d.street_address, [d.state, d.postcode].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', ')
        if (formatted) {
          suppressRef.current = true
          onChange(formatted)
        }
      }
    } catch {
      // Details miss — keep the suggestion text.
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      void select(suggestions[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className={className}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
      />
      {busy && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim"
        >
          …
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="Address suggestions"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto border border-ink-line bg-ink-card"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.place_id}
              type="button"
              role="option"
              aria-selected={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => void select(s)}
              className={`flex w-full items-baseline gap-2 border-l-2 px-3.5 py-2.5 text-left transition-colors ${
                i === highlighted ? 'border-l-accent bg-ink-deep' : 'border-l-transparent'
              }`}
            >
              <span className="text-sm text-text-pri">{s.main_text}</span>
              <span className="truncate text-xs text-text-dim">{s.secondary_text}</span>
            </button>
          ))}
          <p className="border-t border-ink-line px-3.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
            Suggestions by Google
          </p>
        </div>
      )}
    </div>
  )
}
