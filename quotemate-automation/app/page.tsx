// QuoteMax home — the "command-centre" design system: warm-charcoal canvas,
// Caterpillar-yellow accent, all-caps display, rounded corners, borders over
// shadows. Depth comes from a restrained twin glow
// + film grain + lit panel edges (see globals.css), never from drop
// shadows. The hero carries a live SMS-thread demo so the product shows
// itself rather than being described twice.
//
// Shared chrome (Nav/Footer/MarqueeBar/CTAs) lives in _components/site so
// it stays identical to /pricing; the pricing cards come from the shared
// PricingTiers client island.

import Link from "next/link"
import Image from "next/image"
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
import { DuotoneImage } from "./_components/DuotoneImage"
import CookieConsent from "./_components/CookieConsent"

/* Load-time choreography classes. Tailwind scans for literal strings,
   so these stay static; per-element stagger is an inline
   animation-delay (inert under prefers-reduced-motion). */
const RISE =
  "motion-safe:animate-[rise_640ms_cubic-bezier(0.22,1,0.36,1)_both]"
const POP =
  "motion-safe:animate-[pop-in_420ms_cubic-bezier(0.22,1,0.36,1)_both]"

export const metadata = {
  title: "QuoteMax: We will do the quoting for you. You will never quote again",
  description:
    "Customer texts. QuoteMax drafts a quote in under a minute. You review, tweak, send. Built for AU sparkies and plumbers who'd rather be on the tools.",
  openGraph: {
    title: "QuoteMax: We will do the quoting for you. You will never quote again",
    description:
      "Customer texts your number. QuoteMax asks the right questions, applies your pricing book, and drafts a quote in under a minute.",
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
      <PoweredBy />
      <HowItWorks />
      <Trades />
      <Shift />
      <CoveredTrades />
      <Numbers />
      <Pricing />
      <BuiltForAustralia />
      <AppDownload />
      <Faq />
      <ClosingCta />
      <Footer />
      <MarqueeBar />
      <CookieConsent />
    </div>
  )
}

/* ─── Hero ────────────────────────────────────────────────────── */

