// The plan reader (TKO-11, P2 Reading §5). The chosen sheets go to the model as
// one PDF; its JSON is checked against the schema, with one repair round that
// passes the problems back, and assembled into a RoofPlanTakeoff. When its
// planes fall short of the drawings' roof footprint, it is asked once to look
// for a roof it left out (TKO-15). The reader
// fills in what needs no model: the sheet index, each plane's sloped area, and
// the file and page behind each piece of evidence.

import { anthropic } from '@ai-sdk/anthropic'
import { generateText, type ModelMessage } from 'ai'
import { z } from 'zod'
import { deterministicSampling } from '@/lib/llm/sampling'
import { currentSmsWork, smsWorkCheckpoint } from '@/lib/sms/durable-work'
import { footprintLine, SCHEDULE_PCT, type ScheduleLine } from './checks'
import { cutPages, type Sheet } from './classify'
import { READER_SYSTEM, readerRequest } from './prompt'
import { PlaneSchema, RoofPlanTakeoffSchema, StructureSchema, type RoofPlanTakeoff } from './schema'

export const DEFAULT_TAKEOFF_MODEL = 'claude-opus-4-8'
// ponytail: one model call reads the whole run, inside the queue's 240-second
// attempt. Split the reading by structure group if large sets run out of time.
export const READ_MAX_OUTPUT_TOKENS = 12_000
/** The most one run may spend on the model, over all its stages and restarts. */
export const RUN_TOKEN_BUDGET = 1_500_000

export type ModelUsage = { inputTokens: number; outputTokens: number; calls: number }
export type ReadOutcome =
  | { ok: true; takeoff: RoofPlanTakeoff; model: string; usage: ModelUsage }
  | { ok: false; note: string; model: string; usage: ModelUsage }

/** What the model writes: the takeoff without what the reader fills in. */
const ModelPlane = PlaneSchema.omit({ sloped_area_m2: true, evidence: true }).extend({
  evidence: z.array(z.object({ page: z.number().int().positive(), text: z.string().nullable() })).min(1),
})
const ModelTakeoff = z.object({
  scale: z.object({ stated: z.string().nullable(), sheet_size: z.string().nullable(), page: z.number().int().positive().nullable() }),
  structures: z.array(StructureSchema.omit({ source: true, planes: true }).extend({ planes: z.array(ModelPlane) })),
  scope: RoofPlanTakeoffSchema.shape.scope,
})
type Reply = { text: string; finishReason: string; inputTokens: number; outputTokens: number }

const round2 = (n: number) => Math.round(n * 100) / 100
const issues = (error: z.ZodError) => error.issues.slice(0, 20).map((i) => `${i.path.join('.') || 'reply'}: ${i.message}`)

/** The model's reply as a takeoff, or what is wrong with it. `pages` are the
 *  attached pages in order; `sizes` their printed sizes in points. */
export function assemble(reply: string, sheets: Sheet[], pages: Sheet[], sizes: [number, number][]): { takeoff: RoofPlanTakeoff } | { problems: string[] } {
  let json: unknown
  try {
    json = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))
  } catch {
    return { problems: ['The reply is not one complete JSON object.'] }
  }
  const parsed = ModelTakeoff.safeParse(json)
  if (!parsed.success) return { problems: issues(parsed.error) }
  const read = parsed.data

  const problems: string[] = []
  const attached = (page: number, where: string) => {
    if (page <= pages.length) return pages[page - 1]
    problems.push(`${where}: page ${page} is not one of the ${pages.length} attached pages`)
    return pages[0]
  }
  const scalePage = read.scale.page ?? 1
  attached(scalePage, 'scale.page')
  const takeoff = {
    version: 1,
    scale: {
      stated: read.scale.stated,
      sheet_size: read.scale.sheet_size,
      pdf_page: sizes[Math.min(scalePage, sizes.length) - 1],
      calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null },
    },
    sheets,
    structures: read.structures.map((s, i) => ({
      ...s,
      source: 'plans',
      planes: s.planes.map((p, j) => ({
        ...p,
        sloped_area_m2: p.plan_area_m2 === null || p.pitch_deg === null ? null : round2(p.plan_area_m2 / Math.cos((p.pitch_deg * Math.PI) / 180)),
        evidence: p.evidence.map((e, k) => {
          const sheet = attached(e.page, `structures.${i}.planes.${j}.evidence.${k}`)
          return { file: sheet.file, page: sheet.page, text: e.text, bbox: null }
        }),
      })),
    })),
    scope: read.scope,
  }
  if (problems.length) return { problems }
  const checked = RoofPlanTakeoffSchema.safeParse(takeoff)
  return checked.success ? { takeoff: checked.data } : { problems: issues(checked.error) }
}

const planesIn = (t: RoofPlanTakeoff) => t.structures.reduce((n, s) => n + s.planes.length, 0)

