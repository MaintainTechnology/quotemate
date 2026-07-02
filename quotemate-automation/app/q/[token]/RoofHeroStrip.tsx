'use client'

// /q/[token] — roofing-specific hero strip (Wave 3a).
//
// Only renders when the quote's intake is a roofing job. Shows:
//   • A Google Maps satellite snapshot of the property as the visual
//     hero — the customer instantly sees the same building the tradie
//     measured (matches the dual-map UX on the dashboard).
//   • The headline measurement stats: sloped area, roof form, hips,
//     valleys, storeys.
//   • The roofing-specific disclaimer mirroring industry tools like
//     Jobber: "AI estimate from aerial imagery — your final price is
//     locked after our on-site inspection." This is the lead-qual
//     framing that protects against under-quote liability.
//
// Maintain design system — orange accent, mono labels, square corners.

import { useEffect, useState } from 'react'

type Stats = {
  area_m2: number | null
  footprint_m2: number | null
  form: string | null
  material: string | null
  pitch: string | null
  hips: number | null
  valleys: number | null
  ridge_lm: number | null
  storeys: number | null
}

type Props = {
  /** Full street address — fed to the Google Maps Static proxy as
   *  `?address=...` so the same satellite the tradie saw renders here. */
  address: string
  /** Subtitle line (suburb, postcode) for the visual context. */
  suburb: string | null
  /** Public Supabase share token — required by the static-map proxy
   *  which is bearer-gated. The proxy on the customer-facing page is
   *  allowed because the token is unguessable; the static-map route
   *  resolves the share_token → tenant_id and confirms read access. */
  shareToken: string
  stats: Stats
}

export function RoofHeroStrip({ address, suburb, shareToken, stats }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams()
        params.set('address', address)
        params.set('zoom', '20')
        params.set('w', '640')
        params.set('h', '420')
        // Public share-token gates the request; the proxy server-side
        // resolves it to a tenant before calling Google.
        const res = await fetch(
          `/api/q/${encodeURIComponent(shareToken)}/static-map?${params.toString()}`,
        )
        if (cancelled) return
        if (!res.ok) {
          setError(`Map unavailable (HTTP ${res.status})`)
          return
        }
        const blob = await res.blob()
        if (cancelled) return
        setImgSrc(URL.createObjectURL(blob))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address, shareToken])

  useEffect(() => {
    return () => {
      if (imgSrc) URL.revokeObjectURL(imgSrc)
    }
  }, [imgSrc])

  return (
    <section className="mt-12 border border-ink-line bg-ink-card overflow-hidden">
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* Satellite image */}
        <div className="relative h-72 w-full bg-ink-deep md:h-96">
          {imgSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt={`Satellite view of ${address}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-mono text-sm text-text-dim">
                {error ?? 'Loading satellite view…'}
              </span>
            </div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 border border-ink-line bg-ink-deep/95 px-3 py-1.5 backdrop-blur">
            <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              Your roof, from above
            </span>
          </div>
        </div>

        {/* Stat strip + disclaimer */}
        <div className="p-6 sm:p-7 flex flex-col gap-5">
          <div>
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              Roof measurement
            </div>
            <div className="mt-1 font-mono text-sm text-text-sec">
              {address}
              {suburb ? <span className="block text-text-dim">{suburb}</span> : null}
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-4">
            <StatCell
              label="Sloped area"
              value={stats.area_m2 !== null ? `${stats.area_m2.toFixed(0)} m²` : '—'}
            />
            <StatCell
              label="Material"
              value={stats.material !== null ? titleCase(stats.material) : '—'}
            />
            <StatCell
              label="Roof form"
              value={stats.form !== null ? titleCase(stats.form) : '—'}
            />
            <StatCell
              label="Pitch"
              value={stats.pitch !== null ? titleCase(stats.pitch) : '—'}
            />
            <StatCell
              label="Hips · valleys"
              value={`${stats.hips ?? '—'} · ${stats.valleys ?? '—'}`}
            />
            <StatCell
              label="Ridge"
              value={stats.ridge_lm !== null ? `${stats.ridge_lm.toFixed(0)} lm` : '—'}
            />
            <StatCell
              label="Storeys"
              value={stats.storeys !== null ? String(stats.storeys) : '—'}
            />
            <StatCell
              label="Footprint"
              value={
                stats.footprint_m2 !== null ? `${stats.footprint_m2.toFixed(0)} m²` : '—'
              }
            />
          </ul>

          <div className="border border-ink-line border-l-4 border-l-accent bg-ink-deep px-4 py-3">
            <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-accent">
              AI estimate from aerial imagery
            </div>
            <p className="mt-1 text-sm leading-relaxed text-text-sec">
              The numbers below are calculated from satellite imagery and your
              declared roof material + pitch. Your final price is locked after
              our on-site inspection.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <li>
      <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-bold tabular-nums text-text-pri">
        {value}
      </div>
    </li>
  )
}

function titleCase(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
