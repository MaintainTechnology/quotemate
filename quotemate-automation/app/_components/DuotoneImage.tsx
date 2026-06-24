// Brand-tinted duotone photo treatment for the marketing home page.
//
// Stock trade photography would read as "dropped-in" on the Maintain
// canvas, so every photo passes through a consistent duotone: the image
// is desaturated and warmed toward the brand (warm-charcoal mid-tones),
// then an accent-yellow gradient scrim lifts the highlights and welds the
// photo to the cream light-theme background. The treatment is tuned for
// the LIGHT theme (the primary target per the spec) with a lighter key;
// a dark-theme variant keeps it legible when the toggle flips.
//
// Server-safe (no hooks) so it can render inside the page.tsx server
// component. Uses next/image `fill`, so the parent must size the frame —
// we do that here via an aspect-ratio box. Next 16 deprecated `priority`
// in favour of `preload`; we expose a `priority` prop and map it through.

import Image from "next/image"

type DuotoneImageProps = {
  src: string
  alt: string
  /** Tailwind aspect-ratio utility for the frame, e.g. "aspect-[4/5]". */
  aspect?: string
  /** Responsive sizes hint passed to next/image (avoids over-fetching). */
  sizes?: string
  /** Hero/LCP image only — preloads in <head> (Next 16 `preload`). */
  priority?: boolean
  /** Strength of the duotone — "card" (default) or "hero" (a touch lighter). */
  tone?: "card" | "hero"
  /** Extra classes for the outer frame (rounding, borders, shadow). */
  className?: string
  /** object-position for the cropped fill, e.g. "center 30%". */
  position?: string
}

export function DuotoneImage({
  src,
  alt,
  aspect = "aspect-[4/5]",
  sizes = "(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw",
  priority = false,
  tone = "card",
  className = "",
  position,
}: DuotoneImageProps) {
  return (
    <div
      className={`duotone-frame ${tone === "hero" ? "duotone-hero" : ""} relative overflow-hidden bg-ink-card ${aspect} ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        preload={priority}
        loading={priority ? "eager" : "lazy"}
        className="duotone-img object-cover"
        style={position ? { objectPosition: position } : undefined}
      />
      {/* Accent scrim — welds the photo to the brand and guarantees AA
          contrast for any caption laid over the lower edge. aria-hidden:
          purely decorative, the <Image> alt carries the meaning. */}
      <span className="duotone-scrim pointer-events-none absolute inset-0" aria-hidden="true" />
    </div>
  )
}

export default DuotoneImage
