'use client'

// The interactive 3D house section on the roofing thank-you page.
//
// Owns the customer's choices (roof colour, wall colour, roof material) and
// feeds them to three consumers: the 3D viewer, the two studio renders, and
// the share link.
//
// WHY COLOUR IS 3D AND MATERIAL IS 2D:
// The GLB is a single fused Tripo mesh with baked photographic texture. Colour
// can be tinted live per surface-normal class (free, instant). Material cannot
// — swapping Trimdek for tile is a texture and profile change, which on a
// baked mesh needs a paid re-texture task. So material switches the
// pre-rendered studio images instead, which are generated ahead of time. No
// interaction here ever triggers an AI call or costs money.
//
// The prices are unaffected by anything in this section, and it says so.

import { useMemo, useState } from 'react'
import {
  ROOF_COLOUR_SWATCHES,
  WALL_COLOUR_SWATCHES,
  SHOWCASE_MATERIALS,
  buildShareUrl,
  type Swatch,
} from '@/lib/roofing/showcase'
import type { RoofMaterial } from '@/lib/roofing/types'
import { HouseViewer } from './HouseViewer'
import { ShareHouse } from './ShareHouse'

type Props = {
  token: string
  appUrl: string
  modelUrl: string | null
  /** The two synthesised studio renders the model was reconstructed from. */
  images: { front: string | null; back: string | null }
  /** Per-material studio renders where they have been pre-generated:
   *  material -> { front, back }. Missing materials fall back to `images`. */
  materialImages?: Partial<Record<RoofMaterial, { front: string | null; back: string | null }>>
  /** The material actually quoted — the starting state. */
  material: RoofMaterial
  materialLabels: Record<string, string>
}

const EYEBROW: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 9.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--text-dim)',
}

function SwatchRow({
  label,
  swatches,
  selected,
  onSelect,
}: {
  label: string
  swatches: readonly Swatch[]
  selected: Swatch
  onSelect: (s: Swatch) => void
}) {
  return (
    <div>
      <div style={EYEBROW}>
        {label} · <span style={{ color: 'var(--text-sec)' }}>{selected.name}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}
      >
        {swatches.map((s) => {
          const on = s.slug === selected.slug
          return (
            <button
              key={s.slug}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={s.name}
              title={s.name}
              onClick={() => onSelect(s)}
              style={{
                width: 40,
                height: 40,
                minWidth: 40,
                background: s.hex,
                // The selected swatch reads by the accent ring, not a tick —
                // a glyph over an arbitrary colour can fail contrast.
                border: on ? '2px solid var(--accent)' : '1px solid var(--ink-line)',
                outlineOffset: 2,
                cursor: 'pointer',
                padding: 0,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

export function HouseShowcase({
  token,
  appUrl,
  modelUrl,
  images,
  materialImages,
  material,
  materialLabels,
}: Props) {
  const [roof, setRoof] = useState<Swatch>(ROOF_COLOUR_SWATCHES[0])
  const [wall, setWall] = useState<Swatch>(WALL_COLOUR_SWATCHES[0])
  const [mat, setMat] = useState<RoofMaterial>(material)

  // Per-material renders where they exist; otherwise the originals, so the
  // selector never blanks the images out.
  const shown = materialImages?.[mat] ?? images

  const shareUrl = useMemo(
    () => buildShareUrl(appUrl, token, { roof: roof.slug, wall: wall.slug, material: mat }),
    [appUrl, token, roof.slug, wall.slug, mat],
  )

  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <p style={{ margin: 0, maxWidth: '60ch', fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
        This is your place, rebuilt in 3D from the aerial survey. Spin it around
        and try some colours — it&apos;s just for fun, and none of it changes
        your price.
      </p>

      {modelUrl ? (
        <HouseViewer
          modelUrl={modelUrl}
          roofHex={roof.hex}
          wallHex={wall.hex}
          posterUrl={shown.front ?? images.front}
          label="3D model of your house"
        />
      ) : null}

      <div style={{ display: 'grid', gap: 16 }}>
        <SwatchRow label="Roof colour" swatches={ROOF_COLOUR_SWATCHES} selected={roof} onSelect={setRoof} />
        <SwatchRow label="House colour" swatches={WALL_COLOUR_SWATCHES} selected={wall} onSelect={setWall} />
      </div>

      {shown.front || shown.back ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={EYEBROW}>
            Roof material ·{' '}
            <span style={{ color: 'var(--text-sec)' }}>{materialLabels[mat] ?? mat}</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SHOWCASE_MATERIALS.map((m) => {
              const on = m === mat
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMat(m)}
                  style={{
                    border: on ? '1px solid var(--accent)' : '1px solid var(--ink-line)',
                    background: on ? 'var(--accent)' : 'var(--ink-card)',
                    color: on ? 'var(--accent-ink)' : 'var(--text-sec)',
                    padding: '9px 13px',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    minHeight: 40,
                  }}
                >
                  {materialLabels[m] ?? m}
                </button>
              )
            })}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            }}
          >
            {(['front', 'back'] as const).map((view) =>
              shown[view] ? (
                <figure key={view} style={{ margin: 0, border: '1px solid var(--ink-line)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shown[view]!}
                    alt={`${view === 'front' ? 'Front' : 'Rear'} view of your house`}
                    style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }}
                  />
                  <figcaption style={{ ...EYEBROW, padding: '8px 12px', borderTop: '1px solid var(--ink-line)' }}>
                    {view === 'front' ? 'Front' : 'Rear'}
                  </figcaption>
                </figure>
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      <ShareHouse shareUrl={shareUrl} />
    </div>
  )
}
