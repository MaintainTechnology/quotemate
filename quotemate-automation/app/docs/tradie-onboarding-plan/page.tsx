// Tradie Onboarding Plan — v6 architecture visual at /docs/tradie-onboarding-plan
//
// Static React Server Component. Brand: Maintain design system
// (dark navy + orange, all-caps display, numbered cards).
// Styles in page.module.css; fonts (Manrope + JetBrains Mono) loaded via
// next/font/google so they're self-hosted on Vercel.

import type { Metadata } from 'next'
import { Manrope, JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'
import styles from './page.module.css'

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

const jbMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Tradie Onboarding Plan · QuoteMax',
  description:
    'How a tradie signs up, fills the form, and gets a live AI receptionist on their own QuoteMax number. End to end, fully automated.',
}

type Step = { num: string; label: string; desc: string }

const FLOW: Step[] = [
  { num: '01', label: 'Website',  desc: 'Tradie visits quotemax.com.au and clicks Get Started' },
  { num: '02', label: 'Form',     desc: '4 short pages on mobile, ~3 minutes to fill' },
  { num: '03', label: 'Database', desc: 'Tenant row, pricing book, service offerings written' },
  { num: '04', label: 'Twilio',   desc: 'New AU phone number bought, SMS + voice webhooks wired' },
  { num: '05', label: 'Vapi',     desc: 'AI assistant created with their pricing and brand' },
  { num: '06', label: 'Live AI',  desc: 'Welcome SMS sent. Tradie tests their new number.' },
]

type Card = { num: string; title: string; body: string; meta: string }

const FORM_CARDS: Card[] = [
  {
    num: '01',
    title: 'Account basics',
    body: 'Business name, owner first + last name, mobile, email, password. Six fields. All required.',
    meta: '→ tenants table',
  },
  {
    num: '02',
    title: 'Trade and licence',
    body: 'Pick electrical or plumbing, choose your state. ABN, licence number, and expiry are optional in test.',
    meta: '→ tenants + pricing_book',
  },
  {
    num: '03',
    title: 'Pricing essentials',
    body: 'Hourly rate, callout minimum, markup percent. Advanced fields hide behind a toggle with sensible defaults.',
    meta: '→ pricing_book',
  },
  {
    num: '04',
    title: 'Review and activate',
    body: 'Summary of every field. Services pre-ticked. Big orange button: Activate my QuoteMax.',
    meta: '→ /api/onboard/activate',
  },
]

const ACTIVATE_CARDS: Card[] = [
  {
    num: '01',
    title: 'Save to database',
    body: 'Tenant row, pricing book, and service offerings inserted in one atomic transaction.',
    meta: 'Supabase',
  },
  {
    num: '02',
    title: 'Buy phone number',
    body: 'New AU mobile long code purchased via Twilio API. SMS and voice webhooks pointed at QuoteMax.',
    meta: 'Twilio API',
  },
  {
    num: '03',
    title: 'Create AI assistant',
    body: "Vapi assistant spun up with the tradie's business name, trade prompt, and pricing book bound to it.",
    meta: 'Vapi API',
  },
  {
    num: '04',
    title: 'Bind number to tradie',
    body: 'Twilio number and Vapi assistant ID saved on the tenant row. Inbound webhooks know which tradie to route to.',
    meta: 'tenants.twilio_sms_number',
  },
  {
    num: '05',
    title: 'Send welcome SMS',
    body: 'Tradie gets a text from their new QuoteMax number on their personal mobile. Closes the loop visibly.',
    meta: 'Twilio outbound',
  },
  {
    num: '06',
    title: 'Show the new number',
    body: 'Welcome screen displays the number with a Send a test text button. Stripe Connect deferred to dashboard.',
    meta: '/onboard/success',
  },
]

