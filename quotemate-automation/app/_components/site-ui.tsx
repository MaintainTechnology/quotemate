// QuoteMax Site Kit — presentational primitives for the marketing surface.
//
// Hook-free and server-safe on purpose: client islands (AuthNav,
// MobileNav, CookieConsent) render the same pill buttons and badges as the
// server pages, and they cannot import site.tsx (it imports AuthNav, and it
// loads the kit's font + stylesheet). Every class here is styled by
// site-kit.css and only resolves inside a `.qm-site` scope — <SiteShell>.

import Link from "next/link"
import type { ComponentProps, ReactNode } from "react"
import { BrandMark } from "./BrandMark"

export function Arrow({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/* ─── Buttons ──────────────────────────────────────────────────────
   The label renders twice and the arrow twice: on hover each pair slides
   by one line/width (the reference's text roll). The second copy is
   aria-hidden, so assistive tech reads the label once. */

export type BtnVariant = "primary" | "secondary" | "brand"
export type BtnSize = "sm" | "md" | "lg"

export function btnClass(variant: BtnVariant = "primary", size: BtnSize = "md", extra = "") {
  return [
    "qs-btn",
    variant === "secondary" && "qs-btn--light",
    variant === "brand" && "qs-btn--brand",
    size === "sm" && "qs-btn--sm",
    size === "lg" && "qs-btn--lg",
    extra,
  ]
    .filter(Boolean)
    .join(" ")
}

export function BtnInner({ children, arrow = false }: { children: ReactNode; arrow?: boolean }) {
  return (
    <>
      <span className="qs-btn__roll">
        <span>{children}</span>
        <span aria-hidden="true">{children}</span>
      </span>
      {arrow ? (
        <span className="qs-btn__icon" aria-hidden="true">
          <Arrow />
          <Arrow />
        </span>
      ) : null}
    </>
  )
}

type ButtonProps = {
  href: string
  children: ReactNode
  variant?: BtnVariant
  size?: BtnSize
  /** Defaults to true for primary/brand, false for secondary. */
  arrow?: boolean
  className?: string
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">

export function Button({ href, children, variant = "primary", size = "md", arrow, className = "", ...rest }: ButtonProps) {
  return (
    <Link href={href} className={btnClass(variant, size, className)} {...rest}>
      <BtnInner arrow={arrow ?? variant !== "secondary"}>{children}</BtnInner>
    </Link>
  )
}

export function PrimaryCTA({ href, children }: { href: string; children: ReactNode }) {
  return <Button href={href}>{children}</Button>
}

export function SecondaryCTA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button href={href} variant="secondary">
      {children}
    </Button>
  )
}

/* ─── Type + structure ─────────────────────────────────────────── */

/** The badge eyebrow: two slanted bars, then an uppercase label. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`qs-badge ${className}`}>
      <span className="qs-badge__mark" aria-hidden="true">
        <i />
        <i />
      </span>
      {children}
    </span>
  )
}

export function SectionHead({
  eyebrow,
  title,
  lead,
  align = "left",
  as: Tag = "h2",
  titleClassName = "qs-h2",
  className = "",
  id,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lead?: ReactNode
  align?: "left" | "center"
  as?: "h1" | "h2" | "h3"
  titleClassName?: string
  className?: string
  /** Put on the title so a section can be `aria-labelledby` it. */
  id?: string
}) {
  return (
    <div className={`qs-head ${align === "center" ? "qs-head--center" : ""} ${className}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Tag id={id} className={titleClassName}>
        {title}
      </Tag>
      {lead ? <p className="qs-text">{lead}</p> : null}
    </div>
  )
}

/** Subpage hero — centred (blog-index pattern) or split (title left,
 *  lead + actions right; services pattern). */
export function PageHero({
  eyebrow,
  title,
  lead,
  layout = "center",
  actions,
  children,
  id = "page-hero-title",
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lead?: ReactNode
  layout?: "center" | "split"
  actions?: ReactNode
  children?: ReactNode
  /** On the h1, so the section is `aria-labelledby` it (one hero a page). */
  id?: string
}) {
  if (layout === "split") {
    return (
      <section className="qs-page-hero" aria-labelledby={id}>
        <div className="qs-container qs-page-hero__split">
          <div>
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            <h1 id={id} className="qs-h1">{title}</h1>
          </div>
          <div>
            {lead ? <p className="qs-text">{lead}</p> : null}
            {actions ? <div className="qs-actions">{actions}</div> : null}
          </div>
        </div>
        {children}
      </section>
    )
  }
  return (
    <section className="qs-page-hero" aria-labelledby={id}>
      <div className="qs-container qs-page-hero__center">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 id={id} className="qs-h1">{title}</h1>
        {lead ? <p className="qs-lead">{lead}</p> : null}
        {actions ? <div className="qs-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Browser-window frame: black bar with traffic lights, a soft gradient
 *  body and the warm glow along its floor — the reference's hero widget. */
export function BrowserFrame({
  children,
  className = "",
  glow = true,
}: {
  children: ReactNode
  className?: string
  glow?: boolean
}) {
  return (
    <div className={`qs-browser ${className}`}>
      <div className="qs-browser__bar" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="qs-browser__body">
        {glow ? <div className="qs-browser__glow" aria-hidden="true" /> : null}
        <div className="qs-browser__content">{children}</div>
      </div>
    </div>
  )
}

/** FAQ accordion on native <details>: keyboard and screen-reader support
 *  come free, and site-kit.css animates the height via ::details-content. */
export function FaqList({
  items,
  className = "",
}: {
  items: { q: ReactNode; a: ReactNode }[]
  className?: string
}) {
  return (
    <div className={`qs-faq ${className}`}>
      {items.map((item, i) => (
        <details key={i} className="qs-faq__item">
          <summary className="qs-faq__q">
            <span>{item.q}</span>
            <Chevron className="qs-faq__chev" />
          </summary>
          <div className="qs-faq__a">{item.a}</div>
        </details>
      ))}
    </div>
  )
}

/** Closing CTA on black — mark, title, lead, actions. Place it directly
 *  before the footer so the two read as one dark run. */
export function CtaBand({
  title,
  lead,
  children,
  id,
}: {
  title: ReactNode
  lead?: ReactNode
  children?: ReactNode
  id?: string
}) {
  return (
    <section className="qs-dark qs-cta" aria-labelledby={id}>
      <BrandMark className="h-10 w-auto" />
      <h2 id={id} className="qs-h2">
        {title}
      </h2>
      {lead ? <p className="qs-text">{lead}</p> : null}
      {children ? <div className="qs-actions">{children}</div> : null}
    </section>
  )
}
