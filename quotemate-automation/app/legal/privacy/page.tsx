import type { Metadata } from 'next'
import { LegalShell, LegalSection, type TocItem } from '../_components/LegalShell'
import { COMPANY } from '../_components/company'

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How QuoteMate collects, uses, stores and discloses personal information under the Australian Privacy Principles and the Privacy Act 1988 (Cth).',
}

const TOC: TocItem[] = [
  { id: 'who-we-are', label: 'Who we are' },
  { id: 'what-we-collect', label: 'Information we collect' },
  { id: 'how-we-use', label: 'How we use it' },
  { id: 'disclosure', label: 'Disclosure & service providers' },
  { id: 'storage', label: 'Storage & security' },
  { id: 'overseas', label: 'Overseas disclosure' },
  { id: 'access', label: 'Access & correction' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'changes', label: 'Changes' },
]

export default function PrivacyPolicyPage() {
  return (
    <LegalShell
      title="Privacy policy"
      activeHref="/legal/privacy"
      intro={`${COMPANY.legalName} ("${COMPANY.product}", "we", "us") is committed to protecting your personal information. This policy explains how we handle personal information in accordance with the Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs). It applies to tradespeople who use ${COMPANY.product} and to the customers who receive quotes through it.`}
      toc={TOC}
    >
      <LegalSection id="who-we-are" n={1} heading="Who we are">
        <p>
          {COMPANY.product} is operated by <strong>{COMPANY.legalName}</strong>{' '}
          (ABN {COMPANY.abn}), of {COMPANY.address}. We are the entity
          responsible for the personal information described in this policy.
        </p>
        <p>
          For privacy enquiries, contact our privacy officer at{' '}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection id="what-we-collect" n={2} heading="Information we collect">
        <p>We collect personal information that is reasonably necessary to provide the service, including:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Account &amp; business details</strong> — name, business name,
            email, mobile number, ABN, trade type, licence details, service area
            and pricing preferences.
          </li>
          <li>
            <strong>Customer enquiry details</strong> — when a tradie&rsquo;s
            customer requests a quote, we process the customer&rsquo;s name,
            contact number, job address, job description and any photos they send.
          </li>
          <li>
            <strong>Communications</strong> — SMS, voice call recordings and
            transcripts, and messages exchanged through the service.
          </li>
          <li>
            <strong>Payment information</strong> — deposit and inspection payments
            are processed by Stripe; we receive transaction metadata but do not
            store full card numbers.
          </li>
          <li>
            <strong>Technical data</strong> — device, browser and usage
            information, and cookies/local storage described in our{' '}
            <a href="/legal/cookies">Cookie policy</a>.
          </li>
        </ul>
        <p>
          Where practicable you may deal with us anonymously or using a
          pseudonym, though we may be unable to provide the full service without
          certain details.
        </p>
      </LegalSection>

      <LegalSection id="how-we-use" n={3} heading="How we use your information">
        <p>We use personal information to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>create and manage tradie accounts and customer quotes;</li>
          <li>draft, send and follow up on quotes via SMS and voice;</li>
          <li>process deposits and inspection bookings;</li>
          <li>provide support, security, fraud-prevention and service improvement;</li>
          <li>comply with our legal obligations.</li>
        </ul>
        <p>
          We use AI models to structure enquiries and draft quotes. Pricing is
          generated from a tradie&rsquo;s configured rates and assembly library —
          not invented — and money-affecting outputs are validated against that
          configuration before a quote is produced.
        </p>
        <p>
          We only use your information for direct marketing where permitted, and
          every marketing message includes a way to opt out.
        </p>
      </LegalSection>

      <LegalSection id="disclosure" n={4} heading="Disclosure & service providers">
        <p>
          We do not sell your personal information. We disclose it to trusted
          providers who help us run the service, under contractual confidentiality
          obligations, including:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Supabase</strong> — database, authentication and file storage;</li>
          <li><strong>Twilio</strong> — SMS and messaging delivery;</li>
          <li><strong>Vapi, Deepgram &amp; ElevenLabs</strong> — voice receptionist (speech-to-text and text-to-speech);</li>
          <li><strong>Anthropic, Google &amp; Voyage AI</strong> — AI processing for quote drafting and image generation;</li>
          <li><strong>Stripe</strong> — payment processing;</li>
          <li><strong>Resend</strong> — transactional email; and</li>
          <li><strong>Vercel</strong> — application hosting.</li>
        </ul>
        <p>
          A tradie&rsquo;s customer details are made available to that tradie so
          they can fulfil the job. We may also disclose information where required
          or authorised by law.
        </p>
      </LegalSection>

      <LegalSection id="storage" n={5} heading="Storage & security">
        <p>
          We take reasonable steps to protect personal information from misuse,
          interference, loss, and unauthorised access, modification or disclosure
          — including encryption in transit, access controls and tenant data
          isolation. No method of transmission or storage is completely secure,
          and we cannot guarantee absolute security.
        </p>
        <p>
          We retain personal information only for as long as necessary for the
          purposes above or as required by law, after which we take reasonable
          steps to delete or de-identify it.
        </p>
      </LegalSection>

      <LegalSection id="overseas" n={6} heading="Overseas disclosure">
        <p>
          Some of our service providers store or process data outside Australia
          (for example, in the United States or the European Union). Where we
          disclose personal information overseas, we take reasonable steps to
          ensure the recipient handles it consistently with the APPs.
        </p>
      </LegalSection>

      <LegalSection id="access" n={7} heading="Access & correction">
        <p>
          You may request access to the personal information we hold about you, and
          ask us to correct it if it is inaccurate, out of date or incomplete.
          Contact <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
          We will respond within a reasonable period and may need to verify your
          identity first. We will tell you if a fee applies (we do not charge to
          make a request).
        </p>
      </LegalSection>

      <LegalSection id="complaints" n={8} heading="Complaints">
        <p>
          If you believe we have breached the APPs, contact our privacy officer at{' '}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a> and
          we will investigate. If you are not satisfied with our response, you may
          contact the Office of the Australian Information Commissioner (OAIC) at{' '}
          <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">
            oaic.gov.au
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="changes" n={9} heading="Changes to this policy">
        <p>
          We may update this policy from time to time. The current version is
          always available on this page, with the &ldquo;last updated&rdquo; date
          shown above. Material changes will be communicated where appropriate.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
