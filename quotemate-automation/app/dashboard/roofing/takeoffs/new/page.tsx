'use client'

// New plan takeoff (TKO-19, Design Brief §4.2): the job on the left, the
// plans on the right. Uploading creates the draft run and sends each PDF
// straight to storage; Start takeoff queues the run once every file is in.

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FeatureGate } from '@/app/dashboard/_components/FeatureGate'
import { AddressAutocomplete } from '@/app/dashboard/roofing/_components/AddressAutocomplete'
import { getAuthToken } from '@/lib/auth/client-token'
import type { CreatedRun } from '@/lib/roofing/plan-takeoff'
import { Notice, PRIMARY, SECONDARY, TakeoffsOff } from '../_components/parts'
import { TAKEOFF_API_URL, takeoffApi, uploadFile } from '../takeoff-api'

type DocType = 'plan_set' | 'engineering' | 'other'
type Plan = {
  file: File
  doc_type: DocType
  /** Why the file can't be sent: it stays listed, and is never uploaded. */
  problem?: string
  state: 'waiting' | 'uploading' | 'done' | 'failed'
  progress: number
  reason?: string
}

// Service Spec §10: PDFs only, 50 MB a file, 10 files a run.
const MAX_MB = 50
const MAX_FILES = 10
const DOC_TYPES: Array<[DocType, string]> = [
  ['plan_set', 'Plan set'],
  ['engineering', 'Engineering'],
  ['other', 'Other'],
]
const FIELD = 'rounded-ctl w-full border border-ink-line bg-ink-deep px-3 py-2.5 text-text-pri placeholder:text-text-dim focus:border-accent'
const LABEL = 'block font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-dim'
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function NewTakeoffPage() {
  return (
    <FeatureGate slug="roofing" featureLabel="plan takeoffs">
      {TAKEOFF_API_URL ? <NewTakeoff /> : <TakeoffsOff />}
    </FeatureGate>
  )
}

