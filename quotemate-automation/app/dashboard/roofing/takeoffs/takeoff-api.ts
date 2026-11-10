// The dashboard's plan takeoff pages (TKO-19) call the takeoff service as the
// signed-in tradie. The service's address is NEXT_PUBLIC_TAKEOFF_API_URL:
// unset, the pages say takeoffs are off and the dashboard doesn't link them.

import { getAuthToken } from '@/lib/auth/client-token'
import type { Fall, RegionAnswer, RegionsView } from '@/lib/roofing/plan-takeoff'

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

/** Fetches a file from the takeoff service with the tradie's token, such as
 *  the Roof Wizard pack (TKO-18). A refusal throws a TakeoffError, as every
 *  call does. */
export async function takeoffDownload(path: string): Promise<Blob> {
  const token = await getAuthToken()
  const res = await fetch(`${TAKEOFF_API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (res.ok) return res.blob()
  const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: unknown }
  throw new TakeoffError(res.status, body.error ?? 'error', res.status === 401 ? NOT_ON_ACCOUNT : words(body.detail), body.detail ?? null)
}

/** Saves a downloaded file under its name, as the browser saves any download. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // The click has started the download; the URL can go once it has the blob.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
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
  C10: 'Aerial agrees',
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

// ── The numbered roof areas (TKO-30, DEC-048) ────────────────────────────────

/** The roof choice that leaves an area out of the job. */
export const LEFT_OUT = 'left-out'
/** One area's choices in the form: a roof's id or LEFT_OUT, and a fall; '' until chosen. */
export type AreaChoice = { roof: string; fall: string }

/** A fall in words, the plan's north up. */
export const FALL_WORDS: Record<Fall, string> = {
  north: 'North, up the plan',
  south: 'South, down the plan',
  east: 'East, to the right',
  west: 'West, to the left',
}

/** Each area as the form starts it: the operator's last answer, else the
 *  reader's suggestion, else unanswered. */
export function startingChoices(regions: RegionsView): Record<number, AreaChoice> {
  return Object.fromEntries(regions.areas.map(({ n }): [number, AreaChoice] => {
    const given = regions.confirmed?.areas.find((a) => a.n === n) ?? regions.suggested?.find((a) => a.n === n)
    if (!given) return [n, { roof: '', fall: '' }]
    return [n, given.roof === null ? { roof: LEFT_OUT, fall: '' } : { roof: given.roof, fall: given.fall ?? '' }]
  }))
}

/** The form's choices as the service takes them: every area answered, each
 *  area of the job with a fall its sheeting allows; null while one isn't. */
export function regionAnswers(regions: RegionsView, choices: Record<number, AreaChoice>): RegionAnswer[] | null {
  const answers: RegionAnswer[] = []
  for (const { n, falls } of regions.areas) {
    const choice = choices[n]
    if (!choice?.roof) return null
    if (choice.roof === LEFT_OUT) {
      answers.push({ n, roof: null, fall: null })
      continue
    }
    const fall = falls.find((f) => f === choice.fall)
    if (!fall) return null
    answers.push({ n, roof: choice.roof, fall })
  }
  return answers
}

/** The header's line while numbered areas wait on the operator. */
export const regionsLine = (count: number) =>
  count === 1
    ? 'One roof area on the plan needs you to say which roof it is: see Takeoff.'
    : `${count} roof areas on the plan need you to say which roof each is: see Takeoff.`
