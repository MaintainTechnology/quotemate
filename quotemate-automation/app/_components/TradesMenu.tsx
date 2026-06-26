"use client"

// Accessible "Trades" dropdown for the desktop nav. Opens on hover and on
// click/keyboard; closes on Escape, outside-click, or selection. Built as a
// small client island so the rest of the Nav stays a server component.
// Theme-aware via the Maintain tokens (matches the nav surface in light or
// dark). On mobile the nav links are hidden, so the same routes also live
// in the footer.

import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"

const TRADE_LINKS = [
  { href: "/trades/electrical", label: "Electrical", region: "NSW" },
  { href: "/trades/plumbing", label: "Plumbing", region: "QLD" },
  { href: "/trades/roofing", label: "Roofing", region: "" },
  { href: "/trades/solar", label: "Solar", region: "" },
  { href: "/trades/painting", label: "Painting", region: "" },
]

export function TradesMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="link-underline inline-flex items-center gap-1 pb-0.5 hover:text-text-pri"
      >
        Trades
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        id={menuId}
        role="menu"
        aria-label="Trades"
        className={`absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3 transition-opacity duration-150 ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <div className="min-w-[230px] border border-ink-line bg-ink-deep/95 p-2 backdrop-blur-md">
          {TRADE_LINKS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-6 px-3 py-2.5 text-sm text-text-sec transition-colors hover:bg-ink-card hover:text-text-pri focus:bg-ink-card focus:text-text-pri focus:outline-none"
            >
              <span className="font-medium">{t.label}</span>
              {t.region && (
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
                  {t.region}
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
