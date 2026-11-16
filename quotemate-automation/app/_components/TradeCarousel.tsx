"use client"

// Auto-advancing trade carousel for the home page "what auto-quotes vs what
// books a visit" section. One slide per live trade, content supplied by the
// server from app/trades/_data.ts so nothing here is invented and the slides
// can never drift from the trade pages they link to.
//
// Presented as the reference kit's case-study tab panel: a white panel with
// a row of trade tabs, and under it a paper card holding the copy on the
// left and the photograph on the right (stacked on phones).
//
// Accessibility is the bulk of this file, because an auto-rotating carousel
// is one of the easier things to get badly wrong:
//   - The trade row is a real WAI-ARIA tab list (the APG "tabbed carousel"):
//     one tab stop, arrow keys / Home / End move focus AND selection.
//   - WCAG 2.2.2 requires a pause mechanism for anything that auto-updates
//     for more than five seconds, so there is a real pause/play control.
//     Hover-pause alone does not satisfy it — that leaves keyboard users
//     with no way to stop the rotation.
//   - Rotation also pauses on hover AND while focus is inside the carousel
//     (tracked separately, so one can't cancel the other), and picking a
//     trade stops it, so it can't yank content away mid-read or mid-tab.
//   - prefers-reduced-motion starts it stopped; the control then offers to
//     start rotation rather than claiming it can pause it.
//   - Off-screen slides are `inert`, so their links are not tab-reachable
//     and screen readers don't walk through four hidden CTAs.
//   - The live region is "off" while rotating (announcing every 6s would be
//     hostile) and "polite" once the user takes manual control.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import Image from "next/image"
import { Button, Chevron, Eyebrow } from "./site-ui"

export type TradeSlide = {
  slug: string
  name: string
  eyebrow: string
  body: string
  image: string
  alt: string
  tags: string[]
  /** object-position for the cover crop, so a face isn't cut by the wide frame. */
  position?: string
}

const INTERVAL_MS = 6000

/** Subscribes to the reduced-motion media query without setState-in-effect. */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false, // server render: assume motion is fine, the effect corrects it
  )
}

/** Keys that move along the tab row, as an offset or an absolute index. */
const TAB_KEYS: Record<string, (i: number, count: number) => number> = {
  ArrowRight: (i) => i + 1,
  ArrowLeft: (i) => i - 1,
  Home: () => 0,
  End: (_, count) => count - 1,
}

