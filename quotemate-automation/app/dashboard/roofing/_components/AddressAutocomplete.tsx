'use client'

// ════════════════════════════════════════════════════════════════════
// /dashboard/roofing — address autocomplete (Geoscape Predictive API).
//
// Self-contained, debounced (250ms) type-ahead. Calls the
// /api/roofing/suggest-address proxy so the GEOSCAPE_API_KEY never
// touches the browser.
//
// Behaviour:
//   • <3 chars typed → no request
//   • 3+ chars       → debounce 250ms → request suggestions
//   • Results panel  → keyboard navigable (↑/↓/Enter/Esc)
//   • Picking a suggestion → onSelect(suggestion) and panel closes
//   • Provider failure → silent fallback (no toast), user can still
//     submit the address manually
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'

export type AddressSuggestion = {
  id: string
  address: string
  state: string | null
  postcode: string | null
}

type SuggestResponse =
  | { ok: true; suggestions: AddressSuggestion[] }
  | { ok: false; code: string; detail: string }
  | { ok: false; error: string }

type Props = {
  /** Bearer access token for the API route. */
  accessToken: string | null
  /** Current input value (controlled by the parent so the form state
   *  stays in one place). */
  value: string
  onChange: (v: string) => void
  onSelect: (s: AddressSuggestion) => void
  /** Optional state filter to scope suggestions. */
  state?: 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'
  placeholder?: string
  className?: string
}

export function AddressAutocomplete({
  accessToken,
  value,
  onChange,
  onSelect,
  state,
  placeholder = 'e.g. 27 Smith Street, Penrith',
  className,
}: Props) {
  const [items, setItems] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const reqRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const fetchSuggestions = useCallback(
    async (q: string) => {
      if (!accessToken) return
      if (q.trim().length < 3) {
        setItems([])
        return
      }
      reqRef.current?.abort()
      const ctrl = new AbortController()
      reqRef.current = ctrl
      setBusy(true)
      try {
        const res = await fetch('/api/roofing/suggest-address', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: q, state }),
        })
        const json = (await res.json()) as SuggestResponse
        if ('ok' in json && json.ok === true) {
          setItems(json.suggestions)
          setOpen(json.suggestions.length > 0)
          setActive(0)
        } else {
          setItems([])
        }
      } catch (e) {
        // AbortError → user typed more, ignore
        if (!(e instanceof Error && e.name === 'AbortError')) {
          setItems([])
        }
      } finally {
        setBusy(false)
      }
    },
    [accessToken, state],
  )

  // Debounced trigger on `value` change.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void fetchSuggestions(value)
    }, 250)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, fetchSuggestions])

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = useCallback(
    (s: AddressSuggestion) => {
      onSelect(s)
      setOpen(false)
    },
    [onSelect],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || items.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        pick(items[active])
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    },
    [open, items, active, pick],
  )

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
      />
      {busy && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
          …
        </span>
      )}
      {open && items.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto border border-ink-line bg-ink-card shadow-lg">
          {items.map((s, i) => (
            <li
              key={s.id}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-4 py-3 font-mono text-sm transition-colors ${
                i === active
                  ? 'bg-accent/15 text-text-pri'
                  : 'text-text-sec hover:bg-ink-line/40'
              }`}
            >
              <div>{s.address}</div>
              {(s.state || s.postcode) && (
                <div className="mt-0.5 text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                  {[s.state, s.postcode].filter(Boolean).join(' · ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
