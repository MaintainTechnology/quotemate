'use client'

// One plan takeoff (TKO-19, Design Brief §4.3): the run's header and stage,
// then its checks, takeoff, sheets and outputs. A run being read refreshes
// itself every five seconds until it settles.

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import type { PriceOutcome, RunDetail } from '@/lib/roofing/plan-takeoff'
import { Chip, Notice, PRIMARY, SECONDARY, Table, TakeoffsOff } from '../_components/parts'
import {
  CHECK_NAMES,
  checkChip,
  isPreliminary,
  reviewLine,
  STAGES,
  statusChip,
  TAKEOFF_API_URL,
  takeoffApi,
} from '../takeoff-api'

type Preview = Omit<Extract<PriceOutcome, { ok: true }>, 'ok'>
type Saved = { run_id: string; status: 'saved'; measurement_id: string; measure_url: string }
type Tab = 'checks' | 'takeoff' | 'sheets' | 'outputs'

const READING = ['queued', 'extracting']
const SETTLED = ['ready', 'needs_review', 'saved']
const TABS: Array<[Tab, string]> = [
  ['checks', 'Checks'],
  ['takeoff', 'Takeoff'],
  ['sheets', 'Sheets'],
  ['outputs', 'Outputs'],
]
const ROW = 'border-b border-ink-line last:border-0'
const CELL = 'px-4 py-2.5'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const measure = (n: number | null, unit: string) => (n === null ? '—' : `${n}${unit}`)

export default function TakeoffRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <FeatureGate slug="roofing" featureLabel="plan takeoffs">
      {TAKEOFF_API_URL ? <Run id={id} /> : <TakeoffsOff />}
    </FeatureGate>
  )
}

