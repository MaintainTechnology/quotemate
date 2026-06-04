'use client'

// Roofing Tier-2 — Street View front elevation on /dashboard/roofing/measure.
//
// A ground-level look at the property the top-down aerial can't give: storey
// height, access, scaffold / EWP need, powerlines, overhanging trees, gutter
// & fascia condition. DISPLAY-ONLY — never feeds the price.
//
// Renders a single image from the /api/roofing/street-view proxy (server-side
// key). The proxy returns 404 when no panorama exists at the address, which
// we surface as a clean "no street-level imagery" note rather than Google's
// grey placeholder. Mirrors GoogleStaticMap's blob+objectURL pattern.

import { useEffect, useState } from 'react'

export type StreetViewProps = {
  /** Bearer access token — the proxy gates on it. */
  accessToken: string | null
  /** Address text. Required (proxy geocodes it). */
  address?: string
  /** Map height in tailwind units. Default `h-112` to match the maps. */
  heightClass?: string
}

export function StreetView({ accessToken, address, heightClass = 'h-112' }: StreetViewProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'no_imagery' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    if (!address?.trim()) {
      setSrc(null)
      setState('idle')
      return
    }
    let cancelled = false
    setState('busy')
    setError(null)
    void (async () => {
      try {
        const params = new URLSearchParams({ address, w: '640', h: '400' })
        const res = await fetch(`/api/roofing/street-view?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (cancelled) return
        if (res.status === 404) {
          setSrc(null)
          setState('no_imagery')
          return
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          setError(`HTTP ${res.status}: ${body.slice(0, 160)}`)
          setSrc(null)
          setState('error')
          return
        }
        const blob = await res.blob()
        if (cancelled) return
        setSrc(URL.createObjectURL(blob))
        setState('idle')
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setState('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, address])

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src)
    }
  }, [src])

  return (
    <div className={`relative w-full ${heightClass} border border-ink-line bg-ink-card overflow-hidden`}>
      <div className="pointer-events-none absolute left-3 top-3 z-10 border border-ink-line bg-ink-deep/95 px-3 py-1.5 backdrop-blur">
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          Street view · access &amp; height
        </span>
      </div>

      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Street View of ${address ?? 'the property'}`}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-ink-card px-6">
          <p className="text-center font-mono text-sm text-text-dim">
            {!accessToken
              ? 'Sign in to load Street View'
              : state === 'busy'
                ? 'Loading Street View…'
                : state === 'no_imagery'
                  ? 'No street-level imagery at this address'
                  : state === 'error'
                    ? `Street View unavailable: ${error}`
                    : address?.trim()
                      ? 'Loading Street View…'
                      : 'Enter an address to load Street View'}
          </p>
        </div>
      )}
    </div>
  )
}
