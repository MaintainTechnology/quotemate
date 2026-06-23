// SMS-initiated Onboarding Architecture — Maintain design system.
// Live at /docs/sms-onboarding-architecture.
//
// Sibling of /docs/tradie-onboarding-architecture but for the SMS-
// initiated branch. Adds two extra moving parts vs. the web flow:
//   • Hybrid (regex + Haiku 4.5) intent classifier on turn 1
//   • tradie_signup_intents token table that links the SMS thread to
//     the eventual /signup → activate session
// Standalone HTML twin at /public/docs/sms-onboarding-architecture.html.

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
  title: 'SMS Onboarding Architecture · QuoteMax',
  description:
    'End-to-end architecture of QuoteMax\'s SMS-initiated tradie onboarding flow: hybrid intent classifier, signup intent tokens, magic-link handoff to web, activation chain, AI live. Includes full Supabase schema.',
}

/* ─── Content ─────────────────────────────────────────────── */

type FlowStep = { num: string; label: string; desc: React.ReactNode }

const FLOW: FlowStep[] = [
  {
    num: '01',
    label: 'SMS in',
    desc: (
      <>
        Tradie texts <span className={styles.mono}>+61 481 613 464</span> (shared QuoteMax number).
      </>
    ),
  },
  {
    num: '02',
    label: 'Classify',
    desc: (
      <>
        Hybrid classifier: regex first, Haiku 4.5 fallback for ambiguous wording.
      </>
    ),
  },
  {
    num: '03',
    label: 'Token + reply',
    desc: (
      <>
        Insert <span className={styles.mono}>tradie_signup_intents</span> row, SMS back a
        <span className={styles.mono}> /signup?intent=</span> link.
      </>
    ),
  },
  {
    num: '04',
    label: 'Tap link',
    desc: (
      <>
        Lands on <span className={styles.mono}>/signup</span>. Mobile prefilled + read-only.
      </>
    ),
  },
  {
    num: '05',
    label: 'Signup',
    desc: (
      <>
        Business name + first name + email + password. Intent token carried through.
      </>
    ),
  },
  {
    num: '06',
    label: 'Verify',
    desc: (
      <>
        Supabase emailRedirectTo → <span className={styles.mono}>/auth/callback</span>{' '}
        forwards intent + mobile to <span className={styles.mono}>/onboard</span>.
      </>
    ),
  },
  {
    num: '07',
    label: 'Wizard',
    desc: (
      <>
        Trade + state + pricing essentials + review. Mobile field is locked
        (&ldquo;verified via SMS&rdquo;).
      </>
    ),
  },
  {
    num: '08',
    label: 'Activate',
    desc: (
      <>
        POST <span className={styles.mono}>/api/onboard/activate</span> runs the 8-step
        chain (one extra step vs. web: <span className={styles.mono}>markIntentUsed</span>).
      </>
    ),
  },
]

type CheckStep = {
  n: string
  title: string
  body: React.ReactNode
  tag: string
  tone: 'ok' | 'gated'
}

