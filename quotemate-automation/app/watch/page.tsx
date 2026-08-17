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
// Built on the shared marketing chrome (Nav/Footer/MarqueeBar) so it cannot
// drift from / and /pricing.

import { Reveal } from "../_components/Reveal"
import {
  Nav,
  Footer,
  MarqueeBar,
  Topography,
  Eyebrow,
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
    <div className="marketing-canvas">
      <div className="noise-overlay" aria-hidden="true" />
      <Nav />
      <Hero />
      {/* Everything below the hero shares one wrapper so the CTA bar can be a
          plain `sticky bottom-0` child — pinned to the viewport while the
          reader is in this range, settling inline at the end. No JS. */}
      <div className="relative">
        <Chapters />
        <Benefits />
        <RoiBand />
        <Objections />
        <WhatHappensNext />
        <ClosingCta />
        <StickyCta />
      </div>
      <Footer />
      <MarqueeBar />
    </div>
  )
}

/* ─── Hero + the video itself ─────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-ink-line">
      <Topography />
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      {/* Tighter than the /pricing hero (py-20 md:py-28) on purpose: every
          pixel of chrome here pushes the player further below the fold. */}
      <div className="relative z-10 mx-auto max-w-[88rem] px-6 py-12 md:py-16">
        <Reveal className="max-w-3xl">
          <Eyebrow>You&rsquo;re in &middot; 15 minutes</Eyebrow>
          <h1 className="mt-6 font-extrabold uppercase leading-[0.98] tracking-[-0.04em] text-[clamp(2.2rem,5.5vw,4.5rem)]">
            Every lead quoted{" "}
            <span className="text-accent">the same day.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-text-sec">
            No slide deck. A real screen recording of an enquiry going in and a
            finished quote coming out, then the numbers on what quoting after
            hours is actually costing you. Watch it once and you&rsquo;ll know
            whether this fits your business.
          </p>
        </Reveal>

        <Reveal delay={120}>
          {/* Capped rather than run to the 88rem gutter: 16:9 at the full
              content width is 765px tall on a desktop, which pushes the player
              and its CTA outside the fold on the one page where the video is
              the whole point. */}
          <div className="mt-12 max-w-5xl">
            <VideoFrame />
          </div>
        </Reveal>

        <Reveal delay={200}>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryCTA href={BOOKING_HREF}>
              Book the 20-minute assessment
            </PrimaryCTA>
            <SecondaryCTA href="/pricing">See pricing</SecondaryCTA>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-text-dim">
            Prefer to watch first? The button is here when you&rsquo;re done.
            The assessment is a look at your own numbers, not a cold sales call.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function VideoFrame() {
  return (
    <div className="edge-lit overflow-hidden border border-ink-line bg-ink-card">
      <div className="relative aspect-video w-full">
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <PlayGlyph />
            <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-text-dim">
              The 15-minute walkthrough
            </span>
            <span className="max-w-sm text-sm leading-relaxed text-text-dim">
              Player placeholder — set VIDEO_SRC in this file once the recording
              is hosted.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function PlayGlyph() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="0.5"
        width="55"
        height="55"
        stroke="var(--accent)"
        strokeWidth="1"
      />
      <path d="M22 17 L40 28 L22 39 Z" fill="var(--accent)" />
    </svg>
  )
}

/* ─── What the 15 minutes covers (deck slide 06) ──────────────── */

const CHAPTERS = [
  {
    time: "0–4m",
    title: "The problem, and the promise",
    body: "Six enquiries in, three quotes owed, and the pricing still to do tonight. Slow quotes lose jobs — this is the cost of the way it works now.",
  },
  {
    time: "4–9m",
    title: "Watch it actually work",
    body: "A real screen recording. A lead comes in, a clean quote goes out, the follow-up runs itself. No mock-ups, no edits between the enquiry and the price.",
  },
  {
    time: "9–14m",
    title: "The numbers, and your questions",
    body: "What the hours are worth, what one extra won job a month is worth, and straight answers to the four things every owner asks before they commit.",
  },
]

