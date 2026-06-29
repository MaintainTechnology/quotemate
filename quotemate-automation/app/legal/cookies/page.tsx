import type { Metadata } from 'next'
import { LegalShell, LegalSection, type TocItem } from '../_components/LegalShell'
import { COMPANY } from '../_components/company'

export const metadata: Metadata = {
  title: 'Cookie policy',
  description:
    'How QuoteMax uses cookies and local storage — essential session, payment and preference data only.',
}

const TOC: TocItem[] = [
  { id: 'what-are-cookies', label: 'What cookies are' },
  { id: 'how-we-use', label: 'How we use them' },
  { id: 'types', label: 'What we store' },
  { id: 'third-party', label: 'Third-party cookies' },
  { id: 'managing', label: 'Managing cookies' },
  { id: 'changes', label: 'Changes' },
]

export default function CookiePolicyPage() {
  return (
    <LegalShell
      title="Cookie policy"
      activeHref="/legal/cookies"
      intro={`This policy explains how ${COMPANY.product} uses cookies and similar technologies such as browser local storage. We keep this deliberately minimal — we use only what's needed to keep you signed in, process payments, and remember your preferences. We do not use advertising or cross-site tracking cookies.`}
      toc={TOC}
    >
      <LegalSection id="what-are-cookies" n={1} heading="What cookies and local storage are">
        <p>
          Cookies are small text files a website stores on your device. Local
          storage is a similar browser feature that lets a site keep small amounts
          of data between visits. Both let the service remember information so it
          works correctly.
        </p>
      </LegalSection>

      <LegalSection id="how-we-use" n={2} heading="How we use them">
        <p>
          We use these technologies strictly to operate the service — not to build
          advertising profiles or track you across other websites. Because the
          cookies and storage we use are essential to providing a service you have
          requested, they do not require a consent banner under Australian law.
        </p>
      </LegalSection>

      <LegalSection id="types" n={3} heading="What we store">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Authentication (essential)</strong> — your Supabase login
            session is stored in browser local storage so you stay signed in to
            your dashboard. Clearing it signs you out.
          </li>
          <li>
            <strong>Preferences (functional)</strong> — your light/dark theme
            choice is stored locally so the site remembers it on your next visit.
          </li>
          <li>
            <strong>Payments (essential)</strong> — when you pay a deposit or
            inspection fee, Stripe may set cookies needed to process the payment
            securely and prevent fraud.
          </li>
          <li>
            <strong>Security &amp; delivery</strong> — our host (Vercel) may set
            cookies necessary for load balancing, security and reliable delivery of
            the application.
          </li>
        </ul>
        <p>
          We do not currently use analytics or marketing cookies. If that changes,
          we will update this policy and, where required, ask for your consent.
        </p>
      </LegalSection>

      <LegalSection id="third-party" n={4} heading="Third-party cookies">
        <p>
          Some essential functions are provided by third parties who may set their
          own cookies, including <strong>Stripe</strong> (payments) and{' '}
          <strong>Vercel</strong> (hosting). Their use of cookies is governed by
          their own privacy and cookie policies.
        </p>
      </LegalSection>

      <LegalSection id="managing" n={5} heading="Managing cookies">
        <p>
          You can control or delete cookies and local storage through your browser
          settings, and clear site data at any time. Please note that blocking
          essential cookies or clearing local storage will sign you out and may
          stop parts of the service — such as your dashboard or the payment flow —
          from working.
        </p>
      </LegalSection>

      <LegalSection id="changes" n={6} heading="Changes to this policy">
        <p>
          We may update this cookie policy from time to time. The current version,
          with its &ldquo;last updated&rdquo; date, is always available on this
          page. For any questions, contact{' '}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
