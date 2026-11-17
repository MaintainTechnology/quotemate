"use client"

// Cookie consent card for the marketing landing page (/).
//
// A non-modal floating card (bottom-left on wide screens, full-width on
// phones) in the Site Kit. On mount it reads the stored decision
// (lib/consent) and stays hidden if the visitor has already chosen;
// otherwise it rises in on their first key press, or on scroll once the
// hero's CTA row ([data-keep-clear]) has cleared it — not on load, where a
// short phone screen would put it over those CTAs. "Accept all" / "Reject
// all" both persist the choice and dismiss it, leaving the way it came
// (down), so the exit mirrors the entrance.
//
// Honest scope: the site currently sets only essential cookies (sign-in +
// security) — there are no advertising/analytics trackers — so the copy says
// exactly that and "Reject all" simply records the preference (and would gate
// any future non-essential scripts via the stored consent).

import { useEffect, useRef, useState } from "react"
import {
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "@/lib/consent/cookie-consent"
import { BtnInner, btnClass } from "./site-ui"

const DETAILS_ID = "cookie-consent-details"
// How far up from the viewport's bottom edge the card reaches (186px on a
// phone, plus its inset and a little air).
const CARD_ZONE = 240

export default function CookieConsent() {
  // Hidden on the server and on the first client render so SSR/CSR markup
  // match (no hydration warning) and there's no layout shift. The reveal
  // effect below flips this on once localStorage has been read.
  const [visible, setVisible] = useState(false)
  // Drives the rise: mounted lowered + transparent, then raised on the next
  // frame so the transition actually plays.
  const [raised, setRaised] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (readConsent(window.localStorage) !== null) return
    let frame = 0
    const keepClear = document.querySelector("[data-keep-clear]")
    function reveal() {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("keydown", reveal)
      setVisible(true)
      // Defer the raise to the next frame so the browser paints the lowered
      // state first; otherwise the card appears already in place.
      frame = requestAnimationFrame(() => setRaised(true))
    }
    function onScroll() {
      if (!keepClear || keepClear.getBoundingClientRect().bottom <= window.innerHeight - CARD_ZONE) reveal()
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("keydown", reveal)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("keydown", reveal)
      cancelAnimationFrame(frame)
    }
  }, [])

  // While the card shows, reserve its height at the bottom of the scroll
  // area so keyboard focus scrolls clear of it, not behind it (WCAG 2.4.11).
  // A first key press mounts it, and this runs, before that key moves focus.
  useEffect(() => {
    const card = cardRef.current
    if (!visible || !card) return
    const root = document.documentElement
    const reserve = () => {
      root.style.scrollPaddingBottom = `${card.offsetHeight + 24}px`
    }
    reserve()
    const observer = new ResizeObserver(reserve) // "Cookie details" grows it
    observer.observe(card)
    return () => {
      observer.disconnect()
      root.style.scrollPaddingBottom = ""
    }
  }, [visible])

  // Escape folds the details away, so shrinking the card never means moving
  // focus back to it (WCAG 2.4.11's user-opened-content exception).
  useEffect(() => {
    if (!detailsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailsOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [detailsOpen])

  function choose(choice: ConsentChoice) {
    writeConsent(window.localStorage, choice)
    setRaised(false)
    // Let the exit play before unmounting.
    window.setTimeout(() => setVisible(false), 400)
  }

  if (!visible) return null

  return (
    <div
      ref={cardRef}
      role="region"
      aria-label="Cookie consent"
      className={`fixed inset-x-3 bottom-3 z-50 rounded-[20px] border border-[var(--qs-line)] bg-white p-5 shadow-[0_28px_60px_-28px_rgba(0,0,0,0.35)] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity sm:inset-x-auto sm:bottom-5 sm:left-5 sm:max-w-[400px] ${
        raised ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 motion-reduce:translate-y-0"
      }`}
    >
      <p className="qs-small text-[var(--qs-body)]">
        We use essential cookies to keep QuoteMax working, like keeping you
        signed in and securing the site. We don&rsquo;t use advertising or
        tracking cookies.{" "}
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          aria-controls={DETAILS_ID}
          className="qs-link"
        >
          {detailsOpen ? "Hide details" : "Cookie details"}
        </button>
      </p>
      {detailsOpen ? (
        <p id={DETAILS_ID} className="qs-small mt-3 text-[var(--qs-muted)]">
          Essential cookies are required for the site to function and
          can&rsquo;t be switched off. They cover sign-in sessions and
          security. We don&rsquo;t run analytics or marketing cookies. If that
          ever changes, those would stay off until you accept and we&rsquo;ll
          ask again. Your choice is stored on this device so we don&rsquo;t ask
          every visit.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => choose("rejected")}
          className={btnClass("secondary", "md")}
        >
          <BtnInner>Reject all</BtnInner>
        </button>
        <button
          type="button"
          onClick={() => choose("accepted")}
          className={btnClass("primary", "md")}
        >
          <BtnInner>Accept all</BtnInner>
        </button>
      </div>
    </div>
  )
}