/** What to ask the reader again when its planes, every one sized, fall short
 *  of the drawings' roof footprint by more than C3 allows: a roof it left out,
 *  as Grange's carport was from 2 of 6 readings (TKO-15). Null when nothing is
 *  short, or a plane has no area yet, as the drawing may measure it (TKO-29). */
function shortOfFootprint(takeoff: RoofPlanTakeoff, schedule: ScheduleLine[]): string | null {
  const line = footprintLine(schedule)
  const planes = takeoff.structures.flatMap((s) => s.planes)
  if (!line || !planes.length || planes.some((p) => p.plan_area_m2 === null)) return null
  const total = round2(planes.reduce((sum, p) => sum + (p.plan_area_m2 ?? 0), 0))
  if (total >= line.m2 * (1 - SCHEDULE_PCT / 100)) return null
  // The label is the drawings' text: data, as the request's job details are.
  const label = line.label.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase()
  return [
    `Your planes total ${total} m² on plan, but the drawings' area schedule gives the ${label} as ${line.m2} m², ${round2(line.m2 - total)} m² more.`,
    'A roof in scope may be missing, such as a carport, veranda or lean-to. Read every roof the plans draw in scope, each as its own structure with its evidence, and give a roof you can\'t size a null area.',
    'Never change an area to make the totals agree: if every roof in scope is already read, reply with the same JSON. Reply with the corrected JSON only.',
  ].join(' ')
}

/** Reads the chosen sheets into a takeoff: one model call, one repair call
 *  when the reply doesn't fit the schema, and one more when its planes fall
 *  short of the `schedule`'s roof footprint. */
export async function readPlans(input: {
  sheets: Sheet[]
  files: Map<string, Uint8Array>
  scopeNote: string | null
  job: { name: string | null; ref: string | null; address: string | null }
  /** The drawings' area schedule, which C3 later reconciles against. */
  schedule?: ScheduleLine[]
}, generate: typeof generateText = generateText): Promise<ReadOutcome> {
  const pages = input.sheets.filter((s) => s.used)
  const { pdf, sizes } = await cutPages(pages, input.files)
  const model = process.env.TAKEOFF_MODEL?.trim() || DEFAULT_TAKEOFF_MODEL
  const cache = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }
  const messages: ModelMessage[] = [
    { role: 'system', content: READER_SYSTEM, providerOptions: cache },
    {
      role: 'user',
      content: [
        { type: 'file', data: pdf, mediaType: 'application/pdf', providerOptions: cache },
        { type: 'text', text: readerRequest({ pages, job: input.job, scopeNote: input.scopeNote }) },
      ],
    },
  ]
  const ask = async (conversation: ModelMessage[]): Promise<Reply> => {
    const result = await generate({
      model: anthropic(model),
      messages: conversation,
      ...deterministicSampling(model),
      maxOutputTokens: READ_MAX_OUTPUT_TOKENS,
      maxRetries: 0, // the queue retries the attempt
      abortSignal: currentSmsWork()?.signal,
    })
    return { text: result.text, finishReason: result.finishReason, inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 }
  }
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, calls: 0 }
  const check = (reply: Reply) => {
    usage.inputTokens += reply.inputTokens
    usage.outputTokens += reply.outputTokens
    usage.calls += 1
    return assemble(reply.text, input.sheets, pages, sizes)
  }

  // Each reply is checkpointed, so an attempt the queue cut off is picked up
  // where it stopped instead of reading the plans again.
  const draft = await smsWorkCheckpoint('read:draft', () => ask(messages))
  let reply = draft
  let result = check(draft)
  if ('problems' in result) {
    const cutOff = draft.finishReason === 'length' ? ['The reply was cut off at the output limit: keep evidence texts short and give polygon_mm only for simple planes.'] : []
    const problems = [...cutOff, ...result.problems]
    const repair = await smsWorkCheckpoint('read:repair', () => ask([
      ...messages,
      // An empty reply, such as a thinking model's that spent its whole output
      // limit thinking, can't go back as a turn: the API refuses an empty text block.
      ...(draft.text.trim() ? [{ role: 'assistant' as const, content: draft.text }] : []),
      { role: 'user', content: `That reply can't be used:\n- ${problems.join('\n- ')}\nReply with the corrected JSON only.` },
    ]))
    reply = repair
    result = check(repair)
  }
  const missing = 'takeoff' in result ? shortOfFootprint(result.takeoff, input.schedule ?? []) : null
  if (missing && 'takeoff' in result) {
    const again = await smsWorkCheckpoint('read:complete', () => ask([
      ...messages,
      { role: 'assistant', content: reply.text },
      { role: 'user', content: missing },
    ]))
    // Only a reading that adds a plane is taken, so no area grows to meet the
    // schedule; C3 still judges whichever reading stands.
    const fuller = check(again)
    if ('takeoff' in fuller && planesIn(fuller.takeoff) > planesIn(result.takeoff)) result = fuller
  }
  return 'takeoff' in result
    ? { ok: true, takeoff: result.takeoff, model, usage }
    : { ok: false, note: 'The plan reading came back in a form that could not be used, even after a repair attempt.', model, usage }
}
