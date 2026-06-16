// mt-filestore-kb · HTTP client (pure functions over fetch).
//
// Thin wrapper over the Railway-hosted mt-filestore-kb service
// (https://mt-filestore-kb-production.up.railway.app, source at
// C:/Users/dalig/Downloads/QuoteMate/mt-filestore-kb). All requests
// authenticate with the x-api-key header (KB_API_KEY env var). The
// fetch implementation is injected so tests can mock the network.
//
// Only the endpoints QuoteMate's trade-book extraction needs are
// exposed here:
//   • listStores  — GET  /v1/stores         (sanity / config check)
//   • listDocs    — GET  /v1/stores/:id/documents
//   • search      — POST /v1/search          (the workhorse)
//
// Future endpoints (upload, drive sync) can be added when the admin
// loader's UI grows a "upload trade book" button; for now uploads
// happen via the mt-filestore-kb dashboard and we just point at the
// resulting store_id.

export type KbConfig = {
  url: string       // e.g. "https://mt-filestore-kb-production.up.railway.app"
  apiKey: string    // KB_API_KEY env var
}

export type KbFetch = typeof fetch

// ─────────────────────────────────────────────────────────────────────
// Response shapes (mirrors mt-filestore-kb's GeminiService output)
// ─────────────────────────────────────────────────────────────────────

export type KbStoreSummary = {
  name: string                // "fileSearchStores/abc123…"
  displayName?: string
  state?: string
  createTime?: string
  updateTime?: string
}

export type KbDocumentSummary = {
  name: string                // "fileSearchStores/.../documents/..."
  displayName?: string
  mimeType?: string
  createTime?: string
  state?: string
  customMetadata?: Record<string, string>
}

/** A single grounding passage Gemini cited when answering. */
export type KbGroundingPassage = {
  text?: string
  page?: number
  documentTitle?: string
  /** Raw underlying citation payload — varies by Gemini SDK version. */
  raw?: unknown
}

export type KbSearchResult = {
  answer: string
  passages: KbGroundingPassage[]
  modelUsed?: string
  /** Whole raw response — kept for audit / debugging. */
  raw: unknown
}

// ─────────────────────────────────────────────────────────────────────
// Error shape — never throws on 4xx/5xx; returns structured error.
// ─────────────────────────────────────────────────────────────────────

export class KbHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`KbHttpError ${status} on ${url}: ${body.slice(0, 200)}`)
    this.name = 'KbHttpError'
  }
}

function ensureConfig(config: KbConfig): asserts config is KbConfig {
  if (!config?.url) throw new Error('KbConfig.url is required')
  if (!config?.apiKey) throw new Error('KbConfig.apiKey is required')
}

async function kbFetch(
  config: KbConfig,
  path: string,
  init: RequestInit,
  fetchImpl: KbFetch = fetch,
): Promise<Response> {
  ensureConfig(config)
  const url = `${config.url.replace(/\/+$/, '')}${path}`
  const headers = new Headers(init.headers ?? {})
  headers.set('x-api-key', config.apiKey)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return fetchImpl(url, { ...init, headers })
}

// ─────────────────────────────────────────────────────────────────────
// listStores — sanity check / dropdown population
// ─────────────────────────────────────────────────────────────────────

export async function kbListStores(
  config: KbConfig,
  fetchImpl: KbFetch = fetch,
): Promise<KbStoreSummary[]> {
  const res = await kbFetch(config, '/v1/stores', { method: 'GET' }, fetchImpl)
  if (!res.ok) {
    throw new KbHttpError(res.status, '/v1/stores', await res.text())
  }
  const data = (await res.json()) as { stores?: KbStoreSummary[] }
  return Array.isArray(data.stores) ? data.stores : []
}

// ─────────────────────────────────────────────────────────────────────
// listDocs — see which PDFs are in a store
// ─────────────────────────────────────────────────────────────────────

export async function kbListDocuments(
  config: KbConfig,
  storeId: string,
  fetchImpl: KbFetch = fetch,
): Promise<KbDocumentSummary[]> {
  if (!storeId) throw new Error('storeId is required')
  const safe = encodeURIComponent(storeId)
  const res = await kbFetch(
    config,
    `/v1/stores/${safe}/documents`,
    { method: 'GET' },
    fetchImpl,
  )
  if (!res.ok) {
    throw new KbHttpError(res.status, `/v1/stores/${storeId}/documents`, await res.text())
  }
  const data = (await res.json()) as { documents?: KbDocumentSummary[] }
  return Array.isArray(data.documents) ? data.documents : []
}

// ─────────────────────────────────────────────────────────────────────
// search — the workhorse
// ─────────────────────────────────────────────────────────────────────

export type KbSearchInput = {
  store: string           // store id OR full "fileSearchStores/..." name
  query: string           // the prompt
  model?: string          // optional Gemini model override
  metadataFilter?: string // e.g. 'author="Dr Deepti"' — scope to one doc
  /** Optional system instruction that frames how the model answers. When
   *  omitted, the service applies its default (signage-compliance) persona —
   *  unhelpful for estimate stores, so the estimator chatbot passes its own. */
  systemInstruction?: string
}

