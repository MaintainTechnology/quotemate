// An in-memory stand-in for the service-role client, for the takeoff
// library's tests: enough of the query builder, storage and RPC for runs.ts,
// stages.ts, process.ts and save.ts. It filters rows for real, so tenant
// scoping and the compare-and-set updates are exercised rather than assumed.

import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string; code?: string } | null }
type Op = { kind: 'select' } | { kind: 'insert'; values: Row[] } | { kind: 'update'; patch: Row } | { kind: 'delete' }

/** Seed rows per table. Storage objects are paths with their bytes, or with
 *  just a size where a test only lists them. */
export function fakeDb(seed: {
  runs?: Row[]
  uploads?: Row[]
  extractions?: Row[]
  measurements?: Row[]
  pricingBooks?: Row[]
  tenants?: Row[]
  /** The start ledger (TKO-28): one row a start, kept when its run goes. */
  starts?: Row[]
  objects?: Record<string, number | Uint8Array>
} = {}) {
  const tables: Record<string, Row[]> = {
    roof_takeoff_runs: seed.runs ?? [],
    roof_takeoff_starts: seed.starts ?? [],
    plan_uploads: seed.uploads ?? [],
    plan_extractions: seed.extractions ?? [],
    pipeline_traces: [],
    roofing_measurements: seed.measurements ?? [],
    pricing_book: seed.pricingBooks ?? [],
    tenants: seed.tenants ?? [],
    tenant_licences: [],
  }
  const objects = seed.objects ?? {}
  const fail = { uploadRows: false, signing: false, enqueue: false, readings: false, removal: false, upload: false, ledger: false }
  const hooks: { onList?: () => void; onUpload?: (path: string) => void } = {}
  const signed: Array<{ bucket: string; path: string; options: unknown }> = []
  const rpc = vi.fn(async (_name: string, params: Row) =>
    fail.enqueue ? { data: null, error: { message: 'queue down' } } : { data: { id: 'job-1', work_key: params.p_key }, error: null })

  class Query implements PromiseLike<Result> {
    private readonly filters: Array<(row: Row) => boolean> = []
    private op: Op = { kind: 'select' }
    private sort?: { column: string; ascending: boolean }
    private max?: number
    // An insert answers its rows only when a select() follows it, as Supabase's does.
    private returning = false
    constructor(private readonly table: string) {}
    insert(values: Row | Row[]) { this.op = { kind: 'insert', values: [values].flat() }; return this }
    update(patch: Row) { this.op = { kind: 'update', patch }; return this }
    delete() { this.op = { kind: 'delete' }; return this }
    select() { this.returning = true; return this }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this }
    gte(column: string, value: string) { this.filters.push((row) => String(row[column]) >= value); return this }
    lt(column: string, value: string) { this.filters.push((row) => String(row[column]) < value); return this }
    order(column: string, options: { ascending?: boolean } = {}) { this.sort = { column, ascending: options.ascending ?? true }; return this }
    limit(count: number) { this.max = count; return this }
    async maybeSingle() {
      const { data, error } = this.execute()
      return { data: (data as Row[] | null)?.[0] ?? null, error }
    }
    async single() {
      const { data, error } = this.execute()
      const rows = (data as Row[] | null) ?? []
      if (error || rows.length !== 1) return { data: null, error: error ?? { message: `expected one row, got ${rows.length}` } }
      return { data: rows[0], error: null }
    }
    then<A = Result, B = never>(done?: ((value: Result) => A | PromiseLike<A>) | null, failed?: ((reason: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve().then(() => this.execute()).then(done, failed)
    }
    private execute(): Result {
      const rows = tables[this.table]
      const hits = rows.filter((row) => this.filters.every((keep) => keep(row)))
      const op = this.op
      if (op.kind === 'insert') {
        if (this.table === 'plan_uploads' && fail.uploadRows) return { data: null, error: { message: 'insert refused' } }
        if (this.table === 'roof_takeoff_starts' && fail.ledger) return { data: null, error: { message: 'ledger refused' } }
        // roofing_measurements gets its id from the database, and its
        // (tenant_id, source_request_key) is unique (migration 201).
        const measurement = this.table === 'roofing_measurements'
        // A new run is a draft, as migration 223's column default makes it.
        const run = this.table === 'roof_takeoff_runs'
        const added = op.values.map((value) => ({
          created_at: new Date().toISOString(),
          ...(measurement ? { id: randomUUID() } : {}),
          ...(run ? { status: 'draft' } : {}),
          ...value,
        }))
        const taken = (row: Row) => rows.some((other) => other.tenant_id === row.tenant_id && other.source_request_key != null && other.source_request_key === row.source_request_key)
        if (measurement && added.some(taken)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "roofing_measurements_tenant_source_key_uidx"' } }
        }
        rows.push(...added)
        return { data: this.returning ? added.map((row) => ({ ...row })) : null, error: null }
      }
      if (op.kind === 'update') {
        for (const row of hits) Object.assign(row, op.patch)
        return { data: hits.map((row) => ({ id: row.id })), error: null }
      }
      if (op.kind === 'delete') {
        for (const row of hits) rows.splice(rows.indexOf(row), 1)
        // takeoff_run_id is on delete cascade in both child tables.
        const gone = new Set(hits.map((row) => row.id))
        for (const child of [tables.plan_uploads, tables.plan_extractions]) {
          for (let i = child.length - 1; i >= 0; i--) if (gone.has(child[i].takeoff_run_id)) child.splice(i, 1)
        }
        return { data: null, error: null }
      }
      if (this.table === 'plan_extractions' && fail.readings) return { data: null, error: { message: 'readings unavailable' } }
      const sort = this.sort
      if (sort) hits.sort((a, b) => String(a[sort.column]).localeCompare(String(b[sort.column])) * (sort.ascending ? 1 : -1))
      return { data: hits.slice(0, this.max).map((row) => ({ ...row })), error: null }
    }
  }

  const storage = {
    from: (bucket: string) => ({
      createSignedUploadUrl: async (path: string, options: unknown) => {
        signed.push({ bucket, path, options })
        if (fail.signing) return { data: null, error: { message: 'signing refused' } }
        return { data: { signedUrl: `https://storage.test/upload/sign/${bucket}/${path}?token=t`, token: 't', path }, error: null }
      },
      // One level, as Supabase lists: a file with its id and size, and each
      // folder below once, with no id or metadata.
      list: async (folder: string) => {
        hooks.onList?.()
        const prefix = `${folder}/`
        const files: Array<{ name: string; id: string; metadata: { size: number } }> = []
        const folders = new Set<string>()
        for (const [key, body] of Object.entries(objects)) {
          if (!key.startsWith(prefix)) continue
          const rest = key.slice(prefix.length)
          if (rest.includes('/')) folders.add(rest.slice(0, rest.indexOf('/')))
          else files.push({ name: rest, id: key, metadata: { size: typeof body === 'number' ? body : body.length } })
        }
        return { data: [...files, ...[...folders].map((name) => ({ name, id: null, metadata: null }))], error: null }
      },
      // No upsert, as the service's uploads use: an object once there stays.
      upload: async (path: string, body: Uint8Array) => {
        if (fail.upload) return { data: null, error: { message: 'upload refused' } }
        if (objects[path] !== undefined) return { data: null, error: { message: 'The resource already exists' } }
        objects[path] = new Uint8Array(body)
        hooks.onUpload?.(path)
        return { data: { path }, error: null }
      },
      remove: async (paths: string[]) => {
        if (fail.removal) return { data: null, error: { message: 'removal refused' } }
        for (const path of paths) delete objects[path]
        return { data: paths.map((name) => ({ name })), error: null }
      },
      download: async (path: string) => {
        const body = objects[path]
        return body instanceof Uint8Array
          ? { data: new Blob([body as BlobPart]), error: null }
          : { data: null, error: { message: 'Object not found' } }
      },
    }),
  }

  const db = { from: (table: string) => new Query(table), storage, rpc } as unknown as SupabaseClient
  return { db, tables, objects, fail, hooks, signed, rpc }
}
