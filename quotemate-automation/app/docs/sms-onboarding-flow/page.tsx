// SMS Onboarding Flow doc — Maintain design system.
// Live at /docs/sms-onboarding-flow.
//
// Standalone HTML twin lives at /public/docs/sms-onboarding-flow.html
// for emailing.

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
  title: 'SMS Onboarding Flow · QuoteMax',
  description:
    'SMS-initiated tradie onboarding for QuoteMax. A tradie texts the shared number, AI replies with a link, signup completes on the web. Same end state as web signup.',
}

type CheckStep = {
  n: string
  title: string
  body: React.ReactNode
  tag: 'sms' | 'web'
}

const CHECKLIST: CheckStep[] = [
  {
    n: '01',
    title: 'Tradie texts shared number',
    body: (
      <>
        +61 481 613 464 (shared). Hybrid classifier runs on the body: regex catches
        obvious phrasing (&ldquo;register as a tradie&rdquo;, &ldquo;sign me up&rdquo;);
        ambiguous wording falls through to Haiku 4.5 for a semantic call.
      </>
    ),
    tag: 'sms',
  },
  {
    n: '02',
    title: 'AI replies with signup link',
    body: (
      <>
        Creates a <span className={styles.mono}>tradie_signup_intents</span> row with a 6-char
        token + 24h TTL. SMS welcome template includes the link. Mobile saved from the
        From header.
      </>
    ),
    tag: 'sms',
  },
  {
    n: '03',
    title: 'Tradie taps the link',
    body: (
      <>
        Lands on <span className={styles.mono}>/signup?intent=k4f2x9</span>. Page fetches the
        prefill via <span className={styles.mono}>/api/onboard/intent/[token]</span>. Shows a
        &ldquo;we&rsquo;ve got your mobile&rdquo; banner.
      </>
    ),
    tag: 'web',
  },
  {
    n: '04',
    title: 'Signup: business name + email + password',
    body: (
      <>
        Supabase Auth creates the user. Intent token is carried through Supabase&rsquo;s
        emailRedirectTo for the verification step.
      </>
    ),
    tag: 'web',
  },
  {
    n: '05',
    title: 'Email verification',
    body: (
      <>
        Supabase sends the verification link. /auth/callback reads the intent + mobile
        carry-over and forwards them to /onboard.
      </>
    ),
    tag: 'web',
  },
  {
    n: '06',
    title: 'Wizard: trade + pricing',
    body: (
      <>
        Owner_mobile is pre-filled + read-only (came from SMS, verified). Tradie picks
        trade/state + sets hourly rate, callout, markup. Reviews + activates.
      </>
    ),
    tag: 'web',
  },
  {
    n: '07',
    title: 'Activation chain runs',
    body: (
      <>
        Same 7-step chain as web-only signup: tenants insert → pricing_book →
        Twilio number buy → Vapi assistant create → Vapi phone-number register →
        tenants → active. Intent token marked used.
      </>
    ),
    tag: 'web',
  },
  {
    n: '08',
    title: 'Loop closed',
    body: (
      <>
        Welcome SMS dispatched from the tradie&rsquo;s new number to his personal mobile.
        Original SMS conversation marked status=&apos;converted&apos; + tenant_id linked.
      </>
    ),
    tag: 'sms',
  },
]

