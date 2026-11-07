// The operator's email when a run settles (TKO-23): ready, needs review or
// failed, to each operator address, and never a reason for a stage to fail.
// Also the email for a TAG message that made no run (TKO-24).

import { describe, expect, it, vi } from 'vitest'
import { notifyIntakeRefused, notifyOperator, operatorEmail, type OperatorMail } from './notify'
import { fakeDb } from './test-db'

const TENANT = '11111111-1111-4111-8111-111111111111'
const RUN = '22222222-2222-4222-8222-222222222222'
const LINK = `https://takeoff.example/runs/${RUN}`
const run = (over: Record<string, unknown> = {}) => ({
  id: RUN, tenant_id: TENANT, status: 'ready', status_note: null,
  site_address: '12 Sample St, Exampleton QLD 4305', job_ref: 'J10001', job_name: 'Sample St dual occupancy',
  builder: { business: 'Example Constructions Pty Ltd' },
  checks: { status: 'ready', results: [{ id: 'C1', result: 'pass', detail: 'Calibrated on two dimensions' }] },
  ...over,
})
const facts = (over: Record<string, unknown> = {}) => ({ ...run(over), business_name: 'Peppers Plumbing' })
const setup = (over: Record<string, unknown> = {}) =>
  fakeDb({ runs: [run(over)], tenants: [{ id: TENANT, business_name: 'Peppers Plumbing' }] })
const accepting = () => vi.fn<(mail: OperatorMail) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))

describe('operatorEmail', () => {
  it('says a run is ready, whose it is and where to open it', () => {
    const mail = operatorEmail(facts(), { done: 'finished', status: 'ready' }, LINK)
    expect(mail.subject).toBe('Takeoff ready: J10001, 12 Sample St, Exampleton QLD 4305')
    for (const words of ['Peppers Plumbing', 'Sample St dual occupancy', 'Example Constructions Pty Ltd', 'every check passed', LINK]) {
      expect(mail.text).toContain(words)
    }
    expect(mail.html).toContain(`<a href="${LINK}">`)
  })

  it('names the checks a run under review failed, with what each found', () => {
    const checks = { status: 'needs_review', results: [
      { id: 'C1', result: 'fail', detail: 'No written dimension to calibrate on' },
      { id: 'C5', result: 'fail', detail: 'S1-P1 has no area' },
      { id: 'C7', result: 'pass', detail: 'ok' },
    ] }
    const mail = operatorEmail(facts({ status: 'needs_review', checks }), { done: 'finished', status: 'needs_review' }, null)
    expect(mail.subject).toBe('Takeoff needs review: J10001, 12 Sample St, Exampleton QLD 4305')
    expect(mail.text).toContain('C1 failed: No written dimension to calibrate on')
    expect(mail.text).toContain('C5 failed: S1-P1 has no area')
    expect(mail.text).not.toContain('C7')
    expect(mail.text).not.toContain('Open the run')
  })

  it('gives a failed run its note', () => {
    const note = "Bomb.pdf unpacks to far more than any plan set, so it wasn't read. Save it again as a standard PDF."
    const mail = operatorEmail(facts({ status: 'failed', status_note: note }), { done: 'failed', note }, LINK)
    expect(mail.subject).toBe('Takeoff failed: J10001, 12 Sample St, Exampleton QLD 4305')
    expect(mail.text).toContain(note)
  })

  it('escapes what the run carries in the HTML', () => {
    const mail = operatorEmail(facts({ job_name: '<img src=x onerror=alert(1)>' }), { done: 'finished', status: 'ready' }, LINK)
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('notifyOperator', () => {
  it('sends the email to each operator address', async () => {
    const send = accepting()
    await expect(notifyOperator(setup().db, RUN, { done: 'finished', status: 'ready' }, { recipients: ['a@ops.test', 'b@ops.test'], send }))
      .resolves.toEqual({ sent: 2 })
    expect(send.mock.calls.map(([mail]) => mail.to)).toEqual(['a@ops.test', 'b@ops.test'])
    expect(send.mock.calls[0][0].text).toContain('Peppers Plumbing')
  })

  it('sends nothing without a recipient', async () => {
    const send = accepting()
    await expect(notifyOperator(setup().db, RUN, { done: 'finished', status: 'ready' }, { recipients: [], send }))
      .resolves.toEqual({ sent: 0, skipped: 'no recipients' })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing for a run that is gone', async () => {
    const send = accepting()
    await expect(notifyOperator(fakeDb({}).db, RUN, { done: 'failed', note: 'x' }, { recipients: ['a@ops.test'], send }))
      .resolves.toEqual({ sent: 0, skipped: 'no run' })
  })

  it('never throws: a refused, a throwing or a slow send only goes unsent', async () => {
    const outcome = { done: 'finished', status: 'ready' } as const
    const refused = vi.fn(async () => ({ ok: false, reason: 'http_422' }))
    const throwing = vi.fn(async () => { throw new Error('network down') })
    const slow = vi.fn(() => new Promise<{ ok: boolean }>(() => {}))
    const deps = { recipients: ['a@ops.test'] }
    await expect(notifyOperator(setup().db, RUN, outcome, { ...deps, send: refused })).resolves.toEqual({ sent: 0 })
    await expect(notifyOperator(setup().db, RUN, outcome, { ...deps, send: throwing })).resolves.toEqual({ sent: 0 })
    const started = Date.now()
    await expect(notifyOperator(setup().db, RUN, outcome, { ...deps, send: slow, timeoutMs: 50 })).resolves.toEqual({ sent: 0 })
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('notifyIntakeRefused (TKO-24)', () => {
  const refused = {
    subject: 'Fw: RESEND of\r\n Quote Request: <b>12 Sample St</b>',
    error: 'no_plans',
    detail: 'The message has no PDF attached, and links in a message are never opened.',
  }

  it('emails each operator why a message made no run, with its subject on one line and escaped', async () => {
    const send = accepting()
    await expect(notifyIntakeRefused(refused, { recipients: ['a@ops.test', 'b@ops.test'], send })).resolves.toEqual({ sent: 2 })
    const mail = send.mock.calls[0][0]
    expect(mail.to).toBe('a@ops.test')
    expect(mail.subject).toBe('Takeoff request not taken: Fw: RESEND of Quote Request: <b>12 Sample St</b>')
    expect(mail.text).toContain('no PDF attached')
    expect(mail.html).toContain('&lt;b&gt;12 Sample St&lt;/b&gt;')
    expect(mail.html).not.toContain('<b>')
  })

  it('sends nothing without a recipient, and never throws', async () => {
    const throwing = vi.fn(async () => { throw new Error('network down') })
    await expect(notifyIntakeRefused(refused, { recipients: [], send: throwing })).resolves.toEqual({ sent: 0, skipped: 'no recipients' })
    await expect(notifyIntakeRefused(refused, { recipients: ['a@ops.test'], send: throwing })).resolves.toEqual({ sent: 0 })
  })
})