export default function TradieOnboardingPlan() {
  return (
    <main className={`${manrope.variable} ${jbMono.variable} ${styles.page}`}>
      {/* ─── HERO ─── */}
      <header className={styles.hero}>
        <svg
          className={styles.topo}
          viewBox="0 0 1920 600"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <g fill="none" stroke="#14b8a6" strokeWidth="1">
            <path d="M0,420 Q240,300 480,360 T960,330 T1440,380 T1920,340" />
            <path d="M0,470 Q240,360 480,400 T960,380 T1440,430 T1920,400" opacity="0.7" />
            <path d="M0,520 Q240,420 480,450 T960,430 T1440,480 T1920,450" opacity="0.5" />
            <path d="M0,570 Q240,480 480,500 T960,480 T1440,530 T1920,500" opacity="0.3" />
          </g>
        </svg>
        <div className={styles.container}>
          <span className={styles.eyebrow}>QuoteMax · v6 Architecture Plan</span>
          <h1 className={styles.display}>
            Tradie <span className={styles.hi}>Onboarding</span>
            <br />
            Flow + System
          </h1>
          <p className={styles.lede}>
            How a tradie signs up, fills the form, and gets a live AI receptionist on
            their own QuoteMax number. End to end, fully automated, four pages on the
            front, six steps on the back.
          </p>
          <p className={styles.lede} style={{ marginTop: '0.75rem', fontSize: '0.92rem' }}>
            <Link href="/" className={styles.inlineLink}>
              ← Back to QuoteMax home
            </Link>
          </p>
        </div>
      </header>

      {/* ─── THE FLOW ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The Flow</span>
          <h2 className={styles.sectionTitle}>
            Website to <span className={styles.hi}>live AI</span> in under 4 minutes
          </h2>
          <p className={styles.sectionLead}>
            One forward path. No branching, no separate apps to install. Tradie hits one
            button at the end and the system provisions everything in parallel.
          </p>

          <div className={styles.diagram} aria-label="Onboarding flow diagram">
            {FLOW.map((s) => (
              <div key={s.num} className={styles.node}>
                <span className={styles.stepNum}>{s.num}</span>
                <span className={styles.stepLabel}>{s.label}</span>
                <span className={styles.stepDesc}>{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── THE FORM ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The Form</span>
          <h2 className={styles.sectionTitle}>
            Four pages, <span className={styles.hi}>three minutes</span>
          </h2>
          <p className={styles.sectionLead}>
            Fields that need outside verification (ABN, licence, insurance) are optional
            in test. The tradie can add them later from the dashboard.
          </p>

          <div className={styles.cards}>
            {FORM_CARDS.map((c) => (
              <article key={c.num} className={styles.card}>
                <span className={styles.num}>{c.num}</span>
                <div>
                  <h3 className={styles.cardTitle}>{c.title}</h3>
                  <p className={styles.cardBody}>{c.body}</p>
                  <span className={styles.meta}>{c.meta}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── BEHIND THE ACTIVATE BUTTON ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>
            Behind the Activate Button
          </span>
          <h2 className={styles.sectionTitle}>
            Six things happen in <span className={styles.hi}>parallel</span>
          </h2>
          <p className={styles.sectionLead}>
            Total elapsed time around 10 to 15 seconds. The tradie watches a live
            checklist tick over while the system provisions everything.
          </p>

          <div className={styles.cards}>
            {ACTIVATE_CARDS.map((c) => (
              <article key={c.num} className={styles.card}>
                <span className={styles.num}>{c.num}</span>
                <div>
                  <h3 className={styles.cardTitle}>{c.title}</h3>
                  <p className={styles.cardBody}>{c.body}</p>
                  <span className={styles.meta}>{c.meta}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── OUTCOME ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The Outcome</span>
          <h2 className={styles.sectionTitle}>
            Tradie sees one screen. <span className={styles.hi}>AI is live.</span>
          </h2>

          <div className={styles.outcome}>
            <div>
              <h3 className={styles.outcomeTitle}>You&rsquo;re live</h3>
              <p className={styles.outcomeCopy}>Your QuoteMax line:</p>
              <div className={styles.phone}>+61 482 123 456</div>
              <p className={styles.outcomeCopy} style={{ marginTop: '1rem' }}>
                Send any text to that number now to try your AI receptionist. We just
                sent you a welcome text from it too.
              </p>
            </div>
            <div>
              <h3 className={styles.outcomeTitle}>What&rsquo;s active</h3>
              <ul className={styles.checklist}>
                <li>AI receptionist taking SMS</li>
                <li>AI receptionist taking voice calls</li>
                <li>Your pricing book loaded</li>
                <li>Services configured for your trade</li>
                <li>Welcome SMS delivered</li>
              </ul>
              <p className={styles.outcomeCopy} style={{ marginTop: '0.85rem' }}>
                Set up Stripe Connect from the dashboard later to start accepting deposits.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA BAR ─── */}
      <div className={styles.ctaBar}>
        Build order · migration 015 → form routes → /api/onboard/activate → twilio + vapi provisioning
      </div>
    </main>
  )
}
