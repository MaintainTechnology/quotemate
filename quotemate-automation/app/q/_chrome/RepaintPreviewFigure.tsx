'use client'

// Before/after repaint block with a colour picker — shared by the tradie
// results page (/p/[token]) and the customer quote page (/q/paint/[token]).
//
// The "before" pane is the plain Street View photo; the "after" pane is the
// AI repaint served by /api/painting/q/[token]/after-image, which
// AUTO-generates on first load for a released quote (product decision
// 2026-07-11: no manual colour pick needed) and streams the Street View
// photo as a graceful fallback while a render is in flight. Picking a
// swatch POSTs {colour} (token-gated; the route enforces released + a
// single in-flight render) and then cache-busts the after <img>.

import { useState } from 'react'
import { PAINT_COLOUR_SWATCHES } from '@/lib/painting/colours'

type Props = {
  publicToken: string
  address: string | null
  /** Whether a cached render already exists (row.preview_status === 'ready').
   *  When false the first load auto-paints — the after pane fills in once
   *  the render lands (10–20 s). */
  initialReady: boolean
}

export function RepaintPreviewFigure({ publicToken, address, initialReady }: Props) {
  const [version, setVersion] = useState(0)
  // Flips once the after <img> settles — for an unrendered released row that
  // request IS the render, so this doubles as the "auto-painting" indicator.
  const [settled, setSettled] = useState(initialReady)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function repaint(colour: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/painting/q/${encodeURIComponent(publicToken)}/after-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colour }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!json?.ok) {
        setError(
          res.status === 409
            ? 'A preview is already being painted — try again shortly.'
            : `Could not repaint the preview (${json?.error ?? `HTTP ${res.status}`}).`,
        )
        return
      }
      setVersion(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const proxyBase = `/api/painting/q/${publicToken}`
  const figcaption =
    'border-t border-ink-line px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em]'

  return (
    <div className="border border-ink-line bg-ink-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink-line px-4 py-3">
        <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent">
          See it in a new colour
        </div>
        <div className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
          {busy
            ? 'Repainting… (10–20 s)'
            : settled
              ? 'AI visualisation — finish may vary'
              : 'Painting your AI preview…'}
        </div>
      </div>

      {/* Before/after pair — the property today beside the AI repaint. */}
      <div className="grid sm:grid-cols-2">
        <figure className="m-0 border-b border-ink-line sm:border-b-0 sm:border-r">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${proxyBase}/street-view`}
            alt={`${address ?? 'The property'} as it looks today`}
            loading="lazy"
            className="block w-full object-cover"
            style={{ aspectRatio: '4 / 3' }}
          />
          <figcaption className={`${figcaption} text-text-dim`}>
            Today · Google Street View
          </figcaption>
        </figure>
        <figure className="m-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${proxyBase}/after-image${version ? `?v=${version}` : ''}`}
            alt={`AI preview of ${address ?? 'the property'} freshly repainted`}
            onLoad={() => setSettled(true)}
            onError={() => setSettled(true)}
            className="block w-full object-cover"
            style={{ aspectRatio: '4 / 3', opacity: busy ? 0.4 : 1, transition: 'opacity 200ms' }}
          />
          <figcaption className={`${figcaption} text-accent`}>
            Fresh repaint · AI preview
          </figcaption>
        </figure>
      </div>

      {/* Colour settings — regenerates the after pane in the chosen colour. */}
      <div className="border-t border-ink-line px-4 py-3">
        <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
          Try a colour
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PAINT_COLOUR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              disabled={busy}
              onClick={() => void repaint(c)}
              className="cursor-pointer border border-ink-line px-2.5 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-text-sec transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {c}
            </button>
          ))}
        </div>
        {error ? <p className="mt-2 font-mono text-xs text-warning-bright">{error}</p> : null}
      </div>
    </div>
  )
}