const CHECKLIST: CheckStep[] = [
  {
    n: '01',
    title: 'Validate the payload',
    body: (
      <>
        Same Zod schema as web. Adds an optional{' '}
        <span className={styles.mono}>intent_token</span> field carried from the SMS thread.
      </>
    ),
    tag: 'Always real',
    tone: 'ok',
  },
  {
    n: '02',
    title: 'Insert tenants row',
    body: (
      <>
        Same identity columns. <span className={styles.mono}>owner_mobile</span> is taken from
        the SMS From header — already verified by physical possession of the device.
      </>
    ),
    tag: 'Supabase',
    tone: 'ok',
  },
  {
    n: '03',
    title: 'Insert pricing_book + tenant_service_offerings',
    body: (
      <>
        Identical to web. Easy-5 auto-enabled per trade. Pricing book version bumped on every
        subsequent edit.
      </>
    ),
    tag: 'Supabase',
    tone: 'ok',
  },
  {
    n: '04',
    title: 'Provision AU Twilio number',
    body: (
      <>
        AU only · Voice + SMS + MMS required. Pre-configures{' '}
        <span className={styles.mono}>SmsUrl</span> +{' '}
        <span className={styles.mono}>VoiceUrl</span> at purchase time.
      </>
    ),
    tag: 'TWILIO_PROVISIONING_ENABLED',
    tone: 'gated',
  },
  {
    n: '05',
    title: 'Create Vapi assistant',
    body: (
      <>
        Per-tenant assistant with trade-aware system prompt + chosen voice persona +{' '}
        <span className={styles.mono}>serverUrl</span> for post-call hooks.
      </>
    ),
    tag: 'VAPI_PROVISIONING_ENABLED',
    tone: 'gated',
  },
  {
    n: '5b',
    title: 'Register Twilio number with Vapi',
    body: (
      <>
        POST <span className={styles.mono}>api.vapi.ai/phone-number</span>. Binds the
        purchased number to the new assistant so calls route correctly.
      </>
    ),
    tag: 'VAPI_PROVISIONING_ENABLED',
    tone: 'gated',
  },
  {
    n: '06',
    title: 'Mark SMS intent used + back-link',
    body: (
      <>
        <strong>SMS-only step.</strong>{' '}
        <span className={styles.mono}>markIntentUsed(token, tenantId)</span> flips the intent
        row to consumed, then updates the originating{' '}
        <span className={styles.mono}>sms_conversations</span> row:{' '}
        <span className={styles.mono}>tenant_id</span> = new tenant,{' '}
        <span className={styles.mono}>conversation_type</span> = &lsquo;converted&rsquo;.
        Idempotent — concurrent activate retries are safe.
      </>
    ),
    tag: 'Supabase',
    tone: 'ok',
  },
  {
    n: '07',
    title: 'Update tenants row → active',
    body: (
      <>
        Same as web: stamps <span className={styles.mono}>twilio_sms_number</span>,{' '}
        <span className={styles.mono}>twilio_voice_number</span>,{' '}
        <span className={styles.mono}>vapi_assistant_id</span>, status =
        <span className={styles.mono}> &lsquo;active&rsquo;</span>,{' '}
        <span className={styles.mono}>activated_at</span> = now().
      </>
    ),
    tag: 'Supabase',
    tone: 'ok',
  },
  {
    n: '08',
    title: 'Send welcome SMS',
    body: (
      <>
        From the new tenant&rsquo;s QuoteMax number to their personal mobile. Closes
        the loop — they get a text from THEIR number seconds after activation.
      </>
    ),
    tag: 'TWILIO_PROVISIONING_ENABLED',
    tone: 'gated',
  },
]

type Service = {
  name: string
  role: string
  env: string[]
}

const SERVICES: Service[] = [
  {
    name: 'Supabase',
    role:
      'Auth + Postgres. Same role as the web flow plus the tradie_signup_intents table and sms_conversations.conversation_type column. markIntentUsed is the only SMS-specific server-side mutation.',
    env: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_DB_URL',
    ],
  },
  {
    name: 'Twilio',
    role:
      'Receives the inbound SMS on the shared QuoteMax number, posts to /api/sms/inbound. Later, buys the tenant\'s own AU number. Sends the welcome SMS link from the shared number AND the post-activation welcome from the new tenant number.',
    env: [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_SHARED_FROM_NUMBER',
      'APP_URL (webhooks)',
      'TWILIO_PROVISIONING_ENABLED',
    ],
  },
  {
    name: 'Anthropic (Haiku 4.5)',
    role:
      'Fallback intent classifier. Only called when regex returns ambiguous AND the message has ≥4 words. Returns structured { intent, confidence, reasoning } via generateObject() with a Zod schema. ~$0.0001/call, ~300ms.',
    env: [
      'ANTHROPIC_API_KEY',
      'AI_GATEWAY_API_KEY (optional)',
    ],
  },
  {
    name: 'Vapi',
    role:
      'Per-tenant assistant created in step 5. Identical to the web flow — SMS branch never touches Vapi until activation.',
    env: [
      'VAPI_API_KEY',
      'VAPI_VOICE_JON (optional)',
      'VAPI_VOICE_SARAH (optional)',
      'VAPI_PROVISIONING_ENABLED',
    ],
  },
]

/* ─── Page ────────────────────────────────────────────────── */

