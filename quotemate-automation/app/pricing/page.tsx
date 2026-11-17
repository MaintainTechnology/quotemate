// /pricing — the dedicated plans page, on the QuoteMax Site Kit (SiteShell
// chrome, Inter at weight 400, paper cards, pill controls) and the shared
// PricingTiers cards so it never drifts from the homepage section.
// Structure: centred hero carrying the tier cards (monthly/annual toggle) →
// feature comparison (white table on a paper band) → fair-use & overage
// explainer → the $99 site-visit explainer → ROI proof → FAQ → dark CTA.

import { Reveal } from "../_components/Reveal"
import {
  SiteShell,
  PageHero,
  SectionHead,
  FaqList,
  CtaBand,
  PrimaryCTA,
  SecondaryCTA,
} from "../_components/site"
import { PricingTiers } from "../_components/PricingTiers"
import { COMPARISON, PLANS, PRICING_FAQ } from "../_components/pricing-data"

export const metadata = {
  title: "Pricing · QuoteMax",
  description:
    "Simple plans for Australian tradies. Starter A$49, Pro A$129, Crew A$299 a month (save ~17% annually). Starter Monthly includes a 14-day free trial, no cut of your jobs, A$99 site visit credited to the job.",
  openGraph: {
    title: "QuoteMax pricing: costs less than one missed job",
    description:
      "Three plans for AU tradies. SMS + voice quoting, clean quotes, deposits collected. Starter Monthly includes a 14-day free trial.",
    type: "website",
  },
}

export default function PricingPage() {
  return (
    <SiteShell>
      <Header />
      <Comparison />
      <FairUse />
      <SiteVisit />
      <RoiBand />
      <Faq />
      <ClosingCta />
    </SiteShell>
  )
}

/* ─── Header + plans (the cards ride in the hero) ─────────────── */

function Header() {
  return (
    <>
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <PageHero
        eyebrow="Pricing"
        title="Pays for itself with one extra job a month."
        lead={
          <>
            QuoteMax answers every text and call, drafts clean quotes in under a
            minute, and takes the deposit. Pick a plan and you&rsquo;re quoting
            the same day. Starter Monthly comes with a 14-day free trial. We
            never take a cut of your jobs.
          </>
        }
      >
        {/* Hero content: no scroll reveal. On phones the ~1700px block
            never reached Reveal's 15% threshold on load, leaving a blank
            first screen. */}
        <div className="qs-container mt-14 md:mt-16">
          <PricingTiers variant="full" />
        </div>
      </PageHero>
    </>
  )
}

/* ─── Feature comparison ──────────────────────────────────────── */

// Hairline rows on a white panel. Phones: the panel scrolls sideways on its
// own (the page never does) with the feature column pinned. md+: the panel
// clips instead of scrolling — `overflow: clip` is not a scroll container,
// so the header row can stick under the floating nav.
const CELL = "border-b border-[var(--qs-line)] px-4 py-4 md:px-6"
// Sticky header cells need an opaque fill: white, or the Pro column's tint.
// The white shadow caps the 10px gap under the nav once the row sticks; at
// rest it falls outside the panel and `overflow: clip` hides it.
const HEAD = `${CELL} md:sticky md:top-[88px] md:z-[2] md:py-5 md:shadow-[0_-12px_0_#fff]`
const FIRST =
  "pl-5 md:pl-8 max-md:sticky max-md:left-0 max-md:z-[1] max-md:w-[9.5rem] max-md:min-w-[9.5rem] max-md:bg-white max-md:shadow-[1px_0_0_var(--qs-line)]"
const FEATURED_COL = "bg-[#faf9f8]"

