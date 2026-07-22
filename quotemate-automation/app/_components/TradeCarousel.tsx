"use client"

// Auto-advancing trade carousel for the home page "what auto-quotes vs what
// books a visit" section. One slide per live trade, content supplied by the
// server from app/trades/_data.ts so nothing here is invented and the slides
// can never drift from the trade pages they link to.
//
// Accessibility is the bulk of this file, because an auto-rotating carousel
// is one of the easier things to get badly wrong:
//   - WCAG 2.2.2 requires a pause mechanism for anything that auto-updates
//     for more than five seconds, so there is a real pause/play control.
//     Hover-pause alone does not satisfy it — that leaves keyboard users
//     with no way to stop the rotation.
//   - Rotation also pauses on hover AND on focus entering the carousel, so
//     it can't yank content away mid-read or mid-tab.
//   - prefers-reduced-motion disables auto-advance entirely; the carousel
//     still works, it just waits to be driven.
//   - Off-screen slides are `inert`, so their links are not tab-reachable
//     and screen readers don't walk through four hidden CTAs.
//   - The live region is "off" while rotating (announcing every 6s would be
//     hostile) and "polite" once the user takes manual control.
// Structure follows the WAI-ARIA carousel pattern.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Image from "next/image"
import Link from "next/link"
import { Arrow } from "./site"

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

export function TradeCarousel({ slides }: { slides: TradeSlide[] }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [held, setHeld] = useState(false) // hover or focus inside
  const reduced = usePrefersReducedMotion()
  const count = slides.length

  const goTo = useCallback((n: number) => setIndex(((n % count) + count) % count), [count])

  const rotating = playing && !held && !reduced

  // Keyed on `index`, so any manual navigation restarts the dwell time
  // instead of advancing again a moment later.
  useEffect(() => {
    if (!rotating) return
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), INTERVAL_MS)
    return () => window.clearTimeout(id)
  }, [index, rotating, count])

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-ink-line"
      role="region"
      aria-roledescription="carousel"
      aria-label="Trades QuoteMax quotes"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {/* Slides share one grid cell, so the container is as tall as the
          tallest slide and nothing reflows as they cross-fade. */}
      <div className="grid" aria-live={rotating ? "off" : "polite"}>
        {slides.map((s, i) => {
          const active = i === index
          return (
            <div
              key={s.slug}
              className={`col-start-1 row-start-1 transition-opacity duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                active ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}: ${s.name}`}
              inert={!active}
            >
              <div className="relative min-h-[30rem] md:min-h-[34rem]">
                <Image
                  src={s.image}
                  alt={s.alt}
                  fill
                  // The slot maxes out at ~1360px, but declaring that makes
                  // Next reach for the 1920 bucket (809KB across five slides).
                  // Declaring 1200 lands on the 1200 bucket instead — 692KB —
                  // for a 1.13x upscale that is invisible under a 0.94-alpha
                  // scrim. Retina is unaffected either way; deviceSizes caps
                  // at 1920 regardless of what we ask for.
                  sizes="(max-width: 1024px) 100vw, 1200px"
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
                  className={`object-cover transition-transform duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    active ? "scale-100" : "scale-[1.06]"
                  }`}
                />
                {/* Hardcoded dark scrim (see globals.css): the copy sits on a
                    photograph, so it must stay legible in BOTH themes — a
                    token-driven scrim would turn cream on the light canvas
                    and drop white text to ~1.1:1. */}
                <span className="trade-slide-scrim absolute inset-0" aria-hidden="true" />

                <div className="relative flex min-h-[30rem] flex-col justify-center gap-5 px-6 py-14 sm:px-10 md:min-h-[34rem] md:max-w-[42rem] md:px-14">
                  <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-white/75">
                    {s.eyebrow}
                  </span>
                  <div>
                    <h3 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-white text-[clamp(2.25rem,4.6vw,3.75rem)]">
                      {s.name}
                    </h3>
                    <span
                      className="mt-5 block h-1 w-16 bg-accent"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
                    {s.body}
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {s.tags.map((t) => (
                      <li
                        key={t}
                        className="rounded-md border border-white/25 bg-white/10 px-2.5 py-1 font-mono text-[0.75rem] uppercase tracking-[0.08em] text-white/85 backdrop-blur-sm"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Link
                      href={`/trades/${s.slug}`}
                      className="group inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold uppercase tracking-wider transition-colors hover:bg-accent-press focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
                    >
                      View {s.name.toLowerCase()}
                      <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                        <Arrow />
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Prev / next. Sit over the photo, so they carry their own dark
          backing rather than relying on whatever pixels land behind them. */}
      <CarouselButton
        onClick={() => goTo(index - 1)}
        label="Previous slide"
        className="left-3 md:left-5"
      >
        <Chevron dir="left" />
      </CarouselButton>
      <CarouselButton
        onClick={() => goTo(index + 1)}
        label="Next slide"
        className="right-3 md:right-5"
      >
        <Chevron dir="right" />
      </CarouselButton>

      {/* Dots + pause. Grouped bottom-centre like the reference. */}
      <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-3">
        <div className="flex items-center gap-2 rounded-full bg-black/45 px-3 py-2 backdrop-blur-sm">
          {slides.map((s, i) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show slide ${i + 1} of ${count}: ${s.name}`}
              aria-current={i === index}
              className={`h-2.5 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/50 ${
                i === index ? "w-6 bg-accent" : "w-2.5 bg-white/45 hover:bg-white/70"
              }`}
            />
          ))}
          {/* WCAG 2.2.2: auto-rotation needs a real stop control, not just
              hover-pause — that would leave keyboard users no way out. */}
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={
              playing
                ? "Pause automatic slide rotation"
                : "Resume automatic slide rotation"
            }
            className="ml-1 grid h-6 w-6 place-items-center rounded-full text-white/80 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
      </div>
    </div>
  )
}

function CarouselButton({
  onClick,
  label,
  className,
  children,
}: {
  onClick: () => void
  label: string
  className: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/50 ${className}`}
    >
      {children}
    </button>
  )
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="1" width="3" height="10" />
      <rect x="7.5" y="1" width="3" height="10" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M2.5 1l8 5-8 5z" />
    </svg>
  )
}