export default function SmsOnboardingArchitecture() {
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
          <span className={styles.eyebrow}>QuoteMax · v6 · SMS Onboarding Architecture</span>
          <h1 className={styles.display}>
            One SMS in →
            <br />
            AI <span className={styles.hi}>live</span> in 5 minutes.
          </h1>
          <p className={styles.lede}>
            Full view of the SMS-initiated onboarding branch: how a tradie&rsquo;s
            single inbound text becomes their own dedicated AU number, AI receptionist,
            and pricing book — all without leaving the SMS thread until the magic-link tap.
            Classifier, token table, activation chain, schema, env flags — one screen.
          </p>
          <p className={styles.lede} style={{ marginTop: '0.85rem', fontSize: '0.92rem' }}>
            See also:{' '}
            <Link href="/docs/tradie-onboarding-architecture" className={styles.inlineLink}>
              web onboarding architecture
            </Link>
            {' · '}
            <Link href="/docs/sms-onboarding-flow" className={styles.inlineLink}>
              SMS flow scenario
            </Link>
            {' · '}
            <Link href="/docs/tradie-onboarding-plan-sms" className={styles.inlineLink}>
              SMS plan summary
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
            Eight steps, <span className={styles.hi}>one classifier</span> and one tap.
          </h2>
          <p className={styles.sectionLead}>
            Steps 01–03 happen entirely inside the SMS thread. Step 04 is the handoff to
            web. Steps 05–08 mirror the standard web onboarding chain, with one extra
            SMS-specific step on activate to close the loop on the originating thread.
          </p>

          <div className={styles.flow} aria-label="SMS onboarding flow">
            {FLOW.map((s) => (
              <div key={s.num} className={styles.node}>
                <span className={styles.nodeNum}>{s.num}</span>
                <span className={styles.nodeLabel}>{s.label}</span>
                <span className={styles.nodeDesc}>{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── INTENT CLASSIFIER (HYBRID) ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>The Intent Classifier</span>
          <h2 className={styles.sectionTitle}>
            Regex first, <span className={styles.hi}>Haiku for the middle</span>.
          </h2>
          <p className={styles.sectionLead}>
            Lives in <span className={styles.mono}>lib/sms/intent.ts</span>. Runs on turn 1
            of every conversation whose destination doesn&rsquo;t resolve to a registered
            tenant. Three outcomes: <span className={styles.mono}>tradie_registration</span>,{' '}
            <span className={styles.mono}>customer_quote</span>, or{' '}
            <span className={styles.mono}>ambiguous</span> (defaults to customer flow).
          </p>

          <div className={styles.schemaGrid}>
            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>Layer 1 — Regex (hot path)</h3>
              <p className={styles.schemaNote}>
                Strong-phrase match. ~80% of inbounds resolve here (sub-millisecond, free,
                deterministic). Both tradie + customer regex matching → customer (safer
                default; canned dialog disambiguates next turn).
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
                Triggers when regex returns ambiguous AND the message has ≥4 words.
                generateObject() with a Zod schema. System prompt has disambiguation rules
                (e.g. &ldquo;my sparky didn&rsquo;t turn up&rdquo; → customer, not tradie).
                ~$0.0001, ~300ms. Failures degrade to ambiguous.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>const</span> Schema = z.object({'{'}{'\n'}
                  {'  '}intent: z.<span className={styles.ty}>enum</span>([{'\n'}
                  {'    '}<span className={styles.str}>&apos;tradie_registration&apos;</span>,{'\n'}
                  {'    '}<span className={styles.str}>&apos;customer_quote&apos;</span>{'\n'}
                  {'  '}]),{'\n'}
                  {'  '}confidence: z.<span className={styles.ty}>enum</span>([{'\n'}
                  {'    '}<span className={styles.str}>&apos;HIGH&apos;</span>, <span className={styles.str}>&apos;MEDIUM&apos;</span>, <span className={styles.str}>&apos;LOW&apos;</span>{'\n'}
                  {'  '}]),{'\n'}
                  {'  '}reasoning: z.<span className={styles.ty}>string</span>().max(120),{'\n'}
                  {'}'})
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ─── ACTIVATION CHECKLIST ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>
            The Activation Checklist
          </span>
          <h2 className={styles.sectionTitle}>
            Nine steps run when <span className={styles.hi}>&ldquo;Activate&rdquo;</span> is clicked.
          </h2>
          <p className={styles.sectionLead}>
            One more than the web flow: step 06 (markIntentUsed) is SMS-only and ties the
            originating thread to the new tenant. Steps 04–06 + 5b + 08 hit external APIs
            and are env-gated; the rest are pure Supabase writes.
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
                    c.tone === 'ok' ? styles.tagOk : styles.tagGated
                  }`}
                >
                  {c.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── DATABASE SCHEMA ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>Database Schema</span>
          <h2 className={styles.sectionTitle}>
            <span className={styles.hi}>Two migrations</span>, six tables touched.
          </h2>
          <p className={styles.sectionLead}>
            Migration <span className={styles.mono}>015_tenants_onboarding.sql</span> is shared
            with the web flow. Migration{' '}
            <span className={styles.mono}>016_sms_onboarding.sql</span> adds the two
            SMS-specific pieces: the token table and the conversation_type flag.
          </p>

          <div className={styles.schemaGrid}>
            <SchemaCard
              title="tradie_signup_intents (016)"
              note={
                <>
                  SMS-only. One row per tradie who texted to sign up. Token is a 6-char
                  base64url slug, 24h TTL, single-use. Unique partial index on{' '}
                  <span className={styles.mono}>(owner_mobile) where used_at is null</span>{' '}
                  prevents spam-creation if a tradie texts repeatedly.
                </>
              }
              code={tradieSignupIntentsSql()}
            />

            <SchemaCard
              title="sms_conversations (016 patch)"
              note={
                <>
                  Existing table. Migration 016 added the{' '}
                  <span className={styles.mono}>conversation_type</span> column with a
                  3-value check constraint. The inbound route flips it on turn 1;{' '}
                  <span className={styles.mono}>markIntentUsed</span> flips it to{' '}
                  &lsquo;converted&rsquo; on activation.
                </>
              }
              code={smsConversationsPatchSql()}
            />

            <SchemaCard
              title="tenants (015)"
              note="Shared with web flow. Same identity, pricing, branding, and provisioned Twilio + Vapi identifiers. Owner_mobile is stamped from the SMS From header (verified by physical possession)."
              code={tenantsSql()}
            />

            <SchemaCard
              title="pricing_book (015 patch)"
              note={
                <>
                  Existing table. Migration 015 added{' '}
                  <span className={styles.mono}>tenant_id</span>,{' '}
                  <span className={styles.mono}>senior_rate</span>,{' '}
                  <span className={styles.mono}>after_hours_multiplier</span>. One row per
                  (tenant, trade).
                </>
              }
              code={pricingBookSql()}
            />

            <SchemaCard
              title="tenant_service_offerings (015)"
              note="Which catalogue items the tradie offers. Auto-populated with the easy-5 for their trade on activate."
              code={tenantServiceOfferingsSql()}
            />

            <SchemaCard
              title="tenant_id added to operational tables (015)"
              note="Every downstream table got the tenant_id column for per-tradie scoping. SMS conversations get back-linked on markIntentUsed via this column."
              code={tenantIdAddSql()}
            />
          </div>
        </div>
      </section>

      {/* ─── INTENT TOKEN LIFECYCLE ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>Intent token lifecycle</span>
          <h2 className={styles.sectionTitle}>
            Token <span className={styles.hi}>follows the tradie</span> from SMS to active.
          </h2>
          <p className={styles.sectionLead}>
            Token is the single thread that connects the SMS thread, the signup page, email
            verification, the wizard, and the activate endpoint. Each helper lives in{' '}
            <span className={styles.mono}>lib/onboard/intent-tokens.ts</span>.
          </p>

          <div className={styles.schemaGrid}>
            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>createOrGetActiveIntent</h3>
              <p className={styles.schemaNote}>
                Called from <span className={styles.mono}>/api/sms/inbound</span> after the
                classifier returns tradie_registration. Reuses an existing active row, refreshes
                expired-but-unused rows with a new token, or inserts fresh. Race-safe via
                unique constraint + retry.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>async function</span>{' '}
                  <span className={styles.ty}>createOrGetActiveIntent</span>(args) {'{'}{'\n'}
                  {'  '}<span className={styles.cm}>// 1. unused row for this mobile?</span>{'\n'}
                  {'  '}<span className={styles.kw}>const</span> existing ={'\n'}
                  {'    '}.from(<span className={styles.str}>&apos;tradie_signup_intents&apos;</span>){'\n'}
                  {'    '}.eq(<span className={styles.str}>&apos;owner_mobile&apos;</span>, m){'\n'}
                  {'    '}.is(<span className={styles.str}>&apos;used_at&apos;</span>, <span className={styles.kw}>null</span>);{'\n'}
                  {'\n'}
                  {'  '}<span className={styles.kw}>if</span> (active)  return reuse{'\n'}
                  {'  '}<span className={styles.kw}>if</span> (expired) return refresh{'\n'}
                  {'  '}<span className={styles.kw}>else</span>         return insert{'\n'}
                  {'}'}
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>resolveActiveIntent</h3>
              <p className={styles.schemaNote}>
                Called from <span className={styles.mono}>/api/onboard/intent/[token]</span> when
                the signup page loads. Returns the prefill payload (mobile +
                sms_conversation_id) or null if the token is missing, expired, or already used.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>async function</span>{' '}
                  <span className={styles.ty}>resolveActiveIntent</span>(token) {'{'}{'\n'}
                  {'  '}<span className={styles.kw}>return</span> supabase{'\n'}
                  {'    '}.from(<span className={styles.str}>&apos;tradie_signup_intents&apos;</span>){'\n'}
                  {'    '}.eq(<span className={styles.str}>&apos;token&apos;</span>, token){'\n'}
                  {'    '}.is(<span className={styles.str}>&apos;used_at&apos;</span>, <span className={styles.kw}>null</span>){'\n'}
                  {'    '}.gt(<span className={styles.str}>&apos;expires_at&apos;</span>, now()){'\n'}
                  {'    '}.maybeSingle();{'\n'}
                  {'}'}
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>markIntentUsed</h3>
              <p className={styles.schemaNote}>
                Called by <span className={styles.mono}>/api/onboard/activate</span> after the
                tenant row exists. Flips the intent to consumed, stamps the new tenant_id, AND
                back-links the originating <span className={styles.mono}>sms_conversations</span>{' '}
                row (tenant_id + conversation_type=&lsquo;converted&rsquo;). Idempotent.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>async function</span>{' '}
                  <span className={styles.ty}>markIntentUsed</span>(token, tenantId) {'{'}{'\n'}
                  {'  '}<span className={styles.kw}>const</span> row = update intent {'{'}{'\n'}
                  {'    '}used_at: now(),{'\n'}
                  {'    '}resulting_tenant_id: tenantId{'\n'}
                  {'  '}{'}'}{'\n'}
                  {'\n'}
                  {'  '}<span className={styles.kw}>if</span> (row.sms_conversation_id) {'{'}{'\n'}
                  {'    '}update sms_conversations {'{'}{'\n'}
                  {'      '}tenant_id: tenantId,{'\n'}
                  {'      '}conversation_type: <span className={styles.str}>&apos;converted&apos;</span>{'\n'}
                  {'    '}{'}'}{'\n'}
                  {'  '}{'}'}{'\n'}
                  {'}'}
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>Token carry-through path</h3>
              <p className={styles.schemaNote}>
                The token traverses six surfaces. Each handoff must preserve it
                unmodified — Supabase&rsquo;s emailRedirectTo is the trickiest piece
                (encoded into the magic link query string).
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  SMS reply: <span className={styles.ty}>/signup?intent=k4f2x9</span>{'\n'}
                  {'  '}↓ tap{'\n'}
                  /signup (prefill via{'\n'}
                  {'  '}/api/onboard/intent/[token]){'\n'}
                  {'  '}↓ submit{'\n'}
                  Supabase signup w/{'\n'}
                  {'  '}emailRedirectTo containing intent{'\n'}
                  {'  '}↓ verify link{'\n'}
                  /auth/callback reads intent{'\n'}
                  {'  '}↓ forward{'\n'}
                  /onboard?intent=k4f2x9{'\n'}
                  {'  '}↓ activate{'\n'}
                  POST /api/onboard/activate{'\n'}
                  {'  '}includes intent_token field{'\n'}
                  {'  '}↓{'\n'}
                  <span className={styles.kw}>markIntentUsed</span>(token, tenantId)
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ─── EXTERNAL SERVICES ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>External Services</span>
          <h2 className={styles.sectionTitle}>
            Four integrations, <span className={styles.hi}>zero manual config</span>.
          </h2>
          <p className={styles.sectionLead}>
            One more than the web flow: Anthropic Haiku 4.5 sits on the SMS-inbound hot path
            as the regex fallback. Twilio plays a double role — first the shared QuoteMax
            number that catches the inbound, then the per-tenant number purchased on activate.
          </p>

          <div className={styles.services}>
            {SERVICES.map((s) => (
              <div key={s.name} className={styles.svc}>
                <div className={styles.svcName}>{s.name}</div>
                <div className={styles.svcRole}>{s.role}</div>
                <div className={styles.svcCreds}>
                  <strong>Env:</strong>
                  <br />
                  {s.env.map((line) => (
                    <span key={line}>
                      {renderEnvLine(line)}
                      <br />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── WEBHOOK AUTO-CONFIG ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>Webhook Auto-config</span>
          <h2 className={styles.sectionTitle}>
            Same wiring as <span className={styles.hi}>web onboarding</span>.
          </h2>
          <p className={styles.sectionLead}>
            New tenant numbers arrive with both webhooks pre-configured at Twilio purchase
            time. The shared QuoteMax number that catches the inbound is wired once,
            manually, in the Twilio console — it&rsquo;s the only number that isn&rsquo;t
            auto-provisioned.
          </p>

          <div className={styles.schemaGrid}>
            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>SMS webhook (per-tenant)</h3>
              <p className={styles.schemaNote}>
                Customer SMS lands on our app. Inbound route resolves tenant by destination
                number, then runs the customer dialog with the tenant&rsquo;s pricing book.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>URL:</span>
                  {'    https://quote-mate-rho.vercel.app\n       /api/sms/inbound\n'}
                  <span className={styles.kw}>METHOD:</span>
                  {' POST'}
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>Voice webhook (per-tenant)</h3>
              <p className={styles.schemaNote}>
                Customer call lands on Vapi&rsquo;s hosted endpoint. Vapi looks up the
                destination number in its phone-number table (registered in step 5b) and
                runs the bound assistant.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>URL:</span>
                  {'    https://api.vapi.ai\n       /twilio/inbound_call\n'}
                  <span className={styles.kw}>METHOD:</span>
                  {' POST'}
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>Shared QuoteMax number (manual)</h3>
              <p className={styles.schemaNote}>
                The +61 481 613 464 line that catches inbound tradie texts. Wired once in
                the Twilio console — points to the SAME /api/sms/inbound endpoint as
                per-tenant numbers. The route disambiguates by checking tenant_id on the
                conversation.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  <span className={styles.kw}>SMS:</span>
                  {'  https://quote-mate-rho.vercel.app\n      /api/sms/inbound\n'}
                  <span className={styles.cm}>// no voice wiring — SMS only</span>
                </code>
              </pre>
            </div>

            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>Tenant resolution priority</h3>
              <p className={styles.schemaNote}>
                When an SMS arrives at /api/sms/inbound, the route looks up the tenant in
                this order. Falling all the way through to legacy_pilot_trade is what makes
                the shared QuoteMax number a valid &ldquo;inbound&rdquo; surface.
              </p>
              <pre className={styles.schemaPre}>
                <code>
                  1. tenantByDestinationSms(To){'\n'}
                  2. tenantByOwnerUser(authed){'\n'}
                  3. tenantByLegacyPilotTrade(){'\n'}
                  {'   '}<span className={styles.cm}>// shared number falls here</span>{'\n'}
                  4. → run intent classifier
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ─── ENV FLAGS ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>Activation Flags</span>
          <h2 className={styles.sectionTitle}>
            Three flags decide <span className={styles.hi}>stub vs real</span>.
          </h2>
          <p className={styles.sectionLead}>
            Same two flags as the web flow plus the shared-number env. SMS development can
            run end-to-end without any Twilio money — the inbound classifier + token
            issuance + activation all work; just no actual outbound SMS.
          </p>

          <div className={styles.flags}>
            <h3 className={styles.flagsHeader}>Environment toggles</h3>
            <div className={styles.flagsTable}>
              <div className={styles.flagsRow}>
                <span className={styles.flagsKey}>TWILIO_PROVISIONING_ENABLED=true</span>
                <span className={styles.flagsValue}>→ real number buy + welcome SMS</span>
              </div>
              <div className={styles.flagsRow}>
                <span className={styles.flagsKey}>VAPI_PROVISIONING_ENABLED=true</span>
                <span className={styles.flagsValue}>→ real assistant create + number register</span>
              </div>
              <div className={styles.flagsRow}>
                <span className={styles.flagsKey}>TWILIO_SHARED_FROM_NUMBER=+61481613464</span>
                <span className={styles.flagsValue}>→ source for SMS reply with magic link</span>
              </div>
              <div className={styles.flagsRow}>
                <span className={styles.flagsKey}>ANTHROPIC_API_KEY=sk-ant-...</span>
                <span className={styles.flagsValue}>→ enables Haiku fallback classifier</span>
              </div>
              <div className={styles.flagsRow}>
                <span className={styles.flagsKey}>APP_URL=https://quote-mate-rho.vercel.app</span>
                <span className={styles.flagsValue}>→ webhook destination + magic link host</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA BAR ─── */}
      <div className={styles.ctaBar}>
        Migrations 015 + 016 applied · Hybrid classifier · Token lifecycle wired · Same activate chain as web
      </div>
    </main>
  )
}

/* ─── Helpers ─────────────────────────────────────────────── */

function SchemaCard({
  title,
  note,
  code,
}: {
  title: string
  note: React.ReactNode
  code: React.ReactNode
}) {
  return (
    <div className={styles.schemaCard}>
      <h3 className={styles.schemaTitle}>{title}</h3>
      <p className={styles.schemaNote}>{note}</p>
      <pre className={styles.schemaPre}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function renderEnvLine(line: string): React.ReactNode {
  const m = line.match(/^(.*)(\(.*\))\s*$/)
  if (!m) return line
  return (
    <>
      {m[1]}
      <span className={styles.svcOptional}>{m[2]}</span>
    </>
  )
}

function K(text: string) {
  return <span className={styles.kw}>{text}</span>
}
function T(text: string) {
  return <span className={styles.ty}>{text}</span>
}
function C(text: string) {
  return <span className={styles.cm}>{text}</span>
}

function tradieSignupIntentsSql(): React.ReactNode {
  return (
    <>
      {K('create table')} tradie_signup_intents ({'\n'}
      {'  '}id{'                   '}{T('uuid')} primary key{'\n'}
      {'                        '}default gen_random_uuid(),{'\n'}
      {'  '}token{'                '}{T('text')} not null unique,{'\n'}
      {'  '}owner_mobile{'         '}{T('text')} not null,{'\n'}
      {'  '}sms_conversation_id{'  '}{T('uuid')}{'\n'}
      {'                        '}{C('-> sms_conversations(id)')}{'\n'}
      {'  '}expires_at{'           '}{T('timestamptz')} not null{'\n'}
      {'                        '}default now() + interval{'\n'}
      {'                        '}{'  '}{C('-- 24h')}{'\n'}
      {'  '}used_at{'              '}{T('timestamptz')},{'\n'}
      {'  '}resulting_tenant_id{'  '}{T('uuid')} {C('-> tenants(id)')},{'\n'}
      {'  '}created_at{'           '}{T('timestamptz')} default now(){'\n'}
      );{'\n'}
      {'\n'}
      {C('-- Active-token fast lookup by slug.')}{'\n'}
      {K('create index')} tradie_signup_intents{'\n'}
      {'  '}_active_lookup{'\n'}
      {'  '}{K('on')} tradie_signup_intents (token){'\n'}
      {'  '}{K('where')} used_at {K('is null')};{'\n'}
      {'\n'}
      {C('-- One active intent per mobile at a time.')}{'\n'}
      {K('create unique index')}{'\n'}
      {'  '}tradie_signup_intents{'\n'}
      {'  '}_one_active_per_mobile{'\n'}
      {'  '}{K('on')} tradie_signup_intents (owner_mobile){'\n'}
      {'  '}{K('where')} used_at {K('is null')};
    </>
  )
}

function smsConversationsPatchSql(): React.ReactNode {
  return (
    <>
      {K('alter table')} sms_conversations{'\n'}
      {'  '}{K('add column if not exists')}{'\n'}
      {'  '}conversation_type {T('text')} not null{'\n'}
      {'  '}default {'\''}customer_quote{'\''};{'\n'}
      {'\n'}
      {K('alter table')} sms_conversations{'\n'}
      {'  '}{K('add constraint')}{'\n'}
      {'  '}sms_conversations_conversation_type_check{'\n'}
      {'  '}check (conversation_type {K('in')} ({'\n'}
      {'    \''}customer_quote{'\''},{'\n'}
      {'    \''}tradie_registration{'\''},{'\n'}
      {'    \''}converted{'\''}{'\n'}
      {'  '}));{'\n'}
      {'\n'}
      {C('-- Index hot-path skip for default rows.')}{'\n'}
      {K('create index')} sms_conversations{'\n'}
      {'  '}_conversation_type_idx{'\n'}
      {'  '}{K('on')} sms_conversations (conversation_type){'\n'}
      {'  '}{K('where')} conversation_type {'<>'} {'\''}customer_quote{'\''};
    </>
  )
}

function tenantsSql(): React.ReactNode {
  return (
    <>
      {K('create table')} tenants ({'\n'}
      {'  '}id{'                   '}{T('uuid')} primary key,{'\n'}
      {'  '}owner_user_id{'        '}{T('uuid')} {'-> auth.users'}{'\n'}
      {'  '}business_name{'        '}{T('text')} not null,{'\n'}
      {'  '}owner_first_name{'     '}{T('text')},{'\n'}
      {'  '}owner_email{'          '}{T('text')} unique,{'\n'}
      {'  '}owner_mobile{'         '}{T('text')} not null,{'\n'}
      {'  '}trade{'                '}{T('text')} {C('-- electrical | plumbing')}{'\n'}
      {'  '}state{'                '}{T('text')},{'\n'}
      {'  '}abn{'                  '}{T('text')},{'\n'}
      {'  '}licence_type{'         '}{T('text')},{'\n'}
      {'  '}licence_number{'       '}{T('text')},{'\n'}
      {'  '}licence_expiry{'       '}{T('date')},{'\n'}
      {'  '}twilio_sms_number{'    '}{T('text')} unique,{'\n'}
      {'  '}twilio_voice_number{'  '}{T('text')} unique,{'\n'}
      {'  '}vapi_assistant_id{'    '}{T('text')},{'\n'}
      {'  '}vapi_voice_persona{'   '}{T('text')},{'\n'}
      {'  '}stripe_connect_account_id {T('text')},{'\n'}
      {'  '}status{'               '}{T('text')} {C('-- onboarding | active')}{'\n'}
      {'  '}created_at{'           '}{T('timestamptz')},{'\n'}
      {'  '}activated_at{'         '}{T('timestamptz')}{'\n'}
      );
    </>
  )
}

function pricingBookSql(): React.ReactNode {
  return (
    <>
      {K('alter table')} pricing_book{'\n'}
      {'  '}{K('add')} tenant_id{'              '}{T('uuid')} {'-> tenants(id)'},{'\n'}
      {'  '}{K('add')} senior_rate{'            '}{T('numeric(8,2)')},{'\n'}
      {'  '}{K('add')} after_hours_multiplier {T('numeric(4,2)')}{'\n'}
      {'        '}default 1.5;{'\n'}
      {'\n'}
      {C('-- Existing columns that matter:')}{'\n'}
      {C('--   hourly_rate, call_out_minimum,')}{'\n'}
      {C('--   apprentice_rate, default_markup_pct,')}{'\n'}
      {C('--   risk_buffer_pct, min_labour_hours,')}{'\n'}
      {C('--   gst_registered,')}{'\n'}
      {C('--   licence_type/number/state/expiry')}{'\n'}
      {'\n'}
      {K('create unique index')}{'\n'}
      {'  '}pricing_book_tenant_trade_unique{'\n'}
      {'  '}{K('on')} pricing_book (tenant_id, trade){'\n'}
      {'  '}{K('where')} tenant_id {K('is not null')};
    </>
  )
}

function tenantServiceOfferingsSql(): React.ReactNode {
  return (
    <>
      {K('create table')} tenant_service_offerings ({'\n'}
      {'  '}tenant_id{'    '}{T('uuid')} {'-> tenants(id)'},{'\n'}
      {'  '}assembly_id{'  '}{T('uuid')} {'-> shared_assemblies(id)'},{'\n'}
      {'  '}enabled{'      '}{T('boolean')} default true,{'\n'}
      {'  '}{K('primary key')} (tenant_id, assembly_id){'\n'}
      );
    </>
  )
}

function tenantIdAddSql(): React.ReactNode {
  return (
    <>
      {K('alter table')} intakes{'\n'}
      {'  '}{K('add')} tenant_id {T('uuid')} {'-> tenants(id)'};{'\n'}
      {'\n'}
      {K('alter table')} quotes{'\n'}
      {'  '}{K('add')} tenant_id {T('uuid')} {'-> tenants(id)'};{'\n'}
      {'\n'}
      {K('alter table')} calls{'\n'}
      {'  '}{K('add')} tenant_id {T('uuid')} {'-> tenants(id)'};{'\n'}
      {'\n'}
      {K('alter table')} sms_conversations{'\n'}
      {'  '}{K('add')} tenant_id {T('uuid')} {'-> tenants(id)'};{'\n'}
      {'\n'}
      {K('alter table')} customers{'\n'}
      {'  '}{K('add')} tenant_id {T('uuid')} {'-> tenants(id)'};
    </>
  )
}

// Stamps for linting — keep unused helper exports out of tree-shaking visibility.
void K
void T
void C