/** Parse mt-filestore-kb's search response into a clean shape. The raw
 *  envelope from Gemini's generateContent API varies a bit between SDK
 *  versions, so this is defensive. */
export function parseSearchResponse(raw: unknown): KbSearchResult {
  const r = raw as Record<string, unknown> | null
  const answer = (() => {
    if (!r) return ''
    if (typeof r.answer === 'string') return r.answer
    if (typeof r.text === 'string') return r.text
    // Some shapes wrap in candidates[0].content.parts[0].text
    const candidates = (r.candidates as any[]) ?? []
    const first = candidates[0]
    const parts = first?.content?.parts ?? []
    const partText = parts.map((p: any) => p?.text ?? '').filter(Boolean).join('\n')
    return partText
  })()
  const passages: KbGroundingPassage[] = (() => {
    if (!r) return []
    const cited = (r.passages as any[]) ?? (r.citations as any[]) ?? (r.groundingPassages as any[]) ?? []
    return cited.map((p: any) => ({
      text: p?.text ?? p?.snippet ?? undefined,
      page: typeof p?.page === 'number' ? p.page : undefined,
      documentTitle: p?.documentTitle ?? p?.title ?? undefined,
      raw: p,
    }))
  })()
  const modelUsed = typeof r?.modelUsed === 'string'
    ? r.modelUsed
    : typeof r?.model === 'string'
      ? (r.model as string)
      : undefined
  return { answer, passages, modelUsed, raw }
}

export async function kbSearch(
  config: KbConfig,
  input: KbSearchInput,
  fetchImpl: KbFetch = fetch,
): Promise<KbSearchResult> {
  if (!input?.store) throw new Error('search input.store is required')
  if (!input?.query) throw new Error('search input.query is required')
  const body: Record<string, unknown> = {
    store: input.store,
    query: input.query,
  }
  if (input.model) body.model = input.model
  if (input.metadataFilter) body.metadataFilter = input.metadataFilter
  if (input.systemInstruction?.trim()) {
    body.systemInstruction = input.systemInstruction.trim()
  }
  const res = await kbFetch(
    config,
    '/v1/search',
    { method: 'POST', body: JSON.stringify(body) },
    fetchImpl,
  )
  if (!res.ok) {
    throw new KbHttpError(res.status, '/v1/search', await res.text())
  }
  const raw = await res.json()
  return parseSearchResponse(raw)
}

// ─────────────────────────────────────────────────────────────────────
// Config loader — reads KB_API_URL + KB_API_KEY env vars at call-time
// so importing this module never throws when those aren't set (matches
// how `lib/estimate/tools.ts` lazy-loads its Supabase client).
// ─────────────────────────────────────────────────────────────────────

export function loadKbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KbConfig {
  const url = env.KB_API_URL ?? env.MT_FILESTORE_KB_URL
  const apiKey = env.KB_API_KEY ?? env.MT_FILESTORE_KB_API_KEY
  if (!url) {
    throw new Error('KB_API_URL (or MT_FILESTORE_KB_URL) env var is required')
  }
  if (!apiKey) {
    throw new Error('KB_API_KEY (or MT_FILESTORE_KB_API_KEY) env var is required')
  }
  return { url, apiKey }
}

// ─────────────────────────────────────────────────────────────────────
// kbCreateStore — POST /v1/stores
//
// Lets the /admin/loader UI spin up a new File Search store inline (the
// "+ New store" button on the 01·b card) instead of forcing the admin
// to open the mt-filestore-kb console first. Returns the freshly-created
// store with its `name` (full "fileSearchStores/..." path) so the UI can
// flip the picker to the new store and then call kbUploadDocument.
// ─────────────────────────────────────────────────────────────────────

export type KbCreateStoreInput = {
  displayName: string
  /** Optional embedding-model override; mt-filestore-kb defaults if null. */
  embeddingModel?: string | null
}

export async function kbCreateStore(
  config: KbConfig,
  input: KbCreateStoreInput,
  fetchImpl: KbFetch = fetch,
): Promise<KbStoreSummary> {
  const dn = (input?.displayName ?? '').trim()
  if (!dn) throw new Error('displayName is required to create a store')
  const body: Record<string, unknown> = { displayName: dn }
  if (input.embeddingModel) body.embeddingModel = input.embeddingModel
  const res = await kbFetch(
    config,
    '/v1/stores',
    { method: 'POST', body: JSON.stringify(body) },
    fetchImpl,
  )
  if (!res.ok) {
    throw new KbHttpError(res.status, '/v1/stores', await res.text())
  }
  return (await res.json()) as KbStoreSummary
}

