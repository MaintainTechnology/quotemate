// /watch — the 15-minute sales video page. This is stage 4 of the acquisition
// funnel in QuoteMax-Acquisition-Engine.pdf: the Meta ad lands them on the
// capture page, the form submit creates the contact, and the "Show me how it
// works" button sends them HERE. The deck calls the video "the core of the
// funnel" — everything on this page exists to get it watched and then to get
// the 20-minute assessment booked.
//
// Content is lifted from the deck so the page and the video tell one story:
//   slide 06  the three video chapters (0-4m / 4-9m / 9-14m)
//   slide 07  the ROI numbers (500+ hrs, A$50k+, A$120k)
//   slide 08  the four objections, answered in the same words
//   slide 11  the 20-minute assessment framing
//   slide 13  configure -> train -> test -> live
//
// Built on the shared SiteShell (pill nav + black footer, site-kit.css) so it
// cannot drift from / and /pricing. The flow follows the kit: a centred hero,
// the player inside the browser-frame widget, white sections, one paper band,
// then the closing run on black (questions, next steps, CTA, footer).

import type { LucideIcon } from "lucide-react"
import { BookOpen, Clock, Moon, PhoneIncoming, Route, SlidersHorizontal } from "lucide-react"
import { Reveal } from "../_components/Reveal"
import {
  SiteShell,
  Eyebrow,
  SectionHead,
  BrowserFrame,
  FaqList,
  CtaBand,
  PrimaryCTA,
  SecondaryCTA,
} from "../_components/site"

/* ─── Wiring ──────────────────────────────────────────────────── */
// Three values to fill in when the assets exist. The page renders a labelled
// placeholder while VIDEO_SRC is empty rather than a broken <video>.
// Annotated `string`, not left to infer the `""` literal — otherwise TS narrows
// the type and the populated branch below reads as dead code.
const VIDEO_SRC: string = ""
const VIDEO_POSTER: string = ""
// The deck's stage 6 books a "setup call". Point this at the GHL assessment
// calendar once it is live; /signup is the honest fallback until then.
const BOOKING_HREF = "/signup"

export const metadata = {
  title: "How QuoteMax works · 15-minute walkthrough",
  description:
    "Fifteen minutes on how QuoteMax quotes every enquiry the same day: the problem, a real screen recording of a lead going in and a quote coming out, then the numbers.",
  // Funnel page, reached after the capture form — not a search landing page.
  // Delete this line if it should be publicly discoverable.
  robots: { index: false, follow: false },
}

export default function WatchPage() {
  return (
    <SiteShell>
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <Hero />
      {/* Everything between the hero and the closing CTA shares one wrapper so
          the CTA pill can be a plain `sticky bottom-0` child — pinned to the
          viewport while the reader is in this range, settling into the last
          section's floor at the end, where the closing CTA takes over. No JS.
          Clipped on y so the pill, resting at this wrapper's top edge while
          the reader is still in the hero, stays tucked behind the hero's floor
          instead of hanging over it (clip, unlike hidden, keeps sticky). */}
      <div className="relative overflow-y-clip">
        <Chapters />
        <Benefits />
        <RoiBand />
        <Objections />
        <WhatHappensNext />
        <StickyCta />
      </div>
      <ClosingCta />
    </SiteShell>
  )
}

/* ─── Hero + the video itself ─────────────────────────────────── */
// The one page where the video is the whole point, so the player sits straight
// under the lead, capped at 1000px (the old max-w-5xl) so it lands in the first
// screen, and the CTAs follow it. Not in a Reveal: on a short screen the frame
// sits below the observer's line and would paint as a white band on load.
// PageHero's centred markup, written out (as not-found.tsx does) because the
// player sits between the lead and the CTAs, which PageHero can't order.

function Hero() {
  return (
    <section className="qs-page-hero" aria-labelledby="watch-hero">
      <div className="qs-container qs-page-hero__center">
        <Eyebrow>You&rsquo;re in &middot; 15 minutes</Eyebrow>
        <h1 id="watch-hero" className="qs-display">
          Every lead quoted the same day.
        </h1>
        <p className="qs-lead">
          No slide deck. A real screen recording of an enquiry going in and a
          finished quote coming out, then the numbers on what quoting after
          hours is actually costing you. Watch it once and you&rsquo;ll know
          whether this fits your business.
        </p>
      </div>
      <div className="qs-container qs-container--narrow mt-12">
        <VideoFrame />
        <div className="qs-actions mt-10 justify-center">
          <PrimaryCTA href={BOOKING_HREF}>Book the 20-minute assessment</PrimaryCTA>
          <SecondaryCTA href="/pricing">See pricing</SecondaryCTA>
        </div>
        <p className="qs-meta mx-auto mt-4 max-w-md text-center">
          Prefer to watch first? The button is here when you&rsquo;re done.
          The assessment is a look at your own numbers, not a cold sales call.
        </p>
      </div>
    </section>
  )
}

