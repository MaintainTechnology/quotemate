"use client"

// Accessible "Trades" dropdown for the desktop pill nav: a disclosure of
// links. Opens on mouse hover and on click/tap/keyboard; closes on Escape
// (handing focus back to the button), outside-click, focus leaving it, or
// selection. A small client island so the rest of the Nav stays a server
// component. On mobile the same routes live in MobileNav and the footer.
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  // True while a mouse hover holds the panel open, so the click that usually
  // follows keeps it open instead of toggling it shut.
  const hoverOpen = useRef(false)
  const menuId = useId()
  const onTradePage = usePathname().startsWith("/trades")

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      // Focus inside the panel would fall to <body> as it hides: hand it back.
      if (ref.current?.contains(document.activeElement)) buttonRef.current?.focus()
      setOpen(false)
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
      // Hover opens for a real mouse only (a tap fires mouseenter too, which
      // opened the panel just before the tap's click toggled it shut), and
      // pins only a panel it opened, so one click still shuts a keyed one.
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse" || open) return
        hoverOpen.current = true
        setOpen(true)
      }}
      // A passing mouse never shuts the panel under keyboard focus, which
      // would drop that focus to <body>.
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse" || e.currentTarget.querySelector(":focus-visible")) return
        hoverOpen.current = false
        setOpen(false)
      }}
      // Tabbing out closes it, so the panel never covers what gets focus next.
      // (A null target is a click on something unfocusable: onDown has it.)
      onBlur={(e) => {
        const to = e.relatedTarget
        if (to && !e.currentTarget.contains(to)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        data-active={onTradePage ? "true" : undefined}
        onClick={() => {
          const pinned = hoverOpen.current
          hoverOpen.current = false
          setOpen((o) => pinned || !o)
        }}
        className="qs-nav__link"
      >
        Trades
        <Chevron className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      <div id={menuId} className="qs-menu" data-open={open}>
        <div className="qs-menu__panel">
          {TRADE_LINKS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
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