// ─────────────────────────────────────────────────────────────────────
// kbUploadDocument — POST /v1/stores/:storeId/upload (multipart)
//
// Streams a PDF up to mt-filestore-kb so the admin doesn't need to leave
// QuoteMate. The service performs the Gemini File Search upload + chunk
// + embed + index pipeline; the indexed document is returned with its
// state ('processing' | 'active' | 'failed'). Document indexing can take
// 10-60s for a real trade book — callers should poll kbListDocuments
// until the state flips off 'processing'.
//
// File size cap matches the mt-filestore-kb side: 100MB.
// ─────────────────────────────────────────────────────────────────────

export type KbUploadDocumentInput = {
  storeId: string
  /** Browser File OR Node.js-compatible Blob. The server reads .name + .type. */
  file: Blob & { name?: string }
  /** Friendly label shown in the document picker. Defaults to file.name. */
  displayName?: string
}

export const KB_UPLOAD_MAX_BYTES = 100 * 1024 * 1024

export async function kbUploadDocument(
  config: KbConfig,
  input: KbUploadDocumentInput,
  fetchImpl: KbFetch = fetch,
): Promise<KbDocumentSummary> {
  if (!input?.storeId) throw new Error('storeId is required')
  if (!input?.file) throw new Error('file is required')
  if (typeof (input.file as Blob).size !== 'number') {
    throw new Error('file must be a Blob/File-like object with a size')
  }
  if ((input.file as Blob).size > KB_UPLOAD_MAX_BYTES) {
    throw new Error(
      `file is ${(input.file as Blob).size} bytes; max is ${KB_UPLOAD_MAX_BYTES}`,
    )
  }
  const safe = encodeURIComponent(input.storeId)
  const form = new FormData()
  const fileName = input.file.name ?? input.displayName ?? 'upload.pdf'
  form.append('file', input.file as Blob, fileName)
  if (input.displayName) form.append('displayName', input.displayName)

  // NOTE: do NOT set content-type — fetch sets multipart boundary itself.
  const url = `${config.url.replace(/\/+$/, '')}/v1/stores/${safe}/upload`
  const headers = new Headers()
  headers.set('x-api-key', config.apiKey)
  headers.set('Accept', 'application/json')

  const res = await fetchImpl(url, {
    method: 'POST',
    body: form,
    headers,
  })
  if (!res.ok) {
    throw new KbHttpError(res.status, `/v1/stores/${input.storeId}/upload`, await res.text())
  }
  // mt-filestore-kb returns the document directly OR wrapped in { document }.
  // Be defensive about the shape.
  const json = (await res.json()) as KbDocumentSummary | { document?: KbDocumentSummary }
  const doc = (json as { document?: KbDocumentSummary }).document ?? (json as KbDocumentSummary)
  return doc
}

// ─────────────────────────────────────────────────────────────────────
// kbDeleteDocument — DELETE /v1/stores/:storeId/documents/:docId
//
// The store has no bulk replace, so the DB→KB sync deletes a table's
// prior document before/after re-uploading. Takes the full Gemini
// document resource name (as returned by kbUploadDocument) and routes
// it to mt-filestore-kb's nested delete endpoint.
// ─────────────────────────────────────────────────────────────────────

export async function kbDeleteDocument(
  config: KbConfig,
  documentName: string,
  fetchImpl: KbFetch = fetch,
): Promise<void> {
  const name = (documentName ?? '').trim()
  const m = name.match(/^fileSearchStores\/([^/]+)\/documents\/(.+)$/)
  if (!m) {
    throw new Error(
      `kbDeleteDocument: documentName must be "fileSearchStores/<storeId>/documents/<docId>", got "${documentName}"`,
    )
  }
  const [, storeId, docId] = m
  const path = `/v1/stores/${encodeURIComponent(storeId)}/documents/${encodeURIComponent(docId)}`
  const res = await kbFetch(config, path, { method: 'DELETE' }, fetchImpl)
  if (!res.ok) {
    throw new KbHttpError(res.status, path, await res.text())
  }
}

// ─────────────────────────────────────────────────────────────────────
// kbDeleteStore — DELETE /v1/stores/:storeId[?force=true]
//
// Tears down a whole File Search store (and, with force=true, any docs
// still in it) in one call. Used to clean up the per-session TEMPORARY
// store the commercial-paint KB-supplement pass creates from a tradie's
// uploaded plans. Accepts a bare id or a full "fileSearchStores/<id>"
// name; the service normalises either.
// ─────────────────────────────────────────────────────────────────────

export async function kbDeleteStore(
  config: KbConfig,
  storeId: string,
  opts: { force?: boolean } = {},
  fetchImpl: KbFetch = fetch,
): Promise<void> {
  if (!storeId) throw new Error('storeId is required')
  const path = `/v1/stores/${encodeURIComponent(storeId)}${opts.force ? '?force=true' : ''}`
  const res = await kbFetch(config, path, { method: 'DELETE' }, fetchImpl)
  if (!res.ok) {
    throw new KbHttpError(res.status, path, await res.text())
  }
}