function VideoFrame() {
  return (
    <BrowserFrame>
      <div className="pb-[clamp(20px,3.4vw,48px)]">
        <div className="relative aspect-video w-full overflow-hidden rounded-[var(--qs-r-md)] bg-[var(--qs-ink-soft)] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.45)]">
          {VIDEO_SRC ? (
            <video
              className="absolute inset-0 h-full w-full"
              controls
              preload="metadata"
              playsInline
              poster={VIDEO_POSTER || undefined}
              src={VIDEO_SRC}
            />
          ) : (
            <div className="qs-dark absolute inset-0 flex flex-col items-center justify-center gap-3 bg-transparent px-6 text-center md:gap-4">
              <PlayGlyph />
              <span className="qs-h5 qs-ink">The 15-minute walkthrough</span>
              <span className="qs-meta max-w-sm">
                Player placeholder — set VIDEO_SRC in this file once the recording
                is hosted.
              </span>
            </div>
          )}
        </div>
      </div>
    </BrowserFrame>
  )
}

function PlayIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  )
}

function PlayGlyph() {
  return (
    <span
      aria-hidden="true"
      className="grid size-12 place-items-center rounded-full bg-white pl-0.5 text-[var(--qs-ink)] shadow-[0_0_0_8px_rgba(255,255,255,0.08)] md:size-16"
    >
      <PlayIcon size={22} />
    </span>
  )
}

/* ─── What the 15 minutes covers (deck slide 06) ──────────────── */

const CHAPTERS = [
  {
    time: "0–4m",
    from: 0,
    to: 4,
    title: "The problem, and the promise",
    body: "Six enquiries in, three quotes owed, and the pricing still to do tonight. Slow quotes lose jobs — this is the cost of the way it works now.",
  },
  {
    time: "4–9m",
    from: 4,
    to: 9,
    title: "Watch it actually work",
    body: "A real screen recording. A lead comes in, a clean quote goes out, the follow-up runs itself. No mock-ups, no edits between the enquiry and the price.",
  },
  {
    time: "9–14m",
    from: 9,
    to: 14,
    title: "The numbers, and your questions",
    body: "What the hours are worth, what one extra won job a month is worth, and straight answers to the four things every owner asks before they commit.",
  },
]

// The kit's 3-up grid drops to two columns at 768–991px, where the third card
// would sit alone on its row; there it takes the full row instead.
const SPAN_LAST_ON_TABLET = "min-[768px]:max-[992px]:[&>:last-child]:col-span-2"

