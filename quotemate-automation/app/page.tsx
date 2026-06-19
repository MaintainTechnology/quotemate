// QuoteMate home — Maintain design system, premium "command-centre"
// reinvention. Deep navy canvas, orange accent, all-caps display, square
// corners, borders over shadows. Depth comes from a restrained twin glow
// + film grain + lit panel edges (see globals.css), never from drop
// shadows. The hero carries a live SMS-thread demo so the product shows
// itself rather than being described twice.
//
// Shared chrome (Nav/Footer/MarqueeBar/CTAs) lives in _components/site so
// it stays identical to /pricing; the pricing cards come from the shared
// PricingTiers client island.

import AuthNav from "./AuthNav"
import { Reveal } from "./_components/Reveal"
import {
  Nav,
  Footer,
  MarqueeBar,
  Topography,
  Eyebrow,
  PrimaryCTA,
  SecondaryCTA,
} from "./_components/site"
import { PricingTiers } from "./_components/PricingTiers"

/* Load-time choreography classes. Tailwind scans for literal strings,
   so these stay static; per-element stagger is an inline
   animation-delay (inert under prefers-reduced-motion). */
const RISE =
  "motion-safe:animate-[rise_640ms_cubic-bezier(0.22,1,0.36,1)_both]"
const POP =
  "motion-safe:animate-[pop-in_420ms_cubic-bezier(0.22,1,0.36,1)_both]"

export const metadata = {
  title: "QuoteMate: AI receptionist for Australian tradies",
  description:
    "Customer texts. AI drafts a Good / Better / Best quote in under a minute. You review, tweak, send. Built for AU sparkies and plumbers who'd rather be on the tools.",
  openGraph: {
    title: "QuoteMate: AI receptionist for Australian tradies",
    description:
      "Customer texts your number. AI asks the right questions, applies your pricing book, and drafts a Good / Better / Best quote in under a minute.",
    type: "website",
  },
}

export default function Home() {
  return (
    <div className="marketing-canvas">
      {/* Film grain over the whole page — fixed, non-interactive. */}
      <div className="noise-overlay" aria-hidden="true" />

      <Nav />
      <Hero />
      <TrustStrip />
      <HowItWorks />
      <Trades />
      <Shift />
      <Numbers />
      <Pricing />
      <Faq />
      <ClosingCta />
      <Footer />
      <MarqueeBar />
    </div>
  )
}

/* ─── Hero ────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-ink-line">
      <Topography />
      {/* Scroll-reveal fallback for no-JS visitors — content must never
          stay hidden behind the observer. */}
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <div className="relative z-10 mx-auto grid max-w-[88rem] items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <div className={RISE}>
            <Eyebrow>AI receptionist for Australian tradies</Eyebrow>
          </div>
          <h1
            className={`mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.04em] text-[clamp(2.6rem,6.5vw,5.5rem)] [overflow-wrap:anywhere] ${RISE}`}
            style={{ animationDelay: "110ms" }}
          >
            Drafts your <span className="text-accent">quote</span>
            <br />
            before they <span className="text-accent">hang up.</span>
          </h1>
          <p
            className={`mt-7 max-w-xl text-lg leading-relaxed text-text-sec ${RISE}`}
            style={{ animationDelay: "240ms" }}
          >
            Customers text your QuoteMate number. The AI asks the right
            questions, applies your pricing book, and drafts a clean Good /
            Better / Best quote in under a minute. You review, tweak, send.
          </p>
          <div
            className={`mt-9 flex flex-wrap items-center gap-3 ${RISE}`}
            style={{ animationDelay: "370ms" }}
          >
            <AuthNav variant="hero" />
            <a
              href="#how"
              className="inline-flex items-center gap-2 border border-ink-line bg-transparent px-7 py-4 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-text-dim hover:bg-ink-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
            >
              See how it works
            </a>
          </div>
        </div>

        <div
          className={`self-center ${RISE}`}
          style={{ animationDelay: "300ms" }}
        >
          <SmsDemo />
        </div>
      </div>
    </section>
  )
}

