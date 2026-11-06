// What a Roof Wizard pack may carry (TKO-28, DEC-037). A homeowner's name is
// in the drawings' own text, a title block above all, so the pack is built
// from a copy of the takeoff with none of that text: no evidence text, no
// status text and no file names. A value cites its sheet by number instead.
//
// What the model wrote in its own words (labels, profiles, falls, scope,
// exclusions), the checks' details and the request's scope note and job name
// pass a filter, the backstop for a reading that copied a name anyway. It
// works in two passes. Patterns find a name led by a title, a client or owner
// field, a "… Residence" name, an email address and a phone number. Every
// capitalised word those patterns found, anywhere in the reading's text, the
// dropped drawing text included, is then taken out of every value the pack
// keeps, so "Ask Jane Citizen" goes too once "Owner: Jane Citizen" appeared
// anywhere.
//
// Names aren't ASCII ("Zoë", "Nguyễn"), so the patterns work on Unicode
// letters, and a name never runs past the end of its line.

import { isPreliminary, type SheetKind } from '../classify'
import type { CheckId, CheckResult, Checks } from '../checks'
import type { RoofPlanTakeoff } from '../schema'

const NAME = '[name removed]'
const EMAIL = '[email removed]'
const PHONE = '[phone removed]'

const LETTER = String.raw`\p{L}\p{M}`
const BEFORE = String.raw`(?<![${LETTER}\p{N}])`
const AFTER = String.raw`(?![${LETTER}\p{N}])`
const SPACE = '[ \\t]'
// A word of a name: a capital, then letters, apostrophes and hyphens; or an initial.
const WORD = String.raw`\p{Lu}[${LETTER}'’-]*\.?`
// Titles as drawings write them. "Dr" only with its stop, so a street's "Dr"
// stays; "MS" in capitals is a material code as often as a title.
const TITLE = String.raw`(?:Mrs|Miss|Mr|Ms|Mx|MRS|MISS|MR)(?:\.|${AFTER})|(?:Dr|DR)\.`

const TITLED = new RegExp(String.raw`${BEFORE}(?:${TITLE})(?:${SPACE}*(?:&|and)${SPACE}*(?:${TITLE}))?(?:${SPACE}+${WORD}){1,3}`, 'gu')
// A field's label, in any case; the name after it is found case by case, on its line.
const FIELD = new RegExp(String.raw`${BEFORE}(?:clients?|owners?|home${SPACE}?owners?|proprietors?|customers?|prepared${SPACE}+for)${SPACE}*[:\-–]${SPACE}*`, 'giu')
const FIELD_NAME = new RegExp(String.raw`(?:(?:${TITLE}|&|and)${SPACE}*|${WORD}${SPACE}*){1,6}`, 'uy')
const RESIDENCE_OF = new RegExp(String.raw`${BEFORE}(?:residences?|houses?|homes?|dwellings?)${SPACE}+(?:for|of)${SPACE}+`, 'giu')
const RESIDENCE_NAME = new RegExp(String.raw`(?:${WORD}|&)(?:${SPACE}+(?:${WORD}|&)){0,3}`, 'uy')
const NAMED_RESIDENCE = new RegExp(String.raw`${BEFORE}(\p{Lu}[${LETTER}'’-]+)${SPACE}+([Rr]esidence|RESIDENCE|[Ff]amily|FAMILY|[Hh]ousehold|HOUSEHOLD)${AFTER}`, 'gu')
const EMAILS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu
const PHONES = /(?<!\d)(?:\+61[ .-]?(?:\(0\)[ .-]?)?[2-478](?:[ .-]?\d){8}|61[ .-]4\d{2}[ .-]?\d{3}[ .-]?\d{3}|\(0[2-478]\)[ .-]?\d{4}[ .-]?\d{4}|0[2-478](?:[ .-]?\d){8}|1[38]00(?:[ .-]?\d){6})(?!\d)/gu

// Words that name a building, a place or a firm, never a family: they stay in
// text, and a pattern that found them found no name.
const NOT_A_NAME = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'and', 'the', 'a', 'of', 'for',
  'proposed', 'existing', 'new', 'main', 'primary', 'secondary', 'single', 'dual', 'two', 'double',
  'rear', 'front', 'side', 'granny', 'holiday', 'family', 'storey', 'level', 'upper', 'lower', 'ground', 'first', 'second',
  'roof', 'roofs', 'house', 'houses', 'home', 'homes', 'dwelling', 'residence', 'garage', 'carport', 'deck', 'patio',
  'verandah', 'veranda', 'porch', 'laundry', 'bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'extension',
  'addition', 'additions', 'alterations', 'renovation', 'renovations', 'project', 'site', 'plan', 'plans', 'drawing',
  'drawings', 'sheet', 'stage', 'lot', 'unit', 'block', 'street', 'st', 'road', 'rd', 'avenue', 'ave', 'drive',
  'court', 'ct', 'place', 'pl', 'crescent', 'cres', 'way', 'lane', 'parade', 'terrace', 'highway', 'north', 'south',
  'east', 'west', 'pty', 'ltd', 'builder', 'builders', 'construction', 'constructions', 'group',
])

