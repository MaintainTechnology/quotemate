// Tradie Onboarding Plan (SMS variant) — Maintain design system.
// Live at /docs/tradie-onboarding-plan-sms.
//
// Mirror of /docs/tradie-onboarding-plan but for the SMS-initiated
// signup flow. Standalone HTML twin at
// /public/docs/tradie-onboarding-plan-sms.html (kept in place for
// emailing — not removed).

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
  title: 'Tradie Onboarding via SMS · QuoteMax',
  description:
    'SMS-initiated tradie onboarding for QuoteMax. Tradie texts, AI sends a link, signup completes on the web. Same end state as web signup, kicked off from any phone.',
}

type FlowStep = { num: string; label: string; desc: string }

const FLOW: FlowStep[] = [
  { num: '01', label: 'Text',       desc: "Tradie texts the shared QuoteMax number with 'register' intent" },
  { num: '02', label: 'AI replies', desc: 'Welcome message with a personalised signup link (token + 24h TTL)' },
  { num: '03', label: 'Tap link',   desc: "Lands on /signup with the tradie's mobile pre-filled and verified" },
  { num: '04', label: 'Signup',     desc: 'Business name, email, password. Supabase Auth verifies email.' },
  { num: '05', label: 'Wizard',     desc: 'Trade + state + pricing. Mobile is read-only (from SMS).' },
  { num: '06', label: 'Live AI',    desc: 'Own Twilio number + Vapi assistant. Welcome SMS arrives.' },
]

type Card = { num: string; title: string; body: string; meta: string }

const PIPELINE: Card[] = [
  {
    num: '01',
    title: 'Intent capture (SMS)',
    body: "Hybrid classifier: regex catches clear phrases (\"register as a tradie\", \"sign me up\"); ambiguous wording falls through to Haiku 4.5. Creates a signup intent token tied to the tradie's mobile.",
    meta: '→ tradie_signup_intents',
  },
  {
    num: '02',
    title: 'Link reply (SMS)',
    body: 'Auto-reply with a personalised /signup link. Token has 24h TTL. Mobile is stamped from the From header.',
    meta: '→ buildTradieWelcomeSms',
  },
  {
    num: '03',
    title: 'Signup + verify (Web)',
    body: 'Tradie taps the link. /signup pre-fills the mobile, asks for business name + email + password. Email verification handled by Supabase.',
    meta: '→ /signup?intent=...',
  },
  {
    num: '04',
    title: 'Wizard + activate (Web)',
    body: 'Trade + pricing + review. Mobile is read-only ("verified via SMS"). Big orange "Activate" button kicks off the same 7-step chain as web signup.',
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
    title: 'Buy AU phone number',
    body: 'Voice + SMS + MMS required. SmsUrl + VoiceUrl pre-configured. No manual Twilio console clicks.',
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
    title: 'Register number with Vapi',
    body: "Twilio number registered in Vapi's phone-number table, bound to the new assistant. Voice calls now route to the right place.",
    meta: 'Vapi API',
  },
  {
    num: '05',
    title: 'Mark SMS intent used',
    body: 'Original tradie_signup_intents row flipped to used. Originating SMS conversation back-linked to the new tenant. (SMS-only step.)',
    meta: 'tradie_signup_intents',
  },
  {
    num: '06',
    title: 'Welcome SMS',
    body: "Sent from the tradie's new number to their personal mobile. Closes the loop visibly.",
    meta: 'Twilio outbound',
  },
]

