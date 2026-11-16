"use client"

// Mobile navigation for the pill nav (<1024px): a round burger that opens a
// floating card anchored under the pill — not a full-screen overlay — sized
// to its content. A light scrim dims the page behind it; Escape, a scrim
// tap or picking a link closes it, and body scroll is locked while open.
// The card scales in from the burger's corner (transform-origin: top right)
// and leaves the same way. Styling: .qs-burger / .qs-mnav / .qs-scrim in
// site-kit.css. iOS tap reliability: touch-action on the button and
// pointer-events-none on the decorative bars.

import Link from "next/link"
import { useEffect, useState } from "react"
import AuthNav from "../AuthNav"
import { Arrow, Eyebrow } from "./site-ui"

const SECTION_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#contact", label: "Contact us" },
]

const TRADE_LINKS = [
  { href: "/trades/electrical", label: "Electrical" },
  { href: "/trades/plumbing", label: "Plumbing" },
  { href: "/trades/roofing", label: "Roofing" },
  { href: "/trades/solar", label: "Solar" },
  { href: "/trades/painting", label: "Painting" },
]

const BAR = "absolute left-0 h-[1.5px] w-[18px] rounded-full bg-current transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
        className="qs-burger"
      >
        <span className="pointer-events-none relative block h-3 w-[18px]" aria-hidden="true">
          <span className={`${BAR} ${open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0"}`} />
          <span className={`${BAR} top-1/2 -translate-y-1/2 ${open ? "opacity-0" : "opacity-100"}`} />
          <span className={`${BAR} ${open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0"}`} />
        </span>
      </button>

      <div aria-hidden="true" onClick={close} className="qs-scrim" data-open={open} />

      <div id="mobile-menu" className="qs-mnav" data-open={open}>
        <nav aria-label="Mobile">
          <ul className="flex flex-col">
            {SECTION_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} className="qs-mnav__link">
                  {l.label}
                  <Arrow className="text-[var(--qs-muted)]" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-2 border-t border-[var(--qs-line)] px-2 pb-1 pt-5">
            <Eyebrow>Trades</Eyebrow>
            <ul className="qs-tags mt-3">
              {TRADE_LINKS.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} onClick={close} className="qs-tag">
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div
            className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--qs-line)] px-2 pt-4"
            onClick={close}
          >
            <AuthNav variant="nav" />
          </div>
        </nav>
      </div>
    </>
  )
}
