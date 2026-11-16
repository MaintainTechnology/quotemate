// "Contact us" band for the marketing home page, on the kit's paper band.
// Split like the reference contact page: the ways to reach a person on the
// left (section head, then a hairline-ruled list), the form card on the
// right. Stacks to one column below 1024px.
//
// THE EMAIL ROW IS CONDITIONAL, and that is deliberate. COMPANY.supportEmail
// ships as the bracketed template value '[support@yourdomain.com.au]' (see
// app/legal/_components/company.ts). Rendering that on a live marketing page
// would put a dead mailto: in front of every visitor, so the row only appears
// once the address is real. Fill it in there and it lights up here, in the
// footer, and on the legal pages at the same time. The form works either way.

import type { ReactNode } from "react"
import { COMPANY } from "../legal/_components/company"
import { Reveal } from "./Reveal"
import { ContactForm } from "./ContactForm"
import { SecondaryCTA, SectionHead } from "./site"

/** Template values in company.ts are wrapped in square brackets. */
export function isTemplateValue(value: string): boolean {
  return value.trim().startsWith("[")
}

export function ContactSection() {
  const supportEmail = isTemplateValue(COMPANY.supportEmail)
    ? null
    : COMPANY.supportEmail

  return (
    <section
      id="contact"
      className="qs-band qs-section"
      aria-labelledby="contact-title"
    >
      <div className="qs-container grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
        {/* ── Ways in ─────────────────────────────────────────── */}
        <Reveal className="flex flex-col gap-12">
          <SectionHead
            id="contact-title"
            eyebrow="Contact us"
            title="Got a question? Talk to us."
            lead="Sizing up a plan, wondering whether your trade is covered, or you just want to see it running on a real job. Send a note and a person will read it."
          />

          <dl className="border-t border-[var(--qs-line-strong)]">
            {supportEmail ? (
              <ChannelRow label="Email">
                <a href={`mailto:${supportEmail}`} className="qs-link">
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

          <div className="flex flex-col items-start gap-4">
            <p className="qs-small">
              Would you rather skip the chat and get going?
            </p>
            <SecondaryCTA href="/signup">Start the setup</SecondaryCTA>
          </div>
        </Reveal>

        {/* ── Form ──────────────────────────────────────────────
            Not stretched to the left column's height. The list plus the
            CTA can run taller than the fields, and matching it just parks a
            band of dead space under the submit button, which reads as a
            broken panel rather than as breathing room. */}
        <Reveal delay={120}>
          <ContactForm fallbackEmail={supportEmail ?? undefined} />
        </Reveal>
      </div>
    </section>
  )
}

// One row of the channel list. Hairline-ruled rather than boxed, so the
// block reads as a spec sheet next to the form rather than as a second card
// competing with it. Labels use the body grey, not the lighter meta grey,
// which drops under 4.5:1 on the paper band.
function ChannelRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1 border-b border-[var(--qs-line-strong)] py-4 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-6">
      <dt className="qs-small">{label}</dt>
      <dd className="text-[var(--qs-ink)]">{children}</dd>
    </div>
  )
}
