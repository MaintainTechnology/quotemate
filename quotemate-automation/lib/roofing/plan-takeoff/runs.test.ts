// Takeoff runs (P2, TKO-08) over the in-memory client in test-db.ts, which
// filters rows for real, so tenant scoping and the compare-and-set on status
// are exercised rather than assumed.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { runChecks, type Checks } from './checks'
import {
  correctTakeoff, createRun, deleteRun, getRun, listRuns, runFilePath, stageWorkKey, startRun, sweepExpiredRuns, type NewRun,
} from './runs'
import { RoofPlanTakeoffSchema } from './schema'
import { fakeDb, type Row } from './test-db'

const TENANT = '0b8f6c1e-2d4a-4f5b-9c3d-7e1a2b3c4d5e'
const OTHER_TENANT = '5e4d3c2b-1a2b-4c3d-9e8f-0a1b2c3d4e5f'

describe('paths and work keys', () => {
  it('keeps every file under its tenant and run, and gives each stage and restart its own key', () => {
    expect(runFilePath(TENANT, 'run-1', 'upload-1')).toBe(`roofing/${TENANT}/run-1/upload-1.pdf`)
    expect(stageWorkKey('run-1', 'intake', 0)).toBe('takeoff:run-1:intake:0')
    expect(stageWorkKey('run-1', 'extract', 2, 'A101')).toBe('takeoff:run-1:extract:A101:2')
  })
})

describe('createRun', () => {
  const request: NewRun = {
    tenantId: TENANT,
    site_address: '12 Sample St, Exampleton QLD 4305',
    job_ref: 'J10001',
    files: [
      { filename: 'Architectural.pdf', size_bytes: 17_294_476, doc_type: 'plan_set' },
      { filename: 'Engineering.pdf', size_bytes: 2_435_777, doc_type: 'engineering' },
    ],
  }

  it('creates a draft run with a roofing upload row and a signed URL per file, in request order', async () => {
    const fake = fakeDb()
    const created = await createRun(fake.db, 'plan-pdfs', request)

    expect(fake.tables.roof_takeoff_runs).toEqual([expect.objectContaining({
      id: created.run_id, tenant_id: TENANT, source: 'dashboard', site_address: request.site_address, job_ref: 'J10001', job_name: null, builder: null,
    })])
    const uploads = fake.tables.plan_uploads
    expect(uploads.map((row) => [row.filename, row.trade, row.doc_type, row.takeoff_run_id, row.tenant_id])).toEqual([
      ['Architectural.pdf', 'roofing', 'plan_set', created.run_id, TENANT],
      ['Engineering.pdf', 'roofing', 'engineering', created.run_id, TENANT],
    ])
    const paths = uploads.map((row) => runFilePath(TENANT, created.run_id, String(row.id)))
    expect(uploads.map((row) => row.pdf_path)).toEqual(paths)
    expect(created).toEqual({
      run_id: created.run_id,
      status: 'draft',
      uploads: uploads.map((row, i) => ({
        plan_upload_id: row.id,
        path: paths[i],
        signed_url: expect.stringContaining(paths[i]),
        expires_in: 7200,
      })),
    })
    expect(fake.signed.map((call) => [call.bucket, call.options])).toEqual([
      ['plan-pdfs', { upsert: false }],
      ['plan-pdfs', { upsert: false }],
    ])
  })

  it('takes the run id and source a caller gives, as TAG intake does', async () => {
    const fake = fakeDb()
    const runId = '8d1f0a2b-3c4d-8e5f-9a6b-7c8d9e0f1a2b'
    const created = await createRun(fake.db, 'plan-pdfs', { ...request, runId, source: 'tag_email' })
    expect(created.run_id).toBe(runId)
    expect(fake.tables.roof_takeoff_runs).toEqual([expect.objectContaining({ id: runId, source: 'tag_email' })])
    expect(fake.tables.plan_uploads.map((row) => row.pdf_path)).toEqual(created.uploads.map((upload) => upload.path))
    expect(created.uploads.every((upload) => upload.path.startsWith(`roofing/${TENANT}/${runId}/`))).toBe(true)
  })

  it.each(['uploadRows', 'signing'] as const)('deletes the run again when %s fails', async (step) => {
    const fake = fakeDb()
    fake.fail[step] = true
    await expect(createRun(fake.db, 'plan-pdfs', request)).rejects.toThrow(/failed/)
    expect(fake.tables.roof_takeoff_runs).toEqual([])
    expect(fake.tables.plan_uploads).toEqual([])
  })
})