/* ─── Trust strip ─────────────────────────────────────────────── */
// Honest credibility, directly under the hero (kept OUT of the hero so
// the value-prop stands alone). No fake logos, no fabricated reviews —
// the real stack and the pilot status are the trust signal.
function TrustStrip() {
  return (
    <section className="border-b border-ink-line bg-ink/40">
      <div className="mx-auto flex max-w-[88rem] flex-col gap-5 px-6 py-7 lg:flex-row lg:items-center lg:justify-between">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <TrustChip icon={<PinIcon />}>Built in Australia</TrustChip>
          <TrustChip>Electrical pilot · NSW</TrustChip>
          <TrustChip>Plumbing pilot · QLD</TrustChip>
          <TrustChip icon={<LockIcon />}>Stripe-secured deposits</TrustChip>
          <TrustChip>Free trial · Starter Monthly</TrustChip>
        </ul>
        <p className="shrink-0 font-mono text-xs uppercase tracking-[0.14em] text-text-dim">
          Runs on Twilio, Stripe and Claude
        </p>
      </div>
    </section>
  )
}

function TrustChip({
  icon,
  children,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="inline-flex items-center gap-2 border border-ink-line px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-text-dim">
      {icon ? (
        <span className="text-accent-soft" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </li>
  )
}

/* ─── How it works (numbered timeline) ────────────────────────── */

function HowItWorks() {
  return (
    <section id="how" className="border-b border-ink-line scroll-mt-20">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
            Three steps.{" "}
            <span className="text-accent">You stay on the tools.</span>
          </h2>
        </Reveal>

        {/* The spine sits behind the number column and connects the steps. */}
        <div className="relative mt-14 grid gap-4">
          <div
            className="timeline-spine pointer-events-none absolute left-[2.1rem] top-10 bottom-10 hidden w-px md:block"
            aria-hidden="true"
          />
          <Reveal>
            <NumberedCard
              num="01"
              title="Customer texts your number"
              body="Each tradie gets a dedicated AU number. Voice or SMS, both feed the same AI receptionist while you stay on the tools."
            />
          </Reveal>
          <Reveal delay={110}>
            <NumberedCard
              num="02"
              title="AI drafts the quote"
              body="Claude asks the right questions for the job type, applies your pricing book, and writes Good / Better / Best line items in under a minute."
            />
          </Reveal>
          <Reveal delay={220}>
            <NumberedCard
              num="03"
              title="You review, send, get paid"
              body="The quote lands in your dashboard. Approve as-is or tweak it. The customer pays a deposit via Stripe and the job is booked."
            />
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/* ─── Trades + scope ──────────────────────────────────────────── */

function Trades() {
  return (
    <section id="scope" className="border-b border-ink-line scroll-mt-20">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <h2 className="font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
            Straightforward jobs{" "}
            <span className="text-accent">auto-quote</span>.
            <br />
            The tricky ones book a site visit.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-8 md:grid-cols-2">
          <Reveal>
            <TradePanel
              label="Electrical"
              state="NSW · Electrical pilot"
              auto={[
                "Downlights",
                "Power points (GPOs)",
                "Ceiling fans",
                "Smoke alarms",
                "Outdoor lighting",
              ]}
              inspection={[
                "Switchboard upgrade",
                "EV charger",
                "Fault finding",
                "Oven / cooktop",
                "Renovation",
              ]}
            />
          </Reveal>
          <Reveal delay={130}>
            <TradePanel
              label="Plumbing"
              state="QLD · Plumbing pilot"
              auto={[
                "Blocked drains",
                "Hot water replacement",
                "Tap repair",
                "Tap replacement",
                "Toilet repair",
                "Toilet replacement",
              ]}
              inspection={["Gas fitting", "Burst pipe", "Bathroom renovation"]}
            />
          </Reveal>
        </div>

        <Reveal delay={120}>
          <div className="edge-lit mt-8 flex flex-col items-start justify-between gap-5 border border-ink-line bg-ink-card p-6 md:flex-row md:items-center md:p-8">
            <p className="max-w-2xl text-base leading-relaxed text-text-sec md:text-lg">
              Carpenters, painters, roofers and HVAC: tell us your trade and
              we&rsquo;ll line you up for the next pilot.
            </p>
            <SecondaryCTA href="/signup">Request your trade</SecondaryCTA>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── The shift (pain → fix comparison) ───────────────────────── */

function Shift() {
  const rows = [
    {
      old: "Misses the call while you're up a ladder",
      now: "Answers every text and call the second it lands",
    },
    {
      old: "Quotes typed up at 11pm, after dinner",
      now: "Good / Better / Best drafted in under a minute",
    },
    {
      old: "Job goes to whoever's free to reply",
      now: "A clean quote in their hand while you're still on the job.",
    },
  ]
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <h2 className="font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
            The job goes to whoever quotes first.{" "}
            <span className="text-accent">Now that&rsquo;s you.</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-px border border-ink-line bg-ink-line">
          <div className="hidden grid-cols-[1fr_auto_1fr] items-center gap-6 bg-ink-deep px-6 py-4 md:grid">
            <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              The usual
            </span>
            <span aria-hidden="true" />
            <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent">
              With QuoteMate
            </span>
          </div>
          {rows.map((r, i) => (
            <Reveal key={r.old} delay={i * 90}>
              <div className="grid grid-cols-1 items-center gap-4 bg-ink-card px-6 py-6 md:grid-cols-[1fr_auto_1fr] md:gap-6 md:px-6">
                <p className="text-base leading-snug text-text-dim line-through decoration-text-dim/40 md:text-lg">
                  <span className="sr-only">The usual: </span>
                  {r.old}
                </p>
                <span
                  className="hidden shrink-0 font-mono text-accent md:block"
                  aria-hidden="true"
                >
                  →
                </span>
                <p className="text-base font-medium leading-snug text-text-pri md:text-lg">
                  <span className="sr-only">With QuoteMate: </span>
                  {r.now}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── Numbers ─────────────────────────────────────────────────── */

function Numbers() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto grid max-w-[88rem] grid-cols-2 gap-x-6 gap-y-12 px-6 py-20 md:grid-cols-4">
        <Reveal>
          <Stat value="< 1 min" label="Per quote drafted" />
        </Reveal>
        <Reveal delay={90}>
          <Stat value="24/7" label="Line always answered" />
        </Reveal>
        <Reveal delay={180}>
          <Stat value="3" label="Tiers per quote" />
        </Reveal>
        <Reveal delay={270}>
          <Stat value="$99" label="Locked site-visit price" />
        </Reveal>
      </div>
    </section>
  )
}

/* ─── Pricing (3-tier teaser → full /pricing page) ────────────── */

function Pricing() {
  return (
    <section id="pricing" className="border-b border-ink-line scroll-mt-20">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.9rem,3.8vw,3rem)]">
            Costs less than{" "}
            <span className="text-accent">one missed job.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            Pick a plan and your AI receptionist is quoting the same day —
            Starter Monthly comes with a 14-day free trial. We never take a cut
            of your jobs. The only fixed price is the $99 site visit, credited
            straight back to the job.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12">
            <PricingTiers variant="home" />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── FAQ (two-column Q&A, no accordion) ──────────────────────── */

function Faq() {
  const items = [
    {
      q: "Do I lose control of my pricing?",
      a: "No. The AI only ever uses your pricing book. Every quote lands in your dashboard for you to approve or tweak before it goes out.",
    },
    {
      q: "What about complex jobs?",
      a: "Anything non-standard books a $99 site visit instead of auto-quoting. You quote those the way you always have, with the deposit already paid.",
    },
    {
      q: "Whose number is it?",
      a: "Yours. Each tradie gets a dedicated Australian number. Customers text or call it; you stay on the tools.",
    },
    {
      q: "What does it cost?",
      a: "Plans start at $49/mo, and the Starter Monthly plan comes with a 14-day free trial — see the pricing page for the full breakdown. We never take a cut of your jobs; the only fixed price is the $99 site visit, credited back to the job.",
    },
    {
      q: "Which trades are live?",
      a: "Electrical in NSW and plumbing in QLD are piloting now. More trades are being onboarded, so tell us yours.",
    },
    {
      q: "How long does setup take?",
      a: "About three minutes. Connect your number, load your pricing book, and you're drafting quotes the same day.",
    },
  ]
  return (
    <section id="faq" className="border-b border-ink-line scroll-mt-20">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>Good questions</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
            The stuff tradies <span className="text-accent">actually</span> ask.
          </h2>
        </Reveal>
        <dl className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {items.map((it, i) => (
            <Reveal key={it.q} delay={(i % 2) * 90}>
              <div className="border-t border-ink-line pt-6">
                <dt className="font-extrabold uppercase tracking-tight text-text-pri text-lg">
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

/* ─── Closing CTA ─────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-4xl px-6 py-24 md:py-28">
        <Reveal>
          <h2 className="font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
            <span className="text-accent">Both pilots</span> are live.
            <br />
            Your turn is next.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            Both pilots run on the same platform. Each tradie gets their own
            number, pricing book, and AI receptionist tuned to their brand
            voice. Setup takes about three minutes.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <PrimaryCTA href="/signup">Get my QuoteMate</PrimaryCTA>
            <SecondaryCTA href="#how">See how it works</SecondaryCTA>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── SMS demo card ───────────────────────────────────────────── */

// A live-example conversation rendered as plain content bubbles on the
// canvas — deliberately NOT wrapped in a fake phone frame. It shows the
// intake → quote path, plays itself once on load (each message pops in on
// a timeline), ends on a typing indicator, then the drafted quote lands.
function SmsDemo() {
  return (
    <div className="edge-lit border border-ink-line bg-ink-card">
      <div className="flex items-center justify-between border-b border-ink-line px-4 py-3">
        <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          Live example · SMS intake
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-teal-glow">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-glow motion-safe:animate-[pulse-soft_2.4s_ease-in-out_infinite]" />
          Online
        </span>
      </div>

      <div className="space-y-3 px-4 py-5">
        <Bubble side="in" at={700}>
          Hey mate, need 6 downlights in the lounge. What&rsquo;s it cost?
        </Bubble>
        <Bubble side="out" at={1500}>
          All new fittings, or swapping existing? And is there roof-space
          access?
        </Bubble>
        <Bubble side="in" at={2300}>
          All new. Roof access is easy.
        </Bubble>
        <TypingBubble at={3100} />
      </div>

      <div
        className={`border-t border-ink-line bg-ink-deep/50 px-4 py-4 ${RISE}`}
        style={{ animationDelay: "3900ms" }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Quote drafted · under a minute
          </span>
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-text-dim">
            Sample
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-px border border-ink-line bg-ink-line">
          <TierMini name="Good" price="$680" at={4150} />
          <TierMini name="Better" price="$890" at={4300} />
          <TierMini name="Best" price="$1,150" best at={4450} />
        </div>
      </div>
    </div>
  )
}

function Bubble({
  side,
  at,
  children,
}: {
  side: "in" | "out"
  /** When this message lands on the demo timeline (ms after load). */
  at: number
  children: React.ReactNode
}) {
  const inbound = side === "in"
  return (
    <div
      className={`${inbound ? "flex justify-start" : "flex justify-end"} ${POP}`}
      style={{ animationDelay: `${at}ms` }}
    >
      <div
        className={`max-w-[86%] border px-3.5 py-2.5 text-sm leading-snug ${
          inbound
            ? "border-ink-line bg-ink-deep text-text-sec"
            : "border-accent/35 bg-accent/10 text-text-pri"
        }`}
      >
        {!inbound && (
          <span className="mb-1 block font-mono text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-accent">
            QuoteMate AI
          </span>
        )}
        {children}
      </div>
    </div>
  )
}

// The receptionist "thinking" just before the quote drops — three dots
// bouncing in sequence. Pops onto the timeline, then bounces in place.
function TypingBubble({ at }: { at: number }) {
  return (
    <div
      className={`flex justify-end ${POP}`}
      style={{ animationDelay: `${at}ms` }}
    >
      <div
        className="flex items-center gap-1.5 border border-accent/35 bg-accent/10 px-3.5 py-3"
        role="status"
        aria-label="QuoteMate is drafting the quote"
      >
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="h-1.5 w-1.5 rounded-full bg-accent-soft motion-safe:animate-[typing-bounce_1.3s_ease-in-out_infinite]"
            style={{ animationDelay: `${at + d * 160}ms` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  )
}

function TierMini({
  name,
  price,
  best,
  at,
}: {
  name: string
  price: string
  best?: boolean
  /** Demo-timeline arrival (ms after load) — tiers land one by one. */
  at?: number
}) {
  return (
    <div
      className={`relative bg-ink-card px-3 py-3 text-center ${at ? POP : ""}`}
      style={at ? { animationDelay: `${at}ms` } : undefined}
    >
      {best && (
        <span
          className="absolute inset-x-0 top-0 h-0.5 bg-accent"
          aria-hidden="true"
        />
      )}
      <div className="font-mono text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {name}
      </div>
      <div
        className={`mt-1.5 font-mono text-base font-bold tabular-nums ${
          best ? "text-accent" : "text-text-pri"
        }`}
      >
        {price}
      </div>
      {best && (
        <div className="mt-1 font-mono text-[0.5rem] font-semibold uppercase tracking-[0.14em] text-accent-soft">
          Best value
        </div>
      )}
    </div>
  )
}

/* ─── Page-specific building blocks ───────────────────────────── */

function NumberedCard({
  num,
  title,
  body,
}: {
  num: string
  title: string
  body: string
}) {
  return (
    <article className="group card-sweep edge-lit relative border border-ink-line bg-ink-card p-6 transition-colors duration-300 hover:border-accent/40 hover:bg-ink md:p-10">
      <div className="flex items-start gap-6 md:gap-10">
        <span className="shrink-0 font-mono text-5xl font-bold leading-none text-accent/80 transition-[color,transform] duration-300 group-hover:translate-x-1 group-hover:text-accent md:text-7xl">
          {num}
        </span>
        <div className="min-w-0">
          <h3 className="font-extrabold uppercase tracking-tight text-text-pri text-xl md:text-2xl">
            {title}
          </h3>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec md:text-lg">
            {body}
          </p>
        </div>
      </div>
    </article>
  )
}

function TradePanel({
  label,
  state,
  auto,
  inspection,
}: {
  label: string
  state: string
  auto: string[]
  inspection: string[]
}) {
  return (
    <div className="card-sweep edge-lit h-full border border-ink-line bg-ink-card p-6 transition-colors duration-300 hover:border-accent/30 md:p-8">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-extrabold uppercase tracking-tight text-2xl md:text-3xl">
          {label}
        </h3>
        <span className="shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
          {state}
        </span>
      </div>

      <div className="mt-8">
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Auto-quoted
        </span>
        <ul className="mt-3 grid gap-2">
          {auto.map((it) => (
            <li
              key={it}
              className="flex items-baseline gap-3 text-sm text-text-sec md:text-base"
            >
              <span className="font-mono text-xs text-accent" aria-hidden="true">
                →
              </span>
              {it}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-7 border-t border-ink-line pt-7">
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          $99 site visit
        </span>
        <ul className="mt-3 grid gap-2">
          {inspection.map((it) => (
            <li
              key={it}
              className="flex items-baseline gap-3 text-sm text-text-sec md:text-base"
            >
              <span className="font-mono text-xs text-text-dim" aria-hidden="true">
                ○
              </span>
              {it}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono font-bold leading-tight tracking-tight text-accent text-[clamp(2.5rem,5vw,4.25rem)]">
        {value}
      </div>
      <div className="mt-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
    </div>
  )
}

/* ─── Icons (hand-rolled to match the brand Arrow: square caps, 1.75
   stroke — kept minimal, the brand prefers restraint over iconography) */

function PinIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}
