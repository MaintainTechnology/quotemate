// Branded boot screen (specs/dashboard-performance.md R2). Rendered by
// app/dashboard/loading.tsx during the route transition + client-chunk
// download AND by DashboardPage's !data branch, so the whole boot reads as
// one continuous banner with no flash between the two windows. Zero client
// JS — safe inside a server loading file. White canvas + glowing lockup is
// the requester's explicit brief (light-surface logo variant per
// public/brand/README.md).

export function BootBanner() {
  return (
    <div
      role="status"
      aria-label="Loading your dashboard"
      className="fixed inset-0 z-50 flex items-center justify-center bg-white"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/quotemax-logo-horizontal-light.svg"
        alt="QuoteMax"
        className="h-12 w-auto motion-safe:animate-[boot-glow_1.8s_ease-in-out_infinite]"
      />
    </div>
  )
}
