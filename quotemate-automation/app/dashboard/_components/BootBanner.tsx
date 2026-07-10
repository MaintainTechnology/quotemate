// Branded boot screen (specs/dashboard-performance.md R2). Rendered by
// app/dashboard/loading.tsx during the route transition + client-chunk
// download AND by DashboardPage's !data branch, so the whole boot reads as
// one continuous banner with no flash between the two windows. Zero client
// JS — safe inside a server loading file.
//
// Pinned to the LIGHT "warm paper" values per the requester's brief (the
// theme flips at :root only, so a descendant can't re-pin via tokens —
// these are the canonical light-theme constants from globals.css). The
// mark is inlined SVG so the banner has zero asset dependency and can
// never render without its logo.

export function BootBanner() {
  return (
    <div
      role="status"
      aria-label="Loading your dashboard"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#FAF8F4]"
    >
      <div className="relative motion-safe:animate-[boot-heartbeat_1.6s_ease-in-out_infinite]">
        <div
          aria-hidden
          className="absolute -inset-12 bg-[radial-gradient(closest-side,rgba(255,196,0,0.45),transparent_72%)] motion-safe:animate-[boot-glow_1.6s_ease-in-out_infinite]"
        />
        {/* QuoteMax mark — DesignSystemQM/assets/logos/quotemax-mark.svg, inlined.
            Tile corners rounded to match the dashboard's --radius-card cockpit
            treatment (the wider brand mark is square-cornered). */}
        <svg viewBox="0 0 64 64" className="relative h-20 w-20" aria-hidden="true">
          <rect width="64" height="64" rx="11" fill="#FFC400" />
          <rect x="13" y="14" width="38" height="26" rx="7" fill="#1C1812" />
          <path d="M20 39 L20 50 L31 40 Z" fill="#1C1812" />
          <path
            d="M23 27 L29.5 33.5 L41 21"
            fill="none"
            stroke="#FFC400"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className="font-sans text-[26px] font-extrabold uppercase leading-none tracking-[-0.02em] text-[#241E1B] motion-safe:animate-[boot-breathe_1.6s_ease-in-out_infinite]">
        QuoteMax
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6E645C]">
        Loading dashboard
      </span>
    </div>
  )
}
