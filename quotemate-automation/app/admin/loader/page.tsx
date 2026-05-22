'use client'

// Admin bulk loader — upload a Services / Materials CSV, review the preview
// diff, Approve (commit) or Roll back. Admin-only: every API call carries
// the Supabase access token and the routes enforce the admin_users gate, so
// a non-admin simply gets a 403 here.
//
// UI: Maintain Technology design system — dark navy command-centre, orange
// accent, numbered 3-step flow (.claude/skills/maintain-design-system).

import { useCallback, useState, type ReactNode } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'

type StagedRow = {
  row_class: 'NEW' | 'UPDATE'
  payload: Record<string, unknown>
  smoke_status?: 'passed' | 'failed' | 'skipped'
  smoke_reason?: string | null
}
type RejectedRow = { line: number; errors: string[] }
type PreviewCsv = {
  csv: string
  target_table: string
  summary: { newCount: number; updateCount: number; rejectedCount: number }
  forcedDisabledCount: number
  stagedRows: StagedRow[]
  rejected: RejectedRow[]
}

type BatchStatus = 'staged' | 'committed' | 'rolled_back'

// New-trade form shapes — kept as strings so the inputs stay controlled and
// blank-friendly; parsed + validated in handleUpload.
type DefaultsForm = {
  hourlyRate: string
  callOutMinimum: string
  apprenticeRate: string
  seniorRate: string
  defaultMarkupPct: string
  riskBufferPct: string
  minLabourHours: string
  licenceLabel: string
}
type PromptsForm = {
  estimatorSystemPrompt: string
  smsScopeBlurb: string
  smsTradeRules: string
  voiceGreeting: string
  voiceSystemPrompt: string
}

// §7.5 trade-defaults — the numeric rate fields, in render order.
const DEFAULTS_FIELDS: {
  key: keyof DefaultsForm
  label: string
  hint: string
  required: boolean
}[] = [
  { key: 'hourlyRate', label: 'Hourly rate $', hint: 'ex-GST', required: true },
  { key: 'callOutMinimum', label: 'Call-out minimum $', hint: 'ex-GST', required: true },
  { key: 'apprenticeRate', label: 'Apprentice rate $/hr', hint: 'ex-GST', required: true },
  { key: 'seniorRate', label: 'Senior rate $/hr', hint: 'optional', required: false },
  { key: 'defaultMarkupPct', label: 'Default markup %', hint: 'e.g. 28', required: true },
  { key: 'riskBufferPct', label: 'Risk buffer %', hint: 'e.g. 15', required: true },
  { key: 'minLabourHours', label: 'Min labour hours', hint: 'e.g. 2', required: true },
]

// §6 prompt-pack — the authored text fields.
const PROMPT_FIELDS: {
  key: keyof PromptsForm
  label: string
  hint: string
  rows: number
}[] = [
  {
    key: 'estimatorSystemPrompt',
    label: 'Estimator system prompt',
    hint: 'The trade-tuned drafting prompt. Leave blank to author later.',
    rows: 8,
  },
  {
    key: 'smsScopeBlurb',
    label: 'SMS scope blurb',
    hint: 'One line — what this trade does, for the SMS agent.',
    rows: 3,
  },
  {
    key: 'smsTradeRules',
    label: 'SMS trade rules',
    hint: 'Optional safety/scope rules for the SMS dialog.',
    rows: 3,
  },
  { key: 'voiceGreeting', label: 'Voice greeting', hint: 'Optional.', rows: 2 },
  {
    key: 'voiceSystemPrompt',
    label: 'Voice system prompt',
    hint: 'Optional — bespoke voice-agent text.',
    rows: 4,
  },
]

const num = (v: unknown) => (v == null ? '' : String(v))

// ── Maintain design-system button styles ────────────────────────────
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 bg-accent px-6 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-40'
const BTN_DANGER =
  'inline-flex items-center justify-center gap-2 border border-[#B91C1C] bg-transparent px-6 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-[#FCA5A5] transition-colors hover:bg-[#B91C1C]/20 disabled:cursor-not-allowed disabled:opacity-40'
const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 border border-ink-line bg-transparent px-6 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-text-sec transition-colors hover:border-text-dim hover:text-text-pri disabled:cursor-not-allowed disabled:opacity-40'

