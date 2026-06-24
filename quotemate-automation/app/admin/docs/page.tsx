'use client'

// /admin/docs — Documentation Library (admin-only).
//
// Every internal QuoteMax doc in one searchable place: the platform
// walkthrough, architecture maps, pricing explainers, the SMS channel
// specs, onboarding plans, supplements and the investor pack.
//
// Gating mirrors the rest of /admin: this page is rendered client-side,
// reads the Supabase session, and calls /api/admin/whoami. The catalogue
// is ONLY rendered when whoami confirms is_admin === true — a non-admin
// (or signed-out) visitor sees the gate, never the list. The individual
// docs are static files under /public/docs, so they remain reachable by
// direct URL; this page is the admin-only way to discover and navigate them.
//
// Design system: Maintain Technology (dark command-centre, orange accent,
// all-caps display, mono labels, square cards).

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'

type WhoAmI = {
  ok: boolean
  is_admin?: boolean
  user_id?: string
  error?: string
}

type Doc = { cat: string; title: string; desc: string; file: string }

const CATS = [
  'Start here & overview',
  'Onboarding',
  'Pricing & quote engine',
  'SMS channel',
  'Architecture & data',
  'Supplements & knowledge base',
  'Build, status & internal',
  'Investor',
] as const

const DOCS: Doc[] = [
  // Start here & overview
  { cat: 'Start here & overview', title: 'Platform Walkthrough', desc: 'Plain-English tour of every feature with full sample quotes. Built for onboarding new tradies.', file: 'platform-capabilities-walkthrough.html' },
  { cat: 'Start here & overview', title: 'How It Works — Feature Overview', desc: 'How QuoteMax works, top to bottom.', file: 'quotemate-feature-overview.html' },
  { cat: 'Start here & overview', title: 'How It Works — One-Pager', desc: 'One-page go-to-market and onboarding overview.', file: 'quotemax-onepager.html' },
  { cat: 'Start here & overview', title: 'Beginner Walkthrough', desc: "A beginner's walkthrough across stages 01 to 05.", file: 'beginner-walkthrough.html' },
  // Onboarding
  { cat: 'Onboarding', title: 'Trade Onboarding Bundle Spec', desc: 'What ships when a new trade is added: assemblies, intake rules, pricing, framing and licence schema.', file: 'onboarding-bundle.html' },
  { cat: 'Onboarding', title: 'Tradie Onboarding Plan', desc: 'The plan for self-serve tradie onboarding.', file: 'tradie-onboarding-plan.html' },
  { cat: 'Onboarding', title: 'Tradie Onboarding via SMS', desc: 'Onboarding a tradie entirely over SMS.', file: 'tradie-onboarding-plan-sms.html' },
  { cat: 'Onboarding', title: 'Tradie Onboarding Architecture', desc: 'The architecture behind self-serve onboarding and auto-provisioning.', file: 'tradie-onboarding-architecture.html' },
  // Pricing & quote engine
  { cat: 'Pricing & quote engine', title: 'Intake & Estimation Engine', desc: 'How an intake becomes a priced quote, step by step.', file: 'quote-engine-explainer.html' },
  { cat: 'Pricing & quote engine', title: 'How the Receptionist Prices a Job', desc: 'How the AI receptionist prices a job.', file: 'pricing-flow.html' },
  { cat: 'Pricing & quote engine', title: 'How the Pricing Works', desc: 'How the pricing works, in plain terms.', file: 'pricing-transparency.html' },
  { cat: 'Pricing & quote engine', title: 'Price Book Accuracy', desc: 'How accurate the price book is, explained for Jon.', file: 'pricing-data-accuracy.html' },
  { cat: 'Pricing & quote engine', title: 'Trade-book to Cookbook Pipeline', desc: 'Turning a trade-book into a usable cookbook — pipeline spike.', file: 'trade-book-pipeline-spike.html' },
  { cat: 'Pricing & quote engine', title: 'Pricing KB Verification', desc: 'How the pricing knowledge base is verified for accuracy.', file: 'kb-verify-explainer.html' },
  { cat: 'Pricing & quote engine', title: 'Supplier Catalogue Template', desc: 'CSV template for loading a supplier catalogue.', file: 'supplier-catalogue-template.csv' },
  // SMS channel
  { cat: 'SMS channel', title: 'SMS Receptionist — Pipeline Spec', desc: 'The canonical end-to-end SMS receptionist pipeline.', file: 'sms-ai-receptionist-workflow.html' },
  { cat: 'SMS channel', title: 'SMS — Before & After', desc: 'Before and after the SMS AI receptionist.', file: 'sms-before-after.html' },
  { cat: 'SMS channel', title: 'SMS Onboarding Flow', desc: 'The SMS onboarding flow.', file: 'sms-onboarding-flow.html' },
  { cat: 'SMS channel', title: 'SMS Onboarding Architecture', desc: 'Architecture of SMS onboarding.', file: 'sms-onboarding-architecture.html' },
  { cat: 'SMS channel', title: 'SMS Channel SOP', desc: 'Standard operating procedure for the SMS channel.', file: 'sms-sop.html' },
  // Architecture & data
  { cat: 'Architecture & data', title: 'Platform Architecture', desc: 'End-to-end architecture across stages 01 to 10 (voice + SMS).', file: 'architecture.html' },
  { cat: 'Architecture & data', title: 'Voice + SMS Agent Architecture', desc: 'How the voice and SMS agents are built.', file: 'agent-architecture.html' },
  { cat: 'Architecture & data', title: 'Database Architecture', desc: 'Database architecture and the site wiring map.', file: 'database-architecture.html' },
  { cat: 'Architecture & data', title: 'Data Flow — Visual Guide', desc: 'A visual guide to how the data flows.', file: 'database-visual.html' },
  { cat: 'Architecture & data', title: 'Architecture Wireframe', desc: 'An architecture wireframe of the platform.', file: 'wireframe.html' },
  { cat: 'Architecture & data', title: 'Image Engine Flow', desc: 'How the AI preview images get generated.', file: 'ig-engine-flow.html' },
  // Supplements & knowledge base
  { cat: 'Supplements & knowledge base', title: 'Commercial Paint KB Supplement', desc: 'File-store knowledge-base supplement for the commercial paint estimator.', file: 'commercial-paint-kb-supplement.html' },
  { cat: 'Supplements & knowledge base', title: 'Estimator File-Store Supplement', desc: 'The ephemeral file-store supplement for the electrical estimator.', file: 'estimator-filestore-supplement.html' },
  // Build, status & internal
  { cat: 'Build, status & internal', title: 'Automation Build Guide', desc: 'The automation build guide, stages 01 to 05.', file: 'build-guide.html' },
  { cat: 'Build, status & internal', title: 'SOP — Stages 01 to 05', desc: 'Standard operating procedure walkthrough, stages 01 to 05.', file: 'stage1-05-sop.html' },
  { cat: 'Build, status & internal', title: 'SOP — Stages 06 to 10', desc: 'Standard operating procedure walkthrough, stages 06 to 10.', file: 'stage6-10-sop.html' },
  { cat: 'Build, status & internal', title: 'Build Status', desc: 'The current build status.', file: 'quoteMate-au-progress.html' },
  { cat: 'Build, status & internal', title: 'Weekly Progress', desc: 'A weekly progress snapshot.', file: 'sms-progress.html' },
  { cat: 'Build, status & internal', title: 'Dashboard Capabilities', desc: 'Investor brief on dashboard capabilities.', file: 'dashboard-capabilities.html' },
  { cat: 'Build, status & internal', title: 'Red Team Brief', desc: 'Security red-team brief for the platform.', file: 'red-team-brief.html' },
  // Investor
  { cat: 'Investor', title: 'Investor Pack', desc: 'The full investor overview pack — index, agents, architecture and demo script.', file: 'investor-pack/index.html' },
]

