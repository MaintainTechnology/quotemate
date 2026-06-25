"use client"

// Mobile navigation — a hamburger that opens a full-screen menu below the
// sticky nav bar. Desktop (md+) keeps the inline links + controls and this
// component is hidden. Built as a client island (toggle state) so the rest
// of the Nav stays server-rendered. Theme-aware via Maintain tokens.
//
// The sticky <nav> sits at z-50; this overlay is z-40, so the bar (logo +
// the morphing hamburger/X) stays on top and tappable while the menu is
// open. Escape closes it and body scroll is locked while open.

import Link from "next/link"
import { useEffect, useState } from "react"
import AuthNav from "../AuthNav"
import ThemeToggle from "./ThemeToggle"

const SECTION_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
]

const TRADE_LINKS = [
  { href: "/trades/electrical", label: "Electrical" },
  { href: "/trades/plumbing", label: "Plumbing" },
  { href: "/trades/roofing", label: "Roofing" },
  { href: "/trades/solar", label: "Solar" },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)

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
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
        className="relative z-50 inline-flex h-11 w-11 touch-manipulation items-center justify-center border border-ink-line text-text-pri transition-colors hover:border-text-dim hover:bg-ink-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span
          className="pointer-events-none relative block h-3.5 w-5"
          aria-hidden="true"
        >
          <span
            className={`absolute left-0 h-[2px] w-5 bg-current transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
              open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0"
            }`}
          />
          <span
            className={`absolute left-0 top-1/2 h-[2px] w-5 -translate-y-1/2 bg-current transition-opacity duration-200 ${
              open ? "opacity-0" : "opacity-100"
            }`}
          />
          <span
            className={`absolute left-0 h-[2px] w-5 bg-current transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
              open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0"
            }`}
          />
        </span>
      </button>

      <div
        id="mobile-menu"
        className={`fixed inset-0 z-40 bg-ink-deep/95 backdrop-blur-md transition-opacity duration-300 ${
          open
            ? "visible opacity-100"
            : "pointer-events-none invisible opacity-0"
        }`}
      >
        <div className="flex h-full flex-col overflow-y-auto px-6 pb-12 pt-24">
          <ul className="flex flex-col">
            {SECTION_LINKS.map((l, i) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  style={{ transitionDelay: open ? `${80 + i * 50}ms` : "0ms" }}
                  className={`block border-b border-ink-line py-4 text-2xl font-extrabold uppercase tracking-tight text-text-pri transition-all duration-300 hover:text-accent ${
                    open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <div
            style={{ transitionDelay: open ? "260ms" : "0ms" }}
            className={`mt-7 transition-all duration-300 ${
              open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
          >
            <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
              Trades
            </span>
            <ul className="mt-3 grid grid-cols-2 gap-2.5">
              {TRADE_LINKS.map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    onClick={() => setOpen(false)}
                    className="block border border-ink-line px-4 py-3 font-semibold uppercase tracking-tight text-text-pri transition-colors hover:border-text-dim hover:bg-ink-card hover:text-accent"
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div
            style={{ transitionDelay: open ? "320ms" : "0ms" }}
            className={`mt-auto flex flex-col gap-5 pt-10 transition-all duration-300 ${
              open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
          >
            <div
              className="flex items-center gap-4"
              onClick={() => setOpen(false)}
            >
              <AuthNav variant="nav" />
            </div>
            <div className="flex items-center gap-3 border-t border-ink-line pt-5">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
                Theme
              </span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