/** The words of a name a pattern found, for the second pass. */
const nameWords = (found: string) =>
  found.split(/[\s&.,]+/u)
    .map((w) => w.replace(/['’]s$/u, ''))
    .filter((w) => [...w].length > 1 && /^\p{Lu}/u.test(w) && !NOT_A_NAME.has(w.toLowerCase()))

/** Whether a found run of words is a name, not a building's or a place's. */
const isName = (found: string) => nameWords(found).length > 0

/** Replaces the name after each label `label` finds, read with `name` from
 *  where the label ends, so the name's case decides where it stops. */
function afterLabel(text: string, label: RegExp, name: RegExp, note: (found: string) => void): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(label)) {
    const end = match.index + match[0].length
    if (match.index < last) continue
    name.lastIndex = end
    const found = name.exec(text)?.[0] ?? ''
    if (!found.trim() || !isName(found)) continue
    note(found)
    out += text.slice(last, end) + NAME + (/[ \t]$/.test(found) ? ' ' : '')
    last = end + found.length
  }
  return out + text.slice(last)
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text with every name, email and phone number the patterns find taken
 *  out, and with `names` (each word on its own) taken out too. */
export function redact(text: string, names: ReadonlySet<string> = new Set(), found?: Set<string>): string {
  const note = (match: string) => { for (const w of nameWords(match)) found?.add(w) }
  let out = text.normalize('NFC').replace(EMAILS, EMAIL).replace(PHONES, PHONE)
  out = afterLabel(out, FIELD, FIELD_NAME, note)
  out = out.replace(TITLED, (match) => { note(match); return NAME })
  out = afterLabel(out, RESIDENCE_OF, RESIDENCE_NAME, note)
  out = out.replace(NAMED_RESIDENCE, (match, first: string, kind: string) => {
    if (NOT_A_NAME.has(first.toLowerCase())) return match
    note(first)
    return kind.toLowerCase() === 'residence' ? NAME : `${NAME} ${kind}`
  })
  for (const name of names) {
    out = out.replace(new RegExp(String.raw`${BEFORE}${escape(name.normalize('NFC'))}(?:['’]s)?${AFTER}`, 'giu'), NAME)
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
/** The request's own free text, filtered as the reading's is. */
export type PackRequest = { job_name: string | null; scope_note: string | null }
export type PackTakeoff = {
  scale: Takeoff['scale']
  sheets: PackSheet[]
  structures: PackStructure[]
  scope: Takeoff['scope']
  checks: { status: Checks['status']; ran_at: string; results: PackCheck[] } | null
  request: PackRequest
}

// The reader's own ids, as the prompt asks for them (S1, S1-P1): anything else
// is text a model or a tradie wrote, so the pack numbers the roof instead.
const ID = /^[A-Za-z]{1,3}\d{1,3}(?:-[A-Za-z]{1,3}\d{1,3})?$/
const plain = (ids: string[]) => ids.every((id) => ID.test(id)) && new Set(ids.map((id) => id.toUpperCase())).size === ids.length

/** Pass one of the filter: the names every text the reading, its checks and
 *  the request hold give away, the drawing text the copy drops included. The
 *  pack and an eval fixture (TKO-00c) take them out of every value they keep. */
export function namesIn(takeoff: Takeoff, checks: Checks | null, request: Partial<PackRequest> = {}): Set<string> {
  const names = new Set<string>()
  const scan = (text: string | null | undefined) => { if (text) redact(text, new Set(), names) }
  for (const sheet of takeoff.sheets) [sheet.file, sheet.title, sheet.status_text, sheet.number].forEach(scan)
  for (const s of takeoff.structures) {
    [s.id, s.label].forEach(scan)
    for (const p of s.planes) {
      [p.id, p.fall, p.profile, p.finish_tag].forEach(scan)
      for (const e of p.evidence) [e.text, e.file].forEach(scan)
    }
    for (const x of s.exclusions) [x.label, x.reason].forEach(scan)
  }
  for (const line of [...takeoff.scope.includes, ...takeoff.scope.excludes, ...takeoff.scope.questions]) scan(line)
  for (const r of checks?.results ?? []) [r.detail, r.evidence?.file].forEach(scan)
  for (const line of checks?.schedule ?? []) [line.label, line.file].forEach(scan)
  ;[request.job_name, request.scope_note].forEach(scan)
  return names
}

/** The takeoff and its checks as a pack may carry them: no drawing text, and
 *  every free-text value filtered. The takeoff given is left as it was. */
export function packTakeoff(takeoff: Takeoff, checks: Checks | null, request: Partial<PackRequest> = {}): PackTakeoff {
  const names = namesIn(takeoff, checks, request)

  // Pass two: the values the pack keeps, each without them.
  const clean = (text: string) => redact(text, names)
  const maybe = (text: string | null | undefined) => (text == null ? null : clean(text))
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
  const keepIds = plain(takeoff.structures.map((s) => s.id))

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
    structures: takeoff.structures.map((s, i) => {
      const id = keepIds ? s.id : `S${i + 1}`
      const keepPlanes = keepIds && plain(s.planes.map((p) => p.id))
      return {
        id,
        label: redactLabel(s.label, id, names),
        role: s.role,
        source: s.source,
        planes: s.planes.map(({ evidence, ...plane }, j) => ({
          ...structuredClone(plane),
          id: keepPlanes ? plane.id : `${id}-P${j + 1}`,
          fall: maybe(plane.fall),
          profile: maybe(plane.profile),
          finish_tag: maybe(plane.finish_tag),
          sheets: [...new Set(evidence.map((e) => refOf(e.file, e.page)))],
        })),
        edges: structuredClone(s.edges),
        exclusions: s.exclusions.map((x) => ({ label: clean(x.label), reason: clean(x.reason), area_m2: x.area_m2 })),
        ...(s.aerial ? { aerial: structuredClone(s.aerial) } : {}),
      }
    }),
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
    request: { job_name: maybe(request.job_name), scope_note: maybe(request.scope_note) },
  }
}
