// Shared QuoteMax brand mark — a quote/approval speech bubble with a tick,
// on the Maintain accent tile. Single source of truth for the in-app logo so
// every header matches the favicon (app/icon.svg) and the social card
// (app/opengraph-image.png). The bubble uses var(--accent-ink) so it reads as
// the dark command-centre ink on the accent tile in both themes; the tick is
// var(--accent) so the brand colour pops inside the bubble.
//
// The glyph coordinates below are drawn on a 64×64 canvas with the padding
// baked in (so the inner SVG fills the tile) — this keeps it pixel-identical
// to app/icon.svg and the OG card, which reuse the same coordinates.
// Server-safe (no hooks); size the accent tile via `className` (defaults h-10 w-10 ≈ 40px).
export function BrandMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-accent ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <rect x="13" y="14" width="38" height="26" rx="7" fill="var(--accent-ink)" />
        <path d="M20 39 L20 50 L31 40 Z" fill="var(--accent-ink)" />
        <path
          d="M23 27 L29.5 33.5 L41 21"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export default BrandMark
