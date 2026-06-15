// Thin-IO client for the mt-filestore-kb service (a Gemini File Search proxy).
//
// The estimator supplementation step (lib/estimation/supplement.ts) uses this to
// spin up an EPHEMERAL file store from one uploaded plan PDF, retrieve passages,
// then tear the store down. Every network call goes through an injectable `fetch`
// so the client is fully unit-testable without a live service.
//
// Config comes from the environment:
//   KB_FILESTORE_URL   — base URL, e.g. https://mt-filestore-kb-production.up.railway.app
//   KB_API_KEY         — shared secret sent as the `x-api-key` header
//   KB_FILESTORE_MODEL — optional search model override
//
// Privacy: never log the api key or file bytes.

export type FileStoreCitation = { title?: string; page?: number; snippet?: string }

export type FileStoreSearchResult = {
  store?: string
  model?: string
  /** Synthesised answer. UNRELIABLE for electrical content — the upstream
   *  service injects a fixed signage-compliance persona — so callers should
   *  prefer `citations[].snippet` (raw retrieved passages). */
  answer: string
  citations: FileStoreCitation[]
}

export type FileStoreDocument = {
  name?: string
  displayName?: string
  mimeType?: string
  sizeBytes?: number
  state?: string
}

// Intersect with an index signature so `process.env` (NodeJS.ProcessEnv) is
// structurally assignable while the named keys stay documented.
export type FileStoreEnv = {
  KB_FILESTORE_URL?: string
  KB_API_KEY?: string
  KB_FILESTORE_MODEL?: string
} & Record<string, string | undefined>

export type FileStoreConfig = {
  baseUrl: string
  apiKey: string
  searchModel?: string
  fetchImpl?: typeof fetch
}

/** Error carrying the HTTP status + a truncated, secret-free detail. */
export class FileStoreError extends Error {
  status: number
  detail: string
  constructor(message: string, status: number, detail = '') {
    super(message)
    this.name = 'FileStoreError'
    this.status = status
    this.detail = detail
  }
}

/** True only when both the base URL and the api key are present + non-blank. */
export function isFileStoreConfigured(env: FileStoreEnv = process.env): boolean {
  return Boolean(env.KB_FILESTORE_URL?.trim() && env.KB_API_KEY?.trim())
}

/** Resolve env → config, or null when the service is not configured (so callers
 *  can degrade gracefully). Trailing slashes on the base URL are stripped. */
export function resolveFileStoreConfig(
  env: FileStoreEnv = process.env,
  fetchImpl?: typeof fetch,
): FileStoreConfig | null {
  if (!isFileStoreConfigured(env)) return null
  return {
    baseUrl: env.KB_FILESTORE_URL!.trim().replace(/\/+$/, ''),
    apiKey: env.KB_API_KEY!.trim(),
    searchModel: env.KB_FILESTORE_MODEL?.trim() || undefined,
    fetchImpl,
  }
}

/** Stores are addressed by their bare id; the API also returns the full
 *  `fileSearchStores/<id>` resource name, which we reduce for path use. */
export function bareStoreId(storeName: string): string {
  const trimmed = String(storeName).trim()
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

export type FileStoreClient = {
  createStore(displayName: string): Promise<{ name: string }>
  uploadPdf(storeName: string, bytes: Uint8Array, filename: string): Promise<{ document: FileStoreDocument }>
  search(
    storeName: string,
    query: string,
    opts?: { model?: string; metadataFilter?: string },
  ): Promise<FileStoreSearchResult>
  deleteStore(storeName: string): Promise<{ deleted: boolean }>
}

export function createFileStoreClient(config: FileStoreConfig): FileStoreClient {
  const doFetch = config.fetchImpl ?? fetch
  const base = config.baseUrl.replace(/\/+$/, '')
  const authHeaders = (): Record<string, string> => ({ 'x-api-key': config.apiKey })

  async function readError(res: Response, label: string): Promise<never> {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      // ignore — the status alone is enough to act on
    }
    throw new FileStoreError(`mt-filestore-kb ${label} failed (HTTP ${res.status})`, res.status, detail)
  }

  return {
    async createStore(displayName) {
      const res = await doFetch(`${base}/v1/stores`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
      })
      if (!res.ok) await readError(res, 'createStore')
      const data = (await res.json()) as { name?: string }
      if (!data?.name) throw new FileStoreError('mt-filestore-kb createStore returned no store name', 502)
      return { name: data.name }
    },

    async uploadPdf(storeName, bytes, filename) {
      const fd = new FormData()
      // Uint8Array is a valid BlobPart at runtime; the cast bridges the TS 5.7
      // typed-array generic (Uint8Array<ArrayBufferLike>) vs DOM BufferSource.
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
      fd.append('file', blob, filename || 'plan.pdf')
      // Do not set content-type here — fetch derives the multipart boundary.
      const res = await doFetch(`${base}/v1/stores/${bareStoreId(storeName)}/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!res.ok) await readError(res, 'uploadPdf')
      const data = (await res.json()) as { document?: FileStoreDocument }
      return { document: data?.document ?? {} }
    },

    async search(storeName, query, opts) {
      const body: Record<string, unknown> = { store: storeName, query }
      const model = opts?.model ?? config.searchModel
      if (model) body.model = model
      if (opts?.metadataFilter) body.metadataFilter = opts.metadataFilter
      const res = await doFetch(`${base}/v1/search`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) await readError(res, 'search')
      const data = (await res.json()) as Partial<FileStoreSearchResult>
      return {
        store: data.store,
        model: data.model,
        answer: typeof data.answer === 'string' ? data.answer : '',
        citations: Array.isArray(data.citations) ? data.citations : [],
      }
    },

    async deleteStore(storeName) {
      const res = await doFetch(`${base}/v1/stores/${bareStoreId(storeName)}?force=true`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) await readError(res, 'deleteStore')
      const data = (await res.json().catch(() => ({}))) as { deleted?: boolean }
      return { deleted: data?.deleted ?? true }
    },
  }
}
