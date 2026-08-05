// Branded boot screen (specs/dashboard-performance.md R2). Rendered by
// app/dashboard/loading.tsx during the route transition + client-chunk
// download AND by DashboardPage's !data branch, so the whole boot reads as
// one continuous banner with no flash between the two windows. Zero client
// JS — safe inside a server loading file.
//
// Pinned to the LIGHT "warm paper" values per the requester's brief (the
// theme flips at :root only, so a descendant can't re-pin via tokens —
// these are the canonical light-theme constants from globals.css).
//
// The logo is the shared <BrandMark> (app/_components/BrandMark.tsx), so the
// boot screen shows the SAME Q/M monogram as every header, the favicon and the
// social card — it used to inline a retired square-tile mark that had drifted
// from the brand. BrandMark is server-safe (no hooks), so the banner stays zero
// client JS and still inlines its SVG: no asset request, can never render
// logo-less.
//
// --logo-body/--logo-notch are re-pinned to their LIGHT source values on the
// wrapper below. BrandMark paints from those tokens, and their :root default is
// the DARK one (#FFFFFF body) — inherited unchanged, a white mark would be
// invisible on this paper canvas whenever the user's theme is dark.

import { BrandMark } from '@/app/_components/BrandMark'

export function BootBanner() {
  return (
    <div
      role="status"
      aria-label="Loading your dashboard"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#FAF8F4]"
    >
      <div
        className="relative motion-safe:animate-[boot-heartbeat_1.6s_ease-in-out_infinite]"
        style={
          {
            '--logo-body': '#16120F',
            '--logo-notch': '#E3C13C',
          } as React.CSSProperties
        }
      >
        {/* h-20 w-AUTO: the mark is a 1.47:1 landscape glyph, and a square box
            letterboxes it (see BrandMark's SIZING note). */}
        <BrandMark className="h-20 w-auto" />
      </div>
      <span className="font-sans text-2xl font-extrabold uppercase leading-none tracking-[-0.02em] text-[#241E1B] motion-safe:animate-[boot-breathe_1.6s_ease-in-out_infinite]">
        QuoteMax
      </span>
      {/* Carries the "still working" signal that the removed "Loading dashboard"
          label used to. Purely decorative — role="status" + aria-label above is
          what a screen reader announces, so this must not add its own text. */}
      <div
        aria-hidden
        className="h-px w-32 overflow-hidden bg-[#E7E0D6]"
      >
        <div className="h-full w-1/3 bg-[#FFC400] motion-safe:animate-[boot-sweep_1.15s_ease-in-out_infinite]" />
      </div>
    </div>
  )
}
