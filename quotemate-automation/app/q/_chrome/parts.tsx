// Presentational building blocks for the QuoteMax quote surface (redesign).
//
// Pure, server-safe components that render the mockup's exact inline-styled
// markup, driven entirely by data the page already computes. Nothing here
// fetches or transforms quote data — the goal is to reskin, not to change
// content. Colours/fonts resolve from the `.qm-quote` scope tokens in
// globals.css. Source: redesign/fullQuote (quotemax-design-system mockup).

import type { CSSProperties, ReactNode } from 'react'
import { businessInitials } from '@/lib/brand/monogram'
import { CheckIcon, QuoteMaxMark } from './icons'

/* ── shared type primitives ──────────────────────────────────────────── */
const MONO: CSSProperties = { fontFamily: 'var(--font-mono)' }
const SANS: CSSProperties = { fontFamily: 'var(--font-sans)' }

export const eyebrowStyle = (accent = false): CSSProperties => ({
  ...MONO,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  color: accent ? 'var(--accent)' : 'var(--text-dim)',
})

/* ── the quote "sheet" (the floating bordered article) ───────────────── */
export function QuoteSheet({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <article
      className="qm-sheet"
      data-screen-label={label}
      style={{
        maxWidth: 'var(--qm-sheet-w)',
        width: '100%',
        margin: '26px auto',
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-deep)',
      }}
    >
      {children}
    </article>
  )
}

/* ── letterhead (tradie identity) ─────────────────────────────────────
 * The reference quote surface (quotemax.com.au) leads with the tradie's
 * brand: a wide, uncropped logo, a "Your tradie" eyebrow + business name,
 * and a labelled Contact / Phone / Email strip. `contactName`/`phone`/`email`
 * are optional — when none are supplied the strip is hidden and `credential`
 * falls back under the name (keeps the simpler roof/solar/aircon letterheads
 * intact). The logo renders at its natural aspect ratio (no square crop) so a
 * wide wordmark reads large and correct. */
const LETTERHEAD_LINK: CSSProperties = { color: 'var(--text-pri)', textDecoration: 'none' }

