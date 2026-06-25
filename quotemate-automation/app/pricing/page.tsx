// /pricing — the dedicated plans page. Maintain design system, built on
// the shared site chrome (Nav/Footer/MarqueeBar) and the shared
// PricingTiers cards so it never drifts from the homepage section.
// Structure: ROI-led header → tier cards (monthly/annual toggle) →
// feature comparison → fair-use & overage explainer → the $99 site-visit
// explainer → ROI proof band → FAQ → closing CTA.

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
import { PricingTiers } from "../_components/PricingTiers"
import { COMPARISON, PLANS, PRICING_FAQ } from "../_components/pricing-data"

export const metadata = {
  title: "Pricing — QuoteMax",
  description:
    "Simple plans for Australian tradies. Starter $49, Pro $129, Crew $299 a month (save ~17% annually). Starter Monthly includes a 14-day free trial, no cut of your jobs, $99 site visit credited to the job.",
  openGraph: {
    title: "QuoteMax pricing — costs less than one missed job",
    description:
      "Three plans for AU tradies. SMS + voice quoting, clean quotes, deposits collected. Starter Monthly includes a 14-day free trial.",
    type: "website",
  },
}

export default function PricingPage() {
  return (
    <div className="marketing-canvas">
      <div className="noise-overlay" aria-hidden="true" />
      <Nav />
      <Header />
      <Plans />
      <Comparison />
      <FairUse />
      <SiteVisit />
      <RoiBand />
      <Faq />
      <ClosingCta />
      <Footer />
      <MarqueeBar />
    </div>
  )
}

/* ─── Header ──────────────────────────────────────────────────── */

function Header() {
  return (
    <section className="relative overflow-hidden border-b border-ink-line">
      <Topography />
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <div className="relative z-10 mx-auto max-w-[88rem] px-6 py-20 md:py-28">
        <Reveal className="max-w-3xl">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="mt-6 font-extrabold uppercase leading-[0.98] tracking-[-0.04em] text-[clamp(2.4rem,6vw,5rem)]">
            Pays for itself with{" "}
            <span className="text-accent">one extra job a month.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-text-sec">
            QuoteMax answers every text and call, drafts clean quotes in under a
            minute, and takes the deposit. Pick a plan and you&rsquo;re quoting
            the same day — Starter Monthly comes with a 14-day free trial. We
            never take a cut of your jobs.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

/* ─── Plans (the cards) ───────────────────────────────────────── */

function Plans() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-20 md:py-24">
        <Reveal>
          <PricingTiers variant="full" />
        </Reveal>
      </div>
    </section>
  )
}

/* ─── Feature comparison ──────────────────────────────────────── */

