// What a Roof Wizard pack may carry (TKO-28, DEC-037). A homeowner's name is
// in the drawings' own text, a title block above all, so the pack is built
// from a copy of the takeoff with none of that text: no evidence text, no
// status text and no file names. A value cites its sheet by number instead.
//
// What the model wrote in its own words (labels, profiles, falls, scope,
// exclusions) and the checks' details pass a filter, the backstop for a
// reading that copied a name anyway. It works in two passes. Patterns find a
// name led by a title, a client or owner field, a "… Residence" name, an email
// address and a phone number. Every capitalised word those patterns found,
// anywhere in the reading's text, the dropped drawing text included, is then
// taken out of every value the pack keeps, so "Ask Jane Citizen" goes too once
// "Owner: Jane Citizen" appeared anywhere.

import { isPreliminary, type SheetKind } from '../classify'
import type { CheckId, CheckResult, Checks } from '../checks'
import type { RoofPlanTakeoff } from '../schema'

const NAME = '[name removed]'
const EMAIL = '[email removed]'
const PHONE = '[phone removed]'

// Titles as drawings write them. "Dr" only with its stop, so a street's "Dr"
// stays; "MS" in capitals is a material code as often as a title.
const TITLE = String.raw`(?:Mr|Mrs|Ms|Miss|Mx|MR|MRS|MISS)\b\.?|(?:Dr|DR)\.`
const WORD = String.raw`[A-Z][A-Za-z'’-]*\.?`
const TITLED = new RegExp(String.raw`(?:${TITLE})(?:\s*(?:&|and)\s*(?:${TITLE}))?(?:\s+${WORD}){1,3}`, 'g')
const FIELD = new RegExp(
  String.raw`\b(clients?|owners?|home\s?owners?|proprietors?|customers?|prepared\s+for)(\s*[:\-–]\s*)((?:(?:${TITLE}|&|and)\s*|${WORD}\s*){1,6})`,
  'gi',
)
const RESIDENCE_OF = new RegExp(String.raw`\b(residence|house|home|dwelling|property|extension|renovation)(s?\s+(?:for|of)\s+)((?:${WORD}|&)(?:\s+(?:${WORD}|&)){0,3})`, 'gi')
const NAMED_RESIDENCE = /\b([A-Za-z][A-Za-z'’-]+)\s+(residence|family|household)\b/gi
const EMAILS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const PHONES = /\+61[\s-]?(?:\(0\))?[2-478](?:[\s-]?\d){8}\b|\(0[2-478]\)[\s-]?\d{4}[\s-]?\d{4}\b|\b0[2-478](?:[\s-]?\d){8}\b|\b1[38]00(?:[\s-]?\d){6}\b/g

// Words before "Residence" that describe a building, not a family.
const NOT_A_NAME = new Set(['proposed', 'existing', 'new', 'main', 'primary', 'secondary', 'single', 'dual', 'two', 'double', 'the', 'a', 'rear', 'front', 'granny', 'holiday', 'family', 'storey', 'level'])
const NOT_A_NAME_WORD = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'and', 'the'])

/** The capitalised words of a name a pattern found, for the second pass. */
const nameWords = (found: string) =>
  found.split(/[\s&.,]+/).map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length > 1 && /^[A-Z]/.test(w) && !NOT_A_NAME_WORD.has(w.toLowerCase()))

/** The text with every name, email and phone number the patterns find taken
 *  out, and with `names` (each word on its own) taken out too. */
export function redact(text: string, names: ReadonlySet<string> = new Set(), found?: Set<string>): string {
  const note = (match: string) => { for (const w of nameWords(match)) found?.add(w) }
  let out = text
    .replace(EMAILS, EMAIL)
    .replace(PHONES, PHONE)
    .replace(FIELD, (_all, label: string, sep: string, who: string) => { note(who); return `${label}${sep.replace(/\s+$/, '')} ${NAME}${/\s$/.test(who) ? ' ' : ''}` })
    .replace(TITLED, (match) => { note(match); return NAME })
    .replace(RESIDENCE_OF, (_all, what: string, link: string, who: string) => { note(who); return `${what}${link}${NAME}` })
    .replace(NAMED_RESIDENCE, (match, first: string, kind: string) => {
      if (!/^[A-Z]/.test(first) || NOT_A_NAME.has(first.toLowerCase())) return match
      note(first)
      return kind.toLowerCase() === 'residence' ? NAME : `${NAME} ${kind}`
    })
  for (const name of names) {
    out = out.replace(new RegExp(String.raw`\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['’]s)?\b`, 'gi'), NAME)
  }
  return out.replace(/\[name removed\](?:\s+\[name removed\])+/g, NAME)
}

