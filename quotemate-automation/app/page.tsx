// QuoteMax home — QuoteMax Site Kit (site-kit.css): Inter at weight 400, a
// white canvas with one warm paper surface, pill controls, and a page that
// closes on one black run (reviews → FAQ → CTA → footer). The hero's
// browser frame carries the live SMS-intake demo, so the product shows
// itself rather than being described twice.
//
// Shared chrome (Nav/Footer) comes from <SiteShell>; the pricing cards come
// from the shared PricingTiers client island.

import Link from "next/link"
import Image from "next/image"
import type { ReactNode } from "react"
import AuthNav from "./AuthNav"
import { Reveal } from "./_components/Reveal"
import {
  SiteShell,
  Arrow,
  Eyebrow,
  SectionHead,
  BrowserFrame,
  FaqList,
  CtaBand,
  PrimaryCTA,
  SecondaryCTA,
} from "./_components/site"
import { PricingTiers } from "./_components/PricingTiers"
import { DuotoneImage } from "./_components/DuotoneImage"
import { Testimonials } from "./_components/Testimonials"
import { ContactSection } from "./_components/ContactSection"
import CookieConsent from "./_components/CookieConsent"
import { TradeCarousel } from "./_components/TradeCarousel"
import { TRADES, TRADE_ORDER } from "./trades/_data"

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
    <SiteShell>
      {/* First in <main> so keyboard users reach its buttons right after the
          nav, not after the whole page (it's fixed, so this moves no layout). */}
      <CookieConsent />
      <Hero />
      <HowItWorks />
      <Trades />
      <Shift />
      <CoveredTrades />
      <Numbers />
      <Pricing />
      <Benefits />
      {/* Before the black run: a paper band can't sit inside it. The FAQ
          links back here for the questions it doesn't answer. */}
      <ContactSection />
      {/* The closing black run, as in the kit: reviews → FAQ → CTA → footer. */}
      <Testimonials />
      <Faq />
      <ClosingCta />
    </SiteShell>
  )
}

/* ─── Hero ────────────────────────────────────────────────────── */

// Centred pitch, then the product in a browser frame (trade tabs, the SMS
// thread, the drafted quote), then the logo strip — the kit's hero order.
function Hero() {
  return (
    <section className="qs-hero" aria-labelledby="home-hero-title">
      {/* Scroll-reveal fallback for no-JS visitors — content must never
          stay hidden behind the observer. */}
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <div className="qs-container qs-hero__inner">
        <div className="qs-hero__copy">
          <div className={RISE}>
            <Eyebrow>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/au-flag.svg"
                alt="Australia"
                className="h-3 w-auto rounded-[2px]"
              />
              Built for Australian tradies
            </Eyebrow>
          </div>

          {/* Each phrase rises on its own beat, so the headline assembles
              left to right; inline-block keeps it one wrapping sentence. */}
          <h1 id="home-hero-title" className="qs-h1">
            <span className={`inline-block ${RISE}`} style={{ animationDelay: "80ms" }}>
              Drafts your
            </span>{" "}
            <span className={`inline-block ${RISE}`} style={{ animationDelay: "170ms" }}>
              quote before
            </span>{" "}
            <span className={`inline-block ${RISE}`} style={{ animationDelay: "260ms" }}>
              they hang up.
            </span>
          </h1>

          <p className={`qs-lead max-w-[34rem] ${RISE}`} style={{ animationDelay: "360ms" }}>
            Customers text your QuoteMax number. QuoteMax asks the right
            questions, applies your pricing book, and drafts a clean quote in
            under a minute. You review, tweak, send.
          </p>

          {/* data-keep-clear: the cookie card waits until this row has
              scrolled clear of it, so it never rises over the CTAs. */}
          <div className={`qs-actions ${RISE}`} style={{ animationDelay: "460ms" }} data-keep-clear>
            <AuthNav variant="hero" />
            <SecondaryCTA href="#how">See how it works</SecondaryCTA>
          </div>

          <p className={`qs-meta ${RISE}`} style={{ animationDelay: "540ms" }}>
            Starter Monthly includes a 14-day free trial. Setup takes about
            three minutes.
          </p>
        </div>

        <div className={`w-full ${RISE}`} style={{ animationDelay: "300ms" }}>
          <BrowserFrame>
            {/* The trade tabs link through to each trade page; the demo
                below is an electrical job, so that tab reads as active. */}
            <div className={`qs-tabs ${RISE}`} style={{ animationDelay: "620ms" }}>
              <HeroTile
                href="/trades/electrical"
                src="/marketing/trade-electrical.jpg"
                alt="Australian electrician in a yellow hard hat testing a switchboard with a multimeter"
                caption="Electrical"
                position="center 30%"
                active
              />
              <HeroTile
                href="/trades/plumbing"
                src="/marketing/trade-plumbing-2.jpg"
                alt="Plumber on her back under a kitchen sink, tightening the tap tailpiece with a wrench"
                caption="Plumbing"
              />
              <HeroTile
                href="/trades/solar"
                src="/marketing/trade-solar.jpg"
                alt="Two installers carrying a solar panel across a Colorbond roof to a half-finished array"
                caption="Solar"
                position="center 35%"
              />
            </div>
            <SmsDemo />
          </BrowserFrame>
        </div>

        <PoweredBy />
      </div>
    </section>
  )
}