// Two bands, not one column with a card bolted beside it:
//
//   row 1   [ pitch ............. | demo ........ ]
//   row 2   [ trade band, full width ............ ]
//
// The old layout put the filmstrip inside the left column, which made that
// column ~365px taller than the demo card and left the right half of the
// fold empty at desktop widths. Moving the strip to its own full-width row
// leaves two columns of near-equal height, and `items-stretch` + `h-full`
// on the demo makes them end on the same baseline at every breakpoint
// instead of relying on the copy staying a fixed length.
function Hero() {
  return (
    <section className="hero-band relative overflow-hidden border-b border-ink-line">
      <Topography />
      {/* Command-centre field (see globals.css): an engineering grid that
          fades downward, plus one warm ember behind the demo panel. Both
          are token-driven, so the hero has texture on the cream canvas as
          well as the charcoal one — the topography alone does not. */}
      <div
        className="hero-grid pointer-events-none absolute inset-0"
        aria-hidden="true"
      />
      <div
        className="hero-ember pointer-events-none absolute right-[-10%] top-[-15%] hidden aspect-square w-[42rem] motion-safe:animate-[ember-drift_24s_ease-in-out_infinite_alternate] lg:block"
        aria-hidden="true"
      />
      {/* Scroll-reveal fallback for no-JS visitors — content must never
          stay hidden behind the observer. */}
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <div className="relative z-10 mx-auto grid max-w-[88rem] gap-x-10 gap-y-12 px-6 py-20 md:py-24 lg:grid-cols-[1.06fr_0.94fr] lg:gap-x-16 xl:gap-x-24">
        {/* ── Pitch ─────────────────────────────────────────────── */}
        <div className="flex flex-col justify-center lg:col-start-1 lg:row-start-1">
          <div className={`mb-6 ${RISE}`}>
            <span className="inline-flex items-center gap-2 rounded-md border border-ink-line bg-ink/60 px-3 py-1.5 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-sec">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/au-flag.svg"
                alt="Australia"
                className="h-3.5 w-auto rounded-sm border border-ink-line/60"
              />
              Built for Australian tradies
            </span>
          </div>

          {/* Three deliberate lines of near-equal length. The old markup
              set two lines with a <br>, but each of those wrapped again in
              the column, so the break points were accidental. Each line is
              its own block so it also carries its own entrance delay and
              the headline assembles top-down. `hero-display` retunes the
              light-theme highlighter for display size (globals.css). */}
          <h1 className="hero-display font-extrabold uppercase leading-[0.95] tracking-[-0.04em] text-[clamp(2.5rem,5.8vw,5rem)] [overflow-wrap:anywhere]">
            <span className={`block ${RISE}`} style={{ animationDelay: "80ms" }}>
              Drafts your
            </span>
            <span
              className={`block ${RISE}`}
              style={{ animationDelay: "170ms" }}
            >
              <span className="text-accent">quote</span> before
            </span>
            <span
              className={`block ${RISE}`}
              style={{ animationDelay: "260ms" }}
            >
              they <span className="text-accent">hang up.</span>
            </span>
          </h1>

          <p
            className={`mt-7 max-w-xl text-lg leading-relaxed text-text-sec ${RISE}`}
            style={{ animationDelay: "360ms" }}
          >
            Customers text your QuoteMax number. QuoteMax asks the right
            questions, applies your pricing book, and drafts a clean quote in
            under a minute. You review, tweak, send.
          </p>

          <div
            className={`mt-9 flex flex-wrap items-center gap-3 ${RISE}`}
            style={{ animationDelay: "460ms" }}
          >
            <AuthNav variant="hero" />
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-lg border border-ink-line bg-transparent px-7 py-4 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-text-dim hover:bg-ink-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
            >
              See how it works
            </a>
          </div>

          <p
            className={`mt-5 text-sm text-text-dim ${RISE}`}
            style={{ animationDelay: "540ms" }}
          >
            Starter Monthly includes a 14-day free trial. Setup takes about
            three minutes.
          </p>
        </div>

        {/* ── Demo ──────────────────────────────────────────────── */}
        <div
          className={`h-full lg:col-start-2 lg:row-start-1 ${RISE}`}
          style={{ animationDelay: "300ms" }}
        >
          <SmsDemo />
        </div>

        {/* ── Trade band ────────────────────────────────────────────
            Full width under both columns. The tiles are links now: the
            same three photos appear as clickable trade cards further down
            the page, so an inert copy directly under the primary CTA was
            a dead end for anyone who tried to tap one. The first tile is
            the LCP image (preloaded); the rest lazy-load. */}
        <div
          className={`grid gap-2 sm:grid-cols-3 sm:gap-3 lg:col-span-2 ${RISE}`}
          style={{ animationDelay: "620ms" }}
        >
          <HeroTile
            href="/trades/electrical"
            src="/marketing/trade-electrical.jpg"
            alt="Australian electrician in a yellow hard hat testing a switchboard with a multimeter"
            caption="Electrical"
            position="center 30%"
            priority
          />
          {/* Below sm the three tiles would be ~104px wide — too narrow to
              hold their own captions, and too small to read as photographs.
              One full-width photo carries the same signal properly; the
              other trades are covered at length further down the page. */}
          <HeroTile
            href="/trades/plumbing"
            src="/marketing/trade-plumbing-2.jpg"
            alt="Plumber on her back under a kitchen sink, tightening the tap tailpiece with a wrench"
            caption="Plumbing"
            className="hidden sm:block"
          />
          <HeroTile
            href="/trades/solar"
            src="/marketing/trade-solar.jpg"
            alt="Two installers carrying a solar panel across a Colorbond roof to a half-finished array"
            caption="Solar"
            position="center 35%"
            className="hidden sm:block"
          />
        </div>
      </div>
    </section>
  )
}