function Comparison() {
  return (
    <section className="qs-section qs-band" aria-labelledby="compare-title">
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            id="compare-title"
            eyebrow="Features"
            title="Compare the plans."
          />
        </Reveal>

        <Reveal>
          {/* `relative`: the sr-only cell labels are absolutely positioned;
              without a positioned scroller they escape its clip and widen
              the page on phones. A named, focusable region so keyboard users
              can scroll it in browsers without focusable scrollers (Safari). */}
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="compare-title"
            className={`relative overflow-x-auto rounded-[var(--qs-r-xl)] border border-[var(--qs-line)] bg-white md:overflow-clip`}
          >
            <table
              aria-labelledby="compare-title"
              className="w-full min-w-[36rem] border-separate border-spacing-0 text-left text-[15px] leading-[1.4]"
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className={`${HEAD} ${FIRST} qs-meta bg-white align-bottom font-normal`}
                  >
                    Feature
                  </th>
                  {PLANS.map((p) => (
                    <th
                      key={p.id}
                      scope="col"
                      className={`${HEAD} w-[22%] text-center font-normal ${
                        p.featured ? FEATURED_COL : "bg-white"
                      }`}
                    >
                      <span className="qs-title inline-flex items-center gap-2">
                        {p.featured && (
                          <span
                            className="size-1.5 rounded-full bg-[var(--qs-brand)]"
                            aria-hidden="true"
                          />
                        )}
                        {p.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label} className="[&:last-child>*]:border-b-0">
                    <th
                      scope="row"
                      className={`${CELL} ${FIRST} font-normal text-[var(--qs-ink)]`}
                    >
                      {row.label}
                    </th>
                    {row.values.map((v, i) => (
                      <td
                        key={PLANS[i].id}
                        className={`${CELL} text-center ${
                          PLANS[i].featured ? FEATURED_COL : ""
                        }`}
                      >
                        <Cell value={v} featured={PLANS[i].featured} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Cell({ value, featured }: { value: string; featured?: boolean }) {
  if (value === "✓") {
    return (
      <>
        <Glyph d="M4.5 12.5l5 5L19.5 7" className="text-[var(--qs-ink)]" />
        <span className="sr-only">Included</span>
      </>
    )
  }
  if (value === "–") {
    return (
      <>
        <Glyph d="M7 12h10" className="text-[var(--qs-muted)]" />
        <span className="sr-only">Not included</span>
      </>
    )
  }
  return (
    <span className={featured ? "text-[var(--qs-ink)]" : "text-[var(--qs-body)]"}>
      {value}
    </span>
  )
}

// ponytail: the kit ships Arrow + Chevron only; thin check/dash live here.
function Glyph({ d, className }: { d: string; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`mx-auto block size-5 ${className}`}
    >
      <path d={d} />
    </svg>
  )
}

/* ─── Fair-use & overage explainer ────────────────────────────── */

function FairUse() {
  return (
    <section className="qs-section" aria-labelledby="fair-use-title">
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            id="fair-use-title"
            eyebrow="Fair use"
            title={
              <>
                No bill shock.{" "}
                <br />
                No cut-offs mid-job.
              </>
            }
            className="max-w-[36rem]"
            lead="Texts and quotes are generous fair-use. Quote as much as you like. The only thing we meter is voice minutes, because answering calls is the one part with a real per-minute cost. Go over and it keeps working; we just bill the extra and nudge you before you get there."
          />
        </Reveal>

        <div className="qs-grid qs-grid--3">
          <Reveal className="h-full">
            <FactCard
              value="Fair-use"
              unit="texts & quotes"
              note="Quote every lead that comes in. We only ever flag genuine abuse, never a busy week."
            />
          </Reveal>
          <Reveal delay={80} className="h-full">
            <FactCard
              value="A$0.50"
              unit="per extra voice minute"
              note="Only on Pro, only past your 300 included minutes (A$0.40 on Crew). Top up or bump a plan anytime."
              accent
            />
          </Reveal>
          <Reveal delay={160} className="h-full md:max-[991px]:col-span-2">
            <FactCard
              value="80%"
              unit="usage warning"
              note="We email you well before you hit a limit, so a busy month is never a surprise on the invoice."
            />
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function FactCard({
  value,
  unit,
  note,
  accent,
}: {
  value: string
  unit: string
  note: string
  accent?: boolean
}) {
  return (
    <div className="qs-card h-full justify-between gap-10">
      <div className="qs-stat">
        {/* normal-nums: Inter's tabular hyphen renders "Fair-use" as
            "Fair - use"; no column here needs tabular figures. */}
        <span className="qs-stat__value normal-nums text-[clamp(2.25rem,1.8rem+1.4vw,3rem)]">
          {value}
        </span>
        <span className="qs-stat__label inline-flex items-center gap-2">
          {accent && (
            <span
              className="size-2 rounded-full bg-[var(--qs-brand)]"
              aria-hidden="true"
            />
          )}
          {unit}
        </span>
      </div>
      <p className="qs-text">{note}</p>
    </div>
  )
}

/* ─── The $99 site visit ──────────────────────────────────────── */

function SiteVisit() {
  const steps = [
    {
      num: "01",
      title: "Complex job comes in",
      body: "Anything that can’t be safely auto-quoted, such as a switchboard upgrade or a burst pipe, routes to a paid site visit instead of a guessed price.",
    },
    {
      num: "02",
      title: "Customer pays A$99 to lock a slot",
      body: "A real deposit filters tyre-kickers and confirms intent. It’s collected on the quote page before you drive out.",
    },
    {
      num: "03",
      title: "It’s credited to the job",
      body: "When the job goes ahead, the A$99 comes off the final invoice. You keep it. QuoteMax never takes a cut of your work.",
    },
  ]
  return (
    <section
      className="qs-section qs-section--flush-top"
      aria-labelledby="site-visit-title"
    >
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            id="site-visit-title"
            eyebrow="The only fixed price"
            title="How the A$99 site visit works."
          />
        </Reveal>
        <div className="qs-grid qs-grid--3">
          {steps.map((s, i) => (
            <Reveal
              key={s.num}
              delay={i * 80}
              className={`h-full ${i === 2 ? "md:max-[991px]:col-span-2" : ""}`}
            >
              <article className="qs-card h-full">
                <span className="qs-icon-tile qs-num text-[15px]">{s.num}</span>
                <div className="qs-card__copy">
                  <h3 className="qs-card__title">{s.title}</h3>
                  <p className="qs-card__text">{s.body}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── ROI proof ───────────────────────────────────────────────── */

function RoiBand() {
  return (
    <section
      className="qs-section qs-section--flush-top"
      aria-labelledby="roi-title"
    >
      <div className="qs-container">
        <Reveal>
          <div className="qs-card gap-12 lg:grid lg:grid-cols-2 lg:items-end lg:gap-16 lg:p-14">
            <SectionHead
              id="roi-title"
              eyebrow="ROI"
              title={
                <>
                  Do the maths.{" "}
                  {/* A block, not a <br>: text-wrap: balance then balances
                      this line on its own instead of orphaning "months." */}
                  <span className="block">One won job covers months.</span>
                </>
              }
              className="max-w-[34rem]"
              lead={
                <>
                  Most jobs a tradie wins carry A$300–A$2,000+ in margin. Pro is
                  A$129 a month. If QuoteMax catches one lead you&rsquo;d
                  otherwise have missed up a ladder, it&rsquo;s already paid for
                  itself, usually many times over.
                </>
              }
            />
            <div className="grid grid-cols-2 gap-x-6 gap-y-10">
              <Stat value="< 1 min" label="Per quote drafted" />
              <Stat value="24/7" label="Line always answered" />
              <Stat value="A$129" label="Pro, billed monthly" />
              <Stat value="1 job" label="Pays for the year" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="qs-stat border-t border-black/[0.08] pt-5">
      <span className="qs-stat__value text-[clamp(2rem,1.6rem+1.2vw,2.75rem)]">
        {value}
      </span>
      <span className="qs-stat__label">{label}</span>
    </div>
  )
}

/* ─── FAQ ─────────────────────────────────────────────────────── */

function Faq() {
  return (
    <section
      className="qs-section qs-section--flush-top"
      aria-labelledby="pricing-faq-title"
    >
      <div className="qs-container qs-stack">
        <Reveal>
          <SectionHead
            align="center"
            id="pricing-faq-title"
            eyebrow="Good questions"
            title="Pricing, straight up."
          />
        </Reveal>
        <Reveal>
          <FaqList className="qs-faq--wide" items={PRICING_FAQ} />
        </Reveal>
      </div>
    </section>
  )
}

/* ─── Closing CTA ─────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <CtaBand
      id="pricing-cta-title"
      title={
        <>
          Start free.{" "}
          <br />
          Quoting the same day.
        </>
      }
      lead="Connect your number, load your pricing book, and QuoteMax is live in about three minutes. Starter Monthly comes with a 14-day free trial."
    >
      <PrimaryCTA href="/signup">Get started</PrimaryCTA>
      <SecondaryCTA href="/#how">See how it works</SecondaryCTA>
    </CtaBand>
  )
}
