// Shared chrome for the public marketing surface (/, /pricing, /trades/*,
// /legal/*, /watch, 404): the `.qm-site` scope wrapper, the floating pill
// Nav and the black Footer. Design language: the QuoteMax Site Kit
// (site-kit.css), reverse-engineered from the atomos99 Webflow kit — Inter
// at weight 400 with tight tracking, a white canvas with one warm paper
// surface, pill controls, and a page that closes on black over a warm glow.
//
// Primitives (buttons, badge, section head, page hero, browser frame, FAQ,
// CTA band) live in site-ui.tsx — hook-free, so client islands share them —
// and are re-exported here so page imports keep working.

import { Fragment, type ReactNode } from "react"
import Link from "next/link"
import { Inter } from "next/font/google"
import AuthNav from "../AuthNav"
import { BrandMark } from "./BrandMark"
import { TradesMenu } from "./TradesMenu"
import { MobileNav } from "./MobileNav"
import { NavLink } from "./NavLink"
import "./site-kit.css"

export {
  Arrow,
  Chevron,
  BtnInner,
  Button,
  btnClass,
  PrimaryCTA,
  SecondaryCTA,
  Eyebrow,
  SectionHead,
  PageHero,
  BrowserFrame,
  FaqList,
  CtaBand,
} from "./site-ui"

// Loaded here, not in the root layout, so only marketing routes download
// and preload it; the app keeps Manrope.
const inter = Inter({ subsets: ["latin"], variable: "--font-qs", display: "swap" })

/* ─── Shell ───────────────────────────────────────────────────────
   Every marketing page renders inside this. It owns the scope class the
   kit's styles hang off, the font, the skip link, Nav, <main> and Footer —
   so a page renders sections only, and must not add its own <main>. */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className={`qm-site ${inter.variable}`}>
      <a href="#main" className="qs-skip">
        Skip to content
      </a>
      <Nav />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  )
}

function Wordmark({ markClassName = "h-7 w-auto" }: { markClassName?: string }) {
  return (
    <>
      <BrandMark className={markClassName} />
      <span className="qs-wordmark">QuoteMax</span>
    </>
  )
}

/* ─── Nav ─────────────────────────────────────────────────────────
   Section links resolve to the homepage (`/#…`) so they work from any
   page; Pricing points at the dedicated /pricing route. */
export function Nav() {
  return (
    <header className="qs-nav-wrap">
      <nav className="qs-nav" aria-label="Main">
        <Link href="/" className="qs-nav__brand" aria-label="QuoteMax home">
          <Wordmark />
        </Link>
        <div className="qs-nav__links">
          <NavLink href="/#how">How it works</NavLink>
          <TradesMenu />
          <NavLink href="/pricing">Pricing</NavLink>
          <NavLink href="/#faq">FAQ</NavLink>
          <NavLink href="/#contact">Contact</NavLink>
        </div>
        <div className="qs-nav__actions">
          <AuthNav variant="nav" />
        </div>
        <div className="qs-nav__mobile">
          <AuthNav variant="mobileBar" />
          <MobileNav />
        </div>
      </nav>
    </header>
  )
}

/* ─── Footer ──────────────────────────────────────────────────────
   Black, with the reference's faint grid and warm glow along the floor.
   The brand lines that used to scroll in the yellow marquee bar now run as
   a monochrome ticker here (motion-safe only; the first copy is the one
   assistive tech reads). */

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Pricing", href: "/pricing" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact us", href: "/#contact" },
    ],
  },
  {
    title: "Trades",
    links: [
      { label: "Electrical", href: "/trades/electrical" },
      { label: "Plumbing", href: "/trades/plumbing" },
      { label: "Roofing", href: "/trades/roofing" },
      { label: "Solar", href: "/trades/solar" },
      { label: "Painting", href: "/trades/painting" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/signin" },
      { label: "Get started", href: "/signup" },
      { label: "The plan", href: "/docs/tradie-onboarding-plan" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/legal/privacy" },
      { label: "Terms & conditions", href: "/legal/terms" },
      { label: "Cookie policy", href: "/legal/cookies" },
    ],
  },
]

const BRAND_LINES = [
  "QuoteMax",
  "Built in Australia",
  "For tradies, by tradies",
  "Quote drafted in under a minute",
  "Electrical NSW",
  "Plumbing QLD",
]

export function Footer() {
  return (
    <footer className="qs-dark qs-footer">
      <div className="qs-footer__grid" aria-hidden="true" />
      <div className="qs-container">
        <div className="qs-footer__top">
          <div className="qs-footer__about">
            <Link href="/" className="qs-nav__brand" aria-label="QuoteMax home">
              <Wordmark markClassName="h-8 w-auto" />
            </Link>
            <p>QuoteMax drafts clean quotes for Australian electricians and plumbers.</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="qs-footer__label">{col.title}</p>
              <ul className="qs-footer__links">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="qs-footer__link">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="qs-ticker">
          <div className="qs-ticker__track">
            {[0, 1].map((copy) => (
              <span key={copy} aria-hidden={copy === 1 ? true : undefined}>
                {BRAND_LINES.map((line) => (
                  <Fragment key={line}>
                    <span>{line}</span>
                    <i aria-hidden="true" />
                  </Fragment>
                ))}
              </span>
            ))}
          </div>
        </div>

        <div className="qs-footer__bottom">
          <span>© 2026 QuoteMax</span>
          <span>Electrical NSW · Plumbing QLD</span>
        </div>
      </div>
      <div className="qs-footer__glow" aria-hidden="true" />
    </footer>
  )
}