// ── Numbered step card (the signature Maintain pattern) ──────────────
function StepCard({
  n,
  title,
  children,
}: {
  n: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="mt-8 border border-ink-line bg-ink-card">
      <header className="flex items-center gap-5 border-b border-ink-line px-6 py-5 md:px-8">
        <span className="font-mono text-4xl font-bold leading-none text-accent md:text-5xl">
          {n}
        </span>
        <h2 className="font-extrabold uppercase tracking-tight text-lg md:text-xl">
          {title}
        </h2>
      </header>
      <div className="px-6 py-6 md:px-8">{children}</div>
    </section>
  )
}

// ── Alert banner ─────────────────────────────────────────────────────
function Banner({
  tone,
  children,
}: {
  tone: 'danger' | 'info'
  children: ReactNode
}) {
  const cls =
    tone === 'danger'
      ? 'border-[#B91C1C]/55 bg-[#B91C1C]/12 text-[#FCA5A5]'
      : 'border-teal-glow/45 bg-teal-glow/10 text-teal-glow'
  return (
    <div className={`mt-6 border px-4 py-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </div>
  )
}

// ── Big-number stat tile ─────────────────────────────────────────────
function Stat({
  value,
  label,
  colour,
}: {
  value: number
  label: string
  colour: string
}) {
  return (
    <div className="border border-ink-line bg-ink-deep px-4 py-3">
      <div className={`font-mono text-3xl font-bold leading-none ${colour}`}>
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
        {label}
      </div>
    </div>
  )
}

// ── 3-step progress rail ─────────────────────────────────────────────
// Orients the admin in the Upload → Preview → Commit flow. Only the
// active step's StepCard renders below, so without this the admin loses
// the sense of "where am I, what's left".
function StepRail({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: '01', label: 'Upload' },
    { n: '02', label: 'Preview' },
    { n: '03', label: 'Commit' },
  ] as const
  return (
    <ol className="mt-10 grid grid-cols-3 gap-px border border-ink-line bg-ink-line">
      {steps.map((s, i) => {
        const idx = i + 1
        const state =
          idx < current ? 'done' : idx === current ? 'current' : 'upcoming'
        return (
          <li
            key={s.n}
            className={`border-b-2 bg-ink-card px-4 py-4 ${
              state === 'current' ? 'border-accent' : 'border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`font-mono text-xl font-bold leading-none ${
                  state === 'upcoming' ? 'text-text-dim' : 'text-accent'
                }`}
              >
                {s.n}
              </span>
              <span
                className={`font-mono text-[0.7rem] font-bold uppercase tracking-[0.14em] ${
                  state === 'upcoming' ? 'text-text-dim' : 'text-text-pri'
                }`}
              >
                {s.label}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[0.56rem] uppercase tracking-[0.16em] text-text-dim">
              {state === 'done'
                ? '✓ Complete'
                : state === 'current'
                  ? 'In progress'
                  : 'Waiting'}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ── Download glyph for the CSV template chips ────────────────────────
function DownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
    </svg>
  )
}

export default function AdminLoaderPage() {
  const [servicesFile, setServicesFile] = useState<File | null>(null)
  const [materialsFile, setMaterialsFile] = useState<File | null>(null)
  const [categoriesFile, setCategoriesFile] = useState<File | null>(null)
  // "Create new trade" — name + the §2.1 install/job-based confirmation,
  // the §7.5 pricing-defaults block, and the optional §6 prompt pack.
  const [newTradeOpen, setNewTradeOpen] = useState(false)
  const [tradeName, setTradeName] = useState('')
  const [tradeDisplay, setTradeDisplay] = useState('')
  const [tradeJobBased, setTradeJobBased] = useState(false)
  const [tradeGstRegistered, setTradeGstRegistered] = useState(true)
  const [tradeDefaults, setTradeDefaults] = useState<DefaultsForm>({
    hourlyRate: '',
    callOutMinimum: '',
    apprenticeRate: '',
    seniorRate: '',
    defaultMarkupPct: '',
    riskBufferPct: '',
    minLabourHours: '',
    licenceLabel: '',
  })
  const [promptPackOpen, setPromptPackOpen] = useState(false)
  const [tradePrompts, setTradePrompts] = useState<PromptsForm>({
    estimatorSystemPrompt: '',
    smsScopeBlurb: '',
    smsTradeRules: '',
    voiceGreeting: '',
    voiceSystemPrompt: '',
  })
  const [createdTrade, setCreatedTrade] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [structural, setStructural] = useState<
    { csv: string; errors: string[] }[] | null
  >(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [preview, setPreview] = useState<PreviewCsv[] | null>(null)
  // §8 step 7 — count of NEW services the smoke-test held back.
  const [smokeFailed, setSmokeFailed] = useState(0)

  const token = useCallback(async () => {
    const { data } = await getBrowserSupabase().auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  function resetAll() {
    setServicesFile(null)
    setMaterialsFile(null)
    setCategoriesFile(null)
    setNewTradeOpen(false)
    setTradeName('')
    setTradeDisplay('')
    setTradeJobBased(false)
    setTradeGstRegistered(true)
    setTradeDefaults({
      hourlyRate: '',
      callOutMinimum: '',
      apprenticeRate: '',
      seniorRate: '',
      defaultMarkupPct: '',
      riskBufferPct: '',
      minLabourHours: '',
      licenceLabel: '',
    })
    setPromptPackOpen(false)
    setTradePrompts({
      estimatorSystemPrompt: '',
      smsScopeBlurb: '',
      smsTradeRules: '',
      voiceGreeting: '',
      voiceSystemPrompt: '',
    })
    setCreatedTrade(null)
    setError(null)
    setInfo(null)
    setStructural(null)
    setBatchId(null)
    setBatchStatus(null)
    setPreview(null)
    setSmokeFailed(0)
  }

  async function handleUpload() {
    setError(null)
    setInfo(null)
    setStructural(null)
    setCreatedTrade(null)
    const wantsNewTrade = newTradeOpen && tradeName.trim().length >= 2
    if (!servicesFile && !materialsFile && !categoriesFile && !wantsNewTrade) {
      setError('Add a new trade and/or choose a CSV first.')
      return
    }
    if (wantsNewTrade && !tradeJobBased) {
      setError('Confirm the trade is install/job-based (§2.1) before creating it.')
      return
    }
    // §7.5 — a new trade MUST carry pricing defaults; §10 step 2 seeds a
    // tenant's pricing_book from them, and a missing row fails every quote.
    let defaultsPayload: Record<string, unknown> | null = null
    if (wantsNewTrade) {
      const parsed: Record<string, number> = {}
      for (const f of DEFAULTS_FIELDS) {
        const raw = tradeDefaults[f.key].trim()
        if (!raw) {
          if (f.required) {
            setError(`Trade defaults: "${f.label}" is required.`)
            return
          }
          continue
        }
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 0) {
          setError(`Trade defaults: "${f.label}" must be a number ≥ 0.`)
          return
        }
        parsed[f.key] = n
      }
      if ((parsed.hourlyRate ?? 0) <= 0) {
        setError('Trade defaults: "Hourly rate $" must be greater than 0.')
        return
      }
      defaultsPayload = {
        hourlyRate: parsed.hourlyRate,
        callOutMinimum: parsed.callOutMinimum,
        apprenticeRate: parsed.apprenticeRate,
        seniorRate: parsed.seniorRate,
        defaultMarkupPct: parsed.defaultMarkupPct,
        riskBufferPct: parsed.riskBufferPct,
        minLabourHours: parsed.minLabourHours,
        gstRegistered: tradeGstRegistered,
        licenceLabel: tradeDefaults.licenceLabel.trim() || undefined,
      }
    }
    setBusy(true)
    try {
      const t = await token()
      if (!t) {
        setError('Not signed in. Sign in with an admin account, then retry.')
        return
      }
      const payload: Record<string, unknown> = {
        idempotencyKey: crypto.randomUUID(),
      }
      if (servicesFile) payload.services = await servicesFile.text()
      if (materialsFile) payload.materials = await materialsFile.text()
      if (categoriesFile) payload.categories = await categoriesFile.text()
      if (wantsNewTrade && defaultsPayload) {
        // Only forward prompt fields that were actually authored.
        const promptEntries = Object.entries(tradePrompts)
          .map(([k, v]) => [k, v.trim()] as const)
          .filter(([, v]) => v.length > 0)
        payload.newTrade = {
          name: tradeName.trim().toLowerCase(),
          displayName: tradeDisplay.trim() || undefined,
          isJobBased: true,
          defaults: defaultsPayload,
          prompts:
            promptEntries.length > 0
              ? Object.fromEntries(promptEntries)
              : undefined,
        }
      }

      const res = await fetch('/api/admin/loader/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (res.status === 403) {
        setError('Not authorized — your account is not on the admin list.')
        return
      }
      if (data?.error === 'structural_validation_failed') {
        setStructural(data.csvs ?? [])
        return
      }
      if (!res.ok || !data?.ok) {
        setError(data?.message ?? data?.error ?? `Upload failed (${res.status}).`)
        return
      }
      if (data.idempotentReplay) {
        setInfo('This upload was already submitted — showing the existing batch.')
        setBatchId(data.batchId)
        setBatchStatus((data.batch?.status as BatchStatus) ?? 'staged')
        setPreview(null)
        return
      }
      setBatchId(data.batchId)
      setBatchStatus('staged')
      setPreview(data.preview as PreviewCsv[])
      setSmokeFailed(Number(data.smokeFailedCount) || 0)
      setCreatedTrade(data.newTrade?.name ? String(data.newTrade.name) : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function callBatch(action: 'approve' | 'rollback', body?: object) {
    const t = await token()
    if (!t) {
      setError('Session expired — sign in again.')
      return null
    }
    const res = await fetch(`/api/admin/loader/batch/${batchId}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify(body ?? {}),
    })
    return { res, data: await res.json() }
  }

  async function handleApprove() {
    if (!batchId) return
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      let out = await callBatch('approve')
      if (!out) return
      if (out.data?.error === 'reprice_confirmation_required') {
        const ok = window.confirm(
          `${out.data.message}\n\nProceed and re-price ${out.data.updateCount} live service(s)?`,
        )
        if (!ok) return
        out = await callBatch('approve', { confirmReprice: true })
        if (!out) return
      }
      if (!out.res.ok || !out.data?.ok) {
        setError(out.data?.message ?? out.data?.error ?? 'Approve failed.')
        return
      }
      const r = out.data.result ?? {}
      setBatchStatus('committed')
      setInfo(
        r.already_committed
          ? 'Batch was already committed.'
          : `Committed ${r.committed ?? 0} row(s)${r.skipped ? `, skipped ${r.skipped}` : ''}.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleRollback() {
    if (!batchId) return
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const out = await callBatch('rollback')
      if (!out) return
      if (!out.res.ok || !out.data?.ok) {
        setError(out.data?.message ?? out.data?.error ?? 'Rollback failed.')
        return
      }
      const r = out.data.result ?? {}
      setBatchStatus('rolled_back')
      setInfo(
        r.already_rolled_back
          ? 'Batch was already rolled back.'
          : `Rolled back — reverted ${r.reverted ?? 0}, deleted ${r.deleted ?? 0}.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const totalStaged = preview?.reduce((n, p) => n + p.stagedRows.length, 0) ?? 0
  // Drives the StepRail: 1 before a batch exists, 2 while staged and
  // under review, 3 once committed or rolled back.
  const currentStep: 1 | 2 | 3 = !batchId
    ? 1
    : batchStatus === 'staged'
      ? 2
      : 3

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      {/* Topographic overlay — the Maintain signature background texture. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.13]"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <path d="M0,560 Q240,440 480,500 T960,480 T1440,510" fill="none" stroke="var(--teal-glow)" strokeWidth="1" />
        <path d="M0,650 Q260,540 520,590 T1040,575 T1440,605" fill="none" stroke="var(--teal-glow)" strokeWidth="1" />
        <path d="M0,740 Q220,650 460,695 T940,685 T1440,710" fill="none" stroke="var(--accent)" strokeWidth="1" strokeOpacity="0.55" />
        <path d="M0,830 Q280,750 560,790 T1120,780 T1440,800" fill="none" stroke="var(--teal-glow)" strokeWidth="1" />
      </svg>

      {/* ── Slim admin nav — keeps the page from feeling orphaned ── */}
      <nav className="relative z-10 border-b border-ink-line bg-ink-deep/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <a href="/dashboard" className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center bg-accent text-xs font-black text-white">
              Q
            </span>
            <span className="font-extrabold uppercase tracking-tight">
              QuoteMate
            </span>
            <span className="text-text-dim">/</span>
            <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-sec">
              Admin
            </span>
          </a>
          <a
            href="/dashboard"
            className="shrink-0 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:text-text-pri"
          >
            ← Dashboard
          </a>
        </div>
      </nav>

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-14 md:py-16">
        {/* ── Header ──────────────────────────────────────────────── */}
        <header>
          <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-text-dim">
            QuoteMate · Admin
          </span>
          <h1 className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.25rem,5vw,3.5rem)]">
            Bulk service <span className="text-accent">loader</span>
          </h1>
          <p className="mt-5 max-w-[58ch] leading-relaxed text-text-sec">
            Upload a Services or Materials CSV, review the diff, then approve.
            Nothing touches the live catalogue until you approve — and every
            commit can be rolled back.
          </p>
        </header>

        <StepRail current={currentStep} />

        {error && <Banner tone="danger">{error}</Banner>}
        {info && <Banner tone="info">{info}</Banner>}

        {/* ── Structural rejection ─────────────────────────────────── */}
        {structural && (
          <div className="mt-6 border border-[#B91C1C]/55 bg-[#B91C1C]/12 px-5 py-4 text-[#FCA5A5]">
            <p className="font-semibold uppercase tracking-wide text-sm">
              File rejected before any row was staged
            </p>
            {structural.map((s) => (
              <div key={s.csv} className="mt-3">
                <span className="font-mono text-xs uppercase tracking-[0.12em] text-text-dim">
                  {s.csv} CSV
                </span>
                <ul className="mt-1 ml-5 list-disc text-sm leading-relaxed">
                  {s.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* ── Step 01 · Upload ─────────────────────────────────────── */}
        {!batchId && (
          <StepCard n="01" title="Upload a CSV">
            {/* Create-new-trade — the §2.1 gate. */}
            <div className="mb-6 border border-ink-line bg-ink-deep px-4 py-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={newTradeOpen}
                  onChange={(e) => setNewTradeOpen(e.target.checked)}
                  className="h-4 w-4 accent-[#FF5A1F]"
                />
                <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                  Create a new trade with this upload
                </span>
              </label>
              {newTradeOpen && (
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs text-text-dim">Trade name (slug)</span>
                      <input
                        type="text"
                        value={tradeName}
                        onChange={(e) => setTradeName(e.target.value)}
                        placeholder="carpentry"
                        className="mt-1 block w-full border border-ink-line bg-ink-card px-3 py-2 text-sm lowercase text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-text-dim">Display name</span>
                      <input
                        type="text"
                        value={tradeDisplay}
                        onChange={(e) => setTradeDisplay(e.target.value)}
                        placeholder="Carpentry"
                        className="mt-1 block w-full border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
                      />
                    </label>
                  </div>
                  <label className="flex items-start gap-3 text-sm text-text-sec">
                    <input
                      type="checkbox"
                      checked={tradeJobBased}
                      onChange={(e) => setTradeJobBased(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#FF5A1F]"
                    />
                    <span>
                      <span className="font-semibold text-text-pri">§2.1 gate —</span>{' '}
                      this trade quotes a discrete install / job, presented as
                      Good / Better / Best. Recurring-service trades (pool
                      cleaning, lawn care) are not supported.
                    </span>
                  </label>

                  {/* §7.5 trade-defaults — required for a new trade. */}
                  <div className="border-t border-ink-line pt-4">
                    <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                      Pricing defaults · §7.5
                    </p>
                    <p className="mt-1 text-xs text-text-dim">
                      Seeds every tenant&apos;s pricing book when they turn the
                      trade on — required.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {DEFAULTS_FIELDS.map((f) => (
                        <label key={f.key} className="block">
                          <span className="text-xs text-text-dim">
                            {f.label}
                            {f.required ? (
                              <span className="text-accent"> *</span>
                            ) : (
                              <span className="text-text-dim"> ({f.hint})</span>
                            )}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            value={tradeDefaults[f.key]}
                            onChange={(e) =>
                              setTradeDefaults((d) => ({
                                ...d,
                                [f.key]: e.target.value,
                              }))
                            }
                            className="mt-1 block w-full border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
                          />
                        </label>
                      ))}
                      <label className="block">
                        <span className="text-xs text-text-dim">
                          Licence label{' '}
                          <span className="text-text-dim">(optional)</span>
                        </span>
                        <input
                          type="text"
                          value={tradeDefaults.licenceLabel}
                          onChange={(e) =>
                            setTradeDefaults((d) => ({
                              ...d,
                              licenceLabel: e.target.value,
                            }))
                          }
                          placeholder="e.g. Carpenter licence"
                          className="mt-1 block w-full border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
                        />
                      </label>
                    </div>
                    <label className="mt-3 flex items-center gap-3 text-sm text-text-sec">
                      <input
                        type="checkbox"
                        checked={tradeGstRegistered}
                        onChange={(e) => setTradeGstRegistered(e.target.checked)}
                        className="h-4 w-4 accent-[#FF5A1F]"
                      />
                      <span>GST registered</span>
                    </label>
                  </div>

                  {/* §6 prompt pack — authored, optional at trade-creation. */}
                  <div className="border-t border-ink-line pt-4">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={promptPackOpen}
                        onChange={(e) => setPromptPackOpen(e.target.checked)}
                        className="h-4 w-4 accent-[#FF5A1F]"
                      />
                      <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                        Author the prompt pack now · §6
                      </span>
                    </label>
                    <p className="mt-1 text-xs text-text-dim">
                      Optional — the smoke-test is the backstop. Without an
                      estimator prompt the trade quotes generically until one is
                      authored.
                    </p>
                    {promptPackOpen && (
                      <div className="mt-3 space-y-3">
                        {PROMPT_FIELDS.map((f) => (
                          <label key={f.key} className="block">
                            <span className="text-xs text-text-dim">
                              {f.label}
                            </span>
                            <textarea
                              rows={f.rows}
                              value={tradePrompts[f.key]}
                              onChange={(e) =>
                                setTradePrompts((p) => ({
                                  ...p,
                                  [f.key]: e.target.value,
                                }))
                              }
                              placeholder={f.hint}
                              className="mt-1 block w-full resize-y border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mb-5">
              <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                Need the format? Download a template with the exact headers
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {(['services', 'materials', 'categories'] as const).map((t) => (
                  <a
                    key={t}
                    href={`/api/admin/loader/template?csv=${t}`}
                    className="inline-flex items-center gap-2 border border-ink-line bg-ink-deep px-3 py-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-sec transition-colors hover:border-accent/50 hover:text-text-pri"
                  >
                    <DownloadIcon />
                    {t}
                  </a>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['Services CSV', servicesFile, setServicesFile] as const,
                  ['Materials CSV', materialsFile, setMaterialsFile] as const,
                  ['Categories CSV', categoriesFile, setCategoriesFile] as const,
                ]
              ).map(([label, file, setFile]) => (
                <label
                  key={label}
                  className="block border border-ink-line bg-ink-deep px-4 py-4"
                >
                  <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                    {label}
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="mt-3 block w-full cursor-pointer text-sm text-text-sec file:mr-4 file:cursor-pointer file:border-0 file:bg-accent file:px-4 file:py-2 file:text-[0.7rem] file:font-semibold file:uppercase file:tracking-[0.1em] file:text-white hover:file:bg-accent-press"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  {file && (
                    <span className="mt-2 block font-mono text-xs text-teal-glow">
                      ✓ {file.name} · {(file.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                </label>
              ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleUpload}
              className={`mt-6 ${BTN_PRIMARY}`}
            >
              {busy ? 'Validating…' : 'Upload & preview'}
            </button>
          </StepCard>
        )}

        {/* ── Step 02 · Preview ────────────────────────────────────── */}
        {preview && (
          <StepCard n="02" title="Preview the diff">
            {createdTrade && (
              <div className="mb-6 border border-teal-glow/40 bg-teal-glow/10 px-4 py-3">
                <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-teal-glow">
                  New trade
                </span>
                <p className="mt-1 text-sm text-text-sec">
                  This batch creates the trade{' '}
                  <span className="font-semibold text-text-pri">{createdTrade}</span>
                  {' '}— it commits before its categories and services.
                </p>
              </div>
            )}
            {smokeFailed > 0 && (
              <div className="mb-6 border border-[#B91C1C]/55 bg-[#B91C1C]/12 px-4 py-3 text-sm leading-relaxed text-[#FCA5A5]">
                <span className="font-semibold uppercase tracking-wide">
                  {smokeFailed} service{smokeFailed === 1 ? '' : 's'} failed
                  the smoke-test
                </span>{' '}
                — their sample quote would not ground. They stay in staging
                and are <strong>not</strong> committed on Approve. Fix the
                flagged rows and re-upload.
              </div>
            )}
            <div className="space-y-8">
              {preview.map((p) => (
                <div key={p.csv}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-extrabold uppercase tracking-tight">
                      {p.csv}
                    </h3>
                    <span className="font-mono text-xs uppercase tracking-[0.12em] text-text-dim">
                      → {p.target_table}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Stat value={p.summary.newCount} label="New" colour="text-teal-glow" />
                    <Stat value={p.summary.updateCount} label="Update" colour="text-accent" />
                    <Stat value={p.summary.rejectedCount} label="Rejected" colour="text-[#FCA5A5]" />
                  </div>

                  {p.forcedDisabledCount > 0 && (
                    <p className="mt-3 font-mono text-xs text-text-dim">
                      {p.forcedDisabledCount} row(s) forced off — adding to a
                      trade with live tenants never auto-enables a service.
                    </p>
                  )}

                  {p.stagedRows.length > 0 && (
                    <div className="mt-4 overflow-x-auto border border-ink-line">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-ink-line bg-ink-deep font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                            <th className="px-3 py-2">Class</th>
                            <th className="px-3 py-2">Trade</th>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Price ex-GST</th>
                            <th className="px-3 py-2">Smoke</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.stagedRows.map((r, i) => (
                            <tr
                              key={i}
                              className="border-b border-ink-line/60 last:border-0"
                            >
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-block border px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] ${
                                    r.row_class === 'NEW'
                                      ? 'border-teal-glow/45 text-teal-glow'
                                      : 'border-accent/50 text-accent'
                                  }`}
                                >
                                  {r.row_class}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-text-sec">
                                {num(r.payload.trade)}
                              </td>
                              <td className="px-3 py-2 text-text-pri">
                                {num(r.payload.name)}
                                {r.smoke_status === 'failed' &&
                                  r.smoke_reason && (
                                    <span className="mt-0.5 block text-xs text-[#FCA5A5]">
                                      {r.smoke_reason}
                                    </span>
                                  )}
                              </td>
                              <td className="px-3 py-2 font-mono text-text-sec">
                                {num(r.payload.default_unit_price_ex_gst)}
                              </td>
                              <td className="px-3 py-2">
                                {r.smoke_status === 'passed' && (
                                  <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-teal-glow">
                                    Pass
                                  </span>
                                )}
                                {r.smoke_status === 'failed' && (
                                  <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-[#FCA5A5]">
                                    Fail
                                  </span>
                                )}
                                {(!r.smoke_status ||
                                  r.smoke_status === 'skipped') && (
                                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {p.rejected.length > 0 && (
                    <div className="mt-4 border border-[#B91C1C]/45 bg-[#B91C1C]/10 px-4 py-3">
                      <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#FCA5A5]">
                        Rejected — not staged
                      </p>
                      <ul className="mt-1.5 space-y-1 text-sm text-text-sec">
                        {p.rejected.map((r) => (
                          <li key={r.line}>
                            <span className="font-mono text-text-dim">
                              Line {r.line}
                            </span>{' '}
                            — {r.errors.join(' ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </StepCard>
        )}

        {/* ── Step 03 · Commit ─────────────────────────────────────── */}
        {batchId && (
          <StepCard n="03" title="Commit or roll back">
            <div className="flex flex-wrap items-center gap-3">
              {batchStatus === 'staged' && (
                <button
                  type="button"
                  disabled={busy || totalStaged === 0}
                  onClick={handleApprove}
                  className={BTN_PRIMARY}
                >
                  {busy ? 'Working…' : `Approve & commit (${totalStaged})`}
                </button>
              )}
              {batchStatus === 'committed' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRollback}
                  className={BTN_DANGER}
                >
                  {busy ? 'Working…' : 'Roll back this batch'}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={resetAll}
                className={BTN_GHOST}
              >
                {batchStatus === 'committed' || batchStatus === 'rolled_back'
                  ? 'New upload'
                  : 'Cancel'}
              </button>
            </div>
            <p className="mt-4 font-mono text-xs uppercase tracking-[0.1em] text-text-dim">
              Batch {batchId.slice(0, 8)} · {batchStatus}
            </p>
          </StepCard>
        )}
      </div>

      {/* ── Orange accent bar — the Maintain closing full-stop ─────── */}
      <div className="relative z-10 mt-8 bg-accent">
        <p className="mx-auto max-w-5xl px-6 py-3.5 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-white">
          Staging-safe · no live table is written until you approve
        </p>
      </div>
    </main>
  )
}
