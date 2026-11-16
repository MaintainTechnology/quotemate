"use client"

// Accessible "Trades" dropdown for the desktop pill nav. Opens on hover and
// on click/keyboard; closes on Escape, outside-click, or selection. A small
// client island so the rest of the Nav stays a server component. On mobile
// the same routes live in MobileNav and the footer.
//
// The panel scales in from its trigger (transform-origin: top centre) and
// leaves the way it came — the dropdown is anchored to the button that
// opened it. Styling: .qs-menu* in site-kit.css.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
import { Chevron } from "./site-ui"

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
  const onTradePage = usePathname().startsWith("/trades")

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
        data-active={onTradePage ? "true" : undefined}
        onClick={() => setOpen((o) => !o)}
        className="qs-nav__link"
      >
        Trades
        <Chevron className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      <div id={menuId} role="menu" aria-label="Trades" className="qs-menu" data-open={open}>
        <div className="qs-menu__panel">
          {TRADE_LINKS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="qs-menu__item"
            >
              <span>{t.label}</span>
              {t.region ? <span className="qs-menu__tag">{t.region}</span> : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
