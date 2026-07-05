// Shared inline icons for the QuoteMax quote surface (redesign).
// Server-safe (pure SVG, no client hooks). Line icons follow the lucide
// convention (currentColor stroke, 1.9 width) so they inherit text colour;
// the QuoteMax mark is a filled logomark. Decorative unless given a title.

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Line({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function CheckIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} {...rest}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function PhoneIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </Line>
  )
}

export function PrinterIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </Line>
  )
}

export function SunIcon(p: IconProps) {
  return (
    <Line {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </Line>
  )
}

export function MoonIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Line>
  )
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </Line>
  )
}

export function DownloadIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Line>
  )
}

// ── Trade icons (used in the top-bar trade badge) ────────────────────
export function ZapIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </Line>
  )
}
export function DropletIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 4 12 2C11.5 4 10 7.9 8 9.5S5 13 5 15a7 7 0 0 0 7 7z" />
    </Line>
  )
}
export function HouseIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </Line>
  )
}
export function RollerIcon(p: IconProps) {
  return (
    <Line {...p}>
      <rect x="3" y="3" width="12" height="6" rx="1" />
      <path d="M15 6h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-7a1 1 0 0 0-1 1v2" />
      <rect x="9" y="15" width="4" height="6" rx="1" />
    </Line>
  )
}
export function BuildingIcon(p: IconProps) {
  return (
    <Line {...p}>
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 22v-3h4v3" />
    </Line>
  )
}
export function WindIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2" />
    </Line>
  )
}
export function LayersIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </Line>
  )
}
export function WrenchIcon(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6z" />
    </Line>
  )
}

// The QuoteMax logomark — yellow tile, dark speech bubble, accent check.
export function QuoteMaxMark({ size = 24, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="QuoteMax" style={{ display: 'block', flexShrink: 0 }} {...rest}>
      <rect width="64" height="64" fill="#FFC400" />
      <rect x="13" y="14" width="38" height="26" rx="7" fill="#1C1812" />
      <path d="M20 39 L20 50 L31 40 Z" fill="#1C1812" />
      <path d="M23 27 L29.5 33.5 L41 21" fill="none" stroke="#FFC400" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Map a trade key → its badge icon. Falls back to a wrench.
export function tradeIcon(trade: string | null | undefined, size = 13) {
  switch ((trade || '').toLowerCase()) {
    case 'solar': return <SunIcon size={size} />
    case 'roof':
    case 'roofing': return <HouseIcon size={size} />
    case 'electrical': return <ZapIcon size={size} />
    case 'plumbing': return <DropletIcon size={size} />
    case 'paint':
    case 'painting': return <RollerIcon size={size} />
    case 'commercial-paint':
    case 'commercial_paint':
    case 'commercial painting': return <BuildingIcon size={size} />
    case 'aircon':
    case 'ac':
    case 'air-conditioning':
    case 'hvac': return <WindIcon size={size} />
    case 'plan':
    case 'multi': return <LayersIcon size={size} />
    default: return <WrenchIcon size={size} />
  }
}
