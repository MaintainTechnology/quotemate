// QuoteMate home — Maintain design system: dark navy canvas, orange
// accent, all-caps display, signature numbered cards, restraint over
// decoration. The hero carries a live SMS-thread demo so the product
// shows itself rather than being described twice.

import Link from "next/link"
import AuthNav from "./AuthNav"
import { Reveal } from "./_components/Reveal"

/* Load-time choreography classes. Tailwind scans for literal strings,
   so these stay static; per-element stagger is an inline
   animation-delay (inert when motion-safe: withholds the animation). */
const RISE =
  "motion-safe:animate-[rise_640ms_cubic-bezier(0.22,1,0.36,1)_both]"
const POP =
  "motion-safe:animate-[pop-in_420ms_cubic-bezier(0.22,1,0.36,1)_both]"

export const metadata = {
  title: "QuoteMate — AI receptionist for Australian tradies",
  description:
    "Customer texts. AI drafts a Good / Better / Best quote. You review, send. For sparkies and plumbers who'd rather be on the tools.",
}

export default function Home() {
  return (
    <>
      {/* ═══════════════ NAV ═══════════════ */}
      <Nav />

      {/* ═══════════════ HERO ═══════════════ */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <Topography />
        {/* Scroll-reveal fallback for no-JS visitors — content must
            never stay hidden behind the observer. */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        <div className="relative z-10 mx-auto grid max-w-[88rem] gap-12 px-6 py-20 md:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <div className={RISE}>
              <Eyebrow>AI receptionist · AU tradies · v5 live</Eyebrow>
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
              Your customer texts your QuoteMate number. The AI asks the
              right questions, applies your pricing book, and a clean
              Good / Better / Best quote lands in under a minute. You
              review, tweak, send.
            </p>
            <div
              className={`mt-9 flex flex-wrap items-center gap-3 ${RISE}`}
              style={{ animationDelay: "370ms" }}
            >
              <AuthNav variant="hero" />
              <SecondaryCTA href="/docs/tradie-onboarding-plan">
                See how it works
              </SecondaryCTA>
            </div>
            <p
              className={`mt-6 font-mono text-xs uppercase tracking-[0.12em] text-text-dim ${RISE}`}
              style={{ animationDelay: "500ms" }}
            >
              ~3 min to sign up · No credit card · Test phase open
            </p>
          </div>

          <div
            className={`self-center ${RISE}`}
            style={{ animationDelay: "300ms" }}
          >
            <SmsDemo />
          </div>
        </div>
      </section>

      {/* ═══════════════ HOW IT WORKS (numbered cards) ═══════════════ */}
      <section id="how" className="border-b border-ink-line">
        <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
          <Reveal className="max-w-3xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
              Three steps.{" "}
              <span className="text-accent">
                No calls answered at 11pm.
              </span>
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-4">
            <Reveal>
              <NumberedCard
                num="01"
                title="Customer texts your number"
                body="Each tradie gets a dedicated AU number. Voice or SMS — both paths feed the same AI receptionist while you stay on the tools."
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

      {/* ═══════════════ TRADES + SCOPE ═══════════════ */}
      <section id="scope" className="border-b border-ink-line">
        <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
          <Reveal className="max-w-3xl">
            <Eyebrow>What it quotes</Eyebrow>
            <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
              Straightforward jobs <span className="text-accent">auto-quote</span>.
              <br />
              The tricky ones book a site visit.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-8 md:grid-cols-2">
            <Reveal>
              <TradePanel
                label="Electrical"
                state="NSW · NECA pilot"
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
                state="QLD · QBCC pilot"
                auto={[
                  "Blocked drains",
                  "Hot water replace",
                  "Tap repair",
                  "Tap replace",
                  "Toilet repair",
                  "Toilet replace",
                ]}
                inspection={[
                  "Gas fitting",
                  "Burst pipe",
                  "Bathroom renovation",
                ]}
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════════ NUMBERS ═══════════════ */}
      <section className="border-b border-ink-line">
        <div className="mx-auto grid max-w-[88rem] grid-cols-2 gap-x-6 gap-y-12 px-6 py-20 md:grid-cols-4">
          <Reveal>
            <Stat value="< 1 min" label="Per quote drafted" />
          </Reveal>
          <Reveal delay={90}>
            <Stat value="2" label="Trades live" />
          </Reveal>
          <Reveal delay={180}>
            <Stat value="3" label="Tiers per quote" />
          </Reveal>
          <Reveal delay={270}>
            <Stat value="$99" label="Locked site-visit price" />
          </Reveal>
        </div>
      </section>

      {/* ═══════════════ STATUS / TRUST ═══════════════ */}
      <section className="border-b border-ink-line">
        <div className="mx-auto max-w-4xl px-6 py-24 md:py-28">
          <Reveal>
            <Eyebrow>Where we are</Eyebrow>
            <h2 className="mt-3 font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.75rem,3.5vw,2.75rem)]">
              <span className="text-accent">v5 multi-trade</span> shipped.
              <br />
              v6 self-serve onboarding is now.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
              Both pilots run on the same platform. Each tradie has their
              own number, pricing book, and AI receptionist tuned to their
              brand voice. Your turn is next.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <PrimaryCTA href="/signup">Get my QuoteMate</PrimaryCTA>
              <SecondaryCTA href="/docs/tradie-onboarding-plan">
                See the plan
              </SecondaryCTA>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════════ FOOTER ═══════════════ */}
      <Footer />

      {/* ═══════════════ ORANGE CTA BAR (signature) ═══════════════
          A slow ticker on motion-safe browsers; the track holds the
          line twice so the -50% loop is seamless. Reduced-motion (and
          no-JS) users see the static leading copy. */}
      <div className="overflow-hidden bg-accent py-5 text-white">
        <div className="flex w-max motion-safe:animate-[marquee_36s_linear_infinite]">
          {[0, 1].map((copy) => (
            <span
              key={copy}
              aria-hidden={copy === 1}
              className="flex shrink-0 items-center font-mono text-sm font-semibold uppercase tracking-[0.16em] md:text-base"
            >
              {[
                "QuoteMate",
                "Built in Australia",
                "For tradies, by tradies",
                "Quote drafted in under a minute",
                "Electrical NSW",
                "Plumbing QLD",
              ].map((line) => (
                <span key={line} className="flex items-center">
                  <span className="px-6">{line}</span>
                  <span aria-hidden="true">·</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </>
  )
}

/* ─── Nav ─────────────────────────────────────────────────────── */

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-ink-line bg-ink-deep/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[88rem] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center bg-accent text-xs font-black text-white">
            Q
          </span>
          <span className="font-extrabold uppercase tracking-tight text-text-pri">
            QuoteMate
          </span>
        </Link>
        <div className="hidden gap-8 text-sm font-medium text-text-sec md:flex">
          <a href="#how" className="link-underline pb-0.5 hover:text-text-pri">
            How
          </a>
          <a href="#scope" className="link-underline pb-0.5 hover:text-text-pri">
            Scope
          </a>
          <Link
            href="/docs/tradie-onboarding-plan"
            className="link-underline pb-0.5 hover:text-text-pri"
          >
            Plan
          </Link>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <AuthNav variant="nav" />
        </div>
      </div>
    </nav>
  )
}

/* ─── SMS demo card ───────────────────────────────────────────── */

// A live-example conversation rendered as plain content bubbles on the
// canvas — deliberately NOT wrapped in a fake phone frame. It shows the
// intake → quote path in four messages, then a sample drafted quote.
// The thread plays itself once on load: each message pops in on a
// timeline, then the drafted quote lands — the product demos itself.
function SmsDemo() {
  return (
    <div className="border border-ink-line bg-ink-card">
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
          Hey mate — need 6 downlights in the lounge. What&rsquo;s it
          cost?
        </Bubble>
        <Bubble side="out" at={1500}>
          No worries. All new fittings, or swapping existing? And is
          there roof-space access?
        </Bubble>
        <Bubble side="in" at={2300}>
          All new. Roof access is easy.
        </Bubble>
        <Bubble side="out" at={3100}>
          Got it — drafting your Good / Better / Best quote now.
        </Bubble>
      </div>

      <div
        className={`border-t border-ink-line bg-ink-deep/50 px-4 py-4 ${RISE}`}
        style={{ animationDelay: "3900ms" }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Quote drafted · 41s
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
      className={`bg-ink-card px-3 py-3 text-center ${at ? POP : ""}`}
      style={at ? { animationDelay: `${at}ms` } : undefined}
    >
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
    </div>
  )
}

/* ─── Footer ──────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer>
      <div className="mx-auto grid max-w-[88rem] gap-10 px-6 py-16 md:grid-cols-[1.6fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center bg-accent text-xs font-black text-white">
              Q
            </span>
            <span className="font-extrabold uppercase tracking-tight text-text-pri">
              QuoteMate
            </span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-dim">
            The AI receptionist that drafts Good / Better / Best quotes
            for Australian electricians and plumbers.
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            { label: "How it works", href: "#how" },
            { label: "Trades & scope", href: "#scope" },
            { label: "The plan", href: "/docs/tradie-onboarding-plan" },
          ]}
        />
        <FooterCol
          title="Account"
          links={[
            { label: "Sign in", href: "/signin" },
            { label: "Get started", href: "/signup" },
          ]}
        />
      </div>
      <div className="border-t border-ink-line">
        <div className="mx-auto flex max-w-[88rem] flex-col gap-2 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
            © 2026 QuoteMate
          </span>
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
            Electrical NSW · Plumbing QLD · Test phase
          </span>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({
  title,
  links,
}: {
  title: string
  links: { label: string; href: string }[]
}) {
  return (
    <div>
      <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {title}
      </span>
      <ul className="mt-4 grid gap-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="link-underline pb-0.5 text-sm text-text-sec hover:text-text-pri"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ─── Primitives ──────────────────────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-text-dim">
      {children}
    </span>
  )
}

function PrimaryCTA({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 bg-accent px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
    >
      {children}
      <Arrow />
    </Link>
  )
}

function SecondaryCTA({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 border border-ink-line bg-transparent px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-text-dim hover:bg-ink-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
    >
      {children}
    </Link>
  )
}

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
    <article className="group card-sweep border border-ink-line bg-ink-card p-6 transition-colors duration-300 hover:border-accent/40 hover:bg-ink md:p-10">
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
    <div className="card-sweep h-full border border-ink-line bg-ink-card p-6 transition-colors duration-300 hover:border-accent/30 md:p-8">
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
              <span className="font-mono text-xs text-accent">→</span>
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
              className="flex items-baseline gap-3 text-sm text-text-dim md:text-base"
            >
              <span className="font-mono text-xs text-text-dim">○</span>
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
      <div className="font-mono font-bold leading-none tracking-tight text-accent text-[clamp(2.5rem,5vw,4.25rem)]">
        {value}
      </div>
      <div className="mt-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
    </div>
  )
}

function Arrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

function Topography() {
  // Two ridge groups drifting in opposite directions at glacial speed —
  // the canvas reads as alive without ever announcing itself. The
  // accent ridge is the one warm line in the teal field.
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="var(--teal-glow)"
        strokeWidth="1"
        className="motion-safe:animate-[topo-drift_26s_ease-in-out_infinite_alternate]"
      >
        <path d="M0,820 Q240,700 480,760 T960,720 T1440,780 T1920,740 T2400,760" />
        <path
          d="M0,920 Q240,820 480,850 T960,830 T1440,880 T1920,850 T2400,870"
          opacity="0.5"
        />
        <path
          d="M0,1020 Q240,940 480,960 T960,940 T1440,980 T1920,960 T2400,970"
          opacity="0.2"
        />
      </g>
      <g
        fill="none"
        strokeWidth="1"
        className="motion-safe:animate-[topo-drift_34s_ease-in-out_infinite_alternate-reverse]"
      >
        <path
          d="M0,870 Q240,760 480,800 T960,780 T1440,830 T1920,800 T2400,820"
          stroke="var(--accent)"
          opacity="0.45"
        />
        <path
          d="M0,970 Q240,880 480,900 T960,880 T1440,930 T1920,900 T2400,915"
          stroke="var(--teal-glow)"
          opacity="0.35"
        />
      </g>
    </svg>
  )
}
