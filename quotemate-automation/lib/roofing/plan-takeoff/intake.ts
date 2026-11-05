// TAG email intake (TKO-24, DEC-029, DEC-030): a TAG quote request, as the
// inbound provider posts it, becomes a started takeoff run.
//
// TAG's template labels everything a run needs, so the request is read
// without a model, and a message that isn't one costs nothing. The plans come
// from the attachments only. No link in a message is ever opened: TAG's CRM
// response links sit beside the file links, and opening one answers TAG as the
// supplier (P5 Channels §5).

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createRun, deleteRun, startAllowed, startRun, type RunBuilder, type TakeoffStage } from './runs'

export type TagRequest = {
  job_ref: string
  site_address: string
  scope_note: string | null
  builder: RunBuilder | null
}

// The parser reads only so much of a message, so no message can keep a
// pattern busy for long (DEC-030). A line may be a whole paragraph, as a
// mail client turning HTML into text can make it, so lines are cut only
// far beyond any TAG writes. ponytail: a request past the first 100,000
// characters is missed; raise these if a real one is.
const MAX_TEXT = 100_000
const MAX_LINES = 2_000
const MAX_LINE = 10_000
const MAX_PARAGRAPH = 10_000

// "Quote Request: <address> (<job ref>)", in the subject or a forwarded one.
const QUOTE_REQUEST = /Quote Request:\s*(.+?)\s*\(\s*([A-Z]{1,4}-?\d{2,20})\s*\)/i
// "…submit a quotation by <date> for <address> (a won contract)."
const QUOTATION_FOR = /submit a quotation by .+? for (.+?)\s*(?:\(|\.(?:\s|$)|$)/i
const NOTES = /^Notes pertaining to this quote/i
const NOTES_END = /^(Click on the links below|Please send your quotation|If you have any questions|Please use the links below)/i
const MEMBER = /please contact the member/i
const FIELD = /^(Business|Contact|Mobile|Phone|Email)\s*:\s*(.+)$/i
const EMAIL = /[^\s<>@:]+@[^\s<>@]+\.[^\s<>@]+/

/** A line as written, without its quote marks, bullet, emphasis or link
 *  targets, and with its spaces collapsed. A link target stops at the next
 *  angle bracket, so an unclosed one can't be rescanned to the line's end. */
const clean = (line: string) => line
  .slice(0, MAX_LINE)
  .replace(/^[\s>]+/, '')
  .replace(/^[-*•·]\s+/, '')
  .replace(/<(?:https?|mailto):[^<>]*>/gi, '')
  .replace(/\*+/g, '')
  .replace(/\s+/g, ' ')
  .trim()

/** The first match of a pattern in the texts, in order. */
function firstMatch(texts: string[], pattern: RegExp): RegExpExecArray | null {
  for (const text of texts) {
    const match = pattern.exec(text)
    if (match) return match
  }
  return null
}

/** TAG's request in a message, or null when it isn't one: a request names a
 *  job reference and a site. The first match of each label is taken, however
 *  many forwards the request sits under. */
export function parseTagRequest(message: { subject: string; text: string }): TagRequest | null {
  const lines = message.text.slice(0, MAX_TEXT).split(/\r?\n/, MAX_LINES).map(clean)
  const quoted = firstMatch([clean(message.subject), ...lines], QUOTE_REQUEST)
  if (!quoted) return null
  const named = quoted[1].trim()
  // The sentence can carry the postcode the subject leaves off, so it wins
  // when it extends the subject's address; read by paragraph, as mail
  // clients wrap it.
  const sentence = firstMatch(paragraphs(lines).map((p) => p.slice(0, MAX_PARAGRAPH)), QUOTATION_FOR)?.[1]
  const site = sentence?.toLowerCase().startsWith(named.toLowerCase()) ? sentence : named
  return {
    job_ref: quoted[2].toUpperCase(),
    // At most 300 characters, as the API takes: cut before the state is
    // found, which bounds its pattern, and after, as the state adds some.
    site_address: withState(site.slice(0, 300)).slice(0, 300),
    scope_note: notesIn(lines),
    builder: builderIn(lines),
  }
}

/** Runs of non-blank lines, each joined into one. */
function paragraphs(lines: string[]): string[] {
  const out: string[] = []
  let current: string[] = []
  for (const line of [...lines, '']) {
    if (line) current.push(line)
    else if (current.length) {
      out.push(current.join(' '))
      current = []
    }
  }
  return out
}

/** The lines under "Notes pertaining to this quote", up to the file list. */
function notesIn(lines: string[]): string | null {
  const start = lines.findIndex((line) => NOTES.test(line))
  if (start < 0) return null
  const notes: string[] = []
  for (const line of lines.slice(start + 1, start + 40)) {
    if (NOTES_END.test(line)) break
    if (line) notes.push(line)
  }
  return notes.length ? notes.join('\n').slice(0, 2000) : null
}

/** The member TAG names under "please contact the member": the builder. */
function builderIn(lines: string[]): RunBuilder | null {
  const start = lines.findIndex((line) => MEMBER.test(line))
  if (start < 0) return null
  const builder: RunBuilder = {}
  for (const line of lines.slice(start + 1, start + 15)) {
    const field = FIELD.exec(line)
    if (!field) continue
    const label = field[1].toLowerCase()
    const value = field[2].trim()
    if (label === 'business') builder.business ??= value.slice(0, 200)
    else if (label === 'contact') builder.contact ??= value.slice(0, 200)
    else if (label === 'email') {
      // No address is longer than 254 characters, so no more is searched.
      const email = EMAIL.exec(value.slice(0, 254))?.[0]
      if (email) builder.email ??= email.slice(0, 254)
    } else builder.phone ??= value.slice(0, 40)
  }
  return Object.keys(builder).length ? builder : null
}

// Australia Post's postcode ranges. ponytail: a few border towns use a
// neighbouring state's postcode, get its state and miss the aerial lookup,
// as an address with no postcode does. Map them if a TAG job lands in one.
const POSTCODE_STATES: Array<[number, number, string]> = [
  [200, 299, 'ACT'], [800, 999, 'NT'], [1000, 2599, 'NSW'], [2600, 2618, 'ACT'], [2619, 2899, 'NSW'],
  [2900, 2920, 'ACT'], [2921, 2999, 'NSW'], [3000, 3999, 'VIC'], [4000, 4999, 'QLD'], [5000, 5999, 'SA'],
  [6000, 6999, 'WA'], [7000, 7999, 'TAS'], [8000, 8999, 'VIC'], [9000, 9999, 'QLD'],
]

/** The state a postcode belongs to, or null for a number that isn't one. */
export function stateOfPostcode(postcode: string): string | null {
  if (!/^\d{4}$/.test(postcode)) return null
  const n = Number(postcode)
  return POSTCODE_STATES.find(([low, high]) => n >= low && n <= high)?.[2] ?? null
}

/** The address with its postcode's state when it ends in a postcode without
 *  one, so a saved measurement and the aerial merge can use it. */
export function withState(address: string): string {
  const trimmed = address.trim()
  const tail = /^(.*?)[,\s]+(\d{4})$/.exec(trimmed)
  if (!tail || /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)$/i.test(tail[1])) return trimmed
  const state = stateOfPostcode(tail[2])
  return state ? `${tail[1]} ${state} ${tail[2]}` : trimmed
}

