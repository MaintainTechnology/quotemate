// Shared premium template for the four trade pages. Built entirely on the
// existing Maintain chrome + primitives (Nav/Footer/MarqueeBar/Topography/
// Eyebrow/CTAs/DuotoneImage) so a trade page is indistinguishable in feel
// from the home page. Content comes from ./_data; this file holds no copy.

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
import { DuotoneImage } from "../_components/DuotoneImage"
import type { TradeData } from "./_data"

export function TradePage({ data }: { data: TradeData }) {
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
            <Eyebrow>{data.eyebrow}</Eyebrow>
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
          </Reveal>
          <Reveal delay={120}>
            <DuotoneImage
              src={data.heroImage}
              alt={`${data.name} work in Australia`}
              aspect="aspect-[4/5]"
              tone="hero"
              priority
              sizes="(max-width: 1024px) 100vw, 45vw"
            />
          </Reveal>
        </div>
      </section>

      {/* ─── Scope ────────────────────────────────────────────── */}
      <section className="border-b border-ink-line">
        <div className="mx-auto max-w-[88rem] px-6 py-16 md:py-24">
          <Reveal>
            <Eyebrow>What QuoteMax quotes</Eyebrow>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-sec">
              {data.scopeBody}
            </p>
            <ul className="mt-8 flex flex-wrap gap-2.5">
              {data.scopeTags.map((tag) => (
                <li
                  key={tag}
                  className="border border-ink-line px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-text-dim"
                >
                  {tag}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ─── How the quote is built ───────────────────────────── */}
      <section className="border-b border-ink-line">
        <div className="mx-auto max-w-[88rem] px-6 py-16 md:py-24">
          <Reveal>
            <Eyebrow>How the {data.name.toLowerCase()} quote is built</Eyebrow>
            <h2 className="mt-6 max-w-2xl font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.9rem,3.6vw,3rem)]">
              Your rates. <span className="text-accent">Your book.</span> One
              minute.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-4">
            {data.steps.map((step, i) => (
              <Reveal key={step.n} delay={i * 80}>
                <article className="flex items-start gap-5 border border-ink-line bg-ink-card/40 p-6 md:gap-6 md:p-8">
                  <span className="font-mono text-4xl font-bold leading-none text-accent md:text-5xl">
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
          <p className="mt-8 max-w-2xl font-mono text-xs uppercase tracking-[0.12em] text-text-dim">
            {data.note}
          </p>
        </div>
      </section>

      {/* ─── Detail image band (only when a second photo exists) ─ */}
      {data.detailImage && (
        <section className="border-b border-ink-line">
          <div className="mx-auto grid max-w-[88rem] items-center gap-10 px-6 py-16 md:grid-cols-2 md:py-24">
            <Reveal>
              <DuotoneImage
                src={data.detailImage}
                alt={`${data.name} detail`}
                aspect="aspect-[16/10]"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </Reveal>
            <Reveal delay={120}>
              <p className="max-w-md text-2xl font-extrabold uppercase leading-tight tracking-tight text-text-pri md:text-3xl">
                {data.detailCaption}
              </p>
            </Reveal>
          </div>
        </section>
      )}

      {/* ─── Closing CTA ──────────────────────────────────────── */}
      <section className="border-b border-ink-line">
        <div className="mx-auto max-w-[88rem] px-6 py-20 md:py-28">
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