/** A roof's label, or `Roof <id>` when the label carried a name. */
export function redactLabel(label: string, id: string, names: ReadonlySet<string> = new Set()): string {
  return redact(label, names) === label ? label : `Roof ${id}`
}

type Takeoff = RoofPlanTakeoff
type Structure = Takeoff['structures'][number]
type Plane = Structure['planes'][number]

export type PackSheet = {
  /** The sheet's number, or "file N page P" when it has none. */
  ref: string
  number: string | null
  title: string | null
  revision: string | null
  kind: SheetKind
  used: boolean
  /** Marked preliminary or not for construction (C8); the stamp's own words stay out. */
  preliminary: boolean
}
export type PackPlane = Omit<Plane, 'evidence'> & { sheets: string[] }
export type PackStructure = Omit<Structure, 'planes'> & { planes: PackPlane[] }
export type PackCheck = { id: CheckId; result: CheckResult['result']; detail: string; sheet: string | null }
export type PackTakeoff = {
  scale: Takeoff['scale']
  sheets: PackSheet[]
  structures: PackStructure[]
  scope: Takeoff['scope']
  checks: { status: Checks['status']; ran_at: string; results: PackCheck[] } | null
}

/** The takeoff and its checks as a pack may carry them: no drawing text, and
 *  every free-text value filtered. The takeoff given is left as it was. */
export function packTakeoff(takeoff: Takeoff, checks: Checks | null): PackTakeoff {
  // Pass one: the names every text the reading holds gives away.
  const names = new Set<string>()
  const scan = (text: string | null | undefined) => { if (text) redact(text, new Set(), names) }
  for (const sheet of takeoff.sheets) [sheet.file, sheet.title, sheet.status_text, sheet.number].forEach(scan)
  for (const s of takeoff.structures) {
    scan(s.label)
    for (const p of s.planes) {
      [p.fall, p.profile, p.finish_tag].forEach(scan)
      for (const e of p.evidence) [e.text, e.file].forEach(scan)
    }
    for (const x of s.exclusions) [x.label, x.reason].forEach(scan)
  }
  for (const line of [...takeoff.scope.includes, ...takeoff.scope.excludes, ...takeoff.scope.questions]) scan(line)
  for (const r of checks?.results ?? []) [r.detail, r.evidence?.file].forEach(scan)
  for (const line of checks?.schedule ?? []) [line.label, line.file].forEach(scan)

  // Pass two: the values the pack keeps, each without them.
  const clean = (text: string) => redact(text, names)
  const maybe = (text: string | null) => (text === null ? null : clean(text))
  const ordinals = new Map<string, number>()
  const ordinal = (file: string) => {
    if (!ordinals.has(file)) ordinals.set(file, ordinals.size + 1)
    return ordinals.get(file)!
  }
  for (const sheet of takeoff.sheets) ordinal(sheet.file)
  const refOf = (file: string, page: number) => {
    const number = takeoff.sheets.find((s) => s.file === file && s.page === page)?.number
    return number ? clean(number) : `file ${ordinal(file)} page ${page}`
  }

  return {
    scale: structuredClone(takeoff.scale),
    sheets: takeoff.sheets.map((s) => ({
      ref: refOf(s.file, s.page),
      number: maybe(s.number),
      title: maybe(s.title),
      revision: maybe(s.revision),
      kind: s.kind,
      used: s.used,
      preliminary: isPreliminary(s.status_text),
    })),
    structures: takeoff.structures.map((s) => ({
      id: s.id,
      label: redactLabel(s.label, s.id, names),
      role: s.role,
      source: s.source,
      planes: s.planes.map(({ evidence, ...plane }) => ({
        ...structuredClone(plane),
        fall: maybe(plane.fall),
        profile: maybe(plane.profile),
        finish_tag: maybe(plane.finish_tag),
        sheets: [...new Set(evidence.map((e) => refOf(e.file, e.page)))],
      })),
      edges: structuredClone(s.edges),
      exclusions: s.exclusions.map((x) => ({ label: clean(x.label), reason: clean(x.reason), area_m2: x.area_m2 })),
      ...(s.aerial ? { aerial: structuredClone(s.aerial) } : {}),
    })),
    scope: {
      includes: takeoff.scope.includes.map(clean),
      excludes: takeoff.scope.excludes.map(clean),
      questions: takeoff.scope.questions.map(clean),
    },
    checks: checks
      ? {
          status: checks.status,
          ran_at: checks.ran_at,
          results: checks.results.map((r) => ({ id: r.id, result: r.result, detail: clean(r.detail), sheet: r.evidence ? refOf(r.evidence.file, r.evidence.page) : null })),
        }
      : null,
  }
}
