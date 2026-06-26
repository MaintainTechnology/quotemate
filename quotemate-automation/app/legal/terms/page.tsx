import type { Metadata } from 'next'
import { LegalShell, LegalSection, type TocItem } from '../_components/LegalShell'
import { COMPANY } from '../_components/company'

export const metadata: Metadata = {
  title: 'Terms & conditions',
  description:
    'The terms governing use of QuoteMate by Australian tradespeople and their customers.',
}

const TOC: TocItem[] = [
  { id: 'acceptance', label: 'Acceptance' },
  { id: 'service', label: 'The service' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'quotes', label: 'Quotes & pricing' },
  { id: 'payments', label: 'Payments & fees' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'ip', label: 'Intellectual property' },
  { id: 'liability', label: 'Liability & consumer law' },
  { id: 'termination', label: 'Suspension & termination' },
  { id: 'governing-law', label: 'Governing law' },
]

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms & conditions"
      activeHref="/legal/terms"
      intro={`These terms govern your use of ${COMPANY.product}, operated by ${COMPANY.legalName} (ABN ${COMPANY.abn}). By creating an account or using the service, you agree to these terms. Please read them carefully.`}
      toc={TOC}
    >
      <LegalSection id="acceptance" n={1} heading="Acceptance of these terms">
        <p>
          By accessing or using {COMPANY.product} you agree to be bound by these
          terms and our <a href="/legal/privacy">Privacy policy</a>. If you are
          using the service on behalf of a business, you confirm you are
          authorised to bind that business. If you do not agree, do not use the
          service.
        </p>
      </LegalSection>

      <LegalSection id="service" n={2} heading="The service">
        <p>
          {COMPANY.product} helps Australian tradespeople capture customer
          enquiries (by web, SMS and voice), draft quotes using the tradie&rsquo;s
          own configured pricing, send those quotes to customers, and collect
          deposits or inspection bookings.
        </p>
        <p>
          The service is a tool to assist tradespeople. We are not a party to any
          contract between a tradie and their customer, we do not perform trade
          work, and we do not guarantee that any quote will be accepted or any job
          won.
        </p>
      </LegalSection>

      <LegalSection id="accounts" n={3} heading="Accounts & security">
        <p>
          You must provide accurate information when you register and keep it up to
          date. You are responsible for maintaining the confidentiality of your
          login credentials and for all activity under your account. Notify us
          immediately at{' '}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> if
          you suspect unauthorised access. You may change your password at any time
          from your dashboard or via the password-reset flow.
        </p>
        <p>
          You are responsible for holding and maintaining any licences,
          registrations and insurances required to carry out your trade in your
          jurisdiction (for example, electrical licensing in NSW or plumbing
          licensing in QLD).
        </p>
      </LegalSection>

      <LegalSection id="quotes" n={4} heading="Quotes & pricing">
        <p>
          Quotes are generated from the rates, assemblies and preferences{' '}
          <strong>you configure</strong>. You are responsible for reviewing your
          pricing setup and the quotes produced. While we apply validation to keep
          quote figures grounded in your configuration, you remain responsible for
          the accuracy and suitability of every quote sent to a customer.
        </p>
        <p>
          A quote is an estimate and is not a binding contract unless and until you
          and your customer agree otherwise. Final pricing may change following an
          on-site inspection.
        </p>
      </LegalSection>

      <LegalSection id="payments" n={5} heading="Payments & fees">
        <p>
          Subscription fees (if applicable to your plan) are billed as described at
          sign-up or on our pricing page. Customer deposit and inspection payments
          are processed by Stripe and are subject to Stripe&rsquo;s terms. You
          authorise us and Stripe to process those payments on your behalf.
        </p>
        <p>
          Except as required by the Australian Consumer Law, fees are
          non-refundable. You are responsible for any taxes (including GST) arising
          from your use of the service and from the jobs you quote.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" n={6} heading="Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>use the service for any unlawful, misleading or fraudulent purpose;</li>
          <li>send messages that breach the Spam Act 2003 (Cth) or the Do Not Call Register Act 2006 (Cth);</li>
          <li>upload content you do not have the right to use, or that is defamatory or infringing;</li>
          <li>attempt to disrupt, reverse-engineer, or gain unauthorised access to the service; or</li>
          <li>misuse customer personal information obtained through the service.</li>
        </ul>
        <p>
          You are responsible for obtaining any consents required to contact your
          customers by SMS or voice.
        </p>
      </LegalSection>

      <LegalSection id="ip" n={7} heading="Intellectual property">
        <p>
          We own all intellectual property in the {COMPANY.product} platform. You
          retain ownership of the content you provide (such as your pricing,
          branding and customer data), and you grant us a licence to use it as
          needed to operate and improve the service. We grant you a limited,
          non-exclusive, non-transferable licence to use the service in accordance
          with these terms.
        </p>
      </LegalSection>

      <LegalSection id="liability" n={8} heading="Liability & your consumer rights">
        <p>
          Our services come with guarantees that cannot be excluded under the
          Australian Consumer Law. Nothing in these terms excludes, restricts or
          modifies those guarantees.
        </p>
        <p>
          To the maximum extent permitted by law, the service is provided
          &ldquo;as is&rdquo;; we exclude all other warranties; and our total
          liability for any claim is limited, at our option, to re-supplying the
          service or paying the cost of having it re-supplied. We are not liable
          for indirect or consequential loss, or for the acts or omissions of any
          tradie or customer.
        </p>
      </LegalSection>

      <LegalSection id="termination" n={9} heading="Suspension & termination">
        <p>
          You may stop using the service at any time. We may suspend or terminate
          your access if you breach these terms, if required by law, or to protect
          the service or other users. On termination, your right to use the service
          ends; provisions that by their nature should survive (including IP,
          liability and governing law) will continue.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" n={10} heading="Governing law">
        <p>
          These terms are governed by the laws of {COMPANY.governingState}, and you
          submit to the non-exclusive jurisdiction of the courts of that state. We
          may update these terms from time to time; the current version is always
          available on this page.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
