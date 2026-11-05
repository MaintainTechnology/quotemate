// The dashboard's plan takeoff pages (TKO-19) call the takeoff service as the
// signed-in tradie. The service's address is NEXT_PUBLIC_TAKEOFF_API_URL:
// unset, the pages say takeoffs are off and the dashboard doesn't link them.

import { getAuthToken } from '@/lib/auth/client-token'

export const TAKEOFF_API_URL = (process.env.NEXT_PUBLIC_TAKEOFF_API_URL ?? '').replace(/\/+$/, '')

/** A refusal from the takeoff service: its status, code and detail in words. */
export class TakeoffError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: unknown = null,
  ) {
    super(message)
  }
}

/** The service's `detail` in words: a string, or the message of an object. */
function words(detail: unknown): string {
  if (typeof detail === 'string') return detail
  const message = (detail as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : 'The takeoff service refused the request'
}

/** The service answers every caller it won't admit with the same 401 (a tenant
 *  off the pilot allowlist, without roofing, or signed in elsewhere), so the
 *  words are about the account, not the reason. */
const NOT_ON_ACCOUNT = 'Plan takeoffs aren’t switched on for this account yet. Ask QuoteMax to turn them on.'

/** Calls the takeoff service with the tradie's token. Throws a TakeoffError
 *  on a refusal, with the service's own detail. */
export async function takeoffApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(`${TAKEOFF_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: unknown }
  if (!res.ok) {
    const message = res.status === 401 ? NOT_ON_ACCOUNT : words(body.detail)
    throw new TakeoffError(res.status, body.error ?? 'error', message, body.detail ?? null)
  }
  return body as T
}

/** Uploads one PDF straight to its signed storage URL, reporting progress
 *  from 0 to 1. XHR, because fetch can't report upload progress. */
export function uploadFile(signedUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUrl)
    xhr.setRequestHeader('content-type', 'application/pdf')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the file (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('The upload stopped. Check the connection, then retry.'))
    xhr.send(file)
  })
}

/** A date and time as the dashboard shows them. */
export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : ''

export type Tone = 'neutral' | 'active' | 'success' | 'warning' | 'danger' | 'filled'
export type ChipSpec = { words: string; icon: string; tone: Tone }

// Design Brief §4.4: every chip pairs an icon and a word with its colour.
const STATUS_CHIPS: Record<string, ChipSpec> = {
  draft: { words: 'Draft', icon: '○', tone: 'neutral' },
  queued: { words: 'Reading plans', icon: '···', tone: 'active' },
  extracting: { words: 'Reading plans', icon: '···', tone: 'active' },
  ready: { words: 'Ready', icon: '✓', tone: 'success' },
  needs_review: { words: 'Needs review', icon: '!', tone: 'warning' },
  failed: { words: 'Failed', icon: '×', tone: 'danger' },
  saved: { words: 'Saved', icon: '●', tone: 'filled' },
}

/** A run status's chip; an unknown status reads as its own words. */
export const statusChip = (status: string): ChipSpec =>
  STATUS_CHIPS[status] ?? { words: status.replace(/_/g, ' '), icon: '○', tone: 'neutral' }

const CHECK_CHIPS: Record<string, ChipSpec> = {
  pass: { words: 'Pass', icon: '✓', tone: 'success' },
  warning: { words: 'Warning', icon: '!', tone: 'warning' },
  fail: { words: 'Fail', icon: '×', tone: 'danger' },
  skipped: { words: 'Skipped', icon: '–', tone: 'neutral' },
}
export const checkChip = (result: string): ChipSpec => CHECK_CHIPS[result] ?? statusChip(result)

/** The checks of Service Spec §8, by id. */
export const CHECK_NAMES: Record<string, string> = {
  C1: 'Scale calibrated',
  C2: 'Dimensions consistent',
  C3: 'Area schedule reconciles',
  C4: 'Pitch plausible',
  C5: 'Complete',
  C6: 'Exclusions applied',
  C7: 'Confidence',
  C8: 'Drawing status',
  C9: 'Structure count',
}

/** The pipeline's six stages in the stepper's words (Design Brief §4.3). */
export const STAGES = [
  ['intake', 'Intake'],
  ['classify', 'Sheets'],
  ['extract', 'Reading'],
  ['calibrate', 'Scale'],
  ['check', 'Checks'],
  ['persist', 'Done'],
] as const

/** A sheet its title block marks preliminary, or not for construction. */
export const isPreliminary = (statusText: string | null) =>
  /prelim|not for construction|for reference only/i.test(statusText ?? '')

/** "2 checks need a look", "1 check needs a look". */
export const reviewLine = (fails: number) =>
  `${fails} check${fails === 1 ? ' needs' : 's need'} a look before this goes to the supplier.`
