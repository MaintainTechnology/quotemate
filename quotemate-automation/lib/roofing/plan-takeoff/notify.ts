// The operator's email when a run settles (TKO-23): ready, needs review or
// failed. The stage handler sends it when a stage answers `finished` or
// `failed`, which happens once per settled run: the run moves by
// compare-and-set, and a replay of a settled run is skipped. Pure but for the
// send it is given, and it never throws, so an email can't fail a stage.

import type { SupabaseClient } from '@supabase/supabase-js'

export type Settled = { done: 'finished'; status: string } | { done: 'failed'; note: string }
export type OperatorMail = { to: string; subject: string; html: string; text: string }
export type OperatorNotifier = {
  recipients: string[]
  send: (mail: OperatorMail) => Promise<{ ok: boolean }>
  /** The run's operator page, when this service knows its own address. */
  runUrl?: (runId: string) => string
  timeoutMs?: number
}

type RunFacts = {
  site_address: string
  job_ref: string | null
  job_name: string | null
  builder: { business?: string | null } | null
  checks: { results?: Array<{ id: string; result: string; detail?: string }> } | null
  business_name: string | null
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ENTITIES[c])

/** The email for a settled run: what it is, whose, and what to look at. */
export function operatorEmail(run: RunFacts, outcome: Settled, link: string | null) {
  const status = outcome.done === 'failed' ? 'failed' : outcome.status === 'needs_review' ? 'needs review' : 'ready'
  const job = [run.job_name, run.job_ref && `(${run.job_ref})`].filter(Boolean).join(' ')
  const whose = `${run.business_name ?? 'A tenant'}'s takeoff${job ? ` for ${job}` : ''} at ${run.site_address}`
    + (run.builder?.business ? `, for ${run.builder.business},` : '')
  const failed = (run.checks?.results ?? []).filter((c) => c.result === 'fail').map((c) => `${c.id} failed: ${c.detail ?? ''}`.trim())
  const summary = outcome.done === 'failed' ? `${whose} failed: ${outcome.note}`
    : status === 'ready' ? `${whose} is ready: every check passed.`
      : `${whose} needs review.`
  const lines = [summary, ...(status === 'needs review' ? failed : []), ...(link ? [`Open the run: ${link}`] : [])]
  const html = [
    `<p>${esc(summary)}</p>`,
    status === 'needs review' && failed.length ? `<ul>${failed.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '',
    link ? `<p><a href="${esc(link)}">Open the run</a></p>` : '',
  ].join('')
  return {
    subject: `Takeoff ${status}: ${[run.job_ref, run.site_address].filter(Boolean).join(', ')}`,
    text: lines.join('\n\n'),
    html,
  }
}

/** Sends the settled run's email to each operator address. Answers how many
 *  sends were accepted; a refused, throwing or slow send just goes unsent. */
export async function notifyOperator(db: SupabaseClient, runId: string, outcome: Settled, deps: OperatorNotifier): Promise<{ sent: number; skipped?: string }> {
  if (!deps.recipients.length) return { sent: 0, skipped: 'no recipients' }
  try {
    const found = await db.from('roof_takeoff_runs')
      .select('id, tenant_id, site_address, job_ref, job_name, builder, checks')
      .eq('id', runId).maybeSingle()
    const run = found.data as (RunFacts & { tenant_id: string }) | null
    if (!run) return { sent: 0, skipped: 'no run' }
    const tenant = await db.from('tenants').select('business_name').eq('id', run.tenant_id).maybeSingle()
    const mail = operatorEmail({ ...run, business_name: (tenant.data as { business_name?: string } | null)?.business_name ?? null }, outcome, deps.runUrl?.(runId) ?? null)
    let sent = 0
    for (const to of deps.recipients) {
      if (await accepted(() => deps.send({ to, ...mail }), deps.timeoutMs ?? 10_000)) sent++
      else console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_notify_unsent', run_id: runId }))
    }
    if (sent) console.log(JSON.stringify({ level: 'info', event: 'takeoff_notify_sent', run_id: runId, sent }))
    return { sent }
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_notify_failed', run_id: runId, cause: String(error).slice(0, 200) }))
    return { sent: 0 }
  }
}

/** The operator's email for a TAG message that couldn't become a run
 *  (TKO-24, DEC-029): why, and the message's subject, so they can find it.
 *  The subject is the sender's, so it is kept to one line and escaped. Never
 *  throws, as a run's email doesn't. */
export async function notifyIntakeRefused(
  refused: { subject: string; error: string; detail: string },
  deps: Pick<OperatorNotifier, 'recipients' | 'send' | 'timeoutMs'>,
): Promise<{ sent: number; skipped?: string }> {
  if (!deps.recipients.length) return { sent: 0, skipped: 'no recipients' }
  const subject = refused.subject.replace(/\s+/g, ' ').trim().slice(0, 200)
  const summary = `A message to the takeoff intake made no run (${refused.error}): ${refused.detail}`
  const mail = {
    subject: `Takeoff request not taken: ${subject}`,
    text: `${summary}\n\nIts subject: ${subject}`,
    html: `<p>${esc(summary)}</p><p>Its subject: ${esc(subject)}</p>`,
  }
  let sent = 0
  try {
    for (const to of deps.recipients) {
      if (await accepted(() => deps.send({ to, ...mail }), deps.timeoutMs ?? 10_000)) sent++
      else console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_intake_notify_unsent', error: refused.error }))
    }
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_intake_notify_failed', cause: String(error).slice(0, 200) }))
  }
  return { sent }
}

/** True when the send is accepted in time. */
async function accepted(send: () => Promise<{ ok: boolean }>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms) })
  try {
    return await Promise.race([send().then((result) => result.ok === true, () => false), late])
  } finally {
    clearTimeout(timer)
  }
}
