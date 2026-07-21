// Shared premium template for the five trade pages. Built entirely on the
// existing Maintain chrome + primitives (Nav/Footer/MarqueeBar/Topography/
// Eyebrow/CTAs/DuotoneImage) so a trade page is indistinguishable in feel
// from the home page. Content comes from ./_data; this file holds no copy.
//
// Layout notes (the page reads top-down as one argument):
//   hero      — the pitch, with the trade + region stated as a chip
//   scope     — what it quotes, split into the rule (left) and the jobs (right)
//   steps     — the four beats, on a timeline spine like the home page
//   detail    — one photo that proves the claim its caption makes
//   siblings  — the other trades, so the page is never a dead end
//   cta       — close
//
// Images sit in `edge-lit` framed panels here, matching the home page: on
// this canvas an unframed photo reads as dropped-in rather than built-in.

import Link from "next/link"
import { Reveal } from "../_components/Reveal"
import {
  Nav,
  Footer,
  MarqueeBar,
  Topography,
  Eyebrow,
  PrimaryCTA,
  SecondaryCTA,
  Arrow,
} from "../_components/site"
import { DuotoneImage } from "../_components/DuotoneImage"
import { TRADES, TRADE_ORDER, type TradeData } from "./_data"

export function TradePage({ data }: { data: TradeData }) {
  const others = TRADE_ORDER.filter((s) => s !== data.slug).map((s) => TRADES[s])

  return (
    <div className="marketing-canvas">
      {/* Film grain over the whole page — fixed, non-interactive. */}
      <div className="noise-overlay" aria-hidden="true" />
      {/* Reveal fallback for no-JS visitors — never leave content hidden. */}
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      <Nav />

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <Topography />
        <div className="relative z-10 mx-auto grid max-w-[88rem] items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <Reveal>
            {/* The trade and its pilot region, stated up front — the same
                chip pattern the home hero opens with. */}
            <span className="inline-flex items-center gap-2.5 rounded-md border border-ink-line bg-ink/60 px-3 py-1.5 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-sec">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              {data.eyebrow}
            </span>
            <h1 className="mt-6 font-extrabold uppercase leading-[0.95] tracking-[-0.04em] text-[clamp(2.4rem,5.5vw,4.6rem)] [overflow-wrap:anywhere]">
              {data.headline.lead}
              <span className="text-accent">{data.headline.accent}</span>
              {data.headline.tail}
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-text-sec">
              {data.intro}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <PrimaryCTA href="/signup">Get started</PrimaryCTA>
              <SecondaryCTA href="/#how">See how it works</SecondaryCTA>
            </div>
            <p className="mt-6 font-mono text-xs uppercase tracking-[0.12em] text-text-dim">
              {data.note}
            </p>
          </Reveal>
          <Reveal delay={120}>
            <DuotoneImage
              src={data.heroImage}
              alt={data.heroAlt ?? `${data.name} work in Australia`}
              aspect="aspect-[4/3]"
              tone="hero"
              priority
              sizes="(max-width: 1024px) 100vw, 45vw"
              className="edge-lit rounded-2xl border border-ink-line"
            />
          </Reveal>
        </div>
      </section>

      {/* ─── Scope ────────────────────────────────────────────── */}
      {/* Two columns: the rule that decides how a job is handled, and the
          jobs themselves. As one stacked block these read as the same
          weight, which buried the rule. */}
      <section className="border-b border-ink-line">
        <div className="mx-auto grid max-w-[88rem] gap-10 px-6 py-16 md:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <Reveal>
            <Eyebrow>What QuoteMax quotes</Eyebrow>
            <h2 className="mt-6 font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.7rem,3vw,2.5rem)]">
              The easy ones go out.{" "}
              <span className="text-accent">The rest get a look.</span>
            </h2>
            <div className="mt-8 border-l-2 border-accent bg-ink-card/40 py-4 pl-5 pr-4">
              <p className="text-base leading-relaxed text-text-sec md:text-lg">
                {data.scopeBody}
              </p>
            </div>
          </Reveal>

          <Reveal delay={110}>
            <p className="font-mono text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              {data.name} jobs it handles
            </p>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {data.scopeTags.map((tag) => (
                <li
                  key={tag}
                  className="edge-lit flex items-center gap-3 rounded-lg border border-ink-line bg-ink-card/40 px-4 py-3"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-text-pri">{tag}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ─── How the quote is built ───────────────────────────── */}
      <section className="border-b border-ink-line">
        <div className="mx-auto max-w-[88rem] px-6 py-16 md:py-24">
          <Reveal className="max-w-3xl">
            <Eyebrow>How the {data.name.toLowerCase()} quote is built</Eyebrow>
            <h2 className="mt-6 font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
              Your rates. <span className="text-accent">Your book.</span> One
              minute.
            </h2>
          </Reveal>

          {/* The spine runs behind the number column and ties the four
              beats into one sequence — same device as the home page. */}
          <div className="relative mt-12 grid gap-4">
            <div
              className="timeline-spine pointer-events-none absolute left-[2.6rem] top-12 bottom-12 hidden w-px md:block"
              aria-hidden="true"
            />
            {data.steps.map((step, i) => (
              <Reveal key={step.n} delay={i * 80}>
                <article className="card-sweep edge-lit group relative flex items-start gap-5 rounded-2xl border border-ink-line bg-ink-card/40 p-6 transition-colors duration-300 hover:border-accent/30 md:gap-8 md:p-8">
                  <span className="relative z-10 font-mono text-4xl font-bold leading-none text-accent md:text-5xl">
                    {step.n}
                  </span>
                  <div>
                    <h3 className="text-lg font-extrabold uppercase tracking-tight text-text-pri md:text-xl">
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-2xl leading-relaxed text-text-sec">
                      {step.body}
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Detail image band ────────────────────────────────── */}
      {data.detailImage && (
        <section className="border-b border-ink-line">
          <div className="mx-auto grid max-w-[88rem] items-center gap-10 px-6 py-16 md:grid-cols-2 md:gap-16 md:py-24">
            <Reveal>
              <DuotoneImage
                src={data.detailImage}
                alt={data.detailAlt ?? `${data.name} detail`}
                aspect="aspect-[3/2]"
                sizes="(max-width: 768px) 100vw, 50vw"
                className="edge-lit rounded-2xl border border-ink-line"
              />
            </Reveal>
            <Reveal delay={120}>
              <span
                className="block h-0.5 w-12 bg-accent"
                aria-hidden="true"
              />
              <p className="mt-6 max-w-md text-2xl font-extrabold uppercase leading-tight tracking-tight text-text-pri md:text-3xl">
                {data.detailCaption}
              </p>
            </Reveal>
          </div>
        </section>
      )}

      {/* ─── Other trades ─────────────────────────────────────── */}
      {/* Without this the page dead-ends: the nav dropdown was the only way
          across, and it is hidden on mobile. */}
      <section className="border-b border-ink-line">
        <div className="mx-auto max-w-[88rem] px-6 py-16 md:py-24">
          <Reveal>
            <Eyebrow>Other trades on QuoteMax</Eyebrow>
          </Reveal>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((t, i) => (
              <Reveal key={t.slug} delay={i * 80} className="h-full">
                <Link
                  href={`/trades/${t.slug}`}
                  className="edge-lit group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card transition-colors hover:border-text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
                >
                  <DuotoneImage
                    src={t.heroImage}
                    alt=""
                    aspect="aspect-[4/3]"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 22vw"
                  />
                  <div className="flex items-center justify-between gap-3 p-4">
                    <span className="font-extrabold uppercase tracking-tight text-text-pri">
                      {t.name}
                    </span>
                    <span
                      className="shrink-0 font-mono text-accent transition-transform duration-300 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    >
                      <Arrow />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Closing CTA ──────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <Topography />
        <div className="relative z-10 mx-auto max-w-[88rem] px-6 py-20 md:py-28">
          <Reveal>
            <h2 className="font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
              Ready to quote your next{" "}
              <span className="text-accent">{data.name.toLowerCase()}</span> job?
            </h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryCTA href="/signup">Get started</PrimaryCTA>
              <SecondaryCTA href="/pricing">See pricing</SecondaryCTA>
            </div>
          </Reveal>
        </div>
      </section>

      <MarqueeBar />
      <Footer />
    </div>
  )
}