// A single tile in the hero trade band — a brand-tinted photo linking
// through to that trade's page. The photo eases in slightly on hover
// (transform on the frame, clipped by the link's own overflow) so the
// tile reads as live without any layout cost.
function HeroTile({
  href,
  src,
  alt,
  caption,
  priority = false,
  position,
  className = "",
}: {
  href: string
  src: string
  alt: string
  caption: string
  priority?: boolean
  /** object-position override so a face isn't clipped by the crop. */
  position?: string
  /** Extra classes on the tile itself (e.g. hiding it below sm). */
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`edge-lit group relative block overflow-hidden rounded-xl border border-ink-line transition-colors hover:border-accent/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep ${className}`}
    >
      <DuotoneImage
        src={src}
        alt={alt}
        aspect="aspect-[16/10]"
        sizes="(max-width: 640px) 100vw, 31vw"
        priority={priority}
        tone="hero"
        position={position}
        className="transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:group-hover:scale-[1.04]"
      />
      <div className="photo-caption absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-3 pb-2.5 pt-8 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-white">
        {caption}
        <span
          className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5"
          aria-hidden="true"
        >
          &rarr;
        </span>
      </div>
    </Link>
  )
}

/* ─── Powered-by logo marquee ─────────────────────────────────── */
// The real stack that drafts the quotes and runs the voice agent, shown
// as a slow ticker in each brand's own colours. Logos are real brand SVGs
// under /public/brand — swap a file (same name) to update a mark. The
// track holds the set twice so the `marquee` keyframe (-50%) loops
// seamlessly; reduced-motion users see the static leading set.
//
// `art` is what the SVG actually contains, and it matters: only three of
// these marks ship with brand colour in the file. The rest are monochrome
// glyphs that would disappear against one theme or the other, so they are
// re-inked to the current theme instead (see --logo-mono-invert in
// globals.css). Getting this wrong is silent — the logo just vanishes.
//   colour = has its own brand colour, leave it alone
//   dark   = black artwork  (fine on paper, must invert on charcoal)
//   light  = white artwork  (fine on charcoal, must invert on paper)
type LogoArt = "colour" | "dark" | "light"
const POWERED_BY: {
  name: string
  logo: string
  art: LogoArt
  wordmark?: boolean
  /** Near-black brand colour that needs lifting on the dark canvas. */
  lift?: boolean
}[] = [
  { name: "Anthropic", logo: "/brand/anthropic.svg", art: "dark" },
  { name: "Gemini", logo: "/brand/gemini.svg", art: "dark" },
  { name: "Twilio", logo: "/brand/twilio.svg", art: "colour" },
  {
    name: "ElevenLabs",
    logo: "/brand/elevenlabs.svg",
    art: "dark",
    wordmark: true,
  },
  { name: "Deepgram", logo: "/brand/deepgram.svg", art: "colour" },
  { name: "Vapi", logo: "/brand/vapi.svg", art: "light" },
  { name: "Voyage", logo: "/brand/voyage.svg", art: "colour", lift: true },
]

