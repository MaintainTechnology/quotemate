// Shared template for the five trade pages, on the QuoteMax Site Kit
// (services / case-study subpage language). Content comes from ./_data;
// this file holds no copy beyond the section titles.
//
//   hero      — split PageHero, then the trade photo at 16:7
//   scope     — two-card bento: the quote-or-visit rule | the jobs, as pills
//   steps     — four paper process cards; the detail photo + caption sits
//               beside them as the bento's photo card
//   siblings  — the other trades as photo cards, so the page never dead-ends
//   cta       — the dark closing band

import Link from "next/link"
import { Reveal } from "../_components/Reveal"
import {
  SiteShell,
  SectionHead,
  PageHero,
  CtaBand,
  PrimaryCTA,
  SecondaryCTA,
  Arrow,
} from "../_components/site"
import { DuotoneImage } from "../_components/DuotoneImage"
import { TRADES, TRADE_ORDER, type TradeData } from "./_data"

// Decorative 24px line icons (lucide "split" and "wrench") for the bento tiles.
const SPLIT = ["M16 3h5v5", "M8 3H3v5", "M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3", "m15 9 6-6"]
const WRENCH = [
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
]

// Crop facts the data file can't carry. electrical.jpg has 73px letterbox bars
// baked in top and bottom: any frame that keeps more than 622 of its 768px
// height zooms it 1.25 to crop them (drop once the asset is re-exported).
// solar-2.jpg's two workers stand left of centre.
const BARRED = "/trades/electrical.jpg"
const DETAIL_POSITION: Record<string, string> = { "/trades/solar-2.jpg": "35% 30%" }

// Each `sizes` below is the width the cover crop paints, not the frame's: a
// frame narrower than its photo is filled by height, so a 5:6 card paints a
// 1.75:1 photo at 2.1x the card's width (2.6x zoomed) and the 4:5 phone frame
// paints the widest detail photo at 2.2x. Hinting the frame width fetches a
// file the browser then stretches.

function TileIcon({ paths }: { paths: string[] }) {
  return (
    <span className="qs-icon-tile" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  )
}