// One trade tab: a link with the trade's photo as a small avatar (hidden
// on phones, where the three labels need the whole width). The arrow says
// it leaves for the trade page; it isn't an in-place demo switch.
function HeroTile({
  href,
  src,
  alt,
  caption,
  position,
  active = false,
}: {
  href: string
  src: string
  alt: string
  caption: string
  /** object-position override so a face isn't clipped by the crop. */
  position?: string
  /** The trade the demo below is about. */
  active?: boolean
}) {
  return (
    <Link href={href} className="qs-tab max-sm:gap-1 max-sm:px-2" data-active={active || undefined}>
      <span className="relative hidden size-6 shrink-0 overflow-hidden rounded-full sm:block">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="48px"
          className="object-cover"
          style={position ? { objectPosition: position } : undefined}
        />
      </span>
      {caption}
      <Arrow className="size-3.5 shrink-0 text-[var(--qs-muted)]" />
    </Link>
  )
}

/* ─── Powered-by logo strip ───────────────────────────────────── */
// The real stack that drafts the quotes and runs the voice agent. Logos are
// real brand SVGs under /public/brand — swap a file (same name) to update a
// mark. The kit renders every mark as a monochrome silhouette.
//
// Sized optically, not by box: glyph marks share one square; the wordmark
// sits lower so its width doesn't outweigh the row; Vapi's artwork fills
// only ~2/3 of its square viewBox, so it scales up (transform, so the row
// spacing still counts the 40px box).
const LOGO_SIZE = "h-8 sm:h-10"
const POWERED_BY: { name: string; logo: string; size?: string }[] = [
  { name: "Anthropic", logo: "/brand/anthropic.svg" },
  { name: "Gemini", logo: "/brand/gemini.svg" },
  { name: "Twilio", logo: "/brand/twilio.svg" },
  { name: "ElevenLabs", logo: "/brand/elevenlabs.svg", size: "h-5 sm:h-6" },
  { name: "Deepgram", logo: "/brand/deepgram.svg" },
  { name: "Vapi", logo: "/brand/vapi.svg", size: `${LOGO_SIZE} scale-150` },
  { name: "Voyage", logo: "/brand/voyage.svg" },
]