export default function SmsOnboardingFlowDoc() {
  return (
    <main className={`${manrope.variable} ${jbMono.variable} ${styles.page}`}>
      {/* ─── HERO ─── */}
      <header className={styles.hero}>
        <svg
          className={styles.topo}
          viewBox="0 0 1920 500"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <g fill="none" stroke="#14b8a6" strokeWidth="1">
            <path d="M0,340 Q240,240 480,280 T960,260 T1440,300 T1920,270" />
            <path d="M0,390 Q240,300 480,320 T960,310 T1440,350 T1920,330" opacity="0.7" />
            <path d="M0,440 Q240,360 480,380 T960,360 T1440,400 T1920,380" opacity="0.5" />
            <path d="M0,490 Q240,420 480,440 T960,420 T1440,450 T1920,430" opacity="0.3" />
          </g>
        </svg>
        <div className={styles.container}>
          <span className={styles.eyebrow}>QuoteMax · v6 · SMS Onboarding</span>
          <h1 className={styles.display}>
            Tradie texts.
            <br />
            AI sends the <span className={styles.hi}>link.</span>
          </h1>
          <p className={styles.lede}>
            Same end state as web signup — own tenant, own AU phone number, own AI
            receptionist — but kicked off with a single SMS to the shared QuoteMax number.
            Two SMS turns, then the tradie finishes on the web wizard. Mobile is verified
            automatically.
          </p>
          <p className={styles.lede} style={{ marginTop: '0.85rem', fontSize: '0.92rem' }}>
            See also:{' '}
            <Link href="/docs/sms-onboarding-architecture" className={styles.inlineLink}>
              full SMS architecture
            </Link>
            {' · '}
            <Link href="/docs/tradie-onboarding-architecture" className={styles.inlineLink}>
              web architecture
            </Link>
            {' · '}
            <Link href="/docs/tradie-onboarding-plan" className={styles.inlineLink}>
              high-level plan
            </Link>
            {' · '}
            <Link href="/" className={styles.inlineLink}>
              home
            </Link>
            .
          </p>
        </div>
      </header>

      {/* ─── SMS THREAD ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The SMS thread</span>
          <h2 className={styles.sectionTitle}>
            Two turns, <span className={styles.hi}>one link</span>.
          </h2>
          <p className={styles.sectionLead}>
            Tradie texts the shared QuoteMax number (the same one customers use for
            quotes — the intent classifier decides which path to take on turn 1).
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

      {/* ─── FULL CHECKLIST ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>Full pipeline</span>
          <h2 className={styles.sectionTitle}>
            Eight steps. <span className={styles.hi}>SMS to live AI.</span>
          </h2>
          <p className={styles.sectionLead}>
            The first two steps run on SMS in seconds. Steps 3–7 happen on the web after
            the tradie taps the link. Step 8 closes the loop by texting the tradie&rsquo;s
            new QuoteMax number to itself.
          </p>

          <div className={styles.checklist}>
            {CHECKLIST.map((c) => (
              <div key={c.n} className={styles.checkCard}>
                <span className={styles.stepN}>{c.n}</span>
                <div>
                  <h3 className={styles.checkTitle}>{c.title}</h3>
                  <p className={styles.checkBody}>{c.body}</p>
                </div>
                <span
                  className={`${styles.tag} ${
                    c.tag === 'sms' ? styles.tagSms : styles.tagWeb
                  }`}
                >
                  {c.tag === 'sms' ? 'SMS' : 'Web'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── DATABASE ADDITIONS ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>
            Database additions (migration 016)
          </span>
          <h2 className={styles.sectionTitle}>
            One table, <span className={styles.hi}>one column</span>.
          </h2>
          <p className={styles.sectionLead}>
            The web-only foundation (migration 015) already had tenants, pricing_book and
            the operational tenant_id columns. Migration 016 adds just what SMS onboarding
            needs.
          </p>

          <div className={styles.schemaGrid}>
            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>tradie_signup_intents</h3>
              <p className={styles.schemaNote}>
                Short-lived token row linking a tradie&rsquo;s SMS thread to a pending web
                onboarding. Unique constraint on (owner_mobile) where used_at IS NULL prevents
                spam-creation.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>create table</span> tradie_signup_intents (
                  {'\n'}
                  {'  '}id{'                   '}
                  <span className={styles.ty}>uuid</span> primary key,{'\n'}
                  {'  '}token{'                '}
                  <span className={styles.ty}>text</span> unique,{'    '}
                  <span className={styles.cm}>{'-- 6-char URL slug'}</span>
                  {'\n'}
                  {'  '}owner_mobile{'         '}
                  <span className={styles.ty}>text</span> not null,{'  '}
                  <span className={styles.cm}>{'-- E.164 from SMS From'}</span>
                  {'\n'}
                  {'  '}sms_conversation_id{'  '}
                  <span className={styles.ty}>uuid</span> {'-> sms_conversations'}
                  {'\n'}
                  {'  '}expires_at{'           '}
                  <span className={styles.ty}>timestamptz</span>
                  {'     '}
                  <span className={styles.cm}>{'-- 24h TTL'}</span>
                  {'\n'}
                  {'  '}used_at{'              '}
                  <span className={styles.ty}>timestamptz</span>,{'    '}
                  <span className={styles.cm}>{'-- null until activate'}</span>
                  {'\n'}
                  {'  '}resulting_tenant_id{'  '}
                  <span className={styles.ty}>uuid</span> {'-> tenants(id),'}
                  {'\n'}
                  {'  '}created_at{'           '}
                  <span className={styles.ty}>timestamptz</span>
                  {'\n'}
                  );
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>sms_conversations.conversation_type</h3>
              <p className={styles.schemaNote}>
                Flag set on turn 1 by the intent classifier. The inbound route branches on
                this column to decide between the customer-quote pipeline and the
                tradie-registration pipeline.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>alter table</span> sms_conversations{'\n'}
                  {'  '}
                  <span className={styles.kw}>add</span> conversation_type{' '}
                  <span className={styles.ty}>text</span>
                  {'\n'}
                  {'    '}default <span className={styles.kw}>{"'customer_quote'"}</span>
                  {'\n'}
                  {'    '}check (value in ({'\n'}
                  {'      '}
                  <span className={styles.kw}>{"'customer_quote'"}</span>,{'\n'}
                  {'      '}
                  <span className={styles.kw}>{"'tradie_registration'"}</span>,{'\n'}
                  {'      '}
                  <span className={styles.kw}>{"'converted'"}</span>
                  {'\n'}
                  {'    '}));
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ─── INTENT CLASSIFIER ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>Intent classifier</span>
          <h2 className={styles.sectionTitle}>
            Regex first, <span className={styles.hi}>Haiku for the middle</span>.
          </h2>
          <p className={styles.sectionLead}>
            Runs on turn 1 of every conversation whose destination doesn&rsquo;t resolve
            to a registered tenant. Hybrid two-layer design: regex catches ~80% of
            inbounds with clear phrasing (sub-millisecond, free, deterministic).
            Anything regex can&rsquo;t resolve falls through to Haiku 4.5 — a cheap
            structured-output call (~$0.0001, ~300ms) with a Zod schema that returns
            intent + confidence + reasoning. LOW-confidence Haiku verdicts are
            downgraded to ambiguous so the customer dialog handles them.
          </p>

          <div className={styles.schemaGrid}>
            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>Layer 1 — Regex (hot path)</h3>
              <p className={styles.schemaNote}>
                Strong-phrase match on tradie or customer wording. Both matching →
                customer (safer). No match → fall through to Haiku.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.cm}>// tradie strong phrases</span>{'\n'}
                  /\b(register|sign\s*up|join)\b{'\n'}
                  {'  '}.*\b(tradie|sparky|plumber)\b/i{'\n'}
                  /\bbecome\s+(a\s+)?quotemate\b/i{'\n'}
                  /\blist\s+my\s+business\b/i{'\n'}
                  {'\n'}
                  <span className={styles.cm}>// customer strong phrases</span>{'\n'}
                  /\b(blocked|leaking|broken)\b/i{'\n'}
                  /\b(my|our)\s+(tap|drain|gpo)\b/i{'\n'}
                  /\bhow\s+much\s+(to|for)\b/i
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>Layer 2 — Haiku 4.5 (fallback)</h3>
              <p className={styles.schemaNote}>
                generateObject() with a Zod schema. System prompt has disambiguation
                rules (e.g. &ldquo;my sparky didn&rsquo;t turn up&rdquo; → customer,
                not tradie). Failures degrade to ambiguous.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>const</span> Schema = z.object({'{'}{'\n'}
                  {'  '}intent: z.<span className={styles.fn}>enum</span>([{'\n'}
                  {'    '}<span className={styles.str}>&apos;tradie_registration&apos;</span>,{'\n'}
                  {'    '}<span className={styles.str}>&apos;customer_quote&apos;</span>{'\n'}
                  {'  '}]),{'\n'}
                  {'  '}confidence: z.<span className={styles.fn}>enum</span>([{'\n'}
                  {'    '}<span className={styles.str}>&apos;HIGH&apos;</span>, <span className={styles.str}>&apos;MEDIUM&apos;</span>, <span className={styles.str}>&apos;LOW&apos;</span>{'\n'}
                  {'  '}]),{'\n'}
                  {'  '}reasoning: z.<span className={styles.fn}>string</span>().<span className={styles.fn}>max</span>(120),{'\n'}
                  {'}'})
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA BAR ─── */}
      <div className={styles.ctaBar}>
        Migration 016 applied · Hybrid regex + Haiku 4.5 classifier · SMS branch shipped · Shares activate chain
      </div>
    </main>
  )
}
