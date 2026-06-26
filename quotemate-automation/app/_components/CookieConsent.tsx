"use client"

// Cookie consent banner for the marketing landing page (/).
//
// A non-modal bottom bar in the Maintain design system. On mount it reads
// the stored decision (lib/consent) and stays hidden if the visitor has
// already chosen; otherwise it slides up. "Accept all" / "Reject all" both
// persist the choice and dismiss the bar.
//
// Honest scope: the site currently sets only essential cookies (sign-in +
// security) — there are no advertising/analytics trackers — so the copy says
// exactly that and "Reject all" simply records the preference (and would gate
// any future non-essential scripts via the stored consent).

import { useEffect, useState } from "react"
import {
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "@/lib/consent/cookie-consent"

const DETAILS_ID = "cookie-consent-details"

export default function CookieConsent() {
  // Hidden on the server and on the first client render so SSR/CSR markup
  // match (no hydration warning) and there's no layout shift. The mount
  // effect flips this on once localStorage can be read.
  const [visible, setVisible] = useState(false)
  // Drives the slide: mounted off-screen (translate-y-full), then raised on
  // the next frame so the transition actually plays.
  const [raised, setRaised] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    if (readConsent(window.localStorage) !== null) return
    setVisible(true)
    // Defer the raise to the next frame so the browser paints the off-screen
    // state first; otherwise the bar appears already in place with no slide.
    const id = requestAnimationFrame(() => setRaised(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function choose(choice: ConsentChoice) {
    writeConsent(window.localStorage, choice)
    setRaised(false)
    // Let the slide-down play before unmounting.
    window.setTimeout(() => setVisible(false), 300)
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className={`edge-lit fixed inset-x-0 bottom-0 z-50 border-t border-ink-line bg-ink-card transition-transform duration-300 ease-out motion-reduce:transition-none ${
        raised ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-[88rem] flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between md:gap-8">
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-text-sec">
            We use essential cookies to keep QuoteMax working &mdash; like
            keeping you signed in and securing the site. We don&rsquo;t use
            advertising or tracking cookies.{" "}
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              aria-controls={DETAILS_ID}
              className="link-underline font-medium text-text-pri underline-offset-2 hover:text-accent focus:outline-none"
            >
              {detailsOpen ? "Hide details" : "Cookie details"}
            </button>
          </p>
          {detailsOpen ? (
            <p
              id={DETAILS_ID}
              className="mt-3 max-w-2xl text-sm leading-relaxed text-text-dim"
            >
              Essential cookies are required for the site to function and
              can&rsquo;t be switched off &mdash; they cover sign-in sessions
              and security. We don&rsquo;t run analytics or marketing cookies.
              If that ever changes, those would stay off until you accept and
              we&rsquo;ll ask again. Your choice is stored on this device so we
              don&rsquo;t ask every visit.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => choose("rejected")}
            className="inline-flex items-center justify-center border border-ink-line bg-transparent px-6 py-3 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={() => choose("accepted")}
            className="inline-flex items-center justify-center bg-accent px-6 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  )
}