function PoweredBy() {
  return (
    <Reveal className="w-full">
      <div className="qs-logos">
        <p className="qs-logos__title">Powered by</p>
        <ul className="qs-logos__row max-lg:gap-x-8 max-sm:gap-x-6">
          {POWERED_BY.map((tool) => (
            <li key={tool.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tool.logo}
                alt={tool.name}
                className={`block w-auto ${tool.size ?? LOGO_SIZE}`}
                loading="lazy"
                decoding="async"
              />
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  )
}

/* ─── SMS demo (inside the hero browser frame) ────────────────── */

// A live-example conversation on the left and the drafted quote as a small
// workflow on the right. It plays itself once on load (each message pops
// in on a timeline), ends on a typing indicator, then the quote lands.
function SmsDemo() {
  return (
    <div className="grid gap-6 pb-6 pt-8 md:pt-12 lg:min-h-[27rem] lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-12 lg:pb-0 xl:px-[5%]">
      <div className="flex flex-col overflow-hidden rounded-[var(--qs-r-lg)] border border-[var(--qs-line)] bg-white shadow-[0_24px_48px_-30px_rgba(0,0,0,0.28)] lg:self-end lg:rounded-b-none lg:border-b-0">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--qs-line)] px-5 py-4">
          <span className="qs-title text-[14px]">Live example · SMS intake</span>
          <span className="qs-meta flex items-center gap-1.5 text-[13px]">
            <span className="size-1.5 rounded-full bg-[#10b981] motion-safe:animate-[pulse-soft_2.4s_ease-in-out_infinite]" />
            Online
          </span>
        </div>

        <div className="flex flex-col gap-4 px-4 pb-5 pt-4 sm:px-5">
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-[var(--qs-line)]" />
            <span className="qs-meta text-[12px]">Today · 7:42 am</span>
            <span className="h-px flex-1 bg-[var(--qs-line)]" />
          </div>

          <div className="flex flex-col gap-3">
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
            {/* Fades out as the quote lands but keeps its height, so nothing
                below jumps. Skipped under reduced motion, where the quote is
                already on screen and a frozen "typing" would contradict it. */}
            <div
              className="motion-reduce:hidden motion-safe:animate-[fade-in_300ms_ease-out_3760ms_reverse_forwards]"
              aria-hidden="true"
            >
              <TypingBubble at={3100} />
            </div>
          </div>
        </div>
      </div>

      <QuoteFlow />
    </div>
  )
}

// The drafted quote as workflow nodes: drafted → three tiers → sent. Three
// tiers, because Good/Better/Best is what the pipeline actually writes.
// Marked "Sample" — these are illustrative numbers, not a quoted job.
function QuoteFlow() {
  return (
    <div
      className={`flex flex-col items-center lg:self-end lg:pb-12 ${RISE}`}
      style={{ animationDelay: "3900ms" }}
    >
      <p className="qs-chip">
        <span className="qs-chip__icon">
          <Glyph name="sparkle" />
        </span>
        Quote drafted · under a minute
        <span className="rounded-full bg-[var(--qs-paper)] px-2 py-0.5 text-[11px] text-[var(--qs-body)]">
          Sample
        </span>
      </p>
      <div className="w-full max-w-[28rem]">
        <Fork cols={3} />
        <div className="grid grid-cols-3 gap-3">
          <QuoteTier tier="Good" price="$890" at={4150} />
          <QuoteTier tier="Better" price="$1,140" at={4280} featured />
          <QuoteTier tier="Best" price="$1,460" at={4410} />
        </div>
        <Fork cols={3} merge />
      </div>
      <p className={`qs-chip ${RISE}`} style={{ animationDelay: "4560ms" }}>
        <span className="qs-chip__icon bg-[var(--qs-brand)] text-[var(--qs-brand-ink)]">
          <Glyph name="send" />
        </span>
        Sent to the customer with a deposit link.
      </p>
    </div>
  )
}

// One tier of the drafted sample quote. Only the recommended tier carries
// the yellow rail — three accents in a row would turn the signal into a wash.
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
      className={`relative rounded-[12px] bg-white px-2 py-3 text-center shadow-[0_2px_10px_-3px_rgba(0,0,0,0.14)] ${POP}`}
      style={{ animationDelay: `${at}ms` }}
    >
      {featured ? (
        <span
          className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-[var(--qs-brand)]"
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`text-[12px] ${featured ? "font-medium text-[var(--qs-ink)]" : "text-[var(--qs-muted)]"}`}
      >
        {tier}
      </div>
      <div className="qs-num mt-1 text-[20px] leading-tight tracking-[-0.04em] text-[var(--qs-ink)]">
        {price}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--qs-muted)]">inc GST</div>
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
  children: ReactNode
}) {
  const inbound = side === "in"
  return (
    <div
      className={`flex ${inbound ? "justify-start" : "justify-end"} ${POP}`}
      style={{ animationDelay: `${at}ms` }}
    >
      <div
        className={`max-w-[88%] rounded-[14px] px-3.5 py-2.5 text-[14px] leading-[1.45] text-[var(--qs-ink)] ${
          inbound
            ? "rounded-bl-[4px] bg-[var(--qs-paper)]"
            : "rounded-br-[4px] border border-[var(--qs-line-strong)] bg-white"
        }`}
      >
        {!inbound && (
          <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
            <span className="size-1.5 rounded-full bg-[var(--qs-brand)]" aria-hidden="true" />
            QuoteMax
          </span>
        )}
        {children}
      </div>
    </div>
  )
}

