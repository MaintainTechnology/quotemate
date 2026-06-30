// Branded chrome for the Clerk auth pages (/sign-in, /sign-up).
//
// Layout: a full-height two-column editorial split (inspired by the
// nextgenerationmedicine.co structure) rendered entirely in QuoteMax's
// "Maintain" system —
//   • LEFT  (md+): editorial brand panel — BrandMark, mono eyebrow, a display
//     pull-quote, attribution, and a roman-numeral value list. Hidden on
//     mobile so the form comes first.
//   • RIGHT: the auth panel — theme toggle, mono eyebrow, two-tone display
//     heading (one word in accent), subtitle, the themed Clerk widget, a
//     switch link, and a diamond-divider wordmark footer.
//
// Server component (no hooks); ThemeToggle + the Clerk widget are client
// islands rendered inside it. Surfaces use var-backed tokens so the whole
// split follows the light/dark toggle.

import Link from "next/link";
import { BrandMark } from "./BrandMark";
import ThemeToggle from "./ThemeToggle";

const ROMAN = ["I", "II", "III", "IV", "V"];

export type ClerkAuthShellProps = {
  /** LEFT editorial panel (md+ only). */
  editorial: {
    eyebrow: string;
    quote: React.ReactNode;
    author: string;
    role: string;
    /** Up to five value props; rendered as a roman-numeral list. */
    points: React.ReactNode[];
  };
  /** RIGHT auth panel. */
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: string;
  /** "New here? Create an account" switch link. */
  altPrompt?: React.ReactNode;
  /** Optional reassurance line under the switch link. */
  footerNote?: React.ReactNode;
  /** The Clerk <SignIn /> or <SignUp /> widget. */
  children: React.ReactNode;
};

export function ClerkAuthShell({
  editorial,
  eyebrow,
  title,
  subtitle,
  altPrompt,
  footerNote,
  children,
}: ClerkAuthShellProps) {
  return (
    <main className="grid min-h-screen md:grid-cols-2">
      {/* ── LEFT · editorial panel ─────────────────────────────────── */}
      <aside className="relative hidden flex-col justify-between bg-ink-deep px-10 py-12 md:flex lg:px-16">
        <Link href="/" className="flex w-fit items-center gap-2.5">
          <BrandMark className="h-9 w-9" />
          <span className="font-extrabold uppercase tracking-tight text-text-pri">
            QuoteMax
          </span>
        </Link>

        <figure className="my-12 max-w-md">
          <figcaption className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.18em] text-accent">
            {editorial.eyebrow}
          </figcaption>
          <span
            aria-hidden="true"
            className="mt-5 block font-serif text-7xl leading-[0.5] text-text-dim/60"
          >
            &ldquo;
          </span>
          <blockquote className="mt-4 text-[clamp(1.5rem,2.5vw,2.05rem)] font-bold leading-[1.18] tracking-[-0.02em] text-text-pri">
            {editorial.quote}
          </blockquote>
          <div className="mt-8 h-px w-12 bg-ink-line" />
          <div className="mt-4">
            <div className="font-semibold text-text-pri">{editorial.author}</div>
            <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
              {editorial.role}
            </div>
          </div>
        </figure>

        <ol className="space-y-3.5">
          {editorial.points.map((point, i) => (
            <li key={i} className="flex gap-4">
              <span
                aria-hidden="true"
                className="w-6 shrink-0 font-mono text-sm font-bold tabular-nums text-accent"
              >
                {ROMAN[i]}
              </span>
              <span className="text-sm leading-relaxed text-text-sec">
                {point}
              </span>
            </li>
          ))}
        </ol>
      </aside>

      {/* ── RIGHT · auth panel ─────────────────────────────────────── */}
      <div className="flex flex-col bg-ink-card px-6 py-10 sm:px-10 md:border-l md:border-ink-line lg:px-16">
        {/* Top bar: brand on mobile (left panel owns it on md+), theme toggle. */}
        <div className="flex items-center">
          <Link href="/" className="flex items-center gap-2.5 md:hidden">
            <BrandMark className="h-9 w-9" />
            <span className="font-extrabold uppercase tracking-tight text-text-pri">
              QuoteMax
            </span>
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="mx-auto w-full max-w-sm">
            <div className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.18em] text-accent">
              {eyebrow}
            </div>
            <h1 className="mt-3 font-extrabold uppercase text-[clamp(2rem,4vw,2.75rem)] leading-[1] tracking-[-0.035em] text-text-pri">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-3 max-w-prose leading-relaxed text-text-sec">
                {subtitle}
              </p>
            )}

            <div className="mt-8">{children}</div>

            {altPrompt && (
              <p className="mt-6 text-sm text-text-sec">{altPrompt}</p>
            )}
            {footerNote && <div className="mt-4">{footerNote}</div>}
          </div>
        </div>

        {/* Diamond-divider wordmark footer. */}
        <div className="mt-6">
          <div
            aria-hidden="true"
            className="flex items-center justify-center gap-3 text-text-dim"
          >
            <span className="h-px w-10 bg-ink-line" />
            <span className="text-[0.55rem]">&#9670;</span>
            <span className="h-px w-10 bg-ink-line" />
          </div>
          <div className="mt-3 text-center font-mono text-[0.6rem] uppercase tracking-[0.22em] text-text-dim">
            QuoteMax &middot; Built in Australia
          </div>
        </div>
      </div>
    </main>
  );
}

export default ClerkAuthShell;