describe('startRun', () => {
  const RUN = '9a7b5c3d-1e2f-4a6b-8c0d-2e4f6a8b0c1d'
  const NOW = new Date('2026-11-01T10:00:00.000Z')
  const file = { id: 'upload-1', tenant_id: TENANT, takeoff_run_id: RUN, filename: 'Architectural.pdf', size_bytes: 1000 }
  const uploaded = { [runFilePath(TENANT, RUN, 'upload-1')]: 1000 }
  const run = (patch: Row = {}): Row => ({
    id: RUN, tenant_id: TENANT, status: 'draft', stage: null, status_note: null, usage: null,
    updated_at: '2026-11-01T09:00:00.000Z', ...patch,
  })
  const start = (fake: ReturnType<typeof fakeDb>, options: { runsPerHour?: number; tenantId?: string } = {}) =>
    startRun(fake.db, 'plan-pdfs', { tenantId: options.tenantId ?? TENANT, runId: RUN, runsPerHour: options.runsPerHour ?? 8, now: NOW })
  const enqueued = (fake: ReturnType<typeof fakeDb>) => fake.rpc.mock.calls.map(([, params]) => params)

  it('queues a draft run at intake and enqueues its first stage', async () => {
    const fake = fakeDb({ runs: [run()], uploads: [file], objects: uploaded })
    await expect(start(fake)).resolves.toEqual({ ok: true, run_id: RUN, status: 'queued', stage: 'intake' })
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'queued', stage: 'intake', usage: { starts: [NOW.toISOString()] } })

    const [job] = enqueued(fake)
    expect(job).toMatchObject({
      p_key: `takeoff:${RUN}:intake:0`, p_kind: 'plan', p_serial_key: `takeoff:${RUN}`,
      p_service: 'roofing-takeoff', p_tenant_id: TENANT, p_turn_id: RUN,
    })
    const payload = job.p_payload as { url: string; body: string }
    expect(new URL(payload.url).pathname).toBe('/api/takeoff/internal/process')
    expect(JSON.parse(payload.body)).toEqual({ run_id: RUN, stage: 'intake' })
  })

  it('restarts a failed run from the stage that failed, under its next work key', async () => {
    const fake = fakeDb({
      runs: [run({ status: 'failed', stage: 'extract', status_note: 'The model timed out', usage: { starts: ['2026-11-01T07:00:00.000Z'] } })],
      uploads: [file],
      objects: uploaded,
    })
    await expect(start(fake)).resolves.toMatchObject({ ok: true, stage: 'extract' })
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'queued', stage: 'extract', status_note: null })
    expect(enqueued(fake)[0].p_key).toBe(`takeoff:${RUN}:extract:1`)
  })

  it("answers not_found for another tenant's run", async () => {
    const fake = fakeDb({ runs: [run()], uploads: [file], objects: uploaded })
    await expect(start(fake, { tenantId: OTHER_TENANT })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it.each(['queued', 'extracting', 'ready', 'needs_review', 'saved'])('refuses to start a %s run', async (status) => {
    const fake = fakeDb({ runs: [run({ status })], uploads: [file], objects: uploaded })
    await expect(start(fake)).resolves.toEqual({ ok: false, error: 'conflict_status', status })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('names each file that is missing or not at its declared size', async () => {
    const second = { ...file, id: 'upload-2', filename: 'Engineering.pdf', size_bytes: 500 }
    const fake = fakeDb({ runs: [run()], uploads: [file, second], objects: { [runFilePath(TENANT, RUN, 'upload-2')]: 499 } })
    await expect(start(fake)).resolves.toEqual({
      ok: false,
      error: 'files_missing',
      files: [
        { plan_upload_id: 'upload-1', filename: 'Architectural.pdf', problem: 'missing' },
        { plan_upload_id: 'upload-2', filename: 'Engineering.pdf', problem: 'wrong_size' },
      ],
    })
    expect(fake.tables.roof_takeoff_runs[0].status).toBe('draft')
  })

  it('counts the last hour of starts across the tenant, from the ledger, and says when a slot frees up', async () => {
    const starts = [
      // 08:00 is more than an hour before 10:00; 09:10 and 09:40 count, the
      // second though its run has since been deleted (TKO-28).
      { tenant_id: TENANT, run_id: 'run-2', started_at: '2026-11-01T08:00:00.000Z' },
      { tenant_id: TENANT, run_id: 'run-2', started_at: '2026-11-01T09:10:00.000Z' },
      { tenant_id: TENANT, run_id: 'deleted-run', started_at: '2026-11-01T09:40:00.000Z' },
      { tenant_id: OTHER_TENANT, run_id: 'run-4', started_at: '2026-11-01T09:50:00.000Z' },
    ]
    const limited = fakeDb({ runs: [run()], uploads: [file], objects: uploaded, starts: structuredClone(starts) })
    await expect(start(limited, { runsPerHour: 2 })).resolves.toEqual({
      ok: false, error: 'rate_limited', retry_at: '2026-11-01T10:10:00.000Z',
    })
    expect(limited.rpc).not.toHaveBeenCalled()

    const allowed = fakeDb({ runs: [run()], uploads: [file], objects: uploaded, starts: structuredClone(starts) })
    await expect(start(allowed, { runsPerHour: 3 })).resolves.toMatchObject({ ok: true })
  })

  it('writes each start to the ledger, which outlives the run (TKO-28)', async () => {
    const fake = fakeDb({ runs: [run()], uploads: [file], objects: uploaded })
    await expect(start(fake)).resolves.toMatchObject({ ok: true })
    expect(fake.tables.roof_takeoff_starts).toEqual([expect.objectContaining({ tenant_id: TENANT, run_id: RUN, started_at: NOW.toISOString() })])

    // Deleting the run leaves its start counted: a new run can't start past the limit.
    await deleteRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN })
    expect(fake.tables.roof_takeoff_starts).toHaveLength(1)
    fake.tables.roof_takeoff_runs.push(run())
    fake.objects[runFilePath(TENANT, RUN, 'upload-1')] = 1000
    fake.tables.plan_uploads.push(file)
    await expect(start(fake, { runsPerHour: 1 })).resolves.toMatchObject({ ok: false, error: 'rate_limited' })
  })

  it('puts the run back when the ledger refuses the start, and enqueues nothing', async () => {
    const fake = fakeDb({ runs: [run()], uploads: [file], objects: uploaded })
    fake.fail.ledger = true
    await expect(start(fake)).rejects.toThrow('ledger refused')
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'draft', stage: null })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('reports conflict_status when another start wins the race', async () => {
    const fake = fakeDb({ runs: [run()], uploads: [file], objects: uploaded })
    // Another start lands while this one checks the files.
    fake.hooks.onList = () => { fake.tables.roof_takeoff_runs[0].status = 'queued' }
    await expect(start(fake)).resolves.toEqual({ ok: false, error: 'conflict_status' })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('puts the run back when the enqueue fails, and the retry gets a fresh work key', async () => {
    const fake = fakeDb({ runs: [run()], uploads: [file], objects: uploaded })
    fake.fail.enqueue = true
    await expect(start(fake)).rejects.toThrow('queue down')
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'draft', stage: null, usage: { starts: [NOW.toISOString()] } })

    fake.fail.enqueue = false
    await expect(start(fake)).resolves.toMatchObject({ ok: true })
    expect(enqueued(fake).map((job) => job.p_key)).toEqual([`takeoff:${RUN}:intake:0`, `takeoff:${RUN}:intake:1`])
  })
})

// Grange's hand-measured takeoff (DEC-012), which checks C1 to C8 pass. The
// model's version leaves one pitch unread, so C5 fails it.
const GRANGE = RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync('eval/roof-takeoff/grange/takeoff.json', 'utf8')))
const MISREAD = structuredClone(GRANGE)
Object.assign(MISREAD.structures[0].planes[0], { pitch_deg: null, pitch_source: null, sloped_area_m2: null })
const SCOPE = 'Roofing - Steel (Supply & Fit)'
const SCHEDULE = [{ label: 'PROPOSED DUAL OCCUPANCY FOOTPRINT', m2: 233, file: 'Architectural.pdf', page: 1 }]