export function Letterhead({
  name,
  credential,
  phoneHref,
  logoUrl,
  eyebrow = 'Your tradie',
  contactName,
  phone,
  email,
}: {
  name: string
  credential?: string | null
  phoneHref?: string | null
  logoUrl?: string | null
  eyebrow?: string | null
  contactName?: string | null
  phone?: string | null
  email?: string | null
}) {
  const telHref = phone ? `tel:${phone.replace(/\s+/g, '')}` : (phoneHref ?? null)

  const contactItems: Array<{ label: string; value: ReactNode }> = []
  if (contactName) contactItems.push({ label: 'Contact', value: contactName })
  if (phone) {
    contactItems.push({
      label: 'Phone',
      value: telHref ? <a href={telHref} style={LETTERHEAD_LINK}>{phone}</a> : phone,
    })
  }
  if (email) {
    contactItems.push({
      label: 'Email',
      value: <a href={`mailto:${email}`} style={LETTERHEAD_LINK}>{email}</a>,
    })
  }
  const hasContact = contactItems.length > 0
  const initials = businessInitials(name)

  return (
    <header style={{ borderBottom: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: hasContact ? '20px 24px 14px' : '20px 24px' }}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={`${name} logo`}
            style={{ height: 52, width: 'auto', maxWidth: 220, objectFit: 'contain', display: 'block', flexShrink: 0 }}
          />
        ) : initials ? (
          // No uploaded logo — the tradie's own initials, never the QuoteMax
          // mark: this letterhead is white-label, so a customer of "Bob's
          // Plumbing" must not be shown our brand as Bob's.
          <span
            aria-hidden
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 48,
              height: 48,
              flexShrink: 0,
              background: 'var(--accent)',
              color: 'var(--accent-ink)',
              borderRadius: 'var(--qm-r-sm)',
              ...SANS,
              fontWeight: 800,
              fontSize: 19,
              letterSpacing: '-0.02em',
            }}
          >
            {initials}
          </span>
        ) : null}
        <div style={{ minWidth: 0 }}>
          {eyebrow ? (
            <div style={{ ...MONO, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--text-dim)' }}>
              {eyebrow}
            </div>
          ) : null}
          <div style={{ marginTop: eyebrow ? 5 : 0, ...SANS, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.01em', fontSize: 22, lineHeight: 1.1, color: 'var(--text-pri)' }}>
            {name}
          </div>
          {!hasContact && credential ? (
            <div style={{ marginTop: 7, ...MONO, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.13em', color: 'var(--text-dim)' }}>
              {credential}
            </div>
          ) : null}
        </div>
      </div>

      {hasContact ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '9px 22px', padding: '0 24px 20px' }}>
          {contactItems.map((it) => (
            <span key={it.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0, maxWidth: '100%' }}>
              <span style={{ ...MONO, fontSize: 8.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)', flexShrink: 0 }}>
                {it.label}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--text-pri)', overflowWrap: 'anywhere', minWidth: 0 }}>
                {it.value}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </header>
  )
}

/* ── duotone hero photo ──────────────────────────────────────────────── */
export function HeroPhoto({ src, alt, height = 210 }: { src?: string | null; alt: string; height?: number }) {
  return (
    <figure className="qm-duotone qm-bleed" style={{ margin: 0, position: 'relative', borderBottom: '1px solid var(--ink-line)' }}>
      <div
        className="qm-duotone__img"
        role="img"
        aria-label={alt}
        style={{ height, backgroundImage: src ? `url("${src}")` : undefined, background: src ? undefined : 'var(--ink-card)' }}
      />
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, color-mix(in srgb, var(--ink-deep) 20%, transparent) 0%, transparent 34%, color-mix(in srgb, var(--ink-deep) 78%, transparent) 100%)' }} />
    </figure>
  )
}

/* ── hero (quote id + status + headline + greeting + date chips) ─────── */
export function QuoteHero({
  quoteId,
  status,
  line1,
  line2,
  greeting,
  issued,
  valid,
}: {
  quoteId: string
  status?: { label: string; tone?: 'await' | 'booked' } | null
  line1: string
  line2?: string
  greeting?: ReactNode
  issued?: string | null
  valid?: string | null
}) {
  const tone = status?.tone === 'booked' ? 'var(--success-bright)' : 'var(--warning-bright)'
  return (
    <section style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--ink-line)', background: 'var(--ink-deep)' }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(130% 90% at 50% 0%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 62%)' }} />
      <div style={{ position: 'relative', zIndex: 1, padding: '28px 24px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>{quoteId}</span>
          {status ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`, borderRadius: 'var(--qm-r-ctl)', ...MONO, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.13em', color: tone }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: tone, animation: 'qm-pulse-soft 2.4s ease-in-out infinite' }} />
              {status.label}
            </span>
          ) : null}
        </div>
        <h1 style={{ margin: '18px 0 0', ...SANS, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.03em', fontSize: 'clamp(2.4rem, 4.6vw, 3.6rem)', lineHeight: 0.98, color: 'var(--text-pri)' }}>
          {line1}
          {line2 ? (<><br /><span className="qm-accentword">{line2}</span></>) : null}
        </h1>
        {greeting ? <p style={{ margin: '20px 0 0', fontSize: 17, lineHeight: 1.55, color: 'var(--text-sec)', maxWidth: '68ch' }}>{greeting}</p> : null}
        {(issued || valid) ? (
          <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {issued ? <Chip>{issued}</Chip> : null}
            {valid ? <Chip>{valid}</Chip> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span style={{ ...MONO, fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)', border: '1px solid var(--ink-line)', padding: '5px 10px', borderRadius: 'var(--qm-r-ctl)' }}>
      {children}
    </span>
  )
}

/* ── summary stat grid (2-col hairline cells) ────────────────────────── */
export type Stat = { k: string; v: ReactNode; sub?: ReactNode }
export function StatGrid({ items }: { items: Stat[] }) {
  return (
    <section style={{ borderBottom: '1px solid var(--ink-line)', background: 'var(--ink-line)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1, background: 'var(--ink-line)' }}>
        {items.map((s, i) => (
          <div key={i} style={{ background: 'var(--ink-card)', padding: '16px 18px' }}>
            <div style={{ ...MONO, fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.13em', color: 'var(--text-dim)' }}>{s.k}</div>
            <div style={{ marginTop: 8, ...MONO, fontWeight: 800, lineHeight: 1, fontSize: 25, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
            {s.sub ? <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-sec)' }}>{s.sub}</div> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── generic section shell ───────────────────────────────────────────── */
export function SheetSection({
  eyebrow,
  eyebrowAccent = false,
  aside,
  background = 'var(--ink-card)',
  pad = '22px 24px',
  first = false,
  children,
}: {
  eyebrow?: string
  eyebrowAccent?: boolean
  aside?: ReactNode
  background?: string
  pad?: string
  first?: boolean
  children?: ReactNode
}) {
  return (
    <section style={{ padding: pad, borderTop: first ? undefined : '1px solid var(--ink-line)', background }}>
      {eyebrow ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={eyebrowStyle(eyebrowAccent)}>{eyebrow}</div>
          {aside ? <span style={{ ...MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)' }}>{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/* ── numbered scope of works ─────────────────────────────────────────── */
export type ScopeItem = { title: string; body?: ReactNode; list?: ReactNode[] }
export function Scope({ items, eyebrow = 'Scope of works' }: { items: ScopeItem[]; eyebrow?: string }) {
  return (
    <section style={{ padding: '22px 24px 8px', borderTop: '1px solid var(--ink-line)' }}>
      <div style={eyebrowStyle()}>{eyebrow}</div>
      {items.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 16, padding: '20px 0', borderTop: '1px solid var(--ink-line)', marginTop: 14 }}>
          <span aria-hidden="true" style={{ flexShrink: 0, ...MONO, fontWeight: 700, fontSize: 26, lineHeight: 0.85, color: 'var(--accent)' }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, ...SANS, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.01em', fontSize: 16.5, color: 'var(--text-pri)' }}>{s.title}</h3>
            {/* div, not p: body is a ReactNode and the five-sections layout
                passes block content (figure/div/p) — nesting those inside a
                <p> is invalid HTML and throws hydration errors. */}
            {s.body ? <div style={{ margin: '9px 0 0', fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-sec)', whiteSpace: 'pre-line', maxWidth: '72ch' }}>{s.body}</div> : null}
            {s.list && s.list.length ? (
              <div style={{ marginTop: 11, display: 'grid', gap: 9 }}>
                {s.list.map((li, j) => (
                  <div key={j} style={{ display: 'flex', gap: 11, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>
                    <CheckIcon /> <span>{li}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  )
}

/* ── metric grid (4-col hairline cells; for solar/roof numbers) ──────── */
export type Metric = { k: string; v: ReactNode; sub?: ReactNode }
export function MetricGrid({
  items,
  cols = 4,
  valueColor = 'var(--accent)',
  valueSize = 18,
}: {
  items: Metric[]
  cols?: number
  valueColor?: string
  valueSize?: number
}) {
  return (
    <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 1, background: 'var(--ink-line)', border: '1px solid var(--ink-line)', borderRadius: 'var(--qm-r-sm)', overflow: 'hidden' }}>
      {items.map((m, i) => (
        <div key={i} style={{ background: 'var(--ink-card)', padding: '14px 12px' }}>
          <div style={{ ...MONO, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>{m.k}</div>
          <div style={{ marginTop: 7, ...MONO, fontWeight: 800, fontSize: valueSize, color: valueColor, fontVariantNumeric: 'tabular-nums' }}>{m.v}</div>
          {m.sub ? <div style={{ marginTop: 5, ...MONO, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sec)' }}>{m.sub}</div> : null}
        </div>
      ))}
    </div>
  )
}

/* ── tier cards (Good / Better / Best) ───────────────────────────────── */
export type QuoteTier = {
  name: string
  badge?: string | null
  blurb?: ReactNode
  priceText: string
  priceNote?: string
  items?: ReactNode[]
  ctaLabel: string
  ctaHref?: string | null
  recommended?: boolean
}
export function TierCards({
  tiers,
  eyebrow = 'Choose your option',
  heading = 'Good · Better · Best',
  intro,
}: {
  tiers: QuoteTier[]
  eyebrow?: string
  heading?: string
  intro?: ReactNode
}) {
  return (
    <section style={{ padding: '26px 24px', borderTop: '1px solid var(--ink-line)', background: 'var(--ink-deep)' }}>
      <div style={eyebrowStyle(true)}>{eyebrow}</div>
      <h2 style={{ margin: '10px 0 0', ...SANS, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.02em', fontSize: 22, color: 'var(--text-pri)' }}>{heading}</h2>
      {intro ? <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)' }}>{intro}</p> : null}
      <div
        style={{
          marginTop: 20,
          display: 'grid',
          gap: 14,
          // Stack on phones; lay the tiers out as side-by-side pricing columns
          // on desktop. A lone option stays a comfortable width, left-aligned.
          gridTemplateColumns:
            tiers.length > 1 ? 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))' : '1fr',
          maxWidth: tiers.length === 1 ? 480 : undefined,
          alignItems: 'stretch',
        }}
      >
        {tiers.map((t, i) => (
          <div
            key={i}
            className="qm-tier"
            style={{
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              border: t.recommended ? '1px solid var(--accent)' : '1px solid var(--ink-line)',
              background: t.recommended ? 'color-mix(in srgb, var(--accent) 6%, var(--ink-card))' : 'var(--ink-card)',
              padding: '18px 18px 20px',
            }}
          >
            {t.recommended ? <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--accent), var(--accent-soft))' }} /> : null}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ ...MONO, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--accent)' }}>{t.name}</span>
                  {t.badge ? (
                    <span style={{ background: 'var(--accent)', color: 'var(--accent-ink)', ...MONO, fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.13em', padding: '2px 7px', borderRadius: 'var(--qm-r-sm)' }}>{t.badge}</span>
                  ) : null}
                </div>
                {t.blurb ? <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--text-sec)', maxWidth: '34ch' }}>{t.blurb}</p> : null}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ ...MONO, fontWeight: 800, fontSize: 24, lineHeight: 1, color: 'var(--text-pri)', fontVariantNumeric: 'tabular-nums' }}>{t.priceText}</div>
                <div style={{ marginTop: 5, ...MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>{t.priceNote ?? 'inc GST'}</div>
              </div>
            </div>
            {t.items && t.items.length ? (
              <div style={{ marginTop: 14, display: 'grid', gap: 9, flexGrow: 1, alignContent: 'start' }}>
                {t.items.map((it, j) => (
                  <div key={j} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.4, color: 'var(--text-sec)' }}>
                    <CheckIcon /> <span>{it}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {t.ctaHref ? (
              <a href={t.ctaHref} className="qm-cta" style={{ display: 'block', marginTop: 16, textAlign: 'center', border: '1px solid transparent', background: 'var(--accent)', color: 'var(--accent-ink)', padding: '13px 16px', ...SANS, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', textDecoration: 'none' }}>
                {t.ctaLabel}
              </a>
            ) : (
              <div style={{ marginTop: 16, textAlign: 'center', border: '1px solid var(--ink-line)', color: 'var(--text-dim)', padding: '13px 16px', ...MONO, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', borderRadius: 'var(--qm-r-ctl)' }}>
                {t.ctaLabel}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── media placeholder (face-holder for the tradie trust videos) ──────
 * v1 of the five-sections quote page ships BEFORE any tradie video exists
 * (spec customer-quote-five-sections R4), so the trust section and the
 * post-booking thank-you page render this static face-holder tile instead
 * of a player. Deliberately NOT animated: a pulse reads as "loading", and
 * nothing is loading — this is honest placeholder content. Inline SVG
 * glyph (stroke 1.75) keeps it dependency-free and print-safe. */
export function MediaPlaceholder({
  title,
  caption,
  eyebrow,
}: {
  title: string
  caption?: string | null
  eyebrow?: string | null
}) {
  return (
    <figure
      style={{
        margin: 0,
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-deep)',
        borderRadius: 'var(--qm-r-sm)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          aspectRatio: '16 / 9',
          display: 'grid',
          placeItems: 'center',
          background:
            'radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 60%), var(--ink-card)',
        }}
      >
        <div style={{ display: 'grid', justifyItems: 'center', gap: 10, padding: 20, textAlign: 'center' }}>
          <svg
            width="44"
            height="44"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="3.4" />
            <path d="M5 19.2c1.4-3 4-4.6 7-4.6s5.6 1.6 7 4.6" />
          </svg>
          <div style={{ ...SANS, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.01em', fontSize: 14, color: 'var(--text-pri)' }}>
            {title}
          </div>
          {eyebrow ? (
            <div style={{ ...MONO, fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>
              {eyebrow}
            </div>
          ) : null}
        </div>
      </div>
      {caption ? (
        <figcaption
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--ink-line)',
            ...MONO,
            fontSize: 9.5,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--text-dim)',
          }}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}

/* ── trust video (the tradie's welcome / thank-you message) ───────────
 * Plays the tenant's own video when QuoteMax has filmed them, else the
 * QuoteMax default placeholder video (mig 177 public bucket, resolved by
 * lib/quote/tenant-identity trustVideoUrls). No src at all (unconfigured
 * env) degrades to the static MediaPlaceholder face-holder. Server-safe:
 * a plain HTML5 <video> — controls, no autoplay (respects the customer's
 * data + attention), preload="metadata" so the poster frame shows without
 * pulling megabytes. */
export function TrustVideo({
  src,
  title,
  caption,
}: {
  src: string | null
  title: string
  caption?: string | null
}) {
  if (!src) return <MediaPlaceholder title={title} eyebrow="Video coming soon" caption={caption} />
  return (
    <figure
      style={{
        margin: 0,
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-deep)',
        borderRadius: 'var(--qm-r-sm)',
        overflow: 'hidden',
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- spoken-word
          placeholder briefs; captions land with the per-tradie films */}
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', background: 'var(--ink-card)' }}
      />
      {caption ? (
        <figcaption
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--ink-line)',
            ...MONO,
            fontSize: 9.5,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--text-dim)',
          }}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}

/* ── add to calendar ─────────────────────────────────────────────────
 * Customer-facing "save this appointment" row for a booked site visit.
 * Server-safe (plain <a> tags): Google + Outlook open a compose deep-link in
 * a new tab; ".ics" is a data: URI download that covers Apple Calendar,
 * Outlook desktop and anything else. Ghost styling so it recedes behind the
 * yellow primary CTA. Links come pre-built from lib/quote/calendar-links.ts. */
const CAL_CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid var(--ink-line)',
  background: 'transparent',
  color: 'var(--text-sec)',
  padding: '10px 14px',
  borderRadius: 'var(--qm-r-ctl)',
  ...MONO,
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  textDecoration: 'none',
}
export function AddToCalendar({
  google,
  outlook,
  icsHref,
  label = 'Add to your calendar',
}: {
  google: string
  outlook: string
  /** The .ics route URL (preferred over a data: URI so iOS Safari downloads it). */
  icsHref: string
  label?: string
}) {
  return (
    <div className="qm-print-hide">
      <div style={{ ...MONO, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <a className="qm-ghost" href={google} target="_blank" rel="noopener noreferrer" style={CAL_CHIP}>
          Google
        </a>
        <a className="qm-ghost" href={outlook} target="_blank" rel="noopener noreferrer" style={CAL_CHIP}>
          Outlook
        </a>
        <a className="qm-ghost" href={icsHref} download="site-visit.ics" style={CAL_CHIP}>
          Apple / .ics
        </a>
      </div>
    </div>
  )
}

/* ── good to know ────────────────────────────────────────────────────── */
export function GoodToKnow({ items, note, eyebrow = 'Good to know' }: { items: ReactNode[]; note?: ReactNode; eyebrow?: string }) {
  if (!items.length && !note) return null
  return (
    <section style={{ padding: 24, borderTop: '1px solid var(--ink-line)' }}>
      <div style={eyebrowStyle()}>{eyebrow}</div>
      <div style={{ marginTop: 14, display: 'grid', gap: 11 }}>
        {items.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 11, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>
            <span aria-hidden="true" style={{ ...MONO, color: 'var(--text-dim)', flexShrink: 0 }}>○</span>
            <span>{a}</span>
          </div>
        ))}
      </div>
      {note ? <p style={{ margin: '16px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-dim)' }}>{note}</p> : null}
    </section>
  )
}

/* ── credential footer + prepared-with + tagline strip ───────────────── */
export type FooterRow = { k: string; v: ReactNode }
export function CredentialFooter({
  rows,
  tagline = 'Pick a tier · Pay the deposit · We book it in · Licensed & insured',
}: {
  rows: FooterRow[]
  tagline?: string | null
}) {
  return (
    <>
      <footer style={{ padding: 24, borderTop: '1px solid var(--ink-line)', background: 'var(--ink-card)' }}>
        {rows.length ? (
          <div style={{ display: 'grid', gap: 1, border: '1px solid var(--ink-line)', background: 'var(--ink-line)', borderRadius: 'var(--qm-r-sm)', overflow: 'hidden' }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: 12, padding: '11px 14px', background: 'var(--ink-card)' }}>
                <span style={{ ...MONO, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)' }}>{r.k}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.4 }}>{r.v}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ ...MONO, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)' }}>Quote prepared with</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <QuoteMaxMark size={16} />
            <span style={{ ...SANS, fontWeight: 800, fontSize: 13, textTransform: 'uppercase', letterSpacing: '-0.01em', color: 'var(--text-sec)' }}>QuoteMax</span>
          </span>
        </div>
      </footer>
      {tagline ? (
        <div style={{ background: 'var(--accent)', color: 'var(--accent-ink)', padding: '12px 16px', textAlign: 'center', ...MONO, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          {tagline}
        </div>
      ) : null}
    </>
  )
}