/** The run a message's request becomes, derived from the tenant and the
 *  message's id, so a redelivered message names the same run: a version 8
 *  UUID from SHA-256. */
export function intakeRunId(tenantId: string, messageId: string): string {
  const hex = createHash('sha256').update(`takeoff-intake:${tenantId}:${messageId}`).digest('hex')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export type IntakeMessage = {
  message_id?: string | null
  subject: string
  text: string
  attachments: Array<{ filename: string; content_type?: string | null; content: Uint8Array }>
}

/** Why a message made no run. `email_unavailable` is the Resend route's:
 *  Resend wouldn't give the email or its files (DEC-031). */
export type IntakeRefusal = 'not_a_tag_request' | 'no_plans' | 'too_many_files' | 'too_large' | 'email_unavailable'

export type IntakeOutcome =
  | { ok: true; created: boolean; run_id: string; status: string; stage: TakeoffStage | null }
  | { ok: false; error: IntakeRefusal; detail: string }
  /** The tenant has started its runs for the hour: try again at `retry_at`. */
  | { ok: false; error: 'rate_limited'; retry_at: string }

type Plan = IntakeMessage['attachments'][number]
type RunState = { id: string; status: string; stage: TakeoffStage | null }

const isPdf = (file: { filename: string; content_type?: string | null }) =>
  /\.pdf$/i.test(file.filename) || file.content_type?.split(';')[0].trim().toLowerCase() === 'application/pdf'

const refuse = (error: IntakeRefusal, detail: string): IntakeOutcome => ({ ok: false, error, detail })

/** Turns a TAG request into a started `tag_email` run for the tenant: its PDF
 *  attachments uploaded to the paths createRun built, then the run started. A
 *  message that can't become a run is refused, and nothing is written. */
export async function takeTagRequest(db: SupabaseClient, bucket: string, input: {
  tenantId: string
  message: IntakeMessage
  limits: { maxFiles: number; maxFileBytes: number; runsPerHour: number }
  now?: Date
}): Promise<IntakeOutcome> {
  const { tenantId, message, limits } = input
  const request = parseTagRequest(message)
  if (!request) return refuse('not_a_tag_request', 'The message holds no TAG quote request: it names no job reference and site.')
  const plans = message.attachments.filter(isPdf)
  if (!plans.length) return refuse('no_plans', 'The message has no PDF attached, and links in a message are never opened.')
  if (plans.length > limits.maxFiles) {
    return refuse('too_many_files', `A run takes at most ${limits.maxFiles} files, and the message has ${plans.length} PDFs.`)
  }
  const large = plans.filter((file) => file.content.length > limits.maxFileBytes)
  if (large.length) {
    const mb = Math.round(limits.maxFileBytes / 1_048_576)
    return refuse('too_large', `Each file can be at most ${mb} MB: ${large.map((file) => file.filename).join(', ')}.`)
  }
  const finishing = { tenantId, plans, runsPerHour: limits.runsPerHour, now: input.now }

  // ponytail: a run the operator deleted, delivered again with the same
  // Message-ID, is made afresh under its old work keys and sits queued with no
  // job. Delete it again, or clear its sms_work_jobs rows, if that happens.
  const runId = message.message_id ? intakeRunId(tenantId, message.message_id) : undefined
  if (runId) {
    const run = await runOf(db, tenantId, runId)
    if (run && run.status !== 'draft') return { ok: true, created: false, run_id: run.id, status: run.status, stage: run.stage }
    // An earlier delivery began it and stopped, or is still going: finish it.
    const finished = run ? await finish(db, bucket, { ...finishing, runId, created: false }) : null
    if (finished) return finished
    // A draft with no upload rows stopped between createRun's two inserts.
    // Nothing could finish or start it, so it goes and the run is made afresh.
    if (run) await deleteRun(db, bucket, { tenantId, runId })
  }

  // Counted before anything is written, so a message the hour can't take
  // stores nothing, and the provider delivers it again later.
  const limit = await startAllowed(db, tenantId, limits.runsPerHour, input.now)
  if (!limit.ok) return { ok: false, error: 'rate_limited', retry_at: limit.retry_at }
  const created = await createRun(db, bucket, {
    tenantId,
    runId,
    source: 'tag_email',
    site_address: request.site_address,
    job_ref: request.job_ref,
    scope_note: request.scope_note,
    builder: request.builder,
    files: plans.map((file) => ({
      filename: file.filename,
      size_bytes: file.content.length,
      doc_type: /engineer/i.test(file.filename) ? 'engineering' : 'plan_set',
    })),
  })
  try {
    const finished = await finish(db, bucket, { ...finishing, runId: created.run_id, created: true })
    if (!finished) throw new Error('takeoff intake: the new run has no upload rows')
    return finished
  } catch (error) {
    // Without a message id no later delivery can find the draft, so it goes.
    if (!runId) {
      await deleteRun(db, bucket, { tenantId, runId: created.run_id }).catch((cleanup: unknown) =>
        console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_intake_cleanup_failed', run_id: created.run_id, cause: String(cleanup).slice(0, 200) })))
    }
    throw error
  }
}

async function runOf(db: SupabaseClient, tenantId: string, runId: string): Promise<RunState | null> {
  const found = await db.from('roof_takeoff_runs')
    .select('id, status, stage')
    .eq('id', runId).eq('tenant_id', tenantId)
    .maybeSingle()
  if (found.error) throw new Error(`takeoff intake lookup failed: ${found.error.message}`)
  return found.data as RunState | null
}

/** An upload another delivery of the same message already made. */
const alreadyStored = (error: { message: string; statusCode?: unknown }) =>
  /already exists/i.test(error.message) || String(error.statusCode) === '409'

/** Uploads the message's file for each of the run's upload rows, then starts
 *  the run. A file already stored by another delivery stays, as starting
 *  checks every file's size. A failed upload leaves the draft, for the
 *  provider's next delivery to finish. Null for a run with no upload rows,
 *  which would start with no files. */
async function finish(db: SupabaseClient, bucket: string, input: {
  tenantId: string
  runId: string
  plans: Plan[]
  runsPerHour: number
  now?: Date
  created: boolean
}): Promise<IntakeOutcome | null> {
  const found = await db.from('plan_uploads')
    .select('filename, size_bytes, pdf_path')
    .eq('takeoff_run_id', input.runId).eq('tenant_id', input.tenantId)
  if (found.error) throw new Error(`takeoff intake upload rows failed: ${found.error.message}`)
  const rows = found.data as Array<{ filename: string; size_bytes: number; pdf_path: string }>
  if (!rows.length) return null
  for (const row of rows) {
    // A row no file matches is left for starting to name as missing.
    const file = input.plans.find((plan) => plan.filename === row.filename && plan.content.length === row.size_bytes)
    if (!file) continue
    const put = await db.storage.from(bucket).upload(row.pdf_path, file.content, { contentType: 'application/pdf', upsert: false })
    if (put.error && !alreadyStored(put.error)) throw new Error(`takeoff intake upload failed: ${put.error.message}`)
  }

  const started = await startRun(db, bucket, { tenantId: input.tenantId, runId: input.runId, runsPerHour: input.runsPerHour, now: input.now })
  if (started.ok) return { ok: true, created: input.created, run_id: started.run_id, status: started.status, stage: started.stage }
  // The draft waits, so the provider's next delivery starts it.
  if (started.error === 'rate_limited') return { ok: false, error: 'rate_limited', retry_at: started.retry_at }
  if (started.error === 'conflict_status') {
    // Another delivery of the message started it first.
    const run = await runOf(db, input.tenantId, input.runId)
    if (run) return { ok: true, created: false, run_id: run.id, status: run.status, stage: run.stage }
  }
  throw new Error(`takeoff intake start failed: ${started.error}`)
}
