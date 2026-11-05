// TAG email intake (TKO-24, DEC-029): reading TAG's request, then a message
// made into a started run over the in-memory client in test-db.ts. The
// requests follow TAG's template with placeholder names; no real email is in
// this repo.

import { describe, it, expect } from 'vitest'
import { exclusionsAsked } from './checks'
import { intakeRunId, parseTagRequest, stateOfPostcode, takeTagRequest, withState, type IntakeMessage } from './intake'
import { runFilePath } from './runs'
import { fakeDb } from './test-db'

const TENANT = '0b8f6c1e-2d4a-4f5b-9c3d-7e1a2b3c4d5e'
const NOW = new Date('2026-11-04T01:00:00.000Z')

// Grange's request as a phone's forward, in plain text: header blocks, list
// bullets, and links in angle brackets.
const GRANGE_SUBJECT = 'Fw: RESEND of Quote Request: 59 Grange Rd, Eastern Heights (J14997)'
const GRANGE_TEXT = [
  'Here is a second one.',
  '',
  'Sent from my iPhone',
  '',
  '________________________________',
  'From: TAG Quotes <quotes@tag.example>',
  'Subject: RE: RESEND of Quote Request: 59 Grange Rd, Eastern Heights (J14997)',
  '',
  'The site address is 59 Grange Rd, Eastern Heights & I have attached a copy of the plans.',
  '',
  '________________________________',
  'From: TAG Quotes <quotes@tag.example>',
  'Subject: RESEND of Quote Request: 59 Grange Rd, Eastern Heights (J14997)',
  '',
  'Could you please submit a quotation by 9/10/2026 for 59 Grange Rd, Eastern Heights 4305 (a won contract).',
  '',
  'Please use the links below to indicate if you intend to quote on this request.',
  '',
  '  *   Yes - I intend to quote<https://crm.tag.example/respond?code=731>',
  '  *   No - I will not be quoting<https://crm.tag.example/respond?code=732>',
  '  *   Need More Info<https://crm.tag.example/respond?code=734>',
  '',
  'Notes pertaining to this quote',
  '',
  '  *   Roofing - Steel (Supply & Fit)',
  '',
  'Click on the links below to open files for this job:',
  '',
  '  *   Architectural<https://files.tag.example/architectural.pdf>',
  '  *   Engineering<https://files.tag.example/engineering.pdf>',
  '',
  'Please send your quotation to quotes@tag.example.',
  '',
  'If you have any questions regarding the plans or what needs to be quoted, please contact the member:',
  '',
  'Business: Example Constructions Pty Ltd',
  'Contact: A. Builder',
  'Mobile: 0400 000 000',
  'Email: office@builder.example<mailto:office@builder.example>',
  'Address: 1 Example St, West Ipswich 4305',
  '',
  'If you have any other queries please call the TAG line.',
].join('\r\n')

// Whittaker's, quoted under a reply, its sentence wrapped and its note in bold.
const WHITTAKER_SUBJECT = 'Fw: RESEND of Quote Request: 5 Whittaker Street, North Ipswich (J14945)'
const WHITTAKER_TEXT = [
  'Do you think these house plans can be turned into a quote for roofing?',
  '',
  '> Could you please submit a quotation by 9/10/2026 for 5 Whittaker Street,',
  '> North Ipswich (currently under construction).',
  '>',
  '> Notes pertaining to this quote',
  '>',
  '> - **Roofing - Steel (Supply & Fit)**: Complete re-roof of existing + new section of roof over the laundry / bathroom. However, please exclude the insulated roof over the new deck.;',
  '>',
  '> Click on the links below to open files for this job:',
  '>',
  '> - Floor Plan',
].join('\n')

const GRANGE_BUILDER = { business: 'Example Constructions Pty Ltd', contact: 'A. Builder', phone: '0400 000 000', email: 'office@builder.example' }

