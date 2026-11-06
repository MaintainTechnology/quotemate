import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Checks } from '../checks'
import type { RoofPlanTakeoff } from '../schema'
import { fakeDb, type Row } from '../test-db'
import { exportRun } from './index'
import { readZip } from './test-zip'

const TENANT = '2b6c1f0e-7d4a-4e1b-9c3f-5a8d2e6b1c0a'
const OTHER_TENANT = '7e5d4c3b-2a19-4f8e-b7d6-c5a4b3e2d1f0'
const RUN = '4f3e2d1c-0b9a-4876-a5b4-c3d2e1f0a9b8'
const NOW = new Date('2026-11-06T03:04:05.678Z')
const PDF = Buffer.from('%PDF-1.7 the brief')

// Grange's hand-measured reference, with drawing text that must never leave.
const grange = JSON.parse(readFileSync(join(__dirname, '../../../../eval/roof-takeoff/grange/takeoff.json'), 'utf8')) as RoofPlanTakeoff
const reading: RoofPlanTakeoff = {
  ...grange,
  structures: grange.structures.map((s, i) => ({
    ...s,
    planes: s.planes.map((p) => ({ ...p, evidence: [...p.evidence, { file: p.evidence[0]?.file ?? 'a.pdf', page: 1, text: i === 0 ? 'CLIENT: MR J SMITH' : 'OWNER: JANE CITIZEN', bbox: null }] })),
  })),
}
const checks: Checks = {
  version: 1,
  ran_at: '2026-11-05T22:00:00.000Z',
  status: 'ready',
  results: [{ id: 'C1', result: 'pass', detail: 'Calibrated on A1001A.' }, { id: 'C9', result: 'warning', detail: 'The request names no stage.' }],
  schedule: [],
}

const run = (over: Row = {}): Row => ({
  id: RUN,
  tenant_id: TENANT,
  status: 'ready',
  site_address: '59 Grange Rd, Eastern Heights QLD 4305',
  job_ref: 'J14997',
  job_name: 'Grange Rd dual occupancy',
  scope_note: 'Roofing - Steel (Supply & Fit)',
  builder: { business: 'Example Constructions Pty Ltd', contact: 'A. Builder', email: 'a.builder@example.com', phone: '0400 000 000' },
  checks,
  latest_extraction_id: 'reading-1',
  updated_at: '2026-11-05T22:00:00.000Z',
  ...over,
})

function setup(over: Row = {}, extraction: Row = {}) {
  return fakeDb({
    runs: [run(over)],
    extractions: [{ id: 'reading-1', tenant_id: TENANT, takeoff_run_id: RUN, items: reading, corrected_items: null, ...extraction }],
    tenants: [{ id: TENANT, business_name: 'Peppers Roofing' }],
  })
}

const render = vi.fn<(html: string) => Promise<Buffer>>(async () => PDF)
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

