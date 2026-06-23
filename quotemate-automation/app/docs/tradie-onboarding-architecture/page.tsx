// Tradie Onboarding Architecture doc — Maintain design system.
// Live at /docs/tradie-onboarding-architecture.
//
// Static React Server Component. Content driven from typed arrays so
// editing copy doesn't touch markup. Standalone HTML version still
// lives at /public/docs/tradie-onboarding-architecture.html for sharing.

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
  title: 'Tradie Onboarding Architecture · QuoteMax',
  description:
    'End-to-end architecture of the QuoteMax tradie onboarding flow: signup, email verify, wizard, activate, AI live. Includes database schema and external service integrations.',
}

/* ─── Content ─────────────────────────────────────────────── */

type FlowStep = { num: string; label: string; desc: React.ReactNode }

const FLOW: FlowStep[] = [
  {
    num: '01',
    label: 'Home',
    desc: (
      <>
        Tradie lands on <span className={styles.mono}>/</span>, clicks &ldquo;Get my QuoteMax&rdquo;.
      </>
    ),
  },
  {
    num: '02',
    label: 'Signup',
    desc: (
      <>
        Page <span className={styles.mono}>/signup</span>. Business name, owner first name, email, password (4 fields).
      </>
    ),
  },
  {
    num: '03',
    label: 'Email verify',
    desc: (
      <>
        Supabase sends a link. Tradie clicks → <span className={styles.mono}>/auth/callback</span> picks up session.
      </>
    ),
  },
  {
    num: '04',
    label: 'Wizard',
    desc: (
      <>
        <span className={styles.mono}>/onboard</span>: trade + state + pricing essentials + review (3 steps).
      </>
    ),
  },
  {
    num: '05',
    label: 'Activate',
    desc: (
      <>
        POST <span className={styles.mono}>/api/onboard/activate</span> runs the 7-step provisioning chain.
      </>
    ),
  },
  {
    num: '06',
    label: 'Live AI',
    desc: (
      <>
        <span className={styles.mono}>/onboard/success</span>. Owner gets a welcome text from the new number.
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
        Zod schema in <span className={styles.mono}>lib/onboard/schema.ts</span> checks every field.
        Inline errors returned per-field for the wizard to render.
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
        Owner identity, business name, mobile, trade, state. Status starts as
        <span className={styles.mono}> &lsquo;onboarding&rsquo; </span>. Flipped to
        <span className={styles.mono}> &lsquo;active&rsquo; </span> in step 6.
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
        Hourly rate, markup, callout. Auto-enables the trade&rsquo;s easy-5 services.
        Defaults applied for any blank advanced field (apprentice rate, after-hours multiplier, etc.).
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
        AU only · Voice + SMS + MMS required, Fax best-effort. Sets SmsUrl →
        <span className={styles.mono}> /api/sms/inbound</span>, VoiceUrl →
        <span className={styles.mono}> api.vapi.ai/twilio/inbound_call</span>. No manual Twilio console clicks.
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
        Unique per tenant. Business name in greeting, trade-aware system prompt, chosen voice persona.
        <span className={styles.mono}> serverUrl </span> set to our post-call webhook so quote drafting fires after each call.
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
        POST <span className={styles.mono}>api.vapi.ai/phone-number</span> with the new number + assistant id.
        Number appears in Vapi dashboard&rsquo;s Phone Numbers tab, pre-assigned to the tenant&rsquo;s assistant.
      </>
    ),
    tag: 'VAPI_PROVISIONING_ENABLED',
    tone: 'gated',
  },
  {
    n: '06',
    title: 'Update tenants row → active',
    body: (
      <>
        Saves <span className={styles.mono}>twilio_sms_number</span>,
        <span className={styles.mono}> twilio_voice_number</span>,
        <span className={styles.mono}> vapi_assistant_id</span>. Flips status to
        <span className={styles.mono}> &lsquo;active&rsquo; </span>, stamps
        <span className={styles.mono}> activated_at</span>.
      </>
    ),
    tag: 'Supabase',
    tone: 'ok',
  },
  {
    n: '07',
    title: 'Send welcome SMS',
    body: (
      <>
        From the new QuoteMax number to the owner&rsquo;s personal mobile. Closes the loop visibly —
        they physically receive a text seconds after activation.
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
    role: 'Auth (sign up + email verify + sign in). Postgres for tenants, pricing_book, intakes, quotes. RLS planned for v6.x.',
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
      "Buys the tenant's AU phone number. Pre-configures SMS webhook to our app, voice webhook to Vapi's hosted endpoint. Sends the welcome SMS from the new number.",
    env: [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'APP_URL (webhooks)',
      'TWILIO_PROVISIONING_ENABLED',
    ],
  },
  {
    name: 'Vapi',
    role:
      'Creates per-tenant AI assistant (Claude + 11labs + Deepgram). Registers the Twilio number against the assistant so inbound calls run THAT specific assistant.',
    env: [
      'VAPI_API_KEY',
      'VAPI_VOICE_JON (optional)',
      'VAPI_VOICE_SARAH (optional)',
      'VAPI_PROVISIONING_ENABLED',
    ],
  },
]

/* ─── Page ────────────────────────────────────────────────── */

export default function TradieOnboardingArchitecture() {
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
          <span className={styles.eyebrow}>QuoteMax · v6 · Onboarding Architecture</span>
          <h1 className={styles.display}>
            Tradie signs up →
            <br />
            AI <span className={styles.hi}>live</span> in 4 minutes.
          </h1>
          <p className={styles.lede}>
            Full view of how a new tradie goes from &ldquo;Get my QuoteMax&rdquo; on the
            homepage to receiving real customer calls + SMS on their own dedicated AU
            number, with their own pricing book and AI receptionist. Schema, services,
            flags, all in one screen.
          </p>
          <p className={styles.lede} style={{ marginTop: '0.85rem', fontSize: '0.92rem' }}>
            See also:{' '}
            <Link href="/docs/tradie-onboarding-plan" className={styles.inlineLink}>
              high-level plan
            </Link>
            {' · '}
            <Link href="/docs/sms-onboarding-architecture" className={styles.inlineLink}>
              SMS architecture
            </Link>
            {' · '}
            <Link href="/" className={styles.inlineLink}>
              back to home
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
            Six steps, <span className={styles.hi}>one button click</span> at the end.
          </h2>
          <p className={styles.sectionLead}>
            Each node below is a real page or process. Hitting &ldquo;Activate my QuoteMax&rdquo;
            on step 5 fires every backend integration in parallel.
          </p>

          <div className={styles.flow} aria-label="Tradie onboarding flow">
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

      {/* ─── ACTIVATION CHECKLIST ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>
            The Activation Checklist
          </span>
          <h2 className={styles.sectionTitle}>
            Seven things run when <span className={styles.hi}>&ldquo;Activate&rdquo;</span> is clicked.
          </h2>
          <p className={styles.sectionLead}>
            Steps 1–3 are pure database writes (always real). Steps 4–7 hit external
            APIs and are gated by env flags so test phase costs nothing. Order is
            atomic — failure at any step rolls back or surfaces a clear warning.
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
            Three tables, <span className={styles.hi}>one tenant_id</span> across them.
          </h2>
          <p className={styles.sectionLead}>
            Migration <span className={styles.mono}>015_tenants_onboarding.sql</span> is the
            foundation. Every operational table (intakes, quotes, calls, sms_conversations,
            customers) also gained a <span className={styles.mono}>tenant_id</span> column
            for downstream scoping.
          </p>

          <div className={styles.schemaGrid}>
            <SchemaCard
              title="tenants"
              note="One row per registered tradie. Owns pricing, branding, and the provisioned Twilio + Vapi identifiers."
              code={tenantsSql()}
            />
            <SchemaCard
              title="pricing_book (extended)"
              note={
                <>
                  Pre-existing table. Migration 015 added{' '}
                  <span className={styles.mono}>tenant_id</span>,{' '}
                  <span className={styles.mono}>senior_rate</span>,{' '}
                  <span className={styles.mono}>after_hours_multiplier</span>. One row per
                  (tenant, trade).
                </>
              }
              code={pricingBookSql()}
            />
            <SchemaCard
              title="tenant_service_offerings"
              note="Which catalogue items the tradie offers. Auto-populated with the easy-5 for their trade on activate."
              code={tenantServiceOfferingsSql()}
            />
            <SchemaCard
              title="tenant_id added to operational tables"
              note="Every downstream table got the tenant_id column so quote drafting, intake structuring, and SMS dialogs can scope per-tradie. NULL allowed for back-compat with pre-v6 conversations."
              code={tenantIdAddSql()}
            />
          </div>
        </div>
      </section>

      {/* ─── EXTERNAL SERVICES ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>External Services</span>
          <h2 className={styles.sectionTitle}>
            Three integrations, <span className={styles.hi}>zero manual config</span>.
          </h2>
          <p className={styles.sectionLead}>
            Each tradie gets their own resources in all three external services. The
            activate endpoint orchestrates the creation; the tradie never opens any of
            these dashboards themselves.
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
            Every new Twilio number is <span className={styles.hi}>born wired up</span>.
          </h2>
          <p className={styles.sectionLead}>
            Set at purchase time by the Twilio API call. Tradies never open the Twilio
            console; numbers arrive with both webhooks pre-configured.
          </p>

          <div className={styles.schemaGrid}>
            <div className={styles.schemaCard}>
              <h3 className={styles.schemaTitle}>SMS webhook</h3>
              <p className={styles.schemaNote}>
                Customer SMS lands on our app. The inbound route resolves tenant by
                destination number, then runs the dialog Haiku with the right pricing book.
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
              <h3 className={styles.schemaTitle}>Voice webhook</h3>
              <p className={styles.schemaNote}>
                Customer call lands on Vapi&rsquo;s hosted endpoint. Vapi looks up the
                destination number in its phone-number table (registered in step 5b)
                and runs the bound assistant.
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
          </div>
        </div>
      </section>

      {/* ─── ENV FLAGS ─── */}
      <section className={styles.block}>
        <div className={styles.container}>
          <span className={`${styles.eyebrow} ${styles.sectionEyebrow}`}>Activation Flags</span>
          <h2 className={styles.sectionTitle}>
            Two flags decide <span className={styles.hi}>stub vs real</span>.
          </h2>
          <p className={styles.sectionLead}>
            Test phase runs with both flags off — no Twilio money, no Vapi calls, but
            every UI screen + database write works end to end. Flip to true (per environment)
            when you&rsquo;re ready to provision real numbers and assistants.
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
                <span className={styles.flagsKey}>APP_URL=https://quote-mate-rho.vercel.app</span>
                <span className={styles.flagsValue}>→ webhook destination</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA BAR ─── */}
      <div className={styles.ctaBar}>
        Migration 015 applied · Activate endpoint live · Twilio + Vapi gated · Ready when you fund
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
