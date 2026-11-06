// The Roof Wizard pack (TKO-18, DEC-036, DEC-037): a run's takeoff as the
// outline (DXF), the quantities (CSV), the roof brief (PDF) and a manifest,
// zipped, stored under the run and recorded on it. The export takes the runs
// the save takes, and saved ones; the run's status doesn't change.
//
// Every file is built from the pack's copy of the takeoff (privacy.ts), which
// has no drawing text. Callers pass the service-role client, which bypasses
// RLS, so every query here also filters on tenant_id.

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTenantBranding } from '@/lib/pdf/branding'
import { renderPdfFromHtml } from '@/lib/pdf/gotenberg'
import type { Checks } from '../checks'
import { filesUnder, runFolder, type RunBuilder } from '../runs'
import { RoofPlanTakeoffSchema } from '../schema'
import { briefHtml } from './brief'
import { toCsv } from './csv'
import { toDxf } from './dxf'
import { packGeometry } from './geometry'
import { packTakeoff } from './privacy'
import { zipFiles } from './zip'

export const EXPORT_FORMATS = ['zip', 'dxf', 'csv', 'pdf', 'json'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export const PACK_FILES = { dxf: 'roof-outline.dxf', csv: 'takeoff.csv', pdf: 'roof-brief.pdf', json: 'manifest.json' } as const
export const PACK_GENERATOR = 'qm-roofing-takeoff pack 1'

export type PackManifest = {
  version: 1
  generator: string
  created_at: string
  run_id: string
  job_ref: string | null
  takeoff_version: 1
  extraction_id: string
  corrected: boolean
  status: string
  checks: { status: Checks['status']; failed: string[]; warnings: string[] } | null
  units: { outline: 'mm'; lengths: 'm'; areas: 'm2'; angles: 'deg' }
  dxf: { version: 'AC1009'; scale: '1:1'; north: 'up'; layers: string[] }
  sheets: Array<{ ref: string; revision: string | null; kind: string; preliminary: boolean }>
  files: Array<{ name: string; bytes: number; sha256: string }>
}

export type ExportOutcome =
  | {
      ok: true
      run_id: string
      /** Where the zip is stored, under the run's folder. */
      path: string
      /** The download's name, without its extension. */
      filename: string
      zip: Buffer
      files: Record<'dxf' | 'csv' | 'pdf' | 'json', Buffer>
      manifest: PackManifest
    }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'run_not_ready'; status: string }
  | { ok: false; error: 'pdf_unavailable' }

type RunRow = {
  id: string
  tenant_id: string
  status: string
  site_address: string
  job_ref: string | null
  job_name: string | null
  scope_note: string | null
  builder: RunBuilder | null
  checks: Checks | null
  latest_extraction_id: string | null
}

const failure = (what: string, error: { message: string }) => new Error(`takeoff ${what} failed: ${error.message}`)
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Builds the run's pack, stores it as the run's only pack and records its
 *  manifest. Gotenberg prints the brief unless a test gives its own `render`. */
