// "Contact us" band for the marketing home page. Two columns: the ways to
// reach a person on the left, the form on the right.
//
// THE EMAIL ROW IS CONDITIONAL, and that is deliberate. COMPANY.supportEmail
// ships as the bracketed template value '[support@yourdomain.com.au]' (see
// app/legal/_components/company.ts). Rendering that on a live marketing page
// would put a dead mailto: in front of every visitor, so the row only appears
// once the address is real. Fill it in there and it lights up here, in the
// footer, and on the legal pages at the same time. The form works either way.

import { COMPANY } from "../legal/_components/company"
import { Reveal } from "./Reveal"
import { ContactForm } from "./ContactForm"
import { Eyebrow, SecondaryCTA } from "./site"

/** Template values in company.ts are wrapped in square brackets. */
export function isTemplateValue(value: string): boolean {
  return value.trim().startsWith("[")
}

export function ContactSection() {
  const supportEmail = isTemplateValue(COMPANY.supportEmail)
    ? null
    : COMPANY.supportEmail

  return (
    <section id="contact" className="border-b border-ink-line scroll-mt-20">
      <div className="mx-auto max-w-[88rem] px-6 py-24 md:py-32">
        <div className="grid items-start gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
          {/* ── Ways in ─────────────────────────────────────────── */}
          <Reveal>
            <Eyebrow>Contact us</Eyebrow>
            <h2 className="mt-3 font-extrabold uppercase leading-[1] tracking-[-0.035em] text-[clamp(2rem,4vw,3.25rem)]">
              Got a question?{" "}
              <span className="text-accent">Talk to us.</span>
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-text-sec">
              Sizing up a plan, wondering whether your trade is covered, or you
              just want to see it running on a real job. Send a note and a
              person will read it.
            </p>

            <dl className="mt-10 overflow-hidden rounded-2xl border border-ink-line">
              {supportEmail ? (
                <ChannelRow label="Email">
                  <a
                    href={`mailto:${supportEmail}`}
                    className="link-underline font-semibold text-text-pri hover:text-accent"
                  >
                    {supportEmail}
                  </a>
                </ChannelRow>
              ) : null}
              <ChannelRow label="Reply time">
                Usually within one business day.
              </ChannelRow>
              <ChannelRow label="Where we are">
                Australia wide. Support runs on Australian Eastern time.
              </ChannelRow>
              <ChannelRow label="Already set up">
                Reply to any QuoteMax text and it lands with us.
              </ChannelRow>
            </dl>

            <div className="mt-8">
              <p className="mb-4 text-sm text-text-dim">
                Would you rather skip the chat and get going?
              </p>
              <SecondaryCTA href="/signup">Start the setup</SecondaryCTA>
            </div>
          </Reveal>

          {/* ── Form ──────────────────────────────────────────────
              Not stretched to the left column's height. The ledger plus the
              CTA runs taller than the fields, and matching it just parked a
              band of dead space under the submit button, which reads as a
              broken panel rather than as breathing room. */}
          <Reveal delay={120}>
            <ContactForm fallbackEmail={supportEmail ?? undefined} />
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// One row of the channel ledger. Hairline-separated rather than boxed, so
// the block reads as a spec sheet next to the form rather than as a second
// stack of cards competing with it.
function ChannelRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1 border-b border-ink-line px-5 py-4 last:border-b-0 sm:grid-cols-[9.5rem_1fr] sm:gap-4 sm:px-6">
      <dt className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
        {label}
      </dt>
      <dd className="text-base leading-relaxed text-text-sec">{children}</dd>
    </div>
  )
}