export default function TradieOnboardingPlanSms() {
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
          <span className={styles.eyebrow}>QuoteMax · v6 · SMS Onboarding Plan</span>
          <h1 className={styles.display}>
            Tradie <span className={styles.hi}>texts.</span>
            <br />
            AI sends the link.
          </h1>
          <p className={styles.lede}>
            Same end state as web signup — own tenant, own AU phone number, own AI
            receptionist. Kicked off with a single SMS to the shared QuoteMax number.
            Two SMS turns, then the tradie finishes on the web wizard.
          </p>
          <p className={styles.lede} style={{ marginTop: '0.75rem', fontSize: '0.92rem' }}>
            See also:{' '}
            <Link href="/docs/tradie-onboarding-plan" className={styles.inlineLink}>
              web plan
            </Link>
            {' · '}
            <Link href="/docs/sms-onboarding-flow" className={styles.inlineLink}>
              SMS flow scenario
            </Link>
            {' · '}
            <Link href="/docs/sms-onboarding-architecture" className={styles.inlineLink}>
              full SMS architecture
            </Link>
            {' · '}
            <Link href="/" className={styles.inlineLink}>
              home
            </Link>
            .
          </p>
        </div>
      </header>

      {/* ─── THE FLOW ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The Flow</span>
          <h2 className={styles.sectionTitle}>
            From SMS to <span className={styles.hi}>live AI</span> in under 5 minutes
          </h2>
          <p className={styles.sectionLead}>
            SMS captures the intent + mobile. The web finishes the rest. Same activation
            chain as web-only signup — tradies arrive at the same dashboard either way.
          </p>

          <div className={styles.diagram} aria-label="SMS onboarding flow diagram">
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

      {/* ─── THE SMS THREAD ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The SMS thread</span>
          <h2 className={styles.sectionTitle}>
            Two turns, <span className={styles.hi}>one tap</span>.
          </h2>
          <p className={styles.sectionLead}>
            The tradie texts the same number customers use for quotes. An intent classifier
            decides on turn 1 whether this is a tradie wanting to register or a customer
            wanting a quote.
          </p>

          <div className={styles.thread}>
            <div className={`${styles.bubble} ${styles.bubbleIn}`}>
              <span className={styles.bubbleWho}>Jon · 04xx xxx xxx</span>
              I want to register as a tradie
            </div>
            <div className={`${styles.bubble} ${styles.bubbleOut}`}>
              <span className={styles.bubbleWho}>QuoteMax AI</span>
              G&rsquo;day! Welcome to QuoteMax. Tap the link to set up your AI
              receptionist. Takes about 4 minutes.
              <br />
              <br />
              <span className={styles.bubbleLink}>
                https://quote-mate-rho.vercel.app/signup?intent=k4f2x9
              </span>
              <br />
              <br />
              Your mobile is already saved.
              <br />
              <br />- QuoteMax
            </div>
          </div>
        </div>
      </section>

      {/* ─── THE PIPELINE (4 cards) ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The Pipeline</span>
          <h2 className={styles.sectionTitle}>
            Four moments. <span className={styles.hi}>SMS to active.</span>
          </h2>
          <p className={styles.sectionLead}>
            Each card is a real page or process. SMS handles the kickoff; the web handles
            the input-heavy parts (passwords, pricing) where SMS is awkward.
          </p>

          <div className={styles.cards}>
            {PIPELINE.map((c) => (
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
            Same chain as <span className={styles.hi}>web signup</span>.
          </h2>
          <p className={styles.sectionLead}>
            SMS-initiated onboarding lands in exactly the same activation endpoint as
            web-initiated. Same tenant, same Twilio number purchase, same Vapi assistant.
            Plus one extra step that links the original SMS thread to the new tenant.
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
            Same one screen. <span className={styles.hi}>AI is live.</span>
          </h2>

          <div className={styles.outcome}>
            <div>
              <h3 className={styles.outcomeTitle}>You&rsquo;re live</h3>
              <p className={styles.outcomeCopy}>Your QuoteMax line:</p>
              <div className={styles.phone}>+61 482 123 456</div>
              <p className={styles.outcomeCopy} style={{ marginTop: '1rem' }}>
                Send any text to that number now. Customers calling will reach your AI
                receptionist.
              </p>
            </div>
            <div>
              <h3 className={styles.outcomeTitle}>What&rsquo;s active</h3>
              <ul className={styles.checklist}>
                <li>AI receptionist taking SMS</li>
                <li>AI receptionist taking voice calls</li>
                <li>Your pricing book loaded</li>
                <li>SMS thread back-linked to your tenant</li>
                <li>Welcome SMS delivered</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA BAR ─── */}
      <div className={styles.ctaBar}>
        Same back end as web signup · Two SMS turns · Five minutes from text to live AI
      </div>
    </main>
  )
}