function Chapters() {
  return (
    <section className="qs-section" aria-labelledby="watch-chapters">
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            id="watch-chapters"
            eyebrow={<>What&rsquo;s in it</>}
            title="Fifteen minutes, three parts."
          />
        </Reveal>
        <ol className={`qs-grid qs-grid--3 ${SPAN_LAST_ON_TABLET}`}>
          {CHAPTERS.map((c, i) => (
            <li key={c.time}>
              <Reveal delay={i * 80} className="h-full">
                <article className="qs-card h-full">
                  <p className="qs-h2 qs-num qs-ink">{c.time}</p>
                  <div className="qs-card__copy">
                    <h3 className="qs-card__title">{c.title}</h3>
                    <p className="qs-card__text">{c.body}</p>
                  </div>
                  <ChapterTrack active={i} />
                </article>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// The card's mini UI: a player scrubber with the three chapters at their real
// proportions (4 / 5 / 5 minutes) and this card's chapter lit.
function ChapterTrack({ active }: { active: number }) {
  return (
    <div
      aria-hidden="true"
      className="mt-auto flex items-center gap-3 rounded-[var(--qs-r-md)] bg-white p-3 pr-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]"
    >
      <span className="grid size-8 flex-none place-items-center rounded-full bg-[var(--qs-ink)] pl-px text-white">
        <PlayIcon size={12} />
      </span>
      <span className="flex flex-1 gap-1">
        {CHAPTERS.map((c, i) => (
          <span
            key={c.time}
            className={`h-1.5 basis-0 rounded-full ${i === active ? "bg-[image:var(--qs-glow)]" : "bg-[var(--qs-line-strong)]"}`}
            style={{ flexGrow: c.to - c.from }}
          />
        ))}
      </span>
    </div>
  )
}

/* ─── Key benefits ────────────────────────────────────────────── */

const BENEFITS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Clock,
    title: "Same-day quoting. Guaranteed.",
    body: "Every enquiry that lands gets a real quote back the same day. Not a callback, not a “we’ll get to it” — a priced quote, while they still care.",
  },
  {
    icon: PhoneIncoming,
    title: "It answers when you can’t.",
    body: "Text, phone call or web form. Nine o’clock on a Tuesday, up a ladder, mid-job — QuoteMax picks it up and starts the quote without you.",
  },
  {
    icon: BookOpen,
    title: "Priced from your book, not a guess.",
    body: "Your rates, your materials, your margins, your exclusions. Every figure on the quote traces back to a number you set. Nothing is invented.",
  },
  {
    icon: Route,
    title: "Exceptions come to you. Nothing else does.",
    body: "Anything that can’t be safely priced from a photo and a description routes to a paid site visit instead. You handle the hard ones, not all of them.",
  },
  {
    icon: Moon,
    title: "Get your nights back.",
    body: "Ten hours a week on quoting is over 500 hours a year. That’s the block of your life this takes back, and it starts the week you go live.",
  },
  {
    icon: SlidersHorizontal,
    title: "Configured with you, not dumped on you.",
    body: "We set it up around how you already quote, load your pricing, and train it on your past quotes. You approve the output before anything goes live.",
  },
]

function Benefits() {
  return (
    <section className="qs-section qs-section--flush-top" aria-labelledby="watch-benefits">
      <div className="qs-container qs-stack">
        <Reveal>
          <div className="qs-head-row">
            <SectionHead id="watch-benefits" eyebrow="What you actually get" title="We do the quoting." />
            <p className="qs-head-aside qs-text">
              QuoteMax is not another app to keep on top of. It is the quoting
              taken off your plate — answered, priced, sent and followed up.
            </p>
          </div>
        </Reveal>
        <div className="qs-grid qs-grid--3">
          {BENEFITS.map((b, i) => {
            const Icon = b.icon
            return (
              <Reveal key={b.title} delay={(i % 3) * 80} className="h-full">
                <article className="qs-card qs-card--outline h-full md:min-h-[16.5rem]">
                  <span className="qs-icon-tile">
                    <Icon size={20} strokeWidth={1.6} />
                  </span>
                  <div className="qs-card__copy mt-auto">
                    <h3 className="qs-card__title">{b.title}</h3>
                    <p className="qs-card__text">{b.body}</p>
                  </div>
                </article>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ─── ROI band (deck slide 07) ────────────────────────────────── */

const STATS = [
  { value: "500+", label: "Hours a year quoting" },
  { value: "A$50k+", label: "Of owner time" },
  { value: "A$120k", label: "Added revenue" },
]

function RoiBand() {
  return (
    <section className="qs-section qs-band" aria-labelledby="watch-maths">
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            id="watch-maths"
            eyebrow="The maths"
            title="Save the admin. Quote faster. Win more work."
          />
        </Reveal>
        <div className={`qs-grid qs-grid--3 ${SPAN_LAST_ON_TABLET}`}>
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 80} className="h-full">
              <div className="qs-card qs-card--white h-full">
                <div className="qs-stat">
                  <span className="qs-stat__value text-[clamp(2.5rem,1.9rem+1.8vw,3.5rem)]">
                    {s.value}
                  </span>
                  <span className="qs-stat__label">{s.label}</span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={240}>
          <p className="qs-lead max-w-[46rem]">
            Ten hours a week quoting is <strong>500+ hours a year</strong>. Win
            one extra A$10k job a month and that is <strong>A$120k</strong> more
            revenue. The video walks through both numbers with real figures.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── The four objections (deck slide 08) ─────────────────────── */

const OBJECTIONS = [
  {
    q: "“My quotes are complicated.”",
    a: "So we configure QuoteMax around your quoting process, rather than asking you to change it to suit the software.",
  },
  {
    q: "“AI won’t understand our jobs.”",
    a: "It doesn’t need to guess. It works from your pricing, your rules, your products and your process — the same inputs you use.",
  },
  {
    q: "“I don’t have time to set it up.”",
    a: "We onboard and configure it with you. You give us your pricing and a handful of past quotes; we do the build.",
  },
  {
    q: "“What if something needs me?”",
    a: "It escalates the exceptions and leaves the rest alone. You are not sitting behind it managing every quote.",
  },
]

function Objections() {
  return (
    <section className="qs-section qs-dark" aria-labelledby="watch-questions">
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            id="watch-questions"
            align="center"
            eyebrow="Fair questions"
            title="The four things everyone asks."
          />
        </Reveal>
        <Reveal delay={80}>
          <FaqList items={OBJECTIONS} />
        </Reveal>
      </div>
    </section>
  )
}

/* ─── What happens next (deck slides 11 + 13) ─────────────────── */

const GO_LIVE = [
  { num: "01", title: "Configure", body: "Pricing rules, quote templates, your number and SMS connected." },
  { num: "02", title: "Train", body: "Your historical quotes teach QuoteMax the patterns you already use." },
  { num: "03", title: "Test", body: "Test leads and test quotes. You approve the output before it is live." },
  { num: "04", title: "Live", body: "QuoteMax is operational and quoting your real enquiries." },
]

function WhatHappensNext() {
  return (
    // A fixed 120px floor at every width: the sticky CTA pill (~74px with its
    // offset) docks here 46px under the last row of cards.
    <section
      className="qs-section qs-section--flush-top qs-dark pb-30"
      aria-labelledby="watch-next"
    >
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            id="watch-next"
            className="max-w-[42rem]"
            eyebrow="After the video"
            title="A 20-minute assessment, not a cold discovery."
            lead="We already have your leads, your quote volume and your average job value from the form. The call is spent on where the hours are going and what your business looks like without them — then, if it fits, how we get you live."
          />
        </Reveal>
        {/* 2x2 until 1200px: four across at 992-1199 leaves a ~150px measure. */}
        <ol className="qs-grid qs-grid--4 min-[992px]:max-[1200px]:grid-cols-2">
          {GO_LIVE.map((s, i) => (
            <li key={s.num}>
              <Reveal delay={i * 80} className="h-full">
                <article className="qs-card h-full">
                  <span className="qs-tag qs-num self-start">
                    {i === GO_LIVE.length - 1 ? <span className="qs-tab__dot" aria-hidden="true" /> : null}
                    {s.num}
                  </span>
                  <div className="qs-card__copy">
                    <h3 className="qs-card__title">{s.title}</h3>
                    <p className="qs-card__text">{s.body}</p>
                  </div>
                </article>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ─── Closing CTA ─────────────────────────────────────────────── */

function ClosingCta() {
  return (
    // ponytail: CtaBand takes no className. Its 30rem title cap is ~14px short
    // of the first sentence at 40px and split it "…night. Book / the
    // assessment."; widened here so each sentence holds its own line.
    // Top padding trimmed to 48px: the section above already ends on a 120px
    // floor holding the docked pill, so cards -> pill -> mark is one ~168px step.
    <div className="[&_.qs-cta]:pt-12 [&_.qs-cta>h2]:max-w-[40rem]">
      <CtaBand
        id="watch-cta"
        title={
          <>
            Stop quoting at nine at night.{" "}
            <span className="block">Book the assessment.</span>
          </>
        }
        lead={
          <>
            Twenty minutes, your numbers, no obligation. If QuoteMax isn&rsquo;t
            right for your business we&rsquo;ll tell you on the call.
          </>
        }
      >
        <PrimaryCTA href={BOOKING_HREF}>Book the 20-minute assessment</PrimaryCTA>
        <SecondaryCTA href="/pricing">See pricing</SecondaryCTA>
      </CtaBand>
    </div>
  )
}

/* ─── Persistent CTA pill ─────────────────────────────────────── */
// The deck wants a CTA that is always reachable from about minute twelve.
// Rather than watch playback progress, this rides the scroll: sticky from the
// moment the reader leaves the hero, settling at the end of the range, where
// the closing CTA takes over.
// Zero-height on purpose: the pill hangs above the sticky point, so it adds no
// strip of its own to the layout, and the row around it is click-through.

function StickyCta() {
  return (
    <div className="pointer-events-none sticky bottom-0 z-40 h-0">
      <div className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-[var(--qs-gutter)]">
        <div className="qs-dark pointer-events-auto flex items-center gap-4 rounded-[var(--qs-r-pill)] border border-white/15 py-1.5 pr-1.5 pl-5 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.5)]">
          <span className="qs-small">
            <span className="font-medium text-white">Seen enough?</span>{" "}
            {/* The qualifier is a nicety on a wide bar and a second wrapped line
                on a phone, where the sticky bar was taking 17% of the viewport. */}
            <span className="hidden sm:inline">Twenty minutes on your numbers.</span>
          </span>
          {/* Short label deliberately: "Book the assessment" wraps to two lines
              inside the button at 375px and doubles the bar's height. The full
              phrasing lives on the hero and closing CTAs. */}
          <PrimaryCTA href={BOOKING_HREF}>Book a call</PrimaryCTA>
        </div>
      </div>
    </div>
  )
}