export function TradePage({ data }: { data: TradeData }) {
  const others = TRADE_ORDER.filter((s) => s !== data.slug).map((s) => TRADES[s])

  return (
    <SiteShell>
      {/* Reveal fallback for no-JS visitors — never leave content hidden. */}
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <PageHero
        layout="split"
        eyebrow={data.eyebrow}
        title={
          <>
            {data.headline.lead}
            {data.headline.accent}
            {data.headline.tail}
          </>
        }
        lead={data.intro}
        actions={
          <>
            <PrimaryCTA href="/signup">Get started</PrimaryCTA>
            <SecondaryCTA href="/#how">See how it works</SecondaryCTA>
            {/* basis-full drops the fine print onto its own line under the pills. */}
            <p className="qs-meta mt-2 basis-full">{data.note}</p>
          </>
        }
      >
        <div className="qs-container mt-12 md:mt-16">
          <Reveal delay={120}>
            {/* Taller below lg so phones don't get a strip; 16:7 alone already
                crops electrical.jpg's bars, the taller frames zoom it. */}
            <DuotoneImage
              src={data.heroImage}
              alt={data.heroAlt ?? `${data.name} work in Australia`}
              aspect={`aspect-[4/3] sm:aspect-[16/9] lg:aspect-[16/7] ${data.heroImage === BARRED ? "max-lg:[&_img]:scale-125" : ""}`}
              tone="hero"
              priority
              sizes="(max-width: 639px) 154vw, (max-width: 1023px) 125vw, (max-width: 1332px) 100vw, 1272px"
              className="rounded-[var(--qs-r-md)]"
            />
          </Reveal>
        </div>
      </PageHero>

      {/* ─── Scope ────────────────────────────────────────────── */}
      {/* Top padding nets out the hero's 64px floor so the gap is one section-y. */}
      <section
        className="qs-section pt-[calc(var(--qs-section-y)_-_64px)]"
        aria-labelledby="trade-scope-title"
      >
        <div className="qs-container qs-stack">
          <Reveal>
            <SectionHead
              id="trade-scope-title"
              eyebrow="What QuoteMax quotes"
              title={
                <>
                  The easy ones go out.
                  <br /> The rest get a look.
                </>
              }
            />
          </Reveal>
          <div className="qs-grid qs-grid--2">
            <Reveal className="h-full">
              <div className="qs-card h-full justify-between gap-12">
                <TileIcon paths={SPLIT} />
                <p className="qs-h4 qs-ink max-w-[32rem]">{data.scopeBody}</p>
              </div>
            </Reveal>
            <Reveal delay={80} className="h-full">
              <div className="qs-card h-full justify-between gap-12">
                <TileIcon paths={WRENCH} />
                <div className="flex flex-col gap-4">
                  <h3 className="qs-title">{data.name} jobs it handles</h3>
                  <ul className="qs-tags">
                    {data.scopeTags.map((tag) => (
                      <li key={tag} className="qs-tag">
                        {tag}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ─── How the quote is built ───────────────────────────── */}
      <section className="qs-section qs-section--flush-top" aria-labelledby="trade-steps-title">
        <div className="qs-container qs-stack">
          <Reveal>
            <SectionHead
              id="trade-steps-title"
              eyebrow={<>How the {data.name.toLowerCase()} quote is built</>}
              title={
                <>
                  Your rates. Your book.
                  <br /> One minute.
                </>
              }
            />
          </Reveal>
          <div
            className={`grid gap-4 ${data.detailImage ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}
          >
            <ol className="grid gap-4 md:grid-cols-2">
              {data.steps.map((step, i) => (
                <li key={step.n}>
                  <Reveal delay={i * 80} className="h-full">
                    {/* Top-aligned, so titles share a line across a row whatever the body length. */}
                    <div className="qs-card h-full gap-12">
                      <span className="qs-icon-tile qs-num text-[15px]">{step.n}</span>
                      <div className="qs-card__copy">
                        <h3 className="qs-card__title">{step.title}</h3>
                        <p className="qs-card__text">{step.body}</p>
                      </div>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>

            {/* The photo that proves the claim its caption makes. */}
            {data.detailImage && (
              <Reveal delay={160} className="h-full">
                <figure className="qs-photo-card h-full rounded-[var(--qs-r-xl)]">
                  <DuotoneImage
                    src={data.detailImage}
                    alt={data.detailAlt ?? `${data.name} detail`}
                    aspect="aspect-[4/5] md:aspect-[16/9] lg:aspect-auto lg:h-full"
                    position={DETAIL_POSITION[data.detailImage] ?? "center 30%"}
                    sizes="(max-width: 767px) 208vw, (max-width: 1023px) 100vw, 1200px"
                  />
                  <figcaption className="qs-photo-card__body">
                    <span className="qs-photo-card__title text-balance md:text-xl md:leading-snug">
                      {data.detailCaption}
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            )}
          </div>
        </div>
      </section>

      {/* ─── Other trades ─────────────────────────────────────── */}
      {/* Without this the page dead-ends: the nav dropdown was the only way
          across, and it is hidden on mobile. */}
      <section className="qs-section qs-section--flush-top" aria-labelledby="trade-others-title">
        <div className="qs-container qs-stack">
          <Reveal>
            {/* "Trades" is the nav + footer label, reused as this section's badge. */}
            <SectionHead id="trade-others-title" eyebrow="Trades" title="Other trades on QuoteMax" />
          </Reveal>
          <ul className="qs-grid grid-cols-2 lg:grid-cols-4">
            {others.map((t, i) => {
              const card =
                t.heroImage === BARRED
                  ? { aspect: "aspect-[5/6] [&_img]:scale-125", sizes: "(max-width: 1023px) 122vw, 804px" }
                  : { aspect: "aspect-[5/6]", sizes: "(max-width: 1023px) 98vw, 643px" }
              return (
                <li key={t.slug}>
                  <Reveal delay={i * 80}>
                    <Link href={`/trades/${t.slug}`} className="qs-photo-card group">
                      <DuotoneImage src={t.heroImage} alt="" {...card} />
                      <span className="qs-photo-card__body flex-row items-center justify-between gap-3 p-4 sm:p-6">
                        <span className="qs-photo-card__title">{t.name}</span>
                        <Arrow className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                      </span>
                    </Link>
                  </Reveal>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      {/* ─── Closing CTA ──────────────────────────────────────── */}
      <CtaBand
        id="trade-cta-title"
        title={<>Ready to quote your next {data.name.toLowerCase()} job?</>}
      >
        <PrimaryCTA href="/signup">Get started</PrimaryCTA>
        <SecondaryCTA href="/pricing">See pricing</SecondaryCTA>
      </CtaBand>
    </SiteShell>
  )
}