export function TradeCarousel({ slides }: { slides: TradeSlide[] }) {
  const [index, setIndex] = useState(0)
  // null until the user presses the rotation control or picks a trade;
  // until then reduced motion decides whether the carousel plays.
  const [playing, setPlaying] = useState<boolean | null>(null)
  // Two holds, not one shared flag: a shared flag let mouseleave cancel a
  // focus hold, so the slide rotated out from under a focused tab and the
  // next arrow key skipped a trade.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const reduced = usePrefersReducedMotion()
  const count = slides.length
  const uid = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const goTo = useCallback((n: number) => setIndex(((n % count) + count) % count), [count])

  const autoplay = playing ?? !reduced
  const rotating = autoplay && !hovered && !focused

  // Picking a trade is an explicit choice, so it stops rotation outright
  // (APG tabbed carousel), not just while the pointer or focus stays put.
  function choose(n: number) {
    setPlaying(false)
    goTo(n)
  }

  // Keyed on `index`, so any manual navigation restarts the dwell time
  // instead of advancing again a moment later.
  useEffect(() => {
    if (!rotating) return
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), INTERVAL_MS)
    return () => window.clearTimeout(id)
  }, [index, rotating, count])

  // On phones the tab row scrolls sideways; keep the active tab in view.
  // Scrolls the row only — scrollIntoView would also drag the page.
  useEffect(() => {
    const list = listRef.current
    const tab = tabRefs.current[index]
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return
    list.scrollTo({
      left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    })
  }, [index, reduced])

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const move = TAB_KEYS[e.key]
    if (!move) return
    e.preventDefault()
    const n = ((move(index, count) % count) + count) % count
    choose(n)
    tabRefs.current[n]?.focus()
  }

  return (
    <div
      className="qs-panel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Trades QuoteMax quotes"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      // Only when focus leaves the carousel, not when it moves within it.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="Trades"
        // Below sm the row scrolls sideways with no scrollbar, so its right
        // edge fades to show more trades sit past it. The ::after spacer
        // (plus the gap) is as wide as the fade, so the last tab can scroll
        // fully clear of it.
        className="relative flex gap-2 overflow-x-auto [scrollbar-width:none] lg:gap-4 [&::-webkit-scrollbar]:hidden max-sm:[mask-image:linear-gradient(90deg,#000_calc(100%_-_3rem),transparent)] max-sm:after:w-10 max-sm:after:shrink-0 max-sm:after:content-['']"
      >
        {slides.map((s, i) => {
          const active = i === index
          return (
            <button
              key={s.slug}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              id={`${uid}-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${uid}-panel-${i}`}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(i)}
              onKeyDown={onTabKeyDown}
              className={`flex min-h-[52px] min-w-max flex-[1_0_0%] items-center justify-center gap-2.5 rounded-[var(--qs-r-sm)] px-4 text-[15px] leading-[1.4] tracking-[-0.02em] transition-colors duration-300 focus-visible:outline-offset-[-2px]! ${
                active
                  ? "bg-[var(--qs-paper)] text-[var(--qs-ink)]"
                  : "text-[var(--qs-muted)] hover:text-[var(--qs-ink)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={active ? "qs-tab__dot" : "h-2 w-2 rounded-full bg-[#dcd9d5]"}
              />
              {s.name}
            </button>
          )
        })}
      </div>

      <div className="relative mt-3 lg:mt-5">
        {/* Slides share one grid cell, so the panel is as tall as the
            tallest slide and nothing reflows as they cross-fade. */}
        <div className="grid" aria-live={rotating ? "off" : "polite"}>
          {slides.map((s, i) => {
            const active = i === index
            return (
              <div
                key={s.slug}
                id={`${uid}-panel-${i}`}
                role="tabpanel"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}: ${s.name}`}
                inert={!active}
                className={`col-start-1 row-start-1 grid grid-rows-[1fr_auto] gap-3 rounded-[var(--qs-r-md)] bg-[var(--qs-paper)] p-3 transition-opacity duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-200 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-1 ${
                  active ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
              >
                <div className="flex flex-col justify-between gap-8 px-3 pb-5 pt-6 sm:p-6 lg:p-10">
                  <div className="flex flex-col items-start gap-5">
                    <Eyebrow>{s.eyebrow}</Eyebrow>
                    <h3 className="qs-h3">{s.name}</h3>
                    <p className="qs-text max-w-md">{s.body}</p>
                  </div>
                  <div className="flex flex-col items-start gap-8">
                    <ul className="qs-tags">
                      {s.tags.map((t) => (
                        <li key={t} className="qs-tag">
                          {t}
                        </li>
                      ))}
                    </ul>
                    <Button href={`/trades/${s.slug}`}>View {s.name.toLowerCase()}</Button>
                  </div>
                </div>

                <div className="qs-photo aspect-[4/3] sm:aspect-[16/10] lg:aspect-auto lg:min-h-[32rem]">
                  <Image
                    src={s.image}
                    alt={s.alt}
                    fill
                    // The photo takes ~7/12 of a 1272px panel (~720px) from
                    // lg up, and the full width below it.
                    sizes="(max-width: 1023px) 100vw, (max-width: 1331px) 56vw, 720px"
                    // Eager, but deliberately NOT `priority`. Lazy is wrong
                    // here: every slide is guaranteed to be shown within ~30s,
                    // and a lazily-gated slide advances to an empty frame —
                    // measured, the four inactive slides had still not fetched
                    // 3.5s after the carousel was scrolled into view. `priority`
                    // would be wrong too: this section is well below the fold,
                    // so preloading it in <head> would compete with the hero's
                    // own LCP image for no benefit.
                    loading="eager"
                    style={s.position ? { objectPosition: s.position } : undefined}
                    className={`object-cover motion-safe:transition-transform motion-safe:duration-[1400ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      active ? "scale-100" : "motion-safe:scale-[1.06]"
                    }`}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Prev / pause / next — a white pill floating on the photo's
            bottom-right corner (the photo is the last block at every
            width), with its own backing so any photo stays legible. */}
        <div className="absolute bottom-6 right-6 z-10 flex items-center gap-0.5 rounded-full bg-white/90 p-1 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.4)] backdrop-blur-sm">
          <CarouselButton onClick={() => goTo(index - 1)} label="Previous slide">
            <Chevron className="rotate-90" />
          </CarouselButton>
          {/* WCAG 2.2.2: auto-rotation needs a real stop control, not just
              hover-pause — that would leave keyboard users no way out. */}
          <CarouselButton
            onClick={() => {
              setPlaying(!autoplay)
              // Pressing play is the explicit request APG asks for, so it
              // lifts the focus hold the press itself created; otherwise
              // "Resume" would do nothing until focus left the carousel.
              // The hover hold stays: rotation waits for the pointer to go.
              if (!autoplay) setFocused(false)
            }}
            label={
              autoplay
                ? "Pause automatic slide rotation"
                : reduced
                  ? "Start automatic slide rotation"
                  : "Resume automatic slide rotation"
            }
          >
            {autoplay ? <PauseIcon /> : <PlayIcon />}
          </CarouselButton>
          <CarouselButton onClick={() => goTo(index + 1)} label="Next slide">
            <Chevron className="-rotate-90" />
          </CarouselButton>
        </div>
      </div>
    </div>
  )
}

function CarouselButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-full text-[var(--qs-ink)] transition-colors duration-200 hover:bg-[var(--qs-paper)] focus-visible:outline-offset-[-2px]!"
    >
      {children}
    </button>
  )
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2" y="1" width="2.6" height="10" rx="1" />
      <rect x="7.4" y="1" width="2.6" height="10" rx="1" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M3 1.4v9.2a.6.6 0 0 0 .9.5l7.3-4.6a.6.6 0 0 0 0-1L3.9.9a.6.6 0 0 0-.9.5z" />
    </svg>
  )
}
