// Canva Connect — design creation request/response shaping (pure).
//
// Builds the POST /v1/designs body and decodes the design reference (id +
// edit/view URLs) we open in the editor. No network — unit-tested directly.
// See https://www.canva.dev/docs/connect/api-reference/designs/create-design/.

import { CANVA_API_BASE } from './oauth'

/** A4 portrait at ~300dpi — print-ready flyer canvas (area < Canva's 25MP cap). */
export const FLYER_DESIGN_SIZE = { width: 2480, height: 3508 } as const

export interface CreateDesignOptions {
  title?: string
  width?: number
  height?: number
}

export interface CanvaCreateDesignBody {
  design_type: { type: 'custom'; width: number; height: number }
  title?: string
}

/** Body for "create a custom flyer-sized design", optionally titled. */
export function buildCreateDesignBody(opts: CreateDesignOptions = {}): CanvaCreateDesignBody {
  const width = opts.width ?? FLYER_DESIGN_SIZE.width
  const height = opts.height ?? FLYER_DESIGN_SIZE.height
  const body: CanvaCreateDesignBody = { design_type: { type: 'custom', width, height } }
  const title = opts.title?.trim()
  if (title) body.title = title
  return body
}

export interface CanvaDesignRef {
  id: string
  editUrl: string
  viewUrl: string | null
}

/** Decode the `{ design: { id, urls: { edit_url, view_url } } }` response. */
export function parseCreateDesignResponse(json: unknown): CanvaDesignRef {
  const root = (json ?? {}) as Record<string, unknown>
  const design = (root.design ?? {}) as Record<string, unknown>
  const urls = (design.urls ?? {}) as Record<string, unknown>
  const id = typeof design.id === 'string' ? design.id : ''
  const editUrl = typeof urls.edit_url === 'string' ? urls.edit_url : ''
  const viewUrl = typeof urls.view_url === 'string' ? urls.view_url : null
  if (!id || !editUrl) throw new Error('canva_create_design_unexpected_response')
  return { id, editUrl, viewUrl }
}

/**
 * Attach a `correlation_state` to a design edit URL so Canva can route the
 * user back to our integration ("return navigation"). Preserves existing query
 * params and is idempotent for the same state.
 */
export function appendCorrelationState(editUrl: string, state: string): string {
  const u = new URL(editUrl)
  u.searchParams.set('correlation_state', state)
  return u.toString()
}

export const DESIGNS_ENDPOINT = `${CANVA_API_BASE}/designs`