function PoweredBy() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-14">
        <p className="text-center font-mono text-[0.75rem] font-semibold uppercase tracking-[0.24em] text-text-dim">
          Powered by
        </p>
        <div className="mt-8 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
          <div className="flex w-max items-center motion-safe:animate-[marquee_44s_linear_infinite] hover:[animation-play-state:paused]">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                aria-hidden={copy === 1}
                className="flex shrink-0 items-center"
              >
                {POWERED_BY.map((tool) => (
                  <span
                    key={tool.name}
                    className="flex items-center px-8 sm:px-14"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={tool.logo}
                      alt={tool.name}
                      className={`w-auto ${
                        tool.art === "dark"
                          ? "logo-mono"
                          : tool.art === "light"
                            ? "logo-mono-inv"
                            : tool.lift
                              ? "logo-lift"
                              : ""
                      } ${tool.wordmark ? "h-7 sm:h-9" : "h-10 sm:h-14"}`}
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
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

        <div className="mt-14 grid items-stretch gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-14">
          {/* The spine sits behind the number column and connects the steps. */}
          <div className="relative grid gap-4">
            <div
              className="timeline-spine pointer-events-none absolute left-[2.1rem] top-10 bottom-10 hidden w-px md:block"
              aria-hidden="true"
            />
            <Reveal>
              <NumberedCard
                num="01"
                title="Customer texts your number"
                body="Each tradie gets a dedicated AU number. Voice or SMS, both feed QuoteMax while you stay on the tools."
              />
            </Reveal>
            <Reveal delay={110}>
              <NumberedCard
                num="02"
                title="QuoteMax drafts the quote"
                body="QuoteMax asks the right questions for the job type, applies your pricing book, and writes the line items in under a minute."
              />
            </Reveal>
            <Reveal delay={220}>
              <NumberedCard
                num="03"
                title="You review, send, get paid"
                body="The quote lands in your dashboard. Approve as-is or tweak it. The customer pays a deposit and the job is booked."
              />
            </Reveal>
          </div>

          {/* A real tradesperson at the bench — the quoting runs itself so the
              work stays where it belongs. Hidden on small screens to keep the
              timeline the focus. */}
          <Reveal delay={120} className="hidden h-full lg:block">
            <figure className="edge-lit relative h-full overflow-hidden rounded-2xl border border-ink-line">
              <DuotoneImage
                src="/marketing/trade-carpentry.jpg"
                alt="Carpenter planing a length of timber by hand at a tidy workshop bench"
                aspect="aspect-[3/4] lg:aspect-auto lg:h-full"
                sizes="(max-width: 1024px) 0px, 32vw"
                position="center 30%"
              />
              <figcaption className="photo-caption absolute inset-x-0 bottom-0 p-5 pt-12">
                <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-white">
                  You stay on the tools
                </span>
              </figcaption>
            </figure>
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
              state="Live · NSW"
              image={{
                src: "/marketing/trade-electrical.jpg",
                alt: "Australian electrician in a yellow hard hat testing a switchboard with a multimeter",
                position: "center 25%",
              }}
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
              state="Live · QLD"
              image={{
                src: "/marketing/trade-plumbing.jpg",
                alt: "Plumber at an open bathroom vanity, tightening a supply line with a shifting spanner",
              }}
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

        {/* More trades on the same platform — roofing, solar and painting
            are live too, each clickable through to its trade page. */}
        <Reveal delay={120}>
          <div className="mt-8">
            <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              More trades
            </span>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <TradeTile
                href="/trades/roofing"
                src="/marketing/trade-roofing.jpg"
                alt="Roofer driving a screw into new corrugated Colorbond sheeting with a cordless driver"
                label="Roofing"
              />
              <TradeTile
                href="/trades/solar"
                src="/marketing/trade-solar.jpg"
                alt="Installers carrying a solar panel to a rooftop array on a suburban home"
                label="Solar"
                position="center 42%"
              />
              <TradeTile
                href="/trades/painting"
                src="/marketing/trade-painting.jpg"
                alt="Two painters rolling and cutting in fresh paint on an interior wall"
                label="Painting"
              />
            </div>
          </div>
        </Reveal>

        {/* Generic "request your trade" prompt. The workshop photo adds warmth
            without claiming a trade we don't yet support. */}
        <Reveal delay={180}>
          <div className="edge-lit mt-6 grid items-stretch gap-0 overflow-hidden rounded-2xl border border-ink-line bg-ink-card md:grid-cols-[1fr_1.3fr]">
            <DuotoneImage
              src="/marketing/workshop.jpg"
              alt="Tradesperson checking a finished part at a well-kept workshop bench"
              aspect="aspect-[4/3] md:aspect-auto md:h-full"
              sizes="(max-width: 768px) 100vw, 38vw"
              position="center 30%"
              className="md:border-r md:border-ink-line"
            />
            <div className="flex flex-col items-start justify-center gap-5 p-6 md:p-8">
              <p className="max-w-2xl text-base leading-relaxed text-text-sec md:text-lg">
                Not on the list yet? Carpenters, cabinetmakers, HVAC and the
                rest. Tell us your trade and we&rsquo;ll line you up for
                the next pilot.
              </p>
              <SecondaryCTA href="/signup">Request your trade</SecondaryCTA>
            </div>
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
      now: "A clean quote drafted in under a minute",
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

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-ink-line bg-ink-line">
          <div className="hidden grid-cols-[1fr_auto_1fr] items-center gap-6 bg-ink-deep px-6 py-4 md:grid">
            <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              The usual
            </span>
            <span aria-hidden="true" />
            <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-accent">
              With QuoteMax
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
                  <span className="sr-only">With QuoteMax: </span>
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
          <Stat value="$0" label="Cut of your jobs" />
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
            Pick a plan and QuoteMax is quoting the same day.
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
      a: "No. QuoteMax only ever uses your pricing book. Every quote lands in your dashboard for you to approve or tweak before it goes out.",
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
      a: "Plans start at $49/mo, and the Starter Monthly plan comes with a 14-day free trial. See the pricing page for the full breakdown. We never take a cut of your jobs; the only fixed price is the $99 site visit, credited back to the job.",
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
            number, pricing book, and QuoteMax tuned to their brand
            voice. Setup takes about three minutes.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <PrimaryCTA href="/signup">Get my QuoteMax</PrimaryCTA>
            <SecondaryCTA href="#how">See how it works</SecondaryCTA>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── App download (iOS + Android · coming soon) ──────────────── */
// An image feature band (device left, copy right). The apps aren't
// shipped yet, so the store badges are deliberately NON-interactive and
// clearly marked "coming soon" — no dead links, no fake store pages (see
// /ux ethical design). The one real action is the "get notified" link
// into signup, so a keen tradie isn't left at a dead end.
function AppDownload() {
  return (
    <section id="app" className="border-b border-ink-line scroll-mt-20">
      <div className="mx-auto grid max-w-[88rem] items-center gap-14 px-6 py-24 md:grid-cols-[0.85fr_1.15fr] md:gap-16 md:py-32">
        <Reveal className="flex justify-center md:justify-start">
          <AppPhone />
        </Reveal>
        <Reveal delay={120}>
          <span className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-accent-soft">
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-[pulse-soft_2.4s_ease-in-out_infinite]"
              aria-hidden="true"
            />
            Coming soon
          </span>
          <h2 className="mt-6 font-extrabold uppercase leading-[1.02] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
            Your quoting line,{" "}
            <span className="text-accent">in your pocket.</span>
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-text-sec">
            Approve drafts, check your pipeline, and get paid, from the
            ute, the roof, or the couch. The iOS and Android apps are still on
            the workbench; we&rsquo;re building them now.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <StoreBadge platform="apple" />
            <StoreBadge platform="google" />
          </div>

          <p className="mt-5 text-sm text-text-dim">
            Want first dibs?{" "}
            <Link
              href="/signup"
              className="link-underline font-semibold text-text-pri hover:text-accent"
            >
              Get notified at launch &rarr;
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  )
}

// A store badge in the shape users recognise (glyph + two-line label),
// re-cut in the Maintain style: square corners, bordered ink-card, mono
// eyebrow. It is not a link — the app isn't live — so it renders as a
// labelled image with an explicit "Soon" tag (never colour alone).
function StoreBadge({ platform }: { platform: "apple" | "google" }) {
  const isApple = platform === "apple"
  const label = isApple ? "App Store" : "Google Play"
  const top = isApple ? "Download on the" : "Get it on"
  return (
    <div
      role="img"
      aria-label={`${label} · coming soon`}
      className="inline-flex cursor-default select-none items-center gap-3 rounded-lg border border-ink-line bg-ink-card px-4 py-3"
    >
      <span className="text-text-pri" aria-hidden="true">
        {isApple ? <AppleGlyph /> : <PlayGlyph />}
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-mono text-[0.75rem] uppercase tracking-[0.08em] text-text-dim">
          {top}
        </span>
        <span className="mt-1 text-[0.95rem] font-semibold tracking-tight text-text-pri">
          {label}
        </span>
      </span>
      <span className="ml-1.5 self-start rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-accent-soft">
        Soon
      </span>
    </div>
  )
}

// A real device shot — the live QuoteMax mobile homepage composited into
// an iPhone frame (public/marketing/app-iphone-quotemax.png; the PNG is
// transparent outside the body, so it sits on either theme). No border,
// no drop shadow — the frame is the device, depth comes from the single
// accent glow behind it.
function AppPhone() {
  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute -inset-8 bg-accent/15 blur-[64px]"
        aria-hidden="true"
      />
      <Image
        src="/marketing/app-iphone-quotemax.png"
        alt="The QuoteMax mobile site on an iPhone. Drafts your quote before they hang up"
        width={1022}
        height={2082}
        sizes="(max-width: 768px) 264px, 300px"
        className="relative z-10 h-auto w-[264px] md:w-[300px]"
      />
    </div>
  )
}

function AppleGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.1 2.98-.75.86-1.98 1.53-3.02 1.45-.13-1.1.42-2.26 1.06-2.98.72-.82 2.02-1.44 3.06-1.45zm4.575 15.59c-.55 1.27-.82 1.84-1.53 2.97-.99 1.57-2.39 3.52-4.12 3.53-1.54.02-1.94-.99-4.03-.98-2.09.01-2.52.99-4.06.97-1.73-.01-3.06-1.79-4.05-3.36-2.77-4.4-3.06-9.56-1.35-12.31 1.21-1.95 3.12-3.09 4.92-3.09 1.83 0 2.98 1.01 4.49 1.01 1.47 0 2.36-1.01 4.48-1.01 1.6 0 3.3.87 4.51 2.38-3.96 2.17-3.31 7.82.31 9.9z" />
    </svg>
  )
}

