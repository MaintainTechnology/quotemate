// Social proof for the marketing home page, in the command-centre system:
// warm charcoal, one Caterpillar-yellow accent, mono metadata rails,
// borders and lit edges instead of drop shadows.
//
// LAYOUT: deliberately asymmetric. The page already carries four card
// grids (the numbered timeline, the trade tiles, the stats rail and the
// pricing tiers), so a fifth even 3-up grid would read as filler. One
// wide feature quote beside two stacked dockets breaks that rhythm and
// gives the strongest line somewhere to actually land.
//
// ⚠ THE QUOTES BELOW ARE PLACEHOLDERS. They are written to be plausible
// and measured rather than glowing, but nobody said them. The section
// renders a "Placeholder copy" tag for exactly that reason. Publishing
// invented praise under invented names, unmarked, is a fabricated review.
// Swap in real, permissioned quotes and set PLACEHOLDER to false; that
// one flag drops the tag and nothing else changes.

import { Reveal } from "./Reveal"
import { Eyebrow } from "./site"

/** Flip to false once every quote below is real and permissioned. */
const PLACEHOLDER = true

type Quote = {
  /** The quote itself. Written flat: no superlatives, no round numbers. */
  body: string
  name: string
  /** Trade + region, shown in the mono rail above the quote. */
  meta: string
  /** Two letters for the monogram tile. */
  initials: string
}

const FEATURE: Quote = {
  body:
    "The quote goes out while I’m still packing the ute. I used to save them all up for Sunday night, and by then half the jobs had already gone to someone quicker.",
  name: "Dave R.",
  meta: "Electrical · Penrith NSW",
  initials: "DR",
}

const SUPPORTING: Quote[] = [
  {
    body:
      "It asks the questions I’d ask on the phone. What lands is close to the quote I would have written myself, so I’m adjusting a line here and there rather than starting from scratch.",
    name: "Marnie T.",
    meta: "Plumbing · Ipswich QLD",
    initials: "MT",
  },
  {
    body:
      "The paid site visit sorted out the tyre kickers. If someone puts $99 down they are serious, and it comes off the job anyway, so nobody feels stung.",
    name: "Sam K.",
    meta: "Roofing · Newcastle NSW",
    initials: "SK",
  },
]

export function Testimonials() {
  return (
    <section id="proof" className="border-b border-ink-line scroll-mt-20">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>From the crews</Eyebrow>
            {PLACEHOLDER ? <PlaceholderTag /> : null}
          </div>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
            Less time quoting.{" "}
            <span className="text-accent">More time on the tools.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            The same three things come up: the quote goes out sooner, it reads
            the way the tradie would have written it, and the paperwork stops
            following them home.
          </p>
        </Reveal>

        <div className="mt-14 grid items-stretch gap-4 lg:grid-cols-[1.12fr_0.88fr]">
          <Reveal className="h-full">
            <FeatureQuote quote={FEATURE} />
          </Reveal>
          <div className="grid gap-4">
            {SUPPORTING.map((q, i) => (
              <Reveal key={q.name} delay={110 + i * 90} className="h-full">
                <SupportingQuote quote={q} />
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// Dim, not accent. This tag exists to be honest, not to be looked at; an
// accent chip here would out-shout the quotes it is annotating.
function PlaceholderTag() {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-ink-line bg-ink/60 px-3 py-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
      <span
        className="h-1.5 w-1.5 rounded-full bg-text-dim"
        aria-hidden="true"
      />
      Placeholder copy
    </span>
  )
}

// The headline quote. Carries the static accent rail (the supporting cards
// draw theirs on hover via .card-sweep), an oversized watermark glyph for
// depth, and the quote set at display size so it reads before the eye gets
// to the attribution.
function FeatureQuote({ quote }: { quote: Quote }) {
  return (
    <figure className="edge-lit relative flex h-full flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card p-7 md:p-10">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden="true" />
      {/* Watermark. Clipped by the card's own overflow, so it bleeds off
          the top-right corner rather than sitting inside a box. */}
      <span
        className="pointer-events-none absolute -top-10 right-2 select-none font-mono text-[11rem] leading-none text-accent/10 md:text-[14rem]"
        aria-hidden="true"
      >
        &ldquo;
      </span>

      <span className="relative font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {quote.meta}
      </span>

      {/* The card is stretched to the height of the two stacked dockets
          beside it, and that slack has to go somewhere. Pinning the rail to
          the top and the attribution to the bottom, then centring the quote
          in what is left, turns it into structure. Hanging the caption off
          mt-auto instead pooled every spare pixel into one hole directly
          above it, which read as a rendering fault. */}
      <div className="relative flex flex-1 items-center py-8">
        <blockquote className="font-semibold leading-[1.25] tracking-[-0.02em] text-text-pri text-[clamp(1.35rem,2.1vw,1.9rem)] text-balance">
          &ldquo;{quote.body}&rdquo;
        </blockquote>
      </div>

      <figcaption className="relative flex items-center gap-4 border-t border-ink-line pt-6 md:pt-8">
        <Monogram initials={quote.initials} featured />
        <span className="flex flex-col">
          <span className="font-extrabold uppercase tracking-tight text-text-pri">
            {quote.name}
          </span>
          <span className="mt-0.5 font-mono text-[0.75rem] uppercase tracking-[0.1em] text-text-dim">
            {quote.meta}
          </span>
        </span>
      </figcaption>
    </figure>
  )
}

function SupportingQuote({ quote }: { quote: Quote }) {
  return (
    <figure className="card-sweep edge-lit flex h-full flex-col rounded-2xl border border-ink-line bg-ink-card p-6 transition-colors duration-300 hover:border-accent/40 md:p-7">
      <span className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {quote.meta}
      </span>
      <blockquote className="mt-4 text-base leading-relaxed text-text-sec md:text-lg">
        &ldquo;{quote.body}&rdquo;
      </blockquote>
      <figcaption className="mt-auto flex items-center gap-3 border-t border-ink-line pt-5">
        <Monogram initials={quote.initials} />
        <span className="font-semibold tracking-tight text-text-pri">
          {quote.name}
        </span>
      </figcaption>
    </figure>
  )
}

// A bordered initials tile instead of a stock avatar. No invented faces to
// go with the invented quotes, and it holds the square-shouldered look the
// rest of the page uses for mono labels.
function Monogram({
  initials,
  featured = false,
}: {
  initials: string
  featured?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-lg border font-mono font-bold tracking-[0.04em] ${
        featured
          ? "h-12 w-12 border-accent/45 bg-accent/10 text-accent text-sm"
          : "h-10 w-10 border-ink-line bg-ink text-text-dim text-[0.75rem]"
      }`}
    >
      {initials}
    </span>
  )
}
