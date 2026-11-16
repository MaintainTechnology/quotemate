// Social proof for the marketing home page, in the QuoteMax Site Kit: the
// reference's "client reviews" block on black. A centred head, then three
// even #1a1a1a cards: the quote in white, the author (monogram, name,
// trade + region) pinned to the foot of each card. It opens the page's dark
// closing run, so it carries `qs-dark` and the kit remaps type and cards.
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
  /** Trade + region, shown under the name. */
  meta: string
  /** Two letters for the monogram. */
  initials: string
}

const QUOTES: Quote[] = [
  {
    body:
      "The quote goes out while I’m still packing the ute. I used to save them all up for Sunday night, and by then half the jobs had already gone to someone quicker.",
    name: "Dave R.",
    meta: "Electrical · Penrith NSW",
    initials: "DR",
  },
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
    <section id="proof" className="qs-dark qs-section" aria-labelledby="proof-title">
      <div className="qs-container qs-stack">
        <Reveal className="qs-head qs-head--center">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Eyebrow>From the crews</Eyebrow>
            {PLACEHOLDER ? <PlaceholderTag /> : null}
          </div>
          <h2 id="proof-title" className="qs-h2">
            Less time quoting. More time on the tools.
          </h2>
          <p className="qs-text">
            The same three things come up: the quote goes out sooner, it reads
            the way the tradie would have written it, and the paperwork stops
            following them home.
          </p>
        </Reveal>

        <div className="qs-grid qs-grid--3">
          {QUOTES.map((q, i) => (
            <Reveal
              key={q.name}
              delay={i * 80}
              // Two columns between 768 and 991px: the last card takes the
              // full row rather than sitting alone at half width.
              className="h-full last:md:max-[992px]:col-span-2"
            >
              <QuoteCard quote={q} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// Dim, not accent. This tag exists to be honest, not to be looked at; an
// accent chip here would out-shout the quotes it is annotating.
function PlaceholderTag() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-[13px] leading-[1.4] text-white/60">
      <span className="h-1.5 w-1.5 rounded-full bg-white/40" aria-hidden="true" />
      Placeholder copy
    </span>
  )
}

// Quote at the top, attribution pinned to the foot (the reference card's
// rhythm), so cards of different quote lengths still line up across a row.
function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <figure className="qs-card qs-card--dark h-full justify-between gap-10 lg:min-h-[18rem]">
      <blockquote className="text-base leading-[1.5] text-[var(--qs-on-dark)]">
        &ldquo;{quote.body}&rdquo;
      </blockquote>
      <figcaption className="flex items-center gap-3.5">
        <Monogram initials={quote.initials} />
        <span className="flex min-w-0 flex-col">
          <span className="qs-title">{quote.name}</span>
          <span className="qs-small text-[var(--qs-on-dark-body)]">{quote.meta}</span>
        </span>
      </figcaption>
    </figure>
  )
}

// An initials avatar instead of a stock photo. No invented faces to go with
// the invented quotes.
function Monogram({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/10 bg-[var(--qs-ink-raise)] text-sm font-medium tracking-[0.02em] text-white"
    >
      {initials}
    </span>
  )
}
