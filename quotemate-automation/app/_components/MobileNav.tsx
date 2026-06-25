"use client"

// Mobile navigation — a hamburger that expands a dropdown panel directly
// under the sticky nav bar (not a full-screen overlay), sized to its
// content so there is no inner scrollbar. Desktop (md+) keeps the inline
// links + controls and this component is hidden. Client island (toggle
// state) so the rest of the Nav stays server-rendered. Theme-aware via
// Maintain tokens.
//
// Layering: the sticky <nav> is z-50 (the bar + the morphing hamburger/X
// stay on top); the panel is z-40 directly below it; a dim backdrop is
// z-30. Escape or a backdrop tap closes it, and body scroll is locked
// while open. iOS tap reliability: touch-manipulation on the button and
// pointer-events-none on the decorative icon so the tap always lands on
// the button.

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

      {/* Dim backdrop — a tap anywhere outside the panel closes the menu. */}
      <div
        aria-hidden="true"
        onClick={close}
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Dropdown panel, anchored directly under the bar; content height. */}
      <div
        id="mobile-menu"
        className={`absolute inset-x-0 top-full z-40 origin-top border-b border-ink-line bg-ink-deep transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          open
            ? "visible translate-y-0 opacity-100"
            : "pointer-events-none invisible -translate-y-1 opacity-0"
        }`}
      >
        <nav aria-label="Mobile" className="max-h-[80vh] overflow-y-auto px-5 py-3">
          <ul className="flex flex-col">
            {SECTION_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={close}
                  className="block border-b border-ink-line/70 py-3.5 text-base font-semibold uppercase tracking-tight text-text-pri transition-colors hover:text-accent"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="border-b border-ink-line/70 py-4">
            <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
              Trades
            </span>
            <ul className="mt-2.5 grid grid-cols-2 gap-2">
              {TRADE_LINKS.map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    onClick={close}
                    className="block border border-ink-line px-3 py-2 text-sm font-semibold uppercase tracking-tight text-text-pri transition-colors hover:border-text-dim hover:bg-ink-card hover:text-accent"
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4">
            <div className="flex items-center gap-3" onClick={close}>
              <AuthNav variant="nav" />
            </div>
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </div>
  )
}