describe('listRuns and getRun', () => {
  const run = (id: string, hour: number, patch: Row = {}): Row => ({
    id, tenant_id: TENANT, status: 'ready', stage: 'persist', status_note: null, site_address: `${hour} Example St`,
    job_name: null, job_ref: null, scope_note: null, sheet_index: [], checks: null, latest_extraction_id: null,
    usage: { starts: [] }, created_at: `2026-11-01T0${hour}:00:00.000000+00:00`, updated_at: '2026-11-01T09:00:00.000Z',
    completed_at: null, ...patch,
  })

  it("pages a tenant's runs newest first, and never shows another tenant's", async () => {
    const fake = fakeDb({ runs: [run('run-1', 1), run('run-2', 2), run('run-3', 3), run('run-x', 4, { tenant_id: OTHER_TENANT })] })
    const first = await listRuns(fake.db, { tenants: [TENANT], limit: 2 })
    expect(first.runs.map((r) => r.run_id)).toEqual(['run-3', 'run-2'])
    expect(first.runs[0]).not.toHaveProperty('usage')
    await expect(listRuns(fake.db, { tenants: [TENANT], limit: 2, before: first.next ?? undefined })).resolves.toEqual({
      runs: [expect.objectContaining({ run_id: 'run-1', site_address: '1 Example St' })],
      next: null,
    })
    const all = await listRuns(fake.db, { tenants: 'all', limit: 10 })
    expect(all.runs.map((r) => r.run_id)).toEqual(['run-x', 'run-3', 'run-2', 'run-1'])
  })

  it('shows the corrected takeoff once there is one, and no takeoff before persist links a reading', async () => {
    const fake = fakeDb({
      runs: [run('run-1', 1, { latest_extraction_id: 'reading-1' }), run('run-2', 2, { status: 'extracting', stage: 'calibrate' })],
      extractions: [{ id: 'reading-1', tenant_id: TENANT, takeoff_run_id: 'run-1', items: MISREAD, corrected_items: null }],
    })
    const get = (runId: string, tenants = [TENANT]) => getRun(fake.db, { tenants, runId })
    await expect(get('run-1')).resolves.toMatchObject({ run_id: 'run-1', takeoff: MISREAD, corrected: false })
    fake.tables.plan_extractions[0].corrected_items = GRANGE
    await expect(get('run-1')).resolves.toMatchObject({ takeoff: GRANGE, corrected: true })
    await expect(get('run-2')).resolves.toMatchObject({ status: 'extracting', takeoff: null, corrected: false })
    await expect(get('run-1', [OTHER_TENANT])).resolves.toBeNull()
  })
})