function Comparison() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <h2 className="font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            Compare the <span className="text-accent">plans.</span>
          </h2>
        </Reveal>

        <Reveal>
          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-line">
                  <th className="py-4 pr-4 align-bottom font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                    Feature
                  </th>
                  {PLANS.map((p) => (
                    <th
                      key={p.id}
                      className={`px-4 py-4 text-center font-extrabold uppercase tracking-tight ${
                        p.featured ? "text-accent" : "text-text-pri"
                      }`}
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label} className="border-b border-ink-line/60">
                    <th
                      scope="row"
                      className="py-4 pr-4 text-sm font-medium text-text-sec"
                    >
                      {row.label}
                    </th>
                    {row.values.map((v, i) => (
                      <td
                        key={PLANS[i].id}
                        className={`px-4 py-4 text-center text-sm ${
                          PLANS[i].featured ? "bg-accent/[0.04]" : ""
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
      <span className="font-bold text-accent" aria-label="Included">
        ✓
      </span>
    )
  }
  if (value === "—") {
    return (
      <span className="text-text-dim" aria-label="Not included">
        —
      </span>
    )
  }
  return (
    <span className={featured ? "text-text-pri" : "text-text-sec"}>{value}</span>
  )
}

/* ─── Fair-use & overage explainer ────────────────────────────── */

function FairUse() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <h2 className="font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            No bill shock.{" "}
            <span className="text-accent">No cut-offs mid-job.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            Texts and quotes are generous fair-use — quote as much as you like.
            The only thing we meter is voice minutes, because answering calls is
            the one part with a real per-minute cost. Go over and it keeps
            working; we just bill the extra and nudge you before you get there.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Reveal>
            <FactCard
              value="Fair-use"
              unit="texts & quotes"
              note="Quote every lead that comes in. We only ever flag genuine abuse, never a busy week."
            />
          </Reveal>
          <Reveal delay={110}>
            <FactCard
              value="$0.50"
              unit="per extra voice minute"
              note="Only on Pro, only past your 300 included minutes ($0.40 on Crew). Top up or bump a plan anytime."
              accent
            />
          </Reveal>
          <Reveal delay={220}>
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
    <div
      className={`edge-lit h-full border bg-ink-card p-6 transition-colors duration-300 md:p-8 ${
        accent
          ? "border-accent/40 hover:border-accent/60"
          : "border-ink-line hover:border-text-dim"
      }`}
    >
      <div className="flex items-baseline gap-3">
        <span
          className={`font-mono text-4xl font-bold tracking-tight tabular-nums md:text-5xl ${
            accent ? "text-accent" : "text-text-pri"
          }`}
        >
          {value}
        </span>
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-dim">
          {unit}
        </span>
      </div>
      <p className="mt-5 text-base leading-relaxed text-text-sec">{note}</p>
    </div>
  )
}

/* ─── The $99 site visit ──────────────────────────────────────── */

function SiteVisit() {
  const steps = [
    {
      num: "01",
      title: "Complex job comes in",
      body: "Anything that can’t be safely auto-quoted — a switchboard upgrade, a burst pipe — routes to a paid site visit instead of a guessed price.",
    },
    {
      num: "02",
      title: "Customer pays $99 to lock a slot",
      body: "A real deposit filters tyre-kickers and confirms intent. It’s collected on the quote page before you drive out.",
    },
    {
      num: "03",
      title: "It’s credited to the job",
      body: "When the job goes ahead, the $99 comes off the final invoice. You keep it. QuoteMax never takes a cut of your work.",
    },
  ]
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>The only fixed price</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            How the <span className="text-accent">$99 site visit</span> works.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.num} delay={i * 110}>
              <article className="edge-lit h-full border border-ink-line bg-ink-card p-6 md:p-8">
                <span className="font-mono text-4xl font-bold leading-none text-accent md:text-5xl">
                  {s.num}
                </span>
                <h3 className="mt-5 font-extrabold uppercase tracking-tight text-text-pri text-lg">
                  {s.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-text-sec">
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

/* ─── ROI proof band ──────────────────────────────────────────── */

function RoiBand() {
  return (
    <section className="border-b border-ink-line bg-ink/40">
      <div className="mx-auto max-w-[88rem] px-6 py-20 md:py-24">
        <Reveal className="max-w-3xl">
          <h2 className="font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.7rem,3.4vw,2.6rem)]">
            Do the maths.{" "}
            <span className="text-accent">One won job covers months.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-text-sec">
            Most jobs a tradie wins carry $300–$2,000+ in margin. Pro is $129 a
            month. If QuoteMax catches one lead you&rsquo;d otherwise have
            missed up a ladder, it&rsquo;s already paid for itself — usually many
            times over.
          </p>
        </Reveal>
        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-4">
          <Reveal>
            <Stat value="< 1 min" label="Per quote drafted" />
          </Reveal>
          <Reveal delay={90}>
            <Stat value="24/7" label="Line always answered" />
          </Reveal>
          <Reveal delay={180}>
            <Stat value="$129" label="Pro, billed monthly" />
          </Reveal>
          <Reveal delay={270}>
            <Stat value="1 job" label="Pays for the year" />
          </Reveal>
        </div>
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

/* ─── FAQ ─────────────────────────────────────────────────────── */

function Faq() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <Reveal className="max-w-3xl">
          <Eyebrow>Good questions</Eyebrow>
          <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(1.8rem,3.6vw,2.8rem)]">
            Pricing, <span className="text-accent">straight up.</span>
          </h2>
        </Reveal>
        <dl className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {PRICING_FAQ.map((it, i) => (
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

/* ─── Closing CTA ─────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="border-b border-ink-line">
      <div className="mx-auto max-w-4xl px-6 py-24 md:py-28">
        <Reveal>
          <h2 className="font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
            Start free.{" "}
            <span className="text-accent">Quoting the same day.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
            Connect your number, load your pricing book, and QuoteMax
            is live in about three minutes. Starter Monthly comes with a 14-day
            free trial.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <PrimaryCTA href="/signup">Get started</PrimaryCTA>
            <SecondaryCTA href="/#how">See how it works</SecondaryCTA>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