function NewTakeoff() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [jobRef, setJobRef] = useState('')
  const [builder, setBuilder] = useState('')
  const [scope, setScope] = useState('')
  const [plans, setPlans] = useState<Plan[]>([])
  const [run, setRun] = useState<CreatedRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    void getAuthToken().then(setToken)
  }, [])

  // A run's files are fixed when it is created, so the list locks then.
  const locked = busy || run !== null
  const sendable = plans.filter((plan) => !plan.problem)
  const allIn = run !== null && sendable.length > 0 && sendable.every((plan) => plan.state === 'done')

  function add(files: FileList | null) {
    if (!files || locked) return
    const added = [...files].map(
      (file): Plan => ({
        file,
        doc_type: 'plan_set',
        state: 'waiting',
        progress: 0,
        problem: !/\.pdf$/i.test(file.name)
          ? 'Only PDF files can be read'
          : file.size > MAX_MB * 1024 * 1024
            ? `Larger than ${MAX_MB} MB`
            : undefined,
      }),
    )
    setPlans((current) => [...current, ...added])
  }
  const patch = (index: number, change: Partial<Plan>) =>
    setPlans((current) => current.map((plan, i) => (i === index ? { ...plan, ...change } : plan)))

  async function upload() {
    setError(null)
    if (!address.trim()) return setError('Add the site address first.')
    if (!sendable.length) return setError('Add at least one PDF of the plans.')
    if (sendable.length > MAX_FILES) return setError(`A takeoff takes at most ${MAX_FILES} files.`)
    setBusy(true)
    try {
      const created =
        run ??
        (await takeoffApi<CreatedRun>('/api/takeoff/runs', {
          method: 'POST',
          body: {
            site_address: address.trim(),
            job_ref: jobRef.trim() || undefined,
            scope_note: scope.trim() || undefined,
            builder: builder.trim() ? { business: builder.trim() } : undefined,
            files: sendable.map((plan) => ({ filename: plan.file.name, size_bytes: plan.file.size, doc_type: plan.doc_type })),
          },
        }))
      setRun(created)
      // The run's uploads follow the files' order in the request.
      for (const [i, target] of created.uploads.entries()) {
        const plan = sendable[i]
        const index = plans.indexOf(plan)
        if (plan.state === 'done') continue
        patch(index, { state: 'uploading', progress: 0, reason: undefined })
        try {
          await uploadFile(target.signed_url, plan.file, (progress) => patch(index, { progress }))
          patch(index, { state: 'done', progress: 1 })
        } catch (e) {
          patch(index, { state: 'failed', reason: message(e) })
        }
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      await takeoffApi(`/api/takeoff/runs/${run.run_id}/start`, { method: 'POST' })
      router.push(`/dashboard/roofing/takeoffs/${run.run_id}`)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-5 py-10">
      <header>
        <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent">Roofing · Plan takeoffs</div>
        <h1 className="mt-2 text-3xl font-extrabold uppercase tracking-[-0.02em] text-text-pri">New takeoff</h1>
      </header>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-8 lg:grid-cols-2">
        <fieldset disabled={locked} className="space-y-5">
          <legend className="sr-only">The job</legend>
          <div className="space-y-2">
            <label htmlFor="site_address" className={LABEL}>
              Site address
            </label>
            <AddressAutocomplete
              id="site_address"
              accessToken={token}
              value={address}
              onChange={setAddress}
              onSelect={(suggestion) => setAddress(suggestion.address)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="job_ref" className={LABEL}>
              Job reference
            </label>
            <input id="job_ref" className={`${FIELD} font-mono`} value={jobRef} maxLength={100} onChange={(e) => setJobRef(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="builder" className={LABEL}>
              Builder business
            </label>
            <input id="builder" className={FIELD} value={builder} maxLength={200} onChange={(e) => setBuilder(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="scope_note" className={LABEL}>
              Scope note
            </label>
            <textarea
              id="scope_note"
              rows={5}
              className={FIELD}
              value={scope}
              maxLength={2000}
              placeholder="Pasted word for word from the request"
              onChange={(e) => setScope(e.target.value)}
            />
          </div>
        </fieldset>

        <div className="space-y-4">
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              add(e.dataTransfer.files)
            }}
            className={`rounded-card flex min-h-40 flex-col items-center justify-center gap-2 border border-dashed p-6 text-center focus-within:ring-2 focus-within:ring-accent ${dragging ? 'border-accent' : 'border-ink-line'} ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          >
            <span className="font-semibold text-text-pri">Drop PDF plans here, or browse</span>
            <span className="text-sm text-text-sec">Add every sheet you have. Roof plans, elevations, sections and engineering all help.</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={locked}
              className="sr-only"
              onChange={(e) => {
                add(e.target.files)
                e.target.value = ''
              }}
            />
          </label>

          {plans.length ? (
            <ul className="space-y-2">
              {plans.map((plan, i) => (
                <li key={`${plan.file.name}-${i}`} className="rounded-ctl space-y-2 border border-ink-line bg-ink-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-text-pri">{plan.file.name}</div>
                      <div className="font-mono text-xs tabular-nums text-text-dim">{megabytes(plan.file.size)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="sr-only" htmlFor={`doc_type_${i}`}>
                        Document type of {plan.file.name}
                      </label>
                      <select
                        id={`doc_type_${i}`}
                        value={plan.doc_type}
                        disabled={locked || Boolean(plan.problem)}
                        onChange={(e) => patch(i, { doc_type: e.target.value as DocType })}
                        className="rounded-ctl min-h-11 border border-ink-line bg-ink-deep px-2 text-sm text-text-pri"
                      >
                        {DOC_TYPES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {locked ? null : (
                        <button
                          type="button"
                          className="min-h-11 px-2 text-sm text-text-dim hover:text-text-pri"
                          onClick={() => setPlans((current) => current.filter((_, j) => j !== i))}
                        >
                          Remove <span className="sr-only">{plan.file.name}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {plan.problem ? (
                    <p className="text-sm text-danger-bright">
                      <span aria-hidden="true">× </span>
                      {plan.problem}
                    </p>
                  ) : plan.state === 'done' ? (
                    <p className="text-sm text-success-bright">
                      <span aria-hidden="true">✓ </span>Uploaded
                    </p>
                  ) : plan.state === 'failed' ? (
                    <p className="text-sm text-danger-bright">
                      <span aria-hidden="true">× </span>
                      {plan.reason}
                    </p>
                  ) : plan.state === 'uploading' ? (
                    <progress value={plan.progress} max={1} className="h-1.5 w-full accent-accent" aria-label={`Uploading ${plan.file.name}`} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button type="button" className={SECONDARY} disabled={busy || allIn} onClick={() => void upload()}>
              {busy && run === null ? 'Uploading…' : run ? 'Retry the uploads' : 'Upload plans'}
            </button>
            <button type="button" className={PRIMARY} disabled={!allIn || busy} onClick={() => void start()}>
              Start takeoff
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