export default function AdminDocsPage() {
  const [who, setWho] = useState<WhoAmI | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>(
    'loading',
  )
  const [q, setQ] = useState('')

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token
      if (!t) {
        setAuthState('signed-out')
        return
      }
      try {
        const res = await fetch('/api/admin/whoami', {
          headers: { Authorization: `Bearer ${t}` },
          cache: 'no-store',
        })
        const json = (await res.json()) as WhoAmI
        setWho(json)
      } catch {
        setWho({ ok: false, error: 'network error' })
      } finally {
        setAuthState('ready')
      }
    })
  }, [])

  const isAdmin = authState === 'ready' && who?.is_admin === true

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return DOCS
    return DOCS.filter((d) =>
      `${d.title} ${d.desc} ${d.file} ${d.cat}`.toLowerCase().includes(term),
    )
  }, [q])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pt-14 pb-8 sm:px-10 md:pt-20">
        <div className="flex items-center gap-3 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
          <Link href="/admin" className="hover:text-text-pri">
            QuoteMax / Admin
          </Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">Docs</span>
        </div>

        <h1 className="mt-8 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.25rem,5vw,4rem)]">
          Documentation <span className="text-accent">library</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-text-sec md:text-lg">
          Every QuoteMax document in one place. Click any card to open the live
          doc in a new tab — walkthroughs, architecture, pricing, the SMS
          channel, onboarding and more.
        </p>
      </section>

      {/* ── Gate / catalogue ───────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pb-20 sm:px-10">
        {!isAdmin ? (
          <Gate authState={authState} who={who} />
        ) : (
          <>
            {/* Search */}
            <div className="relative max-w-xl">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-dim">
                <SearchIcon />
              </span>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search docs — e.g. pricing, SMS, onboarding…"
                aria-label="Search documents"
                autoComplete="off"
                className="w-full border border-ink-line bg-ink-card py-3 pl-11 pr-4 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <div className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
              {q.trim()
                ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
                : `${DOCS.length} documents · ${CATS.length} categories`}
            </div>

            {/* Categories */}
            <div className="mt-10 grid gap-12">
              {CATS.map((cat) => {
                const items = filtered.filter((d) => d.cat === cat)
                if (items.length === 0) return null
                return (
                  <div key={cat}>
                    <div className="mb-5 flex items-baseline gap-3">
                      <h2 className="font-extrabold uppercase tracking-[-0.02em] text-[clamp(1.15rem,2.2vw,1.5rem)]">
                        {cat}
                      </h2>
                      <span className="font-mono text-[0.7rem] tracking-[0.1em] text-accent">
                        {items.length}
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((d) => (
                        <DocCard key={d.file} doc={d} />
                      ))}
                    </div>
                  </div>
                )
              })}
              {filtered.length === 0 && (
                <div className="py-16 text-center font-mono text-sm uppercase tracking-[0.08em] text-text-dim">
                  No docs match your search.
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <div className="bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMax Admin · Docs
        </span>
      </div>
    </main>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function DocCard({ doc }: { doc: Doc }) {
  return (
    <a
      href={`/docs/${doc.file}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col border border-ink-line bg-ink-card p-5 transition-colors hover:border-accent"
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-accent transition-transform duration-300 group-hover:scale-x-100"
        aria-hidden="true"
      />
      <h3 className="font-extrabold uppercase tracking-[-0.01em] leading-tight text-text-pri text-base">
        {doc.title}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-text-sec">
        {doc.desc}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-line pt-3">
        <span className="truncate font-mono text-[0.6rem] tracking-[0.04em] text-text-dim">
          {doc.file}
        </span>
        <span className="shrink-0 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-accent">
          Open &#8599;
        </span>
      </div>
    </a>
  )
}

function Gate({
  authState,
  who,
}: {
  authState: 'loading' | 'signed-out' | 'ready'
  who: WhoAmI | null
}) {
  let title = ''
  let body: ReactNode = null

  if (authState === 'loading') {
    title = 'Checking admin status…'
    body = (
      <p className="text-text-sec">One moment while we confirm your access.</p>
    )
  } else if (authState === 'signed-out') {
    title = 'Sign in required'
    body = (
      <p className="text-text-sec">
        The documentation library is admin-only.{' '}
        <Link href="/signin" className="text-accent underline-offset-2 hover:underline">
          Sign in
        </Link>{' '}
        with an admin account to view it.
      </p>
    )
  } else {
    // ready but not an admin
    title = 'Admins only'
    body = (
      <p className="text-text-sec">
        {who?.error
          ? `Access check failed: ${who.error}.`
          : 'You are signed in, but this account is not an admin. Ask an operator to add you to the admin list.'}
      </p>
    )
  }

  return (
    <div className="max-w-xl border border-ink-line bg-ink-card p-8">
      <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent">
        Restricted
      </div>
      <h2 className="mt-3 font-extrabold uppercase tracking-[-0.02em] text-2xl">
        {title}
      </h2>
      <div className="mt-4 text-base leading-relaxed">{body}</div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}