function PlayGlyph() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="currentColor" aria-hidden="true">
      <path d="M1.02 1.31C.76 1.45.6 1.72.6 2.06v17.88c0 .34.16.61.42.75l.06.03L11 11.06v-.12L1.08 1.28l-.06.03z" />
      <path d="M14.3 14.36l-3.3-3.3v-.12l3.3-3.3.08.05 3.91 2.22c1.12.63 1.12 1.67 0 2.31l-3.91 2.22-.08.02z" opacity="0.85" />
      <path d="M14.38 14.31L11 10.94 1.02 20.69c.37.39.98.44 1.67.05l11.69-6.43" opacity="0.7" />
      <path d="M14.38 7.59L2.69 1.16C2 .77 1.39.82 1.02 1.21L11 10.94l3.38-3.35z" opacity="0.9" />
    </svg>
  )
}

/* ─── SMS demo card ───────────────────────────────────────────── */

// A live-example conversation rendered as plain content bubbles on the
// canvas — deliberately NOT wrapped in a fake phone frame. It shows the
// intake → quote path, plays itself once on load (each message pops in on
// a timeline), ends on a typing indicator, then the drafted quote lands.
function SmsDemo() {
  return (
    <div className="edge-lit flex h-full flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card">
      <div className="flex items-center justify-between border-b border-ink-line px-4 py-3 sm:px-5">
        <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-text-dim">
          Live example · SMS intake
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-teal-glow">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-glow motion-safe:animate-[pulse-soft_2.4s_ease-in-out_infinite]" />
          Online
        </span>
      </div>

      {/* The thread takes the slack so the card ends level with the pitch
          column whatever the copy length. Bottom-anchored, like any real
          messaging surface — the newest message sits against the quote. */}
      <div className="flex flex-1 flex-col justify-end gap-3 px-4 py-5 sm:px-5">
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

      {/* The drafted quote. Three tiers, because Good/Better/Best is what
          the pipeline actually writes — a single figure understated the
          output and left the panel looking empty. Marked "Sample"; these
          are illustrative numbers, not a quoted job. */}
      <div
        className={`border-t border-ink-line bg-ink-deep/50 px-4 py-4 sm:px-5 ${RISE}`}
        style={{ animationDelay: "3900ms" }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-accent">
            Quote drafted · under a minute
          </span>
          <span className="shrink-0 font-mono text-[0.75rem] uppercase tracking-[0.08em] text-text-dim">
            Sample
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <QuoteTier tier="Good" price="$890" at={4150} />
          <QuoteTier tier="Better" price="$1,140" at={4280} featured />
          <QuoteTier tier="Best" price="$1,460" at={4410} />
        </div>
        <p
          className={`mt-3 font-mono text-[0.75rem] uppercase tracking-[0.08em] text-text-dim ${RISE}`}
          style={{ animationDelay: "4560ms" }}
        >
          Sent to the customer with a deposit link
        </p>
      </div>
    </div>
  )
}

// One tier of the drafted sample quote. Only the recommended tier carries
// the accent — three accent prices in a row would turn the signal into a
// wash (and, in the light theme, three highlighter underlines side by side).
function QuoteTier({
  tier,
  price,
  at,
  featured = false,
}: {
  tier: string
  price: string
  /** When this tier lands on the demo timeline (ms after load). */
  at: number
  featured?: boolean
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border px-2 py-3 text-center ${POP} ${
        featured
          ? "border-accent/45 bg-accent/10"
          : "border-ink-line bg-ink-card"
      }`}
      style={{ animationDelay: `${at}ms` }}
    >
      {featured ? (
        <span
          className="absolute inset-x-0 top-0 h-0.5 bg-accent"
          aria-hidden="true"
        />
      ) : null}
      <div className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-text-dim">
        {tier}
      </div>
      <div
        className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${
          featured ? "text-accent" : "text-text-pri"
        }`}
      >
        {price}
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
        className={`max-w-[86%] rounded-xl border px-3.5 py-2.5 text-sm leading-snug ${
          inbound
            ? "rounded-bl-sm border-ink-line bg-ink-deep text-text-sec"
            : "rounded-br-sm border-accent/35 bg-accent/10 text-text-pri"
        }`}
      >
        {!inbound && (
          <span className="mb-1 block font-mono text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-accent">
            QuoteMax
          </span>
        )}
        {children}
      </div>
    </div>
  )
}

