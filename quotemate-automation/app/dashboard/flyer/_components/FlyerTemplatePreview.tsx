// On-brand SVG thumbnails for the Canva suggested-template gallery.
//
// No external images (those would hotlink / 404). Each variant is a stylised
// mini-flyer. Colours come from the live CSS design tokens (var(--accent) etc.)
// so the gallery tracks the brand automatically (currently yellow) and renders
// correctly in both the dark and light themes — no hardcoded hexes to drift.
// Presentational + deterministic — safe to render anywhere.

import type { FlyerTemplateLayout } from '@/lib/canva/templates'

// Semantic palette → live design tokens.
const CARD = 'var(--ink-card)' // flyer body
const LINE = 'var(--ink-line)' // borders / neutral blocks
const ON_A = 'var(--accent-ink)' // text/marks sitting ON an accent fill
const INK = 'var(--text-pri)' // high-contrast "printed" content (image / QR)
const SEC = 'var(--text-sec)' // body text lines
const DIM = 'var(--text-dim)' // captions / metadata

function line(x: number, y: number, w: number, opacity = 1, color = DIM) {
  return <rect x={x} y={y} width={w} height={2.4} rx={1.2} fill={color} opacity={opacity} />
}

export function FlyerTemplatePreview({
  layout,
  accent = 'accent',
}: {
  layout: FlyerTemplateLayout
  accent?: 'accent' | 'teal'
}) {
  const A = accent === 'teal' ? 'var(--teal-glow)' : 'var(--accent)'

  return (
    <svg
      viewBox="0 0 100 141"
      role="img"
      aria-hidden="true"
      className="block h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Flyer frame */}
      <rect x="0.5" y="0.5" width="99" height="140" fill={CARD} stroke={LINE} strokeWidth="1" />

      {layout === 'services' && (
        <>
          <rect x="0" y="0" width="100" height="26" fill={A} />
          {line(8, 9, 46, 1, ON_A)}
          {line(8, 15, 30, 0.7, ON_A)}
          {[44, 56, 68, 80].map((y) => (
            <g key={y}>
              <circle cx="11" cy={y + 1} r="2.2" fill={A} />
              {line(18, y, 60, 0.8, SEC)}
            </g>
          ))}
          <rect x="0" y="116" width="100" height="25" fill={A} opacity="0.12" />
          <rect x="8" y="122" width="44" height="12" fill={A} />
          <rect x="66" y="120" width="26" height="16" fill={INK} />
          <rect x="69" y="123" width="20" height="10" fill={CARD} />
        </>
      )}

      {layout === 'promo' && (
        <>
          <rect x="0" y="0" width="100" height="100" fill={A} opacity="0.14" />
          <circle cx="50" cy="44" r="26" fill={A} />
          {line(34, 40, 32, 1, ON_A)}
          {line(40, 48, 20, 0.8, ON_A)}
          {line(20, 86, 60, 0.8, SEC)}
          {line(28, 94, 44, 0.6, DIM)}
          <rect x="22" y="112" width="56" height="14" fill={A} />
          {line(34, 118, 32, 1, ON_A)}
        </>
      )}

      {layout === 'beforeafter' && (
        <>
          <rect x="0" y="0" width="49.5" height="78" fill={LINE} />
          <rect x="50.5" y="0" width="49.5" height="78" fill={A} opacity="0.5" />
          <rect x="49" y="0" width="2" height="78" fill={A} />
          {line(8, 88, 40, 0.8, DIM)}
          {line(56, 88, 36, 0.8, DIM)}
          {line(8, 104, 84, 0.8, SEC)}
          {line(8, 112, 70, 0.6, DIM)}
          <rect x="8" y="124" width="50" height="10" fill={A} />
        </>
      )}

      {layout === 'contact' && (
        <>
          <circle cx="50" cy="30" r="16" fill={A} opacity="0.85" />
          {line(28, 54, 44, 1, INK)}
          {line(36, 62, 28, 0.7, SEC)}
          <rect x="20" y="74" width="60" height="9" fill={A} opacity="0.18" />
          {line(28, 77, 44, 0.9, A)}
          <rect x="34" y="92" width="32" height="32" fill={INK} />
          <rect x="38" y="96" width="24" height="24" fill={CARD} />
          {line(30, 130, 40, 0.6, DIM)}
        </>
      )}

      {layout === 'seasonal' && (
        <>
          <rect x="0" y="0" width="100" height="60" fill={A} opacity="0.5" />
          <circle cx="74" cy="20" r="10" fill={ON_A} opacity="0.65" />
          <rect x="0" y="56" width="100" height="8" fill={A} />
          {line(10, 74, 64, 1, INK)}
          {line(10, 82, 48, 0.7, SEC)}
          {line(10, 98, 80, 0.7, DIM)}
          {line(10, 106, 64, 0.6, DIM)}
          <rect x="10" y="120" width="52" height="13" fill={A} />
          <rect x="72" y="118" width="20" height="17" fill={INK} />
        </>
      )}

      {layout === 'hiring' && (
        <>
          <rect x="0" y="14" width="100" height="22" fill={A} />
          {line(10, 22, 58, 1, ON_A)}
          {[52, 64, 76, 88].map((y) => (
            <g key={y}>
              <rect x="10" y={y - 1} width="4" height="4" fill={A} />
              {line(18, y, 56, 0.8, SEC)}
            </g>
          ))}
          <rect x="10" y="112" width="80" height="16" fill={A} opacity="0.16" />
          <rect x="10" y="112" width="46" height="16" fill={A} />
          {line(18, 119, 30, 1, ON_A)}
        </>
      )}
    </svg>
  )
}