describe('parseTagRequest', () => {
  it("reads Grange's request from a phone's forward: its reference, its site with the state, its scope and its builder", () => {
    expect(parseTagRequest({ subject: GRANGE_SUBJECT, text: GRANGE_TEXT })).toEqual({
      job_ref: 'J14997',
      site_address: '59 Grange Rd, Eastern Heights QLD 4305',
      scope_note: 'Roofing - Steel (Supply & Fit)',
      builder: GRANGE_BUILDER,
    })
  })

  it("finds the request under a forward whose own subject doesn't name it", () => {
    expect(parseTagRequest({ subject: 'Fwd: plans', text: GRANGE_TEXT })).toMatchObject({ job_ref: 'J14997', site_address: '59 Grange Rd, Eastern Heights QLD 4305' })
  })

  it("reads Whittaker's quoted, wrapped request, keeping the exclusion C6 looks for", () => {
    const request = parseTagRequest({ subject: WHITTAKER_SUBJECT, text: WHITTAKER_TEXT })
    expect(request).toEqual({
      job_ref: 'J14945',
      site_address: '5 Whittaker Street, North Ipswich',
      scope_note: 'Roofing - Steel (Supply & Fit): Complete re-roof of existing + new section of roof over the laundry / bathroom. However, please exclude the insulated roof over the new deck.;',
      builder: null,
    })
    expect(exclusionsAsked(request!.scope_note)).toEqual(['please exclude the insulated roof over the new deck'])
  })

  it("takes the subject's address when the body has no sentence for it, or the sentence's would cut it short", () => {
    const notes = 'Notes pertaining to this quote\n\n- Roofing - Steel (Supply & Fit)\n\nClick on the links below to open files for this job:'
    expect(parseTagRequest({ subject: GRANGE_SUBJECT, text: notes })).toMatchObject({ site_address: '59 Grange Rd, Eastern Heights', scope_note: 'Roofing - Steel (Supply & Fit)' })
    const cut = 'Could you please submit a quotation by 9/10/2026 for 12 Smith St. Booval (a tender).'
    expect(parseTagRequest({ subject: 'Quote Request: 12 Smith St. Booval (J20001)', text: cut })).toMatchObject({ site_address: '12 Smith St. Booval' })
  })

  it('is null for a message that is not a TAG request', () => {
    expect(parseTagRequest({ subject: 'Lunch on Friday?', text: 'Are you free?' })).toBeNull()
    expect(parseTagRequest({ subject: 'Quote Request: 59 Grange Rd, Eastern Heights', text: 'No job number here.' })).toBeNull()
    expect(parseTagRequest({ subject: `Quote Request: 1 Main St (J${'1'.repeat(30)})`, text: '' })).toBeNull()
  })

  it('keeps a long one-line note whole, as a mail client turning HTML into text may give it', () => {
    const note = `Roofing - Steel (Supply & Fit): ${'Complete re-roof of the existing house. '.repeat(40)}However, please exclude the insulated roof over the new deck.`
    const text = `Notes pertaining to this quote\n\n- ${note}\n\nClick on the links below to open files for this job:`
    const request = parseTagRequest({ subject: WHITTAKER_SUBJECT, text })
    expect(request?.scope_note).toBe(note)
    expect(exclusionsAsked(request!.scope_note)).toEqual(['please exclude the insulated roof over the new deck'])
  })

  it('caps the site as the API does', () => {
    const request = parseTagRequest({ subject: `Quote Request: ${'Long Street '.repeat(60)}(J1234)`, text: '' })
    expect(request!.site_address.length).toBeLessThanOrEqual(300)
    expect(request!.site_address.length).toBeGreaterThan(290)
  })

  it('reads a hostile message in bounded time: long lines, unclosed links, runs of spaces', () => {
    const started = performance.now()
    expect(parseTagRequest({ subject: 'x', text: '<http:'.repeat(160_000) })).toBeNull()
    expect(parseTagRequest({ subject: `Quote Request: a${' '.repeat(200_000)}b`, text: `Quote Request: a${' '.repeat(200_000)}b` })).toBeNull()
    expect(parseTagRequest({ subject: GRANGE_SUBJECT, text: `submit a quotation by 1 for ${'x '.repeat(400_000)}` })).toMatchObject({ job_ref: 'J14997' })
    expect(parseTagRequest({ subject: GRANGE_SUBJECT, text: `please contact the member\nEmail: ${'a'.repeat(900_000)}` })).toMatchObject({ builder: null })
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('stateOfPostcode and withState', () => {
  it('gives each postcode its state, and none to a number that is not one', () => {
    const states = ['4305', '2000', '2600', '2913', '0800', '3000', '5000', '6000', '7000', '0100', '43'].map(stateOfPostcode)
    expect(states).toEqual(['QLD', 'NSW', 'ACT', 'ACT', 'NT', 'VIC', 'SA', 'WA', 'TAS', null, null])
  })

  it('adds the state to an address that ends in a postcode without one, and leaves any other as written', () => {
    expect(withState('59 Grange Rd, Eastern Heights 4305')).toBe('59 Grange Rd, Eastern Heights QLD 4305')
    expect(withState('1 Example Pl, Canberra, 2600')).toBe('1 Example Pl, Canberra ACT 2600')
    expect(withState('59 Grange Rd, Eastern Heights QLD 4305')).toBe('59 Grange Rd, Eastern Heights QLD 4305')
    expect(withState(' 5 Whittaker Street, North Ipswich ')).toBe('5 Whittaker Street, North Ipswich')
  })
})

describe('intakeRunId', () => {
  it('names the same run for the same tenant and message, as a version 8 UUID', () => {
    const id = intakeRunId(TENANT, '<request-1@tag.example>')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(intakeRunId(TENANT, '<request-1@tag.example>')).toBe(id)
    expect(intakeRunId(TENANT, '<request-2@tag.example>')).not.toBe(id)
    expect(intakeRunId('5e4d3c2b-1a2b-4c3d-9e8f-0a1b2c3d4e5f', '<request-1@tag.example>')).not.toBe(id)
  })
})

describe('takeTagRequest', () => {
  const pdf = (body: string) => new Uint8Array(Buffer.from(`%PDF-1.7\n${body}`))
  const ARCHITECTURAL = pdf('architectural')
  const ENGINEERING = pdf('engineering')
  const message = (over: Partial<IntakeMessage> = {}): IntakeMessage => ({
    message_id: '<request-1@tag.example>',
    subject: GRANGE_SUBJECT,
    text: GRANGE_TEXT,
    attachments: [
      { filename: 'Architectural - 59 Grange Rd.pdf', content_type: 'application/pdf', content: ARCHITECTURAL },
      { filename: 'image001.png', content_type: 'image/png', content: new Uint8Array([137, 80, 78, 71]) },
      { filename: 'Engineering- 59 GRANGE RD', content_type: 'application/pdf; name="Engineering"', content: ENGINEERING },
    ],
    ...over,
  })
  const LIMITS = { maxFiles: 10, maxFileBytes: 50 * 1_048_576, runsPerHour: 8 }
  const take = (fake: ReturnType<typeof fakeDb>, over: Partial<IntakeMessage> = {}, limits = LIMITS) =>
    takeTagRequest(fake.db, 'plan-pdfs', { tenantId: TENANT, message: message(over), limits, now: NOW })
  const RUN = intakeRunId(TENANT, '<request-1@tag.example>')

  it("makes a started tag_email run from the PDF attachments, with the request's fields, its files where createRun put them", async () => {
    const fake = fakeDb()
    await expect(take(fake)).resolves.toEqual({ ok: true, created: true, run_id: RUN, status: 'queued', stage: 'intake' })
    expect(fake.tables.roof_takeoff_runs).toEqual([expect.objectContaining({
      id: RUN,
      tenant_id: TENANT,
      source: 'tag_email',
      job_ref: 'J14997',
      site_address: '59 Grange Rd, Eastern Heights QLD 4305',
      scope_note: 'Roofing - Steel (Supply & Fit)',
      builder: GRANGE_BUILDER,
      status: 'queued',
    })])
    const uploads = fake.tables.plan_uploads
    expect(uploads.map((u) => [u.filename, u.doc_type, u.size_bytes])).toEqual([
      ['Architectural - 59 Grange Rd.pdf', 'plan_set', ARCHITECTURAL.length],
      ['Engineering- 59 GRANGE RD', 'engineering', ENGINEERING.length],
    ])
    expect(fake.objects[runFilePath(TENANT, RUN, String(uploads[0].id))]).toEqual(ARCHITECTURAL)
    expect(fake.objects[runFilePath(TENANT, RUN, String(uploads[1].id))]).toEqual(ENGINEERING)
    expect(fake.rpc).toHaveBeenCalledTimes(1)
  })

  it('answers a message delivered again with the run it made, and makes no second one', async () => {
    const fake = fakeDb()
    await take(fake)
    await expect(take(fake)).resolves.toEqual({ ok: true, created: false, run_id: RUN, status: 'queued', stage: 'intake' })
    expect(fake.tables.roof_takeoff_runs).toHaveLength(1)
    expect(fake.rpc).toHaveBeenCalledTimes(1)
  })

  it('finishes a draft an earlier delivery left: uploads the files it lacks, keeps the one there, then starts it', async () => {
    const architectural = runFilePath(TENANT, RUN, 'upload-a')
    const engineering = runFilePath(TENANT, RUN, 'upload-e')
    const fake = fakeDb({
      runs: [{ id: RUN, tenant_id: TENANT, status: 'draft' }],
      uploads: [
        { id: 'upload-a', tenant_id: TENANT, takeoff_run_id: RUN, filename: 'Architectural - 59 Grange Rd.pdf', size_bytes: ARCHITECTURAL.length, pdf_path: architectural },
        { id: 'upload-e', tenant_id: TENANT, takeoff_run_id: RUN, filename: 'Engineering- 59 GRANGE RD', size_bytes: ENGINEERING.length, pdf_path: engineering },
      ],
      objects: { [architectural]: ARCHITECTURAL },
    })
    await expect(take(fake)).resolves.toEqual({ ok: true, created: false, run_id: RUN, status: 'queued', stage: 'intake' })
    expect(fake.objects[engineering]).toEqual(ENGINEERING)
    expect(fake.tables.roof_takeoff_runs).toHaveLength(1)
    expect(fake.tables.plan_uploads.map((u) => u.id)).toEqual(['upload-a', 'upload-e'])
  })

  it('makes the run afresh over a draft with no upload rows, which no delivery could finish', async () => {
    const fake = fakeDb({ runs: [{ id: RUN, tenant_id: TENANT, status: 'draft' }] })
    await expect(take(fake)).resolves.toEqual({ ok: true, created: true, run_id: RUN, status: 'queued', stage: 'intake' })
    expect(fake.tables.roof_takeoff_runs).toHaveLength(1)
    expect(fake.tables.plan_uploads).toHaveLength(2)
    expect(Object.keys(fake.objects)).toHaveLength(2)
  })

  it('answers with the run when another delivery of the message starts it first', async () => {
    const fake = fakeDb()
    await take(fake)
    // A draft, and a second delivery that starts it while this one checks the files.
    const run = fake.tables.roof_takeoff_runs[0]
    Object.assign(run, { status: 'draft', stage: null })
    fake.hooks.onList = () => { Object.assign(run, { status: 'queued', stage: 'intake' }) }
    await expect(take(fake)).resolves.toEqual({ ok: true, created: false, run_id: RUN, status: 'queued', stage: 'intake' })
  })

  it('gives a message without a message id a run of its own each time', async () => {
    const fake = fakeDb()
    const first = await take(fake, { message_id: null })
    const second = await take(fake, { message_id: null })
    expect([first.ok && first.created, second.ok && second.created]).toEqual([true, true])
    expect(fake.tables.roof_takeoff_runs).toHaveLength(2)
  })

  it('writes nothing while the tenant has started its runs for the hour, and says when it can', async () => {
    const started = new Date(NOW.getTime() - 600_000).toISOString()
    const fake = fakeDb({ runs: [{ id: 'busy', tenant_id: TENANT, status: 'ready', updated_at: started, usage: { starts: [started] } }] })
    await expect(take(fake, {}, { ...LIMITS, runsPerHour: 1 })).resolves.toEqual({ ok: false, error: 'rate_limited', retry_at: '2026-11-04T01:50:00.000Z' })
    expect(fake.tables.roof_takeoff_runs.map((r) => r.id)).toEqual(['busy'])
    expect(fake.objects).toEqual({})
  })

  it('keeps a draft the hour holds, so a later delivery starts it', async () => {
    const fake = fakeDb()
    await expect(take(fake, {}, { ...LIMITS, runsPerHour: 1 })).resolves.toMatchObject({ ok: true, status: 'queued' })
    Object.assign(fake.tables.roof_takeoff_runs[0], { status: 'draft', stage: null })
    await expect(take(fake, {}, { ...LIMITS, runsPerHour: 1 })).resolves.toEqual({ ok: false, error: 'rate_limited', retry_at: expect.any(String) })
    expect(fake.tables.roof_takeoff_runs[0].status).toBe('draft')
    await expect(take(fake, {}, { ...LIMITS, runsPerHour: 2 })).resolves.toMatchObject({ ok: true, created: false, status: 'queued' })
  })

  it('refuses a message that is not a TAG request, or has no PDF attached, and writes nothing', async () => {
    const fake = fakeDb()
    await expect(take(fake, { subject: 'Lunch on Friday?', text: 'Are you free?' })).resolves.toMatchObject({ ok: false, error: 'not_a_tag_request' })
    await expect(take(fake, { attachments: [{ filename: 'image001.png', content_type: 'image/png', content: new Uint8Array([1]) }] }))
      .resolves.toMatchObject({ ok: false, error: 'no_plans' })
    expect(fake.tables.roof_takeoff_runs).toEqual([])
    expect(fake.objects).toEqual({})
  })

  it('refuses more PDFs than a run takes, or one larger than a file may be, naming it', async () => {
    const fake = fakeDb()
    await expect(take(fake, {}, { ...LIMITS, maxFiles: 1 })).resolves.toMatchObject({ ok: false, error: 'too_many_files' })
    await expect(take(fake, {}, { ...LIMITS, maxFileBytes: ENGINEERING.length }))
      .resolves.toMatchObject({ ok: false, error: 'too_large', detail: expect.stringContaining('Architectural - 59 Grange Rd.pdf') })
    expect(fake.tables.roof_takeoff_runs).toEqual([])
  })

  it('removes the draft when an upload fails for a message with no id, as no later delivery could find it', async () => {
    const fake = fakeDb()
    fake.fail.upload = true
    await expect(take(fake, { message_id: null })).rejects.toThrow('upload refused')
    expect(fake.tables.roof_takeoff_runs).toEqual([])
    expect(fake.tables.plan_uploads).toEqual([])
  })

  it('keeps the draft when an upload fails, and the next delivery finishes it', async () => {
    const fake = fakeDb()
    fake.fail.upload = true
    await expect(take(fake)).rejects.toThrow('upload refused')
    expect(fake.tables.roof_takeoff_runs).toEqual([expect.objectContaining({ id: RUN, status: 'draft' })])
    fake.fail.upload = false
    await expect(take(fake)).resolves.toEqual({ ok: true, created: false, run_id: RUN, status: 'queued', stage: 'intake' })
    expect(Object.keys(fake.objects)).toHaveLength(2)
  })
})