// QuoteMax "thinking" just before the quote drops — three dots
// bouncing in sequence. Pops onto the timeline, then bounces in place.
function TypingBubble({ at }: { at: number }) {
  return (
    <div
      className={`flex justify-end ${POP}`}
      style={{ animationDelay: `${at}ms` }}
    >
      <div
        className="flex items-center gap-1.5 rounded-xl rounded-br-sm border border-accent/35 bg-accent/10 px-3.5 py-3"
        role="status"
        aria-label="QuoteMax is drafting the quote"
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
    <article className="group card-sweep edge-lit relative overflow-hidden rounded-2xl border border-ink-line bg-ink-card p-6 transition-colors duration-300 hover:border-accent/40 hover:bg-ink md:p-10">
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
  image,
  auto,
  inspection,
}: {
  label: string
  state: string
  image?: { src: string; alt: string; position?: string }
  auto: string[]
  inspection: string[]
}) {
  return (
    <div className="card-sweep edge-lit group h-full overflow-hidden rounded-2xl border border-ink-line bg-ink-card transition-colors duration-300 hover:border-accent/30">
      {image ? (
        <div className="relative">
          <DuotoneImage
            src={image.src}
            alt={image.alt}
            aspect="aspect-[2/1]"
            sizes="(max-width: 768px) 100vw, 44vw"
            position={image.position}
            className="border-b border-ink-line"
          />
          {/* Trade name + pilot state sit over the lower edge of the photo,
              where the .photo-caption gradient guarantees AA-contrast text. */}
          <div className="photo-caption absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 pt-12 md:p-6 md:pt-14">
            <h3 className="font-extrabold uppercase tracking-tight text-white text-2xl md:text-3xl">
              {label}
            </h3>
            <span className="shrink-0 pb-1 font-mono text-[0.75rem] uppercase tracking-[0.14em] text-white/90">
              {state}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-baseline justify-between gap-3 p-6 pb-0 md:p-8 md:pb-0">
          <h3 className="font-extrabold uppercase tracking-tight text-2xl md:text-3xl">
            {label}
          </h3>
          <span className="shrink-0 font-mono text-[0.75rem] uppercase tracking-[0.14em] text-text-dim">
            {state}
          </span>
        </div>
      )}

      <div className="p-6 md:p-8">
        <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-accent">
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

        <div className="mt-7 border-t border-ink-line pt-7">
          <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
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
    </div>
  )
}