// QuoteMax "thinking" just before the quote drops — three dots bouncing in
// sequence. Pops onto the timeline, then bounces in place.
function TypingBubble({ at }: { at: number }) {
  return (
    <div className={`flex justify-end ${POP}`} style={{ animationDelay: `${at}ms` }}>
      {/* No role="status": the slot around this is aria-hidden, and a live
          region would announce a decorative sample on page load. */}
      <div className="flex items-center gap-1.5 rounded-[14px] rounded-br-[4px] border border-[var(--qs-line-strong)] bg-white px-3.5 py-3">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="size-1.5 rounded-full bg-[#a39e96] motion-safe:animate-[typing-bounce_1.3s_ease-in-out_infinite]"
            style={{ animationDelay: `${at + d * 160}ms` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  )
}

/* ─── How it works (process cards) ────────────────────────────── */

function HowItWorks() {
  return (
    <section id="how" className="qs-section" aria-labelledby="home-how-title">
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            eyebrow="How it works"
            id="home-how-title"
            title={
              <>
                Three steps.
                <br />
                You stay on the tools.
              </>
            }
          />
        </Reveal>

        <div className="qs-grid qs-grid--3">
          <Reveal className="h-full">
            <NumberedCard
              num="01"
              title="Customer texts your number"
              body="Each tradie gets a dedicated AU number. Voice or SMS, both feed QuoteMax while you stay on the tools."
            >
              <IntakeSketch />
            </NumberedCard>
          </Reveal>
          <Reveal delay={110} className="h-full">
            <NumberedCard
              num="02"
              title="QuoteMax drafts the quote"
              body="QuoteMax asks the right questions for the job type, applies your pricing book, and writes the line items in under a minute."
            >
              <DraftSketch />
            </NumberedCard>
          </Reveal>
          {/* Two columns between 768 and 991px (the kit's grid): the last
              card takes the full row instead of sitting alone. */}
          <Reveal delay={220} className="h-full md:max-[992px]:col-span-2">
            <NumberedCard
              num="03"
              title="You review, send, get paid"
              body="The quote lands in your dashboard. Approve as-is or tweak it. The customer pays a deposit and the job is booked."
            >
              <ReviewSketch />
            </NumberedCard>
          </Reveal>
        </div>

        {/* A real tradesperson at the bench — the quoting runs itself so
            the work stays where it belongs. */}
        <Reveal delay={120}>
          <figure className="qs-photo-card">
            <DuotoneImage
              src="/marketing/trade-carpentry.jpg"
              alt="Carpenter planing a length of timber by hand at a tidy workshop bench"
              aspect="aspect-[4/3] sm:aspect-[16/9] lg:aspect-[21/8]"
              sizes="(max-width: 1332px) 100vw, 1272px"
              position="center 30%"
            />
            <figcaption className="qs-photo-card__body">
              <span className="qs-photo-card__title">You stay on the tools</span>
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  )
}

function NumberedCard({
  num,
  title,
  body,
  children,
}: {
  num: string
  title: string
  body: string
  /** The card's decorative UI sketch. */
  children: ReactNode
}) {
  return (
    <article className="qs-card h-full">
      <span className="qs-icon-tile qs-num text-[15px]">{num}</span>
      <div className="qs-card__copy">
        <h3 className="qs-card__title">{title}</h3>
        <p className="qs-text">{body}</p>
      </div>
      <div
        className="mt-auto flex min-h-[11.5rem] items-center justify-center pt-2"
        aria-hidden="true"
      >
        {children}
      </div>
    </article>
  )
}

// The three process sketches. Decorative (the card copy carries the
// meaning), built from kit chips, and worded only from the card copy.
function IntakeSketch() {
  return (
    <div className="flex w-full max-w-[16rem] flex-col items-center">
      <div className="grid w-full grid-cols-2 gap-3">
        <span className="qs-chip">
          <span className="qs-chip__icon">
            <Glyph name="phone" />
          </span>
          Voice
        </span>
        <span className="qs-chip">
          <span className="qs-chip__icon">
            <Glyph name="message" />
          </span>
          SMS
        </span>
      </div>
      <Fork cols={2} merge />
      <span className="qs-chip">
        <span className="qs-chip__icon bg-[var(--qs-brand)] text-[var(--qs-brand-ink)]">
          <Glyph name="mobile" />
        </span>
        Dedicated AU number
      </span>
    </div>
  )
}

function DraftSketch() {
  return (
    <div className="flex flex-col items-center">
      {["Job type", "Pricing book", "Line items"].map((step, i) => (
        <div key={step} className="flex flex-col items-center">
          {i > 0 ? <span className="h-5 w-px bg-[#d6d2cc]" /> : null}
          <span className="qs-chip">
            <span className="qs-chip__icon">
              <Glyph name="sparkle" />
            </span>
            {step}
          </span>
        </div>
      ))}
    </div>
  )
}

function ReviewSketch() {
  const rows: [string, boolean][] = [
    ["Approve as-is", true],
    ["Deposit paid", true],
    ["Job booked", false],
  ]
  return (
    <div className="w-full max-w-[17rem] rounded-[var(--qs-r-md)] bg-white p-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]">
      <p className="flex items-center gap-2.5 border-b border-[var(--qs-line)] pb-3 text-[14px] text-[var(--qs-ink)]">
        <span className="qs-chip__icon">
          <Glyph name="sparkle" />
        </span>
        Your dashboard
      </p>
      <ul>
        {rows.map(([label, done]) => (
          <li
            key={label}
            className="flex items-center gap-2.5 border-b border-[var(--qs-line)] py-2.5 text-[13px] text-[var(--qs-body)] last:border-0 last:pb-0"
          >
            <span
              className={`grid size-4 place-items-center rounded-full ${
                done ? "bg-[var(--qs-ink)] text-white" : "border border-[var(--qs-line-strong)]"
              }`}
            >
              {done ? <Glyph name="check" className="size-2.5" /> : null}
            </span>
            {label}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ─── Trades + scope ──────────────────────────────────────────── */

// The home-page trade photography. Carried over verbatim — sources, alt text
// and crop positions — from the two trade panels and three tiles the carousel
// replaced, so the section keeps the imagery it was art-directed with rather
// than inheriting the trade pages' own hero shots.
const HOME_TRADE_PHOTOS: Record<
  string,
  { src: string; alt: string; position?: string }
> = {
  electrical: {
    src: "/marketing/trade-electrical.jpg",
    alt: "Australian electrician in a yellow hard hat testing a switchboard with a multimeter",
    position: "center 25%",
  },
  plumbing: {
    src: "/marketing/trade-plumbing.jpg",
    alt: "Plumber at an open bathroom vanity, tightening a supply line with a shifting spanner",
  },
  roofing: {
    src: "/marketing/trade-roofing.jpg",
    alt: "Roofer driving a screw into new corrugated Colorbond sheeting with a cordless driver",
  },
  solar: {
    src: "/marketing/trade-solar.jpg",
    alt: "Installers carrying a solar panel to a rooftop array on a suburban home",
    position: "center 42%",
  },
  painting: {
    src: "/marketing/trade-painting.jpg",
    alt: "Two painters rolling and cutting in fresh paint on an interior wall",
  },
}

function Trades() {
  return (
    <section id="scope" className="qs-band qs-section" aria-labelledby="home-scope-title">
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            eyebrow="Trades"
            id="home-scope-title"
            className="max-w-[40rem]"
            title={
              <>
                Straightforward jobs auto-quote.{" "}
                <br className="max-sm:hidden" />
                The tricky ones book a site visit.
              </>
            }
          />
        </Reveal>

        <div className="flex flex-col gap-4">
          {/* One slide per live trade. Copy comes from the same module as
              the trade pages (app/trades/_data.ts) so the two can never
              disagree, but the PHOTOGRAPHY is the home-page marketing set
              above, not _data.ts's heroImage — those /trades/* shots are
              framed for the tall hero band on each trade page and crop
              poorly in a wide slide. */}
          <Reveal>
            <TradeCarousel
              slides={TRADE_ORDER.map((slug) => {
                const t = TRADES[slug]
                const photo = HOME_TRADE_PHOTOS[slug]
                return {
                  slug: t.slug,
                  name: t.name,
                  eyebrow: t.eyebrow,
                  body: t.scopeBody,
                  image: photo.src,
                  alt: photo.alt,
                  position: photo.position,
                  tags: t.scopeTags.slice(0, 6),
                }
              })}
            />
          </Reveal>

          {/* Generic "request your trade" prompt. The workshop photo adds
              warmth without claiming a trade we don't yet support. */}
          <Reveal delay={180}>
            <div className="grid gap-3 rounded-[var(--qs-r-xl)] border border-[var(--qs-line)] bg-white p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <DuotoneImage
                src="/marketing/workshop.jpg"
                alt="Tradesperson checking a finished part at a well-kept workshop bench"
                aspect="aspect-[4/3] md:aspect-auto md:min-h-[16rem]"
                sizes="(max-width: 768px) 100vw, 38vw"
                position="center 30%"
                className="rounded-[var(--qs-r-md)]"
              />
              <div className="flex flex-col items-start justify-center gap-6 px-3 pb-4 pt-2 md:p-10">
                <p className="qs-lead max-w-[32rem]">
                  Not on the list yet? Carpenters, cabinetmakers, HVAC and the
                  rest. Tell us your trade and we&rsquo;ll line you up for
                  the next pilot.
                </p>
                <SecondaryCTA href="/signup">Request your trade</SecondaryCTA>
              </div>
            </div>
          </Reveal>
        </div>
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
    <section className="qs-section" aria-labelledby="home-shift-title">
      <div className="qs-container grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] lg:gap-16">
        <Reveal className="lg:sticky lg:top-32">
          <SectionHead
            eyebrow="What you actually get"
            id="home-shift-title"
            title={<>The job goes to whoever quotes first. Now that&rsquo;s you.</>}
          />
        </Reveal>

        <div className="qs-card gap-3 p-3 sm:p-4">
          <div className="hidden grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-6 px-5 pb-1 pt-3 md:grid">
            <span className="qs-small">The usual</span>
            <span aria-hidden="true" />
            <span className="qs-title flex items-center gap-2 text-[14px]">
              <span className="size-1.5 rounded-full bg-[var(--qs-brand)]" aria-hidden="true" />
              With QuoteMax
            </span>
          </div>
          {rows.map((r, i) => (
            <Reveal key={r.old} delay={i * 90}>
              <div className="grid items-center gap-2 rounded-[var(--qs-r-md)] bg-white px-5 py-5 md:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] md:gap-6 md:py-6">
                <p className="qs-text line-through decoration-[#b5b0a8]">
                  <span className="sr-only">The usual: </span>
                  {r.old}
                </p>
                <Arrow className="hidden text-[var(--qs-muted)] md:block" />
                <p className="qs-ink">
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
    // The photo has a thin black film border baked in (~0.7% a side),
    // which shows on the white canvas; zoom just past it.
    crop: "scale-[1.02]",
  },
]

function CoveredTrades() {
  return (
    <section className="qs-band qs-section" aria-labelledby="home-covered-title">
      <div className="qs-container qs-stack">
        <Reveal>
          <div className="qs-head-row">
            <SectionHead
              eyebrow="Built for your trade"
              id="home-covered-title"
              title="One number. Every trade you run."
            />
            <p className="qs-text qs-head-aside">
              QuoteMax prices each trade against its own book and conventions.
              See how it quotes yours.
            </p>
          </div>
        </Reveal>

        {/* ponytail: the spans assume five trades — three across, then two
            wide (a full-width last card on tablets). */}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {COVERED_TRADES.map((t, i) => (
            <li
              key={t.href}
              className={
                i < 3 ? "lg:col-span-2" : i === 3 ? "lg:col-span-3" : "sm:col-span-2 lg:col-span-3"
              }
            >
              <Reveal delay={(i % 3) * 90} className="h-full">
                <Link href={t.href} className="qs-photo-card qs-photo-card--scrim h-[17rem] sm:h-[22rem] lg:h-[26rem]">
                  <Image
                    src={t.img}
                    alt={`${t.label} work in Australia`}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 640px"
                    className={`object-cover ${t.crop ?? ""}`}
                  />
                  <div className="qs-photo-card__body">
                    <h3 className="qs-photo-card__title">{t.label}</h3>
                    <p className="qs-photo-card__meta">{t.blurb}</p>
                  </div>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ─── Numbers ─────────────────────────────────────────────────── */

// Hairline dividers between the stats once they sit in one row.
const STAT_DIVIDER = "md:border-l md:border-[var(--qs-line-strong)] md:pl-8"

function Numbers() {
  return (
    <div className="qs-section">
      <div className="qs-container">
        <div className="qs-card grid grid-cols-2 gap-y-10 md:grid-cols-4">
          <Reveal>
            <Stat value="< 1 min" label="Per quote drafted" />
          </Reveal>
          <Reveal delay={90} className={STAT_DIVIDER}>
            <Stat value="24/7" label="Line always answered" />
          </Reveal>
          <Reveal delay={180} className={STAT_DIVIDER}>
            <Stat value="A$0" label="Cut of your jobs" />
          </Reveal>
          <Reveal delay={270} className={STAT_DIVIDER}>
            <Stat value="A$99" label="Locked site-visit price" />
          </Reveal>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="qs-stat">
      <div className="qs-stat__value text-[clamp(2.25rem,1.5rem+2.2vw,3.5rem)]">{value}</div>
      <div className="qs-stat__label">{label}</div>
    </div>
  )
}

/* ─── Pricing (3-tier teaser → full /pricing page) ────────────── */

function Pricing() {
  return (
    <section
      id="pricing"
      className="qs-section qs-section--flush-top"
      aria-labelledby="home-pricing-title"
    >
      <div className="qs-container qs-stack">
        <Reveal>
          <div className="qs-head-row">
            <SectionHead
              eyebrow="Pricing"
              id="home-pricing-title"
              title="Costs less than one missed job."
            />
            <p className="qs-text qs-head-aside lg:max-w-[28rem]">
              Pick a plan and QuoteMax is quoting the same day.
              Starter Monthly comes with a 14-day free trial. We never take a cut
              of your jobs. The only fixed price is the A$99 site visit, credited
              straight back to the job.
            </p>
          </div>
        </Reveal>

        {/* No Reveal: on a phone the block is ~1700px tall, so a 15% trigger
            left a blank band under the heading while scrolling. */}
        <PricingTiers variant="home" />
      </div>
    </section>
  )
}

/* ─── Built in Australia + the app (benefits bento) ───────────── */

function Benefits() {
  return (
    <div className="qs-section qs-section--flush-top">
      <div className="qs-container qs-grid qs-grid--2">
        <Reveal className="h-full">
          <BuiltForAustralia />
        </Reveal>
        <Reveal delay={120} className="h-full">
          <AppDownload />
        </Reveal>
      </div>
    </div>
  )
}

function BuiltForAustralia() {
  return (
    <section className="qs-card h-full" aria-labelledby="home-built-title">
      <DuotoneImage
        src="/marketing/home-crew.jpg"
        alt="A crew of Australian tradies at the back of a work ute, sorting tools at the end of the day"
        aspect="h-[16rem] sm:h-[22rem]"
        sizes="(max-width: 768px) 100vw, 50vw"
        className="rounded-[var(--qs-r-md)]"
      />
      <div className="flex flex-1 flex-col items-start gap-4">
        {/* Same 32px label row as the neighbouring card's "Coming soon" tag,
            so the two titles share a line. */}
        <div className="flex min-h-8 items-center">
          <Eyebrow>Built in Australia</Eyebrow>
        </div>
        <h2 id="home-built-title" className="qs-h3">
          Made for the way AU tradies quote.
        </h2>
        <p className="qs-text max-w-md">
          GST handled, licence details on every quote, NSW and QLD conventions
          baked in. Built with sparkies and plumbers, for the crews
          who&rsquo;d rather be on site than chasing paperwork at 11pm.
        </p>
        {/* Follows the copy rather than pinning to the card floor: on tablets
            the next card runs ~140px longer (its store badges wrap), and a
            pinned button left that much air above itself. */}
        <div className="pt-2">
          <PrimaryCTA href="/signup">Get my QuoteMax</PrimaryCTA>
        </div>
      </div>
    </section>
  )
}

// The apps aren't shipped yet, so the store badges are deliberately
// NON-interactive and clearly marked "coming soon" — no dead links, no fake
// store pages. The one real action is the "get notified" link into signup.
function AppDownload() {
  return (
    <section id="app" className="qs-card h-full" aria-labelledby="home-app-title">
      <AppPhone />
      <div className="flex flex-1 flex-col items-start gap-4">
        <span className="qs-tag">
          <span
            className="size-1.5 rounded-full bg-[var(--qs-brand)] motion-safe:animate-[pulse-soft_2.4s_ease-in-out_infinite]"
            aria-hidden="true"
          />
          Coming soon
        </span>
        <h2 id="home-app-title" className="qs-h3">
          Your quoting line, in your pocket.
        </h2>
        <p className="qs-text max-w-md">
          Approve drafts, check your pipeline, and get paid, from the
          ute, the roof, or the couch. The iOS and Android apps are still on
          the workbench; we&rsquo;re building them now.
        </p>
        <div className="flex flex-wrap gap-3">
          <StoreBadge platform="apple" />
          <StoreBadge platform="google" />
        </div>
        <p className="qs-small">
          Want first dibs?{" "}
          <Link href="/signup" className="qs-link">
            Get notified at launch &rarr;
          </Link>
        </p>
      </div>
    </section>
  )
}

// A store badge in the shape users recognise (glyph + two-line label), as a
// black pill. It is not a link — the app isn't live — so it renders as a
// labelled image with an explicit "Soon" tag (never colour alone).
function StoreBadge({ platform }: { platform: "apple" | "google" }) {
  const isApple = platform === "apple"
  const label = isApple ? "App Store" : "Google Play"
  const top = isApple ? "Download on the" : "Get it on"
  return (
    <div
      role="img"
      aria-label={`${label} · coming soon`}
      className="inline-flex min-h-[52px] cursor-default select-none items-center gap-3 rounded-[var(--qs-r-pill)] bg-[var(--qs-ink)] py-2 pl-4 pr-3 text-white"
    >
      <span aria-hidden="true">{isApple ? <AppleGlyph /> : <PlayGlyph />}</span>
      <span className="flex flex-col leading-none">
        <span className="text-[11px] text-white/70">{top}</span>
        <span className="mt-1 text-[15px] font-medium">{label}</span>
      </span>
      <span className="ml-1 rounded-full bg-[var(--qs-brand)] px-2 py-0.5 text-[11px] font-medium text-[var(--qs-brand-ink)]">
        Soon
      </span>
    </div>
  )
}

// A real device shot — the live QuoteMax mobile homepage composited into an
// iPhone frame (transparent outside the body), rising from the card floor
// over the warm glow. Re-shoot it when the hero changes, under a new file
// name: next/image caches the optimised copy by URL for hours.
function AppPhone() {
  return (
    <div className="relative flex h-[16rem] justify-center overflow-hidden rounded-[var(--qs-r-md)] bg-white sm:h-[22rem]">
      <div
        className="pointer-events-none absolute inset-x-[12%] bottom-[-35%] h-[70%] bg-[image:var(--qs-glow)] opacity-40 blur-[56px]"
        aria-hidden="true"
      />
      <Image
        src="/marketing/app-iphone-quotemax-v2.png"
        alt="The QuoteMax mobile site on an iPhone. Drafts your quote before they hang up"
        width={1022}
        height={2082}
        sizes="240px"
        className="relative mt-8 h-auto w-[200px] self-start sm:mt-10 sm:w-[240px]"
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

/* ─── FAQ (on black — the start of the closing run's FAQ → CTA) ── */

function Faq() {
  const items = [
    {
      q: "Do I lose control of my pricing?",
      a: "No. QuoteMax only ever uses your pricing book. Every quote lands in your dashboard for you to approve or tweak before it goes out.",
    },
    {
      q: "What about complex jobs?",
      a: "Anything non-standard books an A$99 site visit instead of auto-quoting. You quote those the way you always have, with the deposit already paid.",
    },
    {
      q: "Whose number is it?",
      a: "Yours. Each tradie gets a dedicated Australian number. Customers text or call it; you stay on the tools.",
    },
    {
      q: "What does it cost?",
      a: "Plans start at A$49/mo, and the Starter Monthly plan comes with a 14-day free trial. See the pricing page for the full breakdown. We never take a cut of your jobs; the only fixed price is the A$99 site visit, credited back to the job.",
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
    // Flush top and bottom: the reviews above and the CTA below each bring
    // their own section padding, so the black run keeps one rhythm.
    <section
      id="faq"
      className="qs-dark qs-section qs-section--flush-top qs-section--flush-bottom"
      aria-labelledby="home-faq-title"
    >
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            align="center"
            eyebrow="Good questions"
            id="home-faq-title"
            title="The stuff tradies actually ask."
          />
        </Reveal>
        <Reveal delay={80}>
          <FaqList items={items} />
        </Reveal>
        {/* The contact band sits before the black run, so the questions
            this list doesn't answer get a way back to it. */}
        <Reveal delay={160} className="flex justify-center">
          <Link href="#contact" className="qs-link min-h-11">
            Contact us
            <Arrow />
          </Link>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── Closing CTA ─────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <CtaBand
      id="home-cta-title"
      title={
        <>
          Both pilots are live.
          <br />
          Your turn is next.
        </>
      }
      lead="Both pilots run on the same platform. Each tradie gets their own number, pricing book, and QuoteMax tuned to their brand voice. Setup takes about three minutes."
    >
      <PrimaryCTA href="/signup">Get my QuoteMax</PrimaryCTA>
      <SecondaryCTA href="#how">See how it works</SecondaryCTA>
    </CtaBand>
  )
}

/* ─── Glyphs for the illustration chips (lucide paths, inlined so
       the page stays a server component with no icon runtime) ───── */

const GLYPHS = {
  sparkle:
    "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
  phone:
    "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",
  message:
    "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
  mobile: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
  send: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zM21.854 2.147l-10.94 10.939",
  check: "M20 6 9 17l-5-5",
}

function Glyph({
  name,
  className = "size-3.5",
}: {
  name: keyof typeof GLYPHS
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={name === "sparkle" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={GLYPHS[name]} />
    </svg>
  )
}

// Thin wires between illustration nodes: one stem that forks out to (or,
// with `merge`, gathers in from) the centres of a `cols`-column grid with
// the 12px gap used above. Rounded corners, like the kit's workflow lines.
function Fork({ cols, merge = false }: { cols: 2 | 3; merge?: boolean }) {
  const span =
    cols === 3
      ? "inset-x-[calc((100%_-_1.5rem)/6)]"
      : "inset-x-[calc((100%_-_0.75rem)/4)]"
  return (
    <div className="relative h-8 w-full" aria-hidden="true">
      <span
        className={`absolute left-1/2 h-1/2 w-px bg-[#d6d2cc] ${merge ? "bottom-0" : "top-0"}`}
      />
      <span
        className={`absolute h-1/2 border-[#d6d2cc] ${span} ${
          merge ? "top-0 rounded-b-[10px] border-x border-b" : "bottom-0 rounded-t-[10px] border-x border-t"
        }`}
      />
      {cols === 3 ? (
        <span
          className={`absolute left-1/2 h-1/2 w-px bg-[#d6d2cc] ${merge ? "top-0" : "bottom-0"}`}
        />
      ) : null}
    </div>
  )
}
