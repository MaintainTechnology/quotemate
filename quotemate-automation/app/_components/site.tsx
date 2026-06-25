// Shared site chrome + brand primitives for the public marketing
// surface (/, /pricing). Extracted from app/page.tsx so the nav, footer,
// marquee and CTAs stay identical across pages instead of drifting in
// two copies. Server-safe: only Link + inline SVG + the AuthNav client
// island. Maintain design system — deep navy, orange accent, all-caps
// display, square corners, borders over shadows.

import Link from "next/link"
import AuthNav from "../AuthNav"
import ThemeToggle from "./ThemeToggle"
import { BrandMark } from "./BrandMark"
import { TradesMenu } from "./TradesMenu"
import { MobileNav } from "./MobileNav"

/* ─── Nav ─────────────────────────────────────────────────────── */
// Section links resolve to the homepage (`/#…`) so they work from any
// page; Pricing points at the dedicated /pricing route.
export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-ink-line bg-ink-deep/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[88rem] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-extrabold uppercase tracking-tight text-text-pri">
            QuoteMax
          </span>
        </Link>
        <div className="hidden gap-8 text-sm font-medium text-text-sec md:flex">
          <Link
            href="/#how"
            className="link-underline pb-0.5 hover:text-text-pri"
          >
            How
          </Link>
          <TradesMenu />
          <Link
            href="/pricing"
            className="link-underline pb-0.5 hover:text-text-pri"
          >
            Pricing
          </Link>
          <Link
            href="/#faq"
            className="link-underline pb-0.5 hover:text-text-pri"
          >
            FAQ
          </Link>
        </div>
        <div className="hidden items-center gap-2 md:flex md:gap-3">
          <ThemeToggle />
          <AuthNav variant="nav" />
        </div>
        <MobileNav />
      </div>
    </nav>
  )
}

/* ─── Footer ──────────────────────────────────────────────────── */

export function Footer() {
  return (
    <footer>
      <div className="mx-auto grid max-w-[88rem] gap-10 px-6 py-16 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-extrabold uppercase tracking-tight text-text-pri">
              QuoteMax
            </span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-dim">
            QuoteMax drafts clean quotes for Australian electricians and
            plumbers.
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            { label: "How it works", href: "/#how" },
            { label: "Pricing", href: "/pricing" },
            { label: "FAQ", href: "/#faq" },
          ]}
        />
        <FooterCol
          title="Trades"
          links={[
            { label: "Electrical", href: "/trades/electrical" },
            { label: "Plumbing", href: "/trades/plumbing" },
            { label: "Roofing", href: "/trades/roofing" },
            { label: "Solar", href: "/trades/solar" },
          ]}
        />
        <FooterCol
          title="Account"
          links={[
            { label: "Sign in", href: "/signin" },
            { label: "Get started", href: "/signup" },
            { label: "The plan", href: "/docs/tradie-onboarding-plan" },
          ]}
        />
      </div>
      <div className="border-t border-ink-line">
        <div className="mx-auto flex max-w-[88rem] flex-col gap-2 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
            © 2026 QuoteMax
          </span>
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
            Electrical NSW · Plumbing QLD
          </span>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({
  title,
  links,
}: {
  title: string
  links: { label: string; href: string }[]
}) {
  return (
    <div>
      <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {title}
      </span>
      <ul className="mt-4 grid gap-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="link-underline pb-0.5 text-sm text-text-sec hover:text-text-pri"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ─── Orange CTA marquee (signature) ──────────────────────────── */
// A slow ticker on motion-safe browsers; the track holds the line twice
// so the -50% loop is seamless. Reduced-motion (and no-JS) users see the
// static leading copy.
export function MarqueeBar() {
  return (
    <div className="overflow-hidden bg-accent py-5 text-white">
      <div className="flex w-max motion-safe:animate-[marquee_36s_linear_infinite]">
        {[0, 1].map((copy) => (
          <span
            key={copy}
            aria-hidden={copy === 1}
            className="flex shrink-0 items-center font-mono text-xl font-bold uppercase tracking-[0.16em] md:text-2xl"
          >
            {[
              "QuoteMax",
              "Built in Australia",
              "For tradies, by tradies",
              "Quote drafted in under a minute",
              "Electrical NSW",
              "Plumbing QLD",
            ].map((line) => (
              <span key={line} className="flex items-center">
                <span className="px-6">{line}</span>
                <span aria-hidden="true">·</span>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ─── Primitives ──────────────────────────────────────────────── */

function Logo() {
  return <BrandMark />
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-text-dim">
      {children}
    </span>
  )
}

export function PrimaryCTA({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 bg-accent px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
    >
      {children}
      <span className="transition-transform duration-300 group-hover:translate-x-0.5">
        <Arrow />
      </span>
    </Link>
  )
}

export function SecondaryCTA({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 border border-ink-line bg-transparent px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-text-dim hover:bg-ink-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
    >
      {children}
    </Link>
  )
}

export function Arrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

export function Topography() {
  // Two ridge groups drifting in opposite directions at glacial speed —
  // the canvas reads as alive without ever announcing itself. The accent
  // ridge is the one warm line in the teal field.
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="var(--teal-glow)"
        strokeWidth="1"
        className="motion-safe:animate-[topo-drift_26s_ease-in-out_infinite_alternate]"
      >
        <path d="M0,820 Q240,700 480,760 T960,720 T1440,780 T1920,740 T2400,760" />
        <path
          d="M0,920 Q240,820 480,850 T960,830 T1440,880 T1920,850 T2400,870"
          opacity="0.5"
        />
        <path
          d="M0,1020 Q240,940 480,960 T960,940 T1440,980 T1920,960 T2400,970"
          opacity="0.2"
        />
      </g>
      <g
        fill="none"
        strokeWidth="1"
        className="motion-safe:animate-[topo-drift_34s_ease-in-out_infinite_alternate-reverse]"
      >
        <path
          d="M0,870 Q240,760 480,800 T960,780 T1440,830 T1920,800 T2400,820"
          stroke="var(--accent)"
          opacity="0.45"
        />
        <path
          d="M0,970 Q240,880 480,900 T960,880 T1440,930 T1920,900 T2400,915"
          stroke="var(--teal-glow)"
          opacity="0.35"
        />
      </g>
    </svg>
  )
}