// A compact live-trade card — a brand-tinted photo with the trade name,
// clickable through to its trade page. Present-tense, no "coming soon".
function TradeTile({
  href,
  src,
  alt,
  label,
  position,
}: {
  href: string
  src: string
  alt: string
  label: string
  position?: string
}) {
  return (
    <Link
      href={href}
      className="edge-lit group relative block overflow-hidden rounded-2xl border border-ink-line transition-colors hover:border-text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
    >
      <DuotoneImage
        src={src}
        alt={alt}
        aspect="aspect-[4/3]"
        sizes="(max-width: 640px) 100vw, 28vw"
        position={position}
      />
      {/* A div, not a figcaption — there is no <figure> here to caption. */}
      <div className="photo-caption absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 pt-10">
        <span className="font-extrabold uppercase tracking-tight text-white text-lg">
          {label}
        </span>
        <span
          className="shrink-0 pb-0.5 font-mono text-white transition-transform duration-300 group-hover:translate-x-0.5"
          aria-hidden="true"
        >
          &rarr;
        </span>
      </div>
    </Link>
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

/* ─── Covered trades (links to the trade detail pages) ────────── */

const COVERED_TRADES = [
  {
    href: "/trades/electrical",
    label: "Electrical",
    img: "/marketing/home-electrical.jpg",
    blurb: "Downlights to switchboards, priced to NSW conventions.",
  },
  {
    href: "/trades/plumbing",
    label: "Plumbing",
    img: "/marketing/home-plumbing.jpg",
    blurb: "Drains to hot water, priced to QLD conventions.",
  },
  {
    href: "/trades/roofing",
    label: "Roofing",
    img: "/marketing/home-roofing.jpg",
    blurb: "Re-roofs and repairs, measured per structure.",
  },
  {
    href: "/trades/solar",
    label: "Solar",
    img: "/marketing/home-solar.jpg",
    blurb: "Systems sized from the address, before you drive out.",
  },
  {
    href: "/trades/painting",
    label: "Painting",
    img: "/marketing/home-painting.jpg",
    blurb: "Repaints inside and out, measured room by room.",
  },
]

function CoveredTrades() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>Built for your trade</Eyebrow>
          <h2 className="mt-6 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
            One number. <span className="text-accent">Every trade</span> you run.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-sec">
            QuoteMax prices each trade against its own book and conventions. See
            how it quotes yours.
          </p>
        </Reveal>
        <div className="mt-14 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {COVERED_TRADES.map((t, i) => (
            <Reveal key={t.href} delay={i * 90} className="h-full">
              <Link
                href={t.href}
                className="edge-lit group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card transition-colors hover:border-text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
              >
                <DuotoneImage
                  src={t.img}
                  alt={`${t.label} work in Australia`}
                  aspect="aspect-[4/5]"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 22vw"
                />
                <div className="flex items-start justify-between gap-3 p-5">
                  <div>
                    <h3 className="font-extrabold uppercase tracking-tight text-text-pri">
                      {t.label}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-text-sec">
                      {t.blurb}
                    </p>
                  </div>
                  <span
                    className="mt-1 shrink-0 font-mono text-accent transition-transform duration-300 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  >
                    &rarr;
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── Built in Australia (image feature band) ─────────────────── */

function BuiltForAustralia() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto grid max-w-[88rem] items-center gap-10 px-6 py-24 md:grid-cols-2 md:gap-16 md:py-32">
        <Reveal>
          <Eyebrow>Built in Australia</Eyebrow>
          <h2 className="mt-6 font-extrabold uppercase leading-[1.02] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
            Made for the way <span className="text-accent">AU tradies</span>{" "}
            quote.
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-text-sec">
            GST handled, licence details on every quote, NSW and QLD conventions
            baked in. Built with sparkies and plumbers, for the crews
            who&rsquo;d rather be on site than chasing paperwork at 11pm.
          </p>
          <div className="mt-8">
            <PrimaryCTA href="/signup">Get my QuoteMax</PrimaryCTA>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <DuotoneImage
            src="/marketing/home-crew.jpg"
            alt="A crew of Australian tradies at the back of a work ute, sorting tools at the end of the day"
            aspect="aspect-[4/3]"
            sizes="(max-width: 768px) 100vw, 50vw"
            className="edge-lit rounded-2xl border border-ink-line"
          />
        </Reveal>
      </div>
    </section>
  )
}