function Chapters() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-20 md:py-24">
        <Reveal className="max-w-3xl">
          <Eyebrow>What&rsquo;s in it</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            Fifteen minutes,{" "}
            <span className="text-accent">three parts.</span>
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {CHAPTERS.map((c, i) => (
            <Reveal key={c.time} delay={i * 110}>
              <article className="edge-lit h-full border border-ink-line bg-ink-card p-6 md:p-8">
                <span className="font-mono text-3xl font-bold leading-none tabular-nums text-accent md:text-4xl">
                  {c.time}
                </span>
                <h3 className="mt-5 text-lg font-extrabold uppercase tracking-tight text-text-pri">
                  {c.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-text-sec">
                  {c.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── Key benefits ────────────────────────────────────────────── */

const BENEFITS = [
  {
    title: "Same-day quoting. Guaranteed.",
    body: "Every enquiry that lands gets a real quote back the same day. Not a callback, not a “we’ll get to it” — a priced quote, while they still care.",
  },
  {
    title: "It answers when you can’t.",
    body: "Text, phone call or web form. Nine o’clock on a Tuesday, up a ladder, mid-job — QuoteMax picks it up and starts the quote without you.",
  },
  {
    title: "Priced from your book, not a guess.",
    body: "Your rates, your materials, your margins, your exclusions. Every figure on the quote traces back to a number you set. Nothing is invented.",
  },
  {
    title: "Exceptions come to you. Nothing else does.",
    body: "Anything that can’t be safely priced from a photo and a description routes to a paid site visit instead. You handle the hard ones, not all of them.",
  },
  {
    title: "Get your nights back.",
    body: "Ten hours a week on quoting is over 500 hours a year. That’s the block of your life this takes back, and it starts the week you go live.",
  },
  {
    title: "Configured with you, not dumped on you.",
    body: "We set it up around how you already quote, load your pricing, and train it on your past quotes. You approve the output before anything goes live.",
  },
]

function Benefits() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>What you actually get</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            We do <span className="text-accent">the quoting.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            QuoteMax is not another app to keep on top of. It is the quoting
            taken off your plate — answered, priced, sent and followed up.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b, i) => (
            <Reveal key={b.title} delay={(i % 3) * 110}>
              <article className="edge-lit h-full border border-ink-line bg-ink-card p-6 transition-colors duration-300 hover:border-text-dim md:p-8">
                <h3 className="text-lg font-extrabold uppercase leading-tight tracking-tight text-text-pri">
                  {b.title}
                </h3>
                <p className="mt-4 text-base leading-relaxed text-text-sec">
                  {b.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── ROI band (deck slide 07) ────────────────────────────────── */

function RoiBand() {
  return (
    <section className="border-b border-ink-line bg-ink/40">
      <div className="mx-auto max-w-[88rem] px-6 py-20 md:py-24">
        <Reveal className="max-w-3xl">
          <Eyebrow>The maths</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.7rem,3.4vw,2.6rem)]">
            Save the admin. Quote faster.{" "}
            <span className="text-accent">Win more work.</span>
          </h2>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-3">
          <Reveal>
            <Stat value="500+" label="Hours a year quoting" />
          </Reveal>
          <Reveal delay={110}>
            <Stat value="A$50k+" label="Of owner time" />
          </Reveal>
          <Reveal delay={220}>
            <Stat value="A$120k" label="Added revenue" />
          </Reveal>
        </div>
        <Reveal delay={280}>
          <p className="mt-12 max-w-3xl text-lg leading-relaxed text-text-sec">
            Ten hours a week quoting is{" "}
            <span className="font-semibold text-text-pri">
              500+ hours a year
            </span>
            . Win one extra A$10k job a month and that is{" "}
            <span className="font-semibold text-accent">A$120k</span> more
            revenue. The video walks through both numbers with real figures.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono font-bold leading-tight tracking-tight text-accent text-[clamp(2.25rem,4.5vw,3.75rem)]">
        {value}
      </div>
      <div className="mt-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
    </div>
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
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>Fair questions</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            The four things{" "}
            <span className="text-accent">everyone asks.</span>
          </h2>
        </Reveal>
        <dl className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {OBJECTIONS.map((it, i) => (
            <Reveal key={it.q} delay={(i % 2) * 90}>
              <div className="border-t border-ink-line pt-6">
                <dt className="text-lg font-extrabold uppercase tracking-tight text-text-pri">
                  {it.q}
                </dt>
                <dd className="mt-3 max-w-prose text-base leading-relaxed text-text-sec">
                  {it.a}
                </dd>
              </div>
            </Reveal>
          ))}
        </dl>
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
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>After the video</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            A 20-minute assessment,{" "}
            <span className="text-accent">not a cold discovery.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            We already have your leads, your quote volume and your average job
            value from the form. The call is spent on where the hours are going
            and what your business looks like without them — then, if it fits,
            how we get you live.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GO_LIVE.map((s, i) => (
            <Reveal key={s.num} delay={i * 90}>
              <article className="edge-lit h-full border border-ink-line bg-ink-card p-6 md:p-7">
                <span className="font-mono text-3xl font-bold leading-none text-accent md:text-4xl">
                  {s.num}
                </span>
                <h3 className="mt-5 text-base font-extrabold uppercase tracking-tight text-text-pri">
                  {s.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-text-sec">
                  {s.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── Closing CTA ─────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-4xl px-6 py-24 md:py-28">
        <Reveal>
          <h2 className="font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
            Stop quoting at nine at night.{" "}
            <span className="text-accent">Book the assessment.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            Twenty minutes, your numbers, no obligation. If QuoteMax isn&rsquo;t
            right for your business we&rsquo;ll tell you on the call.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <PrimaryCTA href={BOOKING_HREF}>
              Book the 20-minute assessment
            </PrimaryCTA>
            <SecondaryCTA href="/pricing">See pricing</SecondaryCTA>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── Persistent CTA bar ──────────────────────────────────────── */
// The deck wants a CTA that is always reachable from about minute twelve.
// Rather than watch playback progress, this rides the scroll: sticky from the
// moment the reader leaves the hero, inline once they reach the bottom.

function StickyCta() {
  return (
    <div className="sticky bottom-0 z-40 border-t border-ink-line bg-ink-deep/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[88rem] items-center justify-between gap-4 px-6 py-3 md:py-4">
        <span className="text-sm font-semibold uppercase tracking-wide text-text-pri">
          Seen enough?{" "}
          {/* The qualifier is a nicety on a wide bar and a second wrapped line
              on a phone, where the sticky bar was taking 17% of the viewport. */}
          <span className="hidden font-normal normal-case text-text-sec sm:inline">
            Twenty minutes on your numbers.
          </span>
        </span>
        {/* Short label deliberately: "Book the assessment" wraps to two lines
            inside the button at 375px and doubles the bar's height. The full
            phrasing lives on the hero and closing CTAs. */}
        <PrimaryCTA href={BOOKING_HREF}>Book a call</PrimaryCTA>
      </div>
    </div>
  )
}