export async function exportRun(db: SupabaseClient, bucket: string, input: {
  tenantId: string
  runId: string
  acceptReview?: boolean
  render?: (html: string) => Promise<Buffer>
  now?: Date
}): Promise<ExportOutcome> {
  const found = await db.from('roof_takeoff_runs')
    .select('id, tenant_id, status, site_address, job_ref, job_name, scope_note, builder, checks, latest_extraction_id')
    .eq('id', input.runId).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (found.error) throw failure('run lookup', found.error)
  const run = found.data as RunRow | null
  if (!run) return { ok: false, error: 'not_found' }
  const takes = run.status === 'ready' || run.status === 'saved' || (run.status === 'needs_review' && input.acceptReview === true)
  if (!takes || !run.latest_extraction_id) return { ok: false, error: 'run_not_ready', status: run.status }
  const got = await db.from('plan_extractions')
    .select('items, corrected_items')
    .eq('id', run.latest_extraction_id).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (got.error) throw failure('reading lookup', got.error)
  const stored = got.data?.corrected_items ?? got.data?.items
  if (!stored) return { ok: false, error: 'run_not_ready', status: run.status }
  const takeoff = RoofPlanTakeoffSchema.parse(stored)
  const now = input.now ?? new Date()

  // The request's scope note and job name are filtered with the reading's names.
  const pack = packTakeoff(takeoff, run.checks, { job_name: run.job_name, scope_note: run.scope_note })
  const geometry = packGeometry(pack.structures)
  const { dxf, layers } = toDxf(geometry, pack.structures)
  const csv = toCsv(pack.structures, geometry)
  const html = briefHtml({
    branding: await loadTenantBranding(db, input.tenantId, 'roofing'),
    run: { job_ref: run.job_ref, job_name: pack.request.job_name, site_address: run.site_address, scope_note: pack.request.scope_note, builder_business: run.builder?.business ?? null },
    pack,
    geometry,
    date: now,
  })
  let pdf: Buffer
  try {
    pdf = await (input.render ?? ((page: string) => renderPdfFromHtml(page, { singlePage: false })))(html)
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_pack_pdf_failed', run_id: run.id, cause: String(error).slice(0, 200) }))
    return { ok: false, error: 'pdf_unavailable' }
  }

  const files = { dxf: Buffer.from(dxf, 'utf8'), csv: Buffer.from(csv, 'utf8'), pdf }
  const ids = (result: string) => pack.checks?.results.filter((c) => c.result === result).map((c) => c.id) ?? []
  const manifest: PackManifest = {
    version: 1,
    generator: PACK_GENERATOR,
    created_at: now.toISOString(),
    run_id: run.id,
    job_ref: run.job_ref,
    takeoff_version: 1,
    extraction_id: run.latest_extraction_id,
    corrected: Boolean(got.data?.corrected_items),
    status: run.status,
    checks: pack.checks ? { status: pack.checks.status, failed: ids('fail'), warnings: ids('warning') } : null,
    units: { outline: 'mm', lengths: 'm', areas: 'm2', angles: 'deg' },
    dxf: { version: 'AC1009', scale: '1:1', north: 'up', layers },
    sheets: pack.sheets.filter((s) => s.used).map((s) => ({ ref: s.ref, revision: s.revision, kind: s.kind, preliminary: s.preliminary })),
    files: (['dxf', 'csv', 'pdf'] as const).map((key) => ({ name: PACK_FILES[key], bytes: files[key].length, sha256: sha256(files[key]) })),
  }
  const json = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const zip = zipFiles([
    { name: PACK_FILES.dxf, data: files.dxf },
    { name: PACK_FILES.csv, data: files.csv },
    { name: PACK_FILES.pdf, data: files.pdf },
    { name: PACK_FILES.json, data: json },
  ], now)

  // Backend Schema §5's path; the stamp is the export's time, with no colons.
  // Not named `exports`: compiled to CommonJS, as the service runs it, that
  // name would shadow the module's own and break every export.
  const packs = `${runFolder(run.tenant_id, run.id)}/exports`
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const path = `${packs}/${stamp}/pack.zip`
  const put = await db.storage.from(bucket).upload(path, zip, { contentType: 'application/zip', upsert: false })
  if (put.error) throw failure('pack upload', put.error)
  const recorded = await db.from('roof_takeoff_runs')
    .update({ export_manifest: manifest, last_exported_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', run.id).eq('tenant_id', run.tenant_id)
    .select('id')
  if (recorded.error) throw failure('export record', recorded.error)
  if (!recorded.data?.length) {
    // The run was deleted while its pack was stored: nothing would ever sweep
    // the pack, as the sweep starts from runs, so it goes now.
    const removed = await db.storage.from(bucket).remove([path])
    if (removed.error) console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_pack_orphaned', run_id: run.id, cause: removed.error.message.slice(0, 200) }))
    return { ok: false, error: 'not_found' }
  }

  // The run keeps its newest pack. Only packs older than this one go, so an
  // export that finishes after a newer one leaves that one; an older pack left
  // by a failed clean-up goes with the next export, or with the run.
  const stampOf = (file: string) => file.slice(packs.length + 1).split('/')[0]
  const older = (await filesUnder(db, bucket, packs)).filter((p) => p !== path && stampOf(p) < stamp)
  if (older.length) {
    const removed = await db.storage.from(bucket).remove(older)
    if (removed.error) console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_pack_cleanup_failed', run_id: run.id, cause: removed.error.message.slice(0, 200) }))
  }
  return { ok: true, run_id: run.id, path, filename: `${run.job_ref ?? run.id.slice(0, 8)} Roof Wizard pack`, zip, files: { ...files, json }, manifest }
}