describe('exportRun', () => {
  it('builds the pack, stores the zip under the run and records its manifest', async () => {
    const fake = setup()
    const out = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const entries = readZip(out.zip)
    expect(entries.map((e) => e.name)).toEqual(['roof-outline.dxf', 'takeoff.csv', 'roof-brief.pdf', 'manifest.json'])
    expect(entries[2].data.equals(PDF)).toBe(true)
    expect(entries[0].data.toString()).toContain('AC1009')

    const manifest = JSON.parse(entries[3].data.toString())
    expect(manifest).toMatchObject({
      version: 1,
      run_id: RUN,
      job_ref: 'J14997',
      takeoff_version: 1,
      extraction_id: 'reading-1',
      corrected: false,
      status: 'ready',
      created_at: NOW.toISOString(),
      units: { outline: 'mm', lengths: 'm', areas: 'm2', angles: 'deg' },
      dxf: { version: 'AC1009', scale: '1:1', north: 'up' },
      checks: { status: 'ready', failed: [], warnings: ['C9'] },
    })
    expect(manifest.dxf.layers).toContain('ROOF-S1')
    expect(manifest.files).toEqual(entries.slice(0, 3).map((e) => ({ name: e.name, bytes: e.data.length, sha256: sha(e.data) })))

    expect(out.path).toBe(`roofing/${TENANT}/${RUN}/exports/2026-11-06T03-04-05-678Z/pack.zip`)
    expect(Buffer.from(fake.objects[out.path] as Uint8Array).equals(out.zip)).toBe(true)
    const row = fake.tables.roof_takeoff_runs[0]
    expect(row.export_manifest).toEqual(manifest)
    expect(row.last_exported_at).toBe(NOW.toISOString())
    expect(row.status).toBe('ready')
    expect(out.filename).toBe('J14997 Roof Wizard pack')
  })

  it('carries no drawing text, and of the builder only the business', async () => {
    const fake = setup()
    const out = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })
    if (!out.ok) throw new Error('export refused')
    const text = readZip(out.zip).map((e) => e.data.toString()).join('\n') + render.mock.calls.at(-1)![0]
    for (const gone of ['SMITH', 'CITIZEN', 'A. Builder', 'a.builder@example.com', '0400 000 000', 'Architectural - 59 Grange Rd']) expect(text).not.toContain(gone)
    expect(render.mock.calls.at(-1)![0]).toContain('Example Constructions Pty Ltd')
  })

  it('exports the corrected takeoff when there is one', async () => {
    const corrected = { ...reading, structures: reading.structures.slice(0, 1) }
    const fake = setup({}, { corrected_items: corrected })
    const out = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })
    if (!out.ok) throw new Error('export refused')
    const manifest = JSON.parse(readZip(out.zip)[3].data.toString())
    expect(manifest.corrected).toBe(true)
    expect(manifest.dxf.layers.filter((l: string) => l.startsWith('ROOF-'))).toEqual(['ROOF-S1'])
  })

  it('keeps only the newest pack of a run', async () => {
    const fake = setup()
    const first = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: new Date('2026-11-05T01:00:00.000Z') })
    const second = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })
    if (!first.ok || !second.ok) throw new Error('export refused')
    expect(Object.keys(fake.objects)).toEqual([second.path])
  })

  it('leaves the newer pack when an older export finishes after it', async () => {
    const fake = setup()
    const newer = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })
    const older = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: new Date('2026-11-06T03:04:00.000Z') })
    if (!newer.ok || !older.ok) throw new Error('export refused')
    expect(Object.keys(fake.objects)).toContain(newer.path)
  })

  it('leaves no pack behind for a run deleted while its pack was stored', async () => {
    const fake = setup()
    fake.hooks.onUpload = () => { fake.tables.roof_takeoff_runs.splice(0) }
    await expect(exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(fake.objects).toEqual({})
  })

  it('filters the request’s scope note and job name in the brief', async () => {
    const fake = setup({ scope_note: 'Mrs Nguyen wants the deck left out', job_name: 'Smith Residence re-roof' })
    const out = await exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })
    if (!out.ok) throw new Error('export refused')
    const html = render.mock.calls.at(-1)![0]
    expect(html).not.toMatch(/Nguyen|Smith/)
    expect(html).toContain('wants the deck left out')
  })

  it('takes a saved run, and one under review only once its checks are accepted', async () => {
    await expect(exportRun(setup({ status: 'saved' }).db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })).resolves.toMatchObject({ ok: true })
    const review = setup({ status: 'needs_review', checks: { ...checks, status: 'needs_review' } })
    await expect(exportRun(review.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW }))
      .resolves.toEqual({ ok: false, error: 'run_not_ready', status: 'needs_review' })
    await expect(exportRun(review.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW, acceptReview: true })).resolves.toMatchObject({ ok: true })
  })

  it.each(['draft', 'queued', 'extracting', 'failed'])('refuses a %s run and writes nothing', async (status) => {
    const fake = setup({ status })
    await expect(exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW }))
      .resolves.toEqual({ ok: false, error: 'run_not_ready', status })
    expect(fake.objects).toEqual({})
  })

  it("answers not_found for another tenant's run", async () => {
    const fake = setup()
    await expect(exportRun(fake.db, 'plan-pdfs', { tenantId: OTHER_TENANT, runId: RUN, render, now: NOW })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('stores and records nothing when the brief cannot be made', async () => {
    const fake = setup()
    const failing = vi.fn(async () => { throw new Error('gotenberg down') })
    await expect(exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render: failing, now: NOW })).resolves.toEqual({ ok: false, error: 'pdf_unavailable' })
    expect(fake.objects).toEqual({})
    expect(fake.tables.roof_takeoff_runs[0].export_manifest).toBeUndefined()
  })

  it('fails loudly when storage refuses the zip, and records no export', async () => {
    const fake = setup()
    fake.fail.upload = true
    await expect(exportRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, render, now: NOW })).rejects.toThrow('upload refused')
    expect(fake.tables.roof_takeoff_runs[0].export_manifest).toBeUndefined()
  })
})
