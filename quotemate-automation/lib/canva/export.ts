// Canva Connect — design export job request/response shaping (pure).
//
// The export API is asynchronous: POST /v1/exports creates a job, then you
// poll GET /v1/exports/{id} until status is terminal and read the download
// URL(s). These helpers build the body and decode the job; no network here.
// See https://www.canva.dev/docs/connect/api-reference/exports/.

import { CANVA_API_BASE } from './oauth'

export type CanvaExportType = 'png' | 'pdf' | 'jpg'
export type ExportStatus = 'in_progress' | 'success' | 'failed'

export interface CanvaExportJobBody {
  design_id: string
  format: { type: CanvaExportType }
}

/** Body for "export this design as <type>". */
export function buildExportJobBody(designId: string, type: CanvaExportType): CanvaExportJobBody {
  return { design_id: designId, format: { type } }
}

export interface ExportJob {
  id: string | null
  status: ExportStatus
  /** Download URLs (one per page) — present once the job succeeds. */
  urls: string[]
  error: string | null
}

/** Decode the `{ job: { id, status, urls?, error? } }` shape (create + get). */
export function parseExportJob(json: unknown): ExportJob {
  const root = (json ?? {}) as Record<string, unknown>
  const job = (root.job ?? {}) as Record<string, unknown>
  const id = typeof job.id === 'string' ? job.id : null
  const rawStatus = typeof job.status === 'string' ? job.status : ''
  const status: ExportStatus =
    rawStatus === 'success' || rawStatus === 'failed' ? rawStatus : 'in_progress'

  let urls: string[] = []
  if (Array.isArray(job.urls)) {
    urls = job.urls.filter((u): u is string => typeof u === 'string')
  } else if (Array.isArray(job.url)) {
    urls = job.url.filter((u): u is string => typeof u === 'string')
  }

  const errObj = (job.error ?? null) as Record<string, unknown> | null
  const error =
    typeof errObj?.message === 'string'
      ? errObj.message
      : typeof errObj?.code === 'string'
        ? errObj.code
        : null

  return { id, status, urls, error }
}

/** True once an export job has reached a terminal state (success or failed). */
export function isExportTerminal(status: ExportStatus): boolean {
  return status === 'success' || status === 'failed'
}

export const EXPORTS_ENDPOINT = `${CANVA_API_BASE}/exports`