function Run({ id }: { id: string }) {
  const [run, setRun] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('checks')
  const load = useCallback(
    () => takeoffApi<RunDetail>(`/api/takeoff/runs/${encodeURIComponent(id)}`).then(setRun, (e: unknown) => setError(message(e))),
    [id],
  )
  useEffect(() => {
    void load()
  }, [load])
  const reading = run !== null && READING.includes(run.status)
  useEffect(() => {
    if (!reading) return
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [reading, load])

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-10">
        <Notice tone="danger">{error}</Notice>
      </main>
    )
  }
  if (!run) return <main className="mx-auto max-w-6xl px-5 py-10 text-text-dim">Loading the takeoff…</main>

  const fails = run.checks?.results.filter((check) => check.result === 'fail').length ?? 0
  const preliminary = (run.sheet_index ?? []).some((sheet) => sheet.used && isPreliminary(sheet.status_text))
  const sheets = run.sheet_index?.length ?? 0
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-10">
      <Link href="/dashboard/roofing/takeoffs" className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-text-pri">
        <span aria-hidden="true">← </span>Takeoffs
      </Link>
      <header className="rounded-card space-y-4 border border-ink-line bg-ink-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent">{run.job_ref ?? 'Plan takeoff'}</div>
            <h1 className="mt-2 text-2xl font-extrabold uppercase tracking-[-0.02em] text-text-pri">{run.site_address}</h1>
            {run.job_name ? <p className="mt-1 text-text-sec">{run.job_name}</p> : null}
          </div>
          <Chip chip={statusChip(run.status)} />
        </div>
        <Stepper run={run} />
        {reading ? (
          <p className="text-text-sec">{sheets ? `Reading ${sheets} sheets.` : 'Reading the plans.'} This usually takes 3 to 6 minutes.</p>
        ) : null}
        {run.status === 'failed' && run.status_note ? <Notice tone="danger">{run.status_note}</Notice> : null}
        {run.status === 'needs_review' && fails ? <Notice tone="warning">{reviewLine(fails)}</Notice> : null}
        {preliminary ? <Notice tone="warning">These drawings are marked preliminary. Confirm the current revision with the builder.</Notice> : null}
      </header>
      <div role="tablist" aria-label="Takeoff" className="flex flex-wrap gap-1 border-b border-ink-line">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
            className={`-mb-px min-h-11 border-b-2 px-4 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] ${tab === key ? 'border-accent text-text-pri' : 'border-transparent text-text-dim hover:text-text-pri'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'checks' ? (
          <Checks run={run} />
        ) : tab === 'takeoff' ? (
          <Takeoff run={run} />
        ) : tab === 'sheets' ? (
          <Sheets run={run} />
        ) : (
          <Outputs run={run} onSaved={() => void load()} />
        )}
      </section>
    </main>
  )
}

/** The six stages with the current one lit: a list, so it is announced. */
function Stepper({ run }: { run: RunDetail }) {
  const current = SETTLED.includes(run.status) ? STAGES.length - 1 : STAGES.findIndex(([stage]) => stage === run.stage)
  const failed = run.status === 'failed'
  return (
    <ol aria-label="Stages" className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em]">
      {STAGES.map(([stage, label], i) => (
        <li
          key={stage}
          aria-current={i === current ? 'step' : undefined}
          className={i === current ? (failed ? 'text-danger-bright' : 'text-accent') : i < current ? 'text-text-sec' : 'text-text-dim'}
        >
          {i > 0 ? (
            <span aria-hidden="true" className="mr-2 text-text-dim">
              ·
            </span>
          ) : null}
          {label}
          {i === current && failed ? ' (failed)' : ''}
        </li>
      ))}
    </ol>
  )
}

function Checks({ run }: { run: RunDetail }) {
  const results = run.checks?.results ?? []
  if (!results.length) return <p className="text-text-dim">The checks run once the plans are read.</p>
  return (
    <Table head={['Check', 'Result', 'Reason']}>
      {results.map((check) => (
        <tr key={check.id} className={ROW}>
          <td className={CELL}>
            <span className="mr-2 font-mono text-text-dim">{check.id}</span>
            <span className="text-text-pri">{CHECK_NAMES[check.id] ?? ''}</span>
          </td>
          <td className={CELL}>
            <Chip chip={checkChip(check.result)} />
          </td>
          <td className={`${CELL} text-text-sec`}>{check.detail}</td>
        </tr>
      ))}
    </Table>
  )
}

function Takeoff({ run }: { run: RunDetail }) {
  const takeoff = run.takeoff
  if (!takeoff) return <p className="text-text-dim">No takeoff yet.</p>
  return (
    <div className="space-y-6">
      {/* ponytail: read-only. Corrections go through the API's PATCH; the
          brief's inline edits come with the editor. */}
      {run.corrected ? <Notice tone="neutral">This is the corrected takeoff.</Notice> : null}
      {takeoff.structures.map((structure, i) => (
        <article key={structure.id} className="rounded-card space-y-4 border border-ink-line bg-ink-card p-5">
          <h2 className="font-extrabold uppercase tracking-[-0.01em] text-text-pri">
            <span className="mr-3 font-mono text-accent">{String(i + 1).padStart(2, '0')}</span>
            {structure.label}
          </h2>
          <Table head={['Plane', 'Dimensions', 'Plan area', 'Pitch', 'Profile', 'Fall', 'Confidence']}>
            {structure.planes.map((plane) => (
              <tr key={plane.id} className={ROW}>
                <td className={`${CELL} font-mono text-text-pri`}>{plane.id}</td>
                <td className={`${CELL} font-mono tabular-nums text-text-sec`}>
                  {plane.plan_dims_mm ? `${plane.plan_dims_mm[0]} × ${plane.plan_dims_mm[1]} mm` : '—'}
                </td>
                <td className={`${CELL} font-mono tabular-nums text-text-sec`}>{measure(plane.plan_area_m2, ' m²')}</td>
                <td className={`${CELL} font-mono tabular-nums text-text-sec`}>{measure(plane.pitch_deg, '°')}</td>
                <td className={`${CELL} text-text-sec`}>{plane.profile ?? '—'}</td>
                <td className={`${CELL} text-text-sec`}>{plane.fall ?? '—'}</td>
                <td className={`${CELL} font-mono text-text-sec`}>{plane.confidence}</td>
              </tr>
            ))}
          </Table>
          {structure.edges.length ? (
            <Table head={['Edge', 'Length', 'Source']}>
              {structure.edges.map((edge, j) => (
                <tr key={`${edge.type}-${j}`} className={ROW}>
                  <td className={`${CELL} text-text-sec`}>{edge.type.replace(/_/g, ' ')}</td>
                  <td className={`${CELL} font-mono tabular-nums text-text-sec`}>{measure(edge.length_m, ' m')}</td>
                  <td className={`${CELL} font-mono text-text-dim`}>{edge.source}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-sm text-text-dim">No edges read for this roof.</p>
          )}
          {structure.exclusions.length ? (
            <ul className="space-y-1 text-sm text-text-sec">
              {structure.exclusions.map((excluded) => (
                <li key={excluded.label}>
                  Excluded: {excluded.label}. {excluded.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function Sheets({ run }: { run: RunDetail }) {
  const sheets = run.sheet_index ?? []
  if (!sheets.length) return <p className="text-text-dim">The sheets are sorted once the files are checked.</p>
  return (
    <Table head={['Number', 'Title', 'Revision', 'Kind', 'Read']}>
      {sheets.map((sheet) => (
        <tr key={`${sheet.file}:${sheet.page}`} className={ROW}>
          <td className={`${CELL} font-mono text-text-pri`}>{sheet.number ?? '—'}</td>
          <td className={`${CELL} text-text-sec`}>
            <span className="mr-2">{sheet.title ?? '—'}</span>
            {isPreliminary(sheet.status_text) ? <Chip chip={{ words: 'Preliminary', icon: '!', tone: 'warning' }} /> : null}
          </td>
          <td className={`${CELL} font-mono text-text-sec`}>{sheet.revision ?? '—'}</td>
          <td className={`${CELL} font-mono text-text-dim`}>{sheet.kind.replace(/_/g, ' ')}</td>
          <td className={`${CELL} text-text-sec`}>{sheet.used ? 'Yes' : ''}</td>
        </tr>
      ))}
    </Table>
  )
}

/** One output: what it does in a line, then its action. */
function Output({ title, line, children }: { title: string; line: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card space-y-3 border border-ink-line bg-ink-card p-5">
      <h2 className="font-extrabold uppercase tracking-[-0.01em] text-text-pri">{title}</h2>
      <p className="text-sm text-text-sec">{line}</p>
      {children}
    </div>
  )
}

function Outputs({ run, onSaved }: { run: RunDetail; onSaved: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState<'price' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!SETTLED.includes(run.status) || !run.takeoff) {
    return <p className="text-text-dim">The outputs open once the plans are read and checked.</p>
  }
  const review = run.status === 'needs_review'

  async function price() {
    setBusy('price')
    setError(null)
    try {
      setPreview(await takeoffApi<Preview>(`/api/takeoff/runs/${run.run_id}/price`, { method: 'POST', body: {} }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }
  async function save() {
    setBusy('save')
    setError(null)
    try {
      setSaved(await takeoffApi<Saved>(`/api/takeoff/runs/${run.run_id}/save`, { method: 'POST', body: review ? { accept_review: true } : {} }))
      onSaved()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {/* TKO-18: the pack waits on the format Roof Wizard imports (D-01). */}
      <Output title="Export Roof Wizard pack" line="The outline, quantities and roof brief for the supplier. It waits on the Roof Wizard format.">
        <button type="button" className={SECONDARY} disabled>
          Export pack
        </button>
      </Output>
      <Output title="Price preview" line="The roofs on your own rate card, priced as a re-roof: there is no new-roof price yet. Nothing is saved.">
        <button type="button" className={SECONDARY} disabled={busy !== null} onClick={() => void price()}>
          {busy === 'price' ? 'Pricing…' : 'Price preview'}
        </button>
        {preview ? <PreviewTable preview={preview} /> : null}
      </Output>
      <Output title="Save to measurement" line="Saves the priced roofs as a measurement you can open, adjust and share from /m.">
        {review ? (
          <label className="flex min-h-11 items-center gap-3 text-text-sec">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="size-4 accent-accent" />
            Accept the failed checks and save anyway
          </label>
        ) : null}
        <button type="button" className={PRIMARY} disabled={busy !== null || (review && !accepted)} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : run.status === 'saved' ? 'Show the /m link' : 'Save to measurement'}
        </button>
        {saved ? (
          <p role="status" className="text-text-sec">
            Saved.{' '}
            <a href={saved.measure_url} className="text-accent underline underline-offset-4">
              Open the measurement on /m
            </a>
          </p>
        ) : null}
      </Output>
    </div>
  )
}

function PreviewTable({ preview }: { preview: Preview }) {
  return (
    <div className="space-y-3">
      {preview.quote ? (
        <>
          <Table head={['All roofs', 'Inc GST']}>
            {preview.quote.combined.tiers.map((tier) => (
              <tr key={tier.tier} className={ROW}>
                <td className={`${CELL} text-text-sec`}>{tier.label}</td>
                <td className={`${CELL} font-mono tabular-nums text-text-pri`}>{money(tier.inc_gst)}</td>
              </tr>
            ))}
          </Table>
          <p className="text-sm text-text-dim">{preview.quote.routing.reason}</p>
        </>
      ) : null}
      {preview.unpriced.length ? (
        <Notice tone="warning">
          Not priced: {preview.unpriced.map((roof) => `${roof.structure_id} (${roof.reason})`).join('; ')}
        </Notice>
      ) : null}
    </div>
  )
}
