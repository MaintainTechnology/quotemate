'use client'

// Google Maps Static View — the "second eye" alongside the Esri/Geoscape
// map on /dashboard/roofing/measure. Renders a single PNG from the
// /api/roofing/static-map proxy (server-side fetch keeps the key
// off the browser).
//
// Props:
//   address — string to centre on. The proxy geocodes it server-side.
//   marker  — optional pin to overlay (the resolved building point).
//
// Visual: 4:3 image, dark border to match the Esri map, "GOOGLE
// SATELLITE" eyebrow label so users know which provider they're
// looking at.

import { useEffect, useState } from 'react'

export type GoogleStaticMapProps = {
  /** Bearer access token — the proxy gates on it. */
  accessToken: string | null
  /** Address text. Required (or center). */
  address?: string
  /** Marker to drop on the building. */
  marker?: { lat: number; lng: number; color?: string }
  /** Map height in tailwind units. Default `h-112` to match the Esri map. */
  heightClass?: string
}

export function GoogleStaticMap({
  accessToken,
  address,
  marker,
  heightClass = 'h-112',
}: GoogleStaticMapProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!accessToken) return
    if (!address?.trim()) {
      setSrc(null)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const params = new URLSearchParams()
        params.set('address', address)
        params.set('zoom', '20')
        params.set('w', '640')
        params.set('h', '480')
        if (marker) {
          params.set(
            'markers',
            `${marker.lat},${marker.lng},${marker.color ?? 'orange'}`,
          )
        }
        const res = await fetch(`/api/roofing/static-map?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (cancelled) return
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          setError(`HTTP ${res.status}: ${body.slice(0, 200)}`)
          setSrc(null)
          return
        }
        const blob = await res.blob()
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, address, marker?.lat, marker?.lng, marker?.color])

  // Revoke object URL on unmount / src change
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src)
    }
  }, [src])

  return (
    <div className={`relative w-full ${heightClass} border border-ink-line bg-ink-card overflow-hidden`}>
      {/* Top-left eyebrow */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 border border-ink-line bg-ink-deep/95 px-3 py-1.5 backdrop-blur">
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          Google satellite
        </span>
      </div>

      {/* The PNG */}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Google Maps satellite view of ${address ?? 'the property'}`}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-ink-card">
          <p className="text-center font-mono text-sm text-text-dim">
            {!accessToken
              ? 'Sign in to load the Google view'
              : busy
                ? 'Loading Google satellite…'
                : error
                  ? `Map unavailable: ${error}`
                  : address?.trim()
                    ? 'Loading map…'
                    : 'Enter an address to load the Google view'}
          </p>
        </div>
      )}
    </div>
  )
}