describe('correctTakeoff', () => {
  const RUN = '9a7b5c3d-1e2f-4a6b-8c0d-2e4f6a8b0c1d'
  const NOW = new Date('2026-11-02T03:00:00.000Z')
  const setup = (status: string, items = MISREAD) => fakeDb({
    runs: [{
      id: RUN, tenant_id: TENANT, status, scope_note: SCOPE, latest_extraction_id: 'reading-1',
      checks: runChecks(items, { scopeNote: SCOPE, schedule: SCHEDULE }), updated_at: '2026-11-02T00:00:00.000Z',
    }],
    extractions: [{ id: 'reading-1', tenant_id: TENANT, takeoff_run_id: RUN, items, corrected_items: null }],
  })
  const correct = (fake: ReturnType<typeof fakeDb>, takeoff: unknown, tenantId = TENANT) =>
    correctTakeoff(fake.db, { tenantId, runId: RUN, takeoff, now: NOW })

  it('saves the correction, re-checks it against the kept schedule and changes the status', async () => {
    const fake = setup('needs_review')
    await expect(correct(fake, GRANGE)).resolves.toMatchObject({ ok: true, run_id: RUN, status: 'ready', checks: { status: 'ready' } })
    const [saved] = fake.tables.roof_takeoff_runs
    expect(saved).toMatchObject({ status: 'ready', updated_at: NOW.toISOString(), checks: { ran_at: NOW.toISOString(), schedule: SCHEDULE } })
    // A tradie's correction leaves the run's geometry source as it was; only the aerial merge sets one.
    expect(saved.geometry_source).toBeUndefined()
    // C3 set the takeoff against the schedule the check stage found; no plan was opened.
    expect((saved.checks as Checks).results.find((r) => r.id === 'C3')).toMatchObject({ result: 'pass', detail: expect.stringContaining('233 m²') })
    expect(fake.tables.plan_extractions[0]).toMatchObject({ items: MISREAD, corrected_items: GRANGE })
  })

  it('puts a ready run back to needs review when the correction fails a check', async () => {
    const fake = setup('ready', GRANGE)
    await expect(correct(fake, MISREAD)).resolves.toMatchObject({ ok: true, status: 'needs_review' })
    expect(fake.tables.roof_takeoff_runs[0].status).toBe('needs_review')
  })

  it.each(['draft', 'queued', 'extracting', 'failed', 'saved'])('refuses to correct a %s run and leaves it alone', async (status) => {
    const fake = setup(status)
    await expect(correct(fake, GRANGE)).resolves.toEqual({ ok: false, error: 'conflict_status', status })
    expect(fake.tables.roof_takeoff_runs[0].status).toBe(status)
    expect(fake.tables.plan_extractions[0].corrected_items).toBeNull()
  })

  it('refuses a body that is not a RoofPlanTakeoff v1 and names the fields', async () => {
    const fake = setup('needs_review')
    const outcome = await correct(fake, { ...GRANGE, version: 2, structures: 'none' })
    expect(outcome).toMatchObject({ ok: false, error: 'invalid_takeoff' })
    expect(outcome.ok === false && outcome.error === 'invalid_takeoff' && outcome.issues.map((i) => i.path)).toEqual(['version', 'structures'])
    expect(fake.tables.plan_extractions[0].corrected_items).toBeNull()
  })

  it("answers not_found for another tenant's run", async () => {
    const fake = setup('needs_review')
    await expect(correct(fake, GRANGE, OTHER_TENANT)).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(fake.tables.plan_extractions[0].corrected_items).toBeNull()
  })

  it('looks the run up before parsing, so a body for no run of the tenant is never parsed', async () => {
    const fake = setup('needs_review')
    await expect(correct(fake, { version: 2 }, OTHER_TENANT)).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('refuses a takeoff larger than any reading without parsing it', async () => {
    // 100k empty structures parse into millions of issues: seconds of a
    // blocked event loop and gigabytes of heap.
    const fake = setup('needs_review')
    const started = performance.now()
    const outcome = await correct(fake, { ...GRANGE, structures: Array.from({ length: 100_000 }, () => ({})) })
    expect(performance.now() - started).toBeLessThan(500)
    expect(outcome).toEqual({ ok: false, error: 'invalid_takeoff', issues: [{ path: '', message: expect.stringContaining('larger than') }] })
    expect(fake.tables.plan_extractions[0].corrected_items).toBeNull()
  })
})

describe('deleteRun', () => {
  const RUN = '9a7b5c3d-1e2f-4a6b-8c0d-2e4f6a8b0c1d'
  const OTHER_RUN = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const KEPT = runFilePath(OTHER_TENANT, OTHER_RUN, 'upload-3')
  const setup = () => fakeDb({
    runs: [{ id: RUN, tenant_id: TENANT, status: 'ready' }, { id: OTHER_RUN, tenant_id: OTHER_TENANT, status: 'ready' }],
    uploads: [
      { id: 'upload-1', tenant_id: TENANT, takeoff_run_id: RUN },
      { id: 'upload-2', tenant_id: TENANT, takeoff_run_id: RUN },
      { id: 'upload-3', tenant_id: OTHER_TENANT, takeoff_run_id: OTHER_RUN },
    ],
    extractions: [{ id: 'reading-1', tenant_id: TENANT, takeoff_run_id: RUN }],
    objects: { [runFilePath(TENANT, RUN, 'upload-1')]: 1000, [runFilePath(TENANT, RUN, 'upload-2')]: 500, [KEPT]: 700 },
  })
  const remove = (fake: ReturnType<typeof fakeDb>, tenantId = TENANT) => deleteRun(fake.db, 'plan-pdfs', { tenantId, runId: RUN })

  it("removes the run's files, then the run with its uploads and readings, and nothing else", async () => {
    const fake = setup()
    await expect(remove(fake)).resolves.toEqual({ ok: true, files: 2 })
    expect(Object.keys(fake.objects)).toEqual([KEPT])
    expect(fake.tables.roof_takeoff_runs.map((r) => r.id)).toEqual([OTHER_RUN])
    expect(fake.tables.plan_uploads.map((r) => r.id)).toEqual(['upload-3'])
    expect(fake.tables.plan_extractions).toEqual([])
  })

  it("removes the run's exported packs too, each in its own folder (TKO-18)", async () => {
    const fake = setup()
    const pack = `roofing/${TENANT}/${RUN}/exports/2026-11-06T03-04-05-000Z/pack.zip`
    const older = `roofing/${TENANT}/${RUN}/exports/2026-11-05T01-00-00-000Z/pack.zip`
    fake.objects[pack] = 2048
    fake.objects[older] = 1024
    await expect(remove(fake)).resolves.toEqual({ ok: true, files: 4 })
    expect(Object.keys(fake.objects)).toEqual([KEPT])
  })

  it('keeps the run when storage refuses, so the delete can be tried again', async () => {
    const fake = setup()
    fake.fail.removal = true
    await expect(remove(fake)).rejects.toThrow('removal refused')
    expect(fake.tables.roof_takeoff_runs).toHaveLength(2)
    fake.fail.removal = false
    await expect(remove(fake)).resolves.toEqual({ ok: true, files: 2 })
  })

  it("answers not_found for another tenant's run and deletes nothing", async () => {
    const fake = setup()
    await expect(remove(fake, OTHER_TENANT)).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(Object.keys(fake.objects)).toHaveLength(3)
    expect(fake.tables.roof_takeoff_runs).toHaveLength(2)
  })

  it('keeps a run with activity since the cutoff it is given, as the sweep gives one', async () => {
    const fake = setup()
    fake.tables.roof_takeoff_runs[0].updated_at = '2026-11-02T00:00:00.000Z'
    await expect(deleteRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, updatedBefore: '2026-11-01T00:00:00.000Z' }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    expect(Object.keys(fake.objects)).toHaveLength(3)
    expect(fake.tables.roof_takeoff_runs).toHaveLength(2)
  })
})

describe('sweepExpiredRuns (D-06)', () => {
  const NOW = new Date('2027-11-04T00:00:00.000Z')
  const RECENT_FILE = runFilePath(TENANT, 'recent', 'u-recent')
  const setup = () => fakeDb({
    runs: [
      { id: 'old-saved', tenant_id: TENANT, status: 'saved', updated_at: '2026-11-02T00:00:00.000Z' },
      { id: 'old-failed', tenant_id: OTHER_TENANT, status: 'failed', updated_at: '2026-11-03T00:00:00.000Z' },
      { id: 'twelve-months', tenant_id: TENANT, status: 'ready', updated_at: '2026-11-04T00:00:00.000Z' },
      { id: 'recent', tenant_id: TENANT, status: 'ready', updated_at: '2026-12-04T00:00:00.000Z' },
    ],
    uploads: [
      { id: 'u-old', tenant_id: TENANT, takeoff_run_id: 'old-saved' },
      { id: 'u-recent', tenant_id: TENANT, takeoff_run_id: 'recent' },
    ],
    extractions: [{ id: 'reading-old', tenant_id: TENANT, takeoff_run_id: 'old-saved' }],
    objects: {
      [runFilePath(TENANT, 'old-saved', 'u-old')]: 1000,
      [runFilePath(OTHER_TENANT, 'old-failed', 'u-failed')]: 500,
      [RECENT_FILE]: 700,
    },
  })
  const runIds = (fake: ReturnType<typeof fakeDb>) => fake.tables.roof_takeoff_runs.map((r) => r.id)

  it('deletes each run more than 12 months past its last activity, in any status, with its files, uploads and readings', async () => {
    const fake = setup()
    await expect(sweepExpiredRuns(fake.db, 'plan-pdfs', { now: NOW })).resolves.toEqual({ runs: 2, files: 2, failed: [], fixtures: 0 })
    expect(runIds(fake)).toEqual(['twelve-months', 'recent'])
    expect(Object.keys(fake.objects)).toEqual([RECENT_FILE])
    expect(fake.tables.plan_uploads.map((r) => r.id)).toEqual(['u-recent'])
    expect(fake.tables.plan_extractions).toEqual([])
  })

  it('removes an eval fixture promoted from a live job 12 months on, and keeps the rest (TKO-00c)', async () => {
    const fake = setup()
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    Object.assign(fake.objects, {
      'eval/old/request.json': json({ job_ref: 'J1', promoted: { run_id: 'r0', at: '2026-11-01T00:00:00.000Z', expires_at: '2027-11-01T00:00:00.000Z' } }),
      'eval/old/takeoff.json': 5,
      'eval/old/plans-1.pdf': 10,
      'eval/new/request.json': json({ job_ref: 'J2', promoted: { run_id: 'r9', at: '2027-06-01T00:00:00.000Z', expires_at: '2028-06-01T00:00:00.000Z' } }),
      'eval/grange/request.json': json({ job_ref: 'J10001' }), // a P0 fixture: never promoted, never expires
    })
    await expect(sweepExpiredRuns(fake.db, 'plan-pdfs', { now: NOW })).resolves.toMatchObject({ runs: 2, fixtures: 1 })
    expect(Object.keys(fake.objects).filter((key) => key.startsWith('eval/')).sort()).toEqual(['eval/grange/request.json', 'eval/new/request.json'])
  })

  it('takes the oldest first, and no more than the limit a sweep', async () => {
    const fake = setup()
    await expect(sweepExpiredRuns(fake.db, 'plan-pdfs', { now: NOW, limit: 1 })).resolves.toEqual({ runs: 1, files: 1, failed: [], fixtures: 0 })
    expect(runIds(fake)).toEqual(['old-failed', 'twelve-months', 'recent'])
  })

  it('keeps a run that has had activity since the sweep chose it', async () => {
    const fake = setup()
    // The first deletion stands for time passing, in which the next run is restarted.
    fake.hooks.onList = () => {
      const run = fake.tables.roof_takeoff_runs.find((r) => r.id === 'old-failed')
      if (run) run.updated_at = NOW.toISOString()
    }
    await expect(sweepExpiredRuns(fake.db, 'plan-pdfs', { now: NOW })).resolves.toEqual({ runs: 1, files: 1, failed: [], fixtures: 0 })
    expect(runIds(fake)).toEqual(['old-failed', 'twelve-months', 'recent'])
  })

  it('skips a run that fails to delete, and still deletes the rest', async () => {
    const fake = setup()
    let lists = 0
    fake.hooks.onList = () => { fake.fail.removal = lists++ === 0 }
    await expect(sweepExpiredRuns(fake.db, 'plan-pdfs', { now: NOW })).resolves.toEqual({ runs: 1, files: 1, failed: ['old-saved'], fixtures: 0 })
    expect(runIds(fake)).toEqual(['old-saved', 'twelve-months', 'recent'])
  })
})
