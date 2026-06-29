// Canva Connect — thin REST client (network orchestration).
//
// Wraps the Connect endpoints with a bearer access token. Request bodies and
// response decoding come from the pure ./design and ./export modules (which are
// unit-tested); this layer just performs fetch + polling. Server-only.

import { CANVA_API_BASE } from './oauth'
import { DESIGNS_ENDPOINT, parseCreateDesignResponse, buildCreateDesignBody, type CanvaDesignRef, type CreateDesignOptions } from './design'
import {
  EXPORTS_ENDPOINT,
  buildExportJobBody,
  parseExportJob,
  isExportTerminal,
  type CanvaExportType,
  type ExportJob,
} from './export'

function jsonHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
}

export async function createDesign(accessToken: string, opts: CreateDesignOptions = {}): Promise<CanvaDesignRef> {
  const res = await fetch(DESIGNS_ENDPOINT, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(buildCreateDesignBody(opts)),
  })
  if (!res.ok) throw new Error(`canva_create_design_${res.status}`)
  return parseCreateDesignResponse(await res.json())
}

export async function startExport(accessToken: string, designId: string, type: CanvaExportType): Promise<ExportJob> {
  const res = await fetch(EXPORTS_ENDPOINT, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(buildExportJobBody(designId, type)),
  })
  if (!res.ok) throw new Error(`canva_export_start_${res.status}`)
  return parseExportJob(await res.json())
}

export async function getExport(accessToken: string, jobId: string): Promise<ExportJob> {
  const res = await fetch(`${EXPORTS_ENDPOINT}/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`canva_export_get_${res.status}`)
  return parseExportJob(await res.json())
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll an export job until it is terminal or the attempt budget is exhausted. */
export async function pollExport(
  accessToken: string,
  jobId: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<ExportJob> {
  const tries = opts.tries ?? 12
  const delayMs = opts.delayMs ?? 1500
  let job: ExportJob = { id: jobId, status: 'in_progress', urls: [], error: null }
  for (let i = 0; i < tries; i++) {
    job = await getExport(accessToken, jobId)
    if (isExportTerminal(job.status)) return job
    await sleep(delayMs)
  }
  return job
}

/** Start an export and wait for the terminal result. */
export async function exportDesign(accessToken: string, designId: string, type: CanvaExportType): Promise<ExportJob> {
  const started = await startExport(accessToken, designId, type)
  if (isExportTerminal(started.status)) return started
  if (!started.id) throw new Error('canva_export_no_job_id')
  return pollExport(accessToken, started.id)
}

export async function downloadToBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`canva_download_${res.status}`)
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType }
}

/** Best-effort fetch of the connected Canva user id (for display/debug). */
export async function getCanvaUserId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${CANVA_API_BASE}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown>
    const teamUser = (json.team_user ?? json) as Record<string, unknown>
    const id = teamUser.user_id ?? teamUser.id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}
