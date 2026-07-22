// ════════════════════════════════════════════════════════════════════
// SMS roofing receptionist — pure intake state machine.
//
// The roofing trade runs a self-contained measure→price pipeline
// (lib/roofing/*) that is NOT the electrical/plumbing intake→estimate
// flow. So over SMS we gather the SAME inputs the dashboard Roofing tab
// collects — address, material, pitch, intent (+ optional year) — with a
// deterministic question-asker rather than the elec/plumbing Sonnet
// dialog. Deterministic = unit-testable + can't drift the money path.
//
// Plain-language mapping is the crux: a homeowner says "tin roof" / "not
// too steep" / "whole roof needs doing", not "colorbond_trimdek" /
// "standard" / "full_reroof". We map those, and when a customer genuinely
// can't tell us the material or pitch we route to the on-site inspection
// rather than guessing a price — the same inspection-fallback discipline
// the rest of QuoteMax uses.
//
// PURE — no I/O, no SDK. Fully unit-tested.
// ════════════════════════════════════════════════════════════════════

import type {
  PitchBucket,
  RoofAddressInput,
  RoofJobIntent,
  RoofMaterial,
} from '@/lib/roofing/types'
// Reuse the pricer's canonical degrees→bucket boundaries rather than
// restating them here — one source of truth for what "25 degrees" means.
import { pitchBucketFromDegrees } from '@/lib/roofing/pricing'

export type AuState = RoofAddressInput['state']

/** Accumulated roofing inputs gathered across SMS turns. Persisted on
 *  sms_conversations.roofing_state (jsonb), decoupled from the
 *  electrical/plumbing conversation_state.slots. */
export type RoofingSlots = {
  address?: string | null
  postcode?: string | null
  state?: AuState | null
  /** Customer confirmed the address we read back is correct. */
  address_confirmed?: boolean
  material?: RoofMaterial | null
  pitch?: PitchBucket | null
  intent?: RoofJobIntent | null
  year_built?: number | null
  /** Customer said "metal"/"Colorbond" without naming a profile — we
   *  understood the answer, we just need to know WHICH. Drives the
   *  'material_profile' follow-up; cleared once the profile lands. */
  metal_hint?: boolean
  /** Consecutive unrecognised answers to the step we're currently asking.
   *  Bounded by the receptionist so a reply we can't map routes to the
   *  on-site inspection instead of re-asking the same question forever.
   *  Cleared the moment an answer lands. */
  misses?: number
}

/** Which input the receptionist is currently gathering. */
export type RoofingStep =
  | 'address'
  | 'confirm_address'
  | 'intent'
  | 'material'
  // Follow-up when the material answer was generic metal: which profile?
  | 'material_profile'
  | 'pitch'
  | 'ready'
  | 'inspection'
  // After measuring we send the roof photo and wait for the customer to
  // confirm it's the right building (or pick among several / say none).
  | 'confirm_roof'
  // After an inspection route, waiting for the customer to confirm they
  // want the on-site visit booked.
  | 'await_booking'
  // Quote sent + confirmed, but the thread stays WARM: a structure
  // follow-up ("give me 2 and 3", "the shed", "all of them") re-serves the
  // SAVED measurement without re-measuring, and an unrelated message is
  // handed back to the general dialog (never trapped, never re-quoted).
  | 'quoted'
  // Conversation finished (cancelled or booked). Only a fresh roofing
  // enquiry reopens it; an unrelated message never re-quotes.
  | 'closed'

const AU_STATES: readonly AuState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']

// ── Intent detection ──────────────────────────────────────────────────

const ROOFING_KEYWORDS = [
  're-roof', 'reroof', 're roof', 'roof replacement', 'replace the roof', 'new roof',
  'roofing', 'roof leak', 'leaking roof', 'roof repair', 'roof restoration',
  'gutter', 'downpipe', 'down pipe', 'ridge cap', 'ridge caps', 'valley iron',
  'roof flashing', 'whirlybird', 'whirly bird', 'colorbond roof', 'tile roof',
  'tiled roof', 'metal roof', 'eaves', 'fascia', 'sarking',
]

/**
 * PURE — does this message read like a roofing enquiry? Used to branch
 * the SMS receptionist into the roofing flow. Conservative: matches clear
 * roofing terms; bare "roof" only counts with a work verb nearby so
 * "the switch is near the roof" (electrical) doesn't trip it.
 */
export function looksLikeRoofingEnquiry(text: string): boolean {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return false
  if (ROOFING_KEYWORDS.some((k) => t.includes(k))) return true
  // bare "roof" only when paired with an action/condition word
  if (/\broofs?\b/.test(t) && /\b(quote|estimate|replace|repair|fix|leak|redo|restore|paint|broken|cracked|old)\b/.test(t)) {
    return true
  }
  return false
}

// ── Plain-language mappers ────────────────────────────────────────────
// Each returns null when the answer is unrecognised (re-ask), or the
// sentinel 'unknown' enum value when the customer explicitly can't tell
// us (→ routes to inspection at readiness).

const UNSURE = /\b(not sure|unsure|no idea|dunno|don'?t know|do not know|no clue|couldn'?t say|hard to say)\b/

/** Metal named generically, with no profile. */
const GENERIC_METAL = /\b(colorbond|colourbond|metal|tin|steel|zincalume)\b/
/** Any answer that DOES pin the profile down. */
const NAMED_PROFILE =
  /\b(corro|corrugated|custom ?orb|iron|galv|galvanised|galvanized|trimdek|trim ?dek|spandek|span ?deck|klip-?lok|kliplok|standing seam|concealed fix)\b/

/**
 * PURE — did the customer say "it's metal" without saying WHICH metal?
 * Corrugated and Trimdek are priced differently ($90 vs $95/m²) and look
 * nothing alike on a roof, so this gets a targeted follow-up rather than a
 * guess. False for tiles, fibro, "not sure", and any named profile.
 */
export function isAmbiguousMetal(text: string): boolean {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return false
  if (UNSURE.test(t)) return false
  return GENERIC_METAL.test(t) && !NAMED_PROFILE.test(t)
}

/** PURE — map a homeowner's words to a RoofMaterial (or null = re-ask). */
export function mapMaterial(text: string): RoofMaterial | null {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return null
  if (UNSURE.test(t)) return 'unknown'
  // Asbestos-suspect first — safety wins over any metal/tile token.
  if (/\b(asbestos|fibro|cement sheet|super ?six|fibrolite|ac sheet)\b/.test(t)) return 'cement_sheet'
  // Materials we do NOT price (not in ROOF_MATERIALS). Reading them as
  // 'unknown' routes the job to an on-site inspection — the honest answer.
  // Guessing the nearest priced material would quote the wrong roof.
  if (/\b(slate|shingles?|asphalt|shake|thatch|polycarbonate|fibreglass)\b/.test(t)) return 'unknown'
  if (/\b(klip-?lok|kliplok|standing seam|concealed fix)\b/.test(t)) return 'colorbond_kliplok'
  if (/\b(spandek|span ?deck)\b/.test(t)) return 'colorbond_spandek'
  // "Iron" / "galv" is AU vernacular for corrugated metal sheet — by far
  // the most common way a homeowner names this roof.
  if (/\b(corro|corrugated|custom ?orb|iron|galv|galvanised|galvanized)\b/.test(t)) return 'colorbond_corrugated'
  if (/\b(trimdek|trim ?dek)\b/.test(t)) return 'colorbond_trimdek'
  // A bare "Colorbond" / "metal" / "tin" names NO profile. This used to
  // return Trimdek, quoting a roof the customer never described (and the
  // SMS twin of the dashboard bug where a tradie's Corrugated came back as
  // Trimdek). Return null so the receptionist asks WHICH profile.
  if (GENERIC_METAL.test(t)) return null
  if (/\b(terracotta|terra ?cotta|clay tile|clay tiles)\b/.test(t)) return 'terracotta_tile'
  if (/\b(concrete tile|cement tile|concrete tiles)\b/.test(t)) return 'concrete_tile'
  // Generic "tiles" → concrete (the common AU default); document this.
  if (/\btiles?\b/.test(t)) return 'concrete_tile'
  return null
}

/** PURE — map a homeowner's words to a PitchBucket (or null = re-ask). */
export function mapPitch(text: string): PitchBucket | null {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return null
  if (UNSURE.test(t)) return 'unknown'
  // An explicit angle is the most precise answer a homeowner can give —
  // classify it with the pricer's own boundaries.
  const deg = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:°|deg\b|degs\b|degree|degrees)/)
  if (deg) return pitchBucketFromDegrees(Number(deg[1]))
  // "Not too steep" means standard — check the negation BEFORE the steep
  // stem below, or the bare word wins and we price fall protection twice.
  if (/\bnot\s+(too\s+|that\s+|very\s+|so\s+|really\s+)?steep\w*/.test(t)) return 'standard'
  if (/\b(very|really|super|extremely)\s+steep\w*|\bnear vertical\b/.test(t)) return 'very_steep'
  // Stem, not `\bsteep\b` — "steeper"/"steeply" must not fall through to
  // the standard rule below and match the "normal" in "steeper than
  // normal", which priced a steep roof at the standard rate.
  if (/\bsteep\w*|\bsharp\b|\bhigh[- ]?pitch/.test(t)) return 'steep'
  if (/\b(flat|low|low pitch|low-pitched|shallow|barely|gentle|skillion)\b/.test(t)) return 'shallow'
  if (/\b(standard|normal|average|medium|regular|typical|usual|moderate)\b/.test(t)) return 'standard'
  return null
}

/** PURE — map a homeowner's words to a RoofJobIntent (or null = re-ask). */
export function mapIntent(text: string): RoofJobIntent | null {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return null
  // NOTE: match verb STEMS (replac\w*), never `…replace\b`. A trailing \b
  // cannot match "replacement" / "replacing", which is exactly how "Roof
  // replacement" read as unrecognised and re-asked the same question.
  if (/\bre-?roof/.test(t)) return 'full_reroof'
  if (/\b(whole|entire|full|new)\s+roof/.test(t)) return 'full_reroof'
  if (/\broofs?\s+replac\w*/.test(t)) return 'full_reroof' // "roof replacement"
  if (/\breplac\w*\s+(the\s+|my\s+|our\s+|that\s+|existing\s+)*roof/.test(t)) return 'full_reroof'
  if (/\b(all of it|replace it all|the lot|whole thing|whole lot)\b/.test(t)) return 'full_reroof'
  if (/\b(leak|leaking|water coming|dripping)\b/.test(t)) return 'leak_trace'
  if (/\b(gutters?|downpipes?|down ?pipes?)\b/.test(t)) return 'gutter_replace'
  if (/\b(ridges?|caps?|repoint|rebed)\b/.test(t)) return 'ridge_cap'
  if (/\b(flashings?)\b/.test(t)) return 'flashing_repair'
  if (/\b(repairs?|patch|fix|broken|cracked|damaged|missing|few tiles)\b/.test(t)) return 'patch_repair'
  // Bare "replacement" with no other cue — checked LAST so "gutter
  // replacement" has already been claimed by the gutter rule above.
  if (/\breplac\w*/.test(t)) return 'full_reroof'
  return null
}

/** PURE — extract an explicit build year (1850-2100) or a decade ("1980s"
 *  → 1980). Relative ages ("about 30 years old") are NOT inferred (no
 *  clock dependency) — returns null so the optional slot is just skipped. */
export function parseYearBuilt(text: string): number | null {
  const t = (text ?? '').toLowerCase()
  const decade = t.match(/\b(18|19|20)(\d0)s\b/)
  if (decade) {
    const y = Number(`${decade[1]}${decade[2]}`)
    if (y >= 1850 && y <= 2100) return y
  }
  const m = t.match(/\b(18|19|20)\d{2}\b/)
  if (m) {
    const y = Number(m[0])
    if (y >= 1850 && y <= 2100) return y
  }
  return null
}

/** PURE — pull a 4-digit AU postcode if present. AU addresses end with
 *  the postcode, so when several 4-digit groups appear (e.g. a build year
 *  earlier in the line) take the LAST one. */
export function parsePostcode(text: string): string | null {
  const all = (text ?? '').match(/\b\d{4}\b/g)
  return all && all.length > 0 ? all[all.length - 1] : null
}

/** PURE — pull an AU state token if present. */
export function parseAuState(text: string): AuState | null {
  const up = (text ?? '').toUpperCase()
  for (const s of AU_STATES) {
    if (new RegExp(`\\b${s}\\b`).test(up)) return s
  }
  return null
}

// ── Affirmation / negation for the address-confirm step ──────────────

const AFFIRM = /\b(yes|yep|yeah|yup|correct|right|that'?s right|that'?s it|confirmed|sure|ok|okay|👍)\b/
const DENY = /\b(no|nope|nah|wrong|incorrect|not right|different)\b/

export function isAffirmative(text: string): boolean {
  return AFFIRM.test((text ?? '').toLowerCase())
}
export function isNegative(text: string): boolean {
  return DENY.test((text ?? '').toLowerCase())
}

// ── Stop / cancel / opt-out ──────────────────────────────────────────
// Checked FIRST on every turn so the customer can always bail. Bare "no"
// is NOT a stop (it's a valid confirm answer); explicit stop words and
// clear frustration are.
const STOP_RE = /\b(stop|cancel|cancelled|unsubscribe|quit|end this|end the|not interested|leave me alone|go away|never ?mind|forget it)\b/
const FRUSTRATION_RE = /\b(f+u+c+k+|f\*+ck|fck|stfu|piss off|bugger off|bullsh|shut up)\b/

/** PURE — true when the customer wants to stop / cancel / opt out. */
export function isStopRequest(text: string): boolean {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return false
  return STOP_RE.test(t) || FRUSTRATION_RE.test(t)
}

// ── Apply a customer answer for a given step ──────────────────────────

/**
 * PURE — fold a customer message into the slots, interpreting it for the
 * step we just asked about. Unrecognised answers leave the slot unset so
 * the next-step logic re-asks. Returns a NEW slots object (no mutation).
 */
export function applyRoofingAnswer(
  slots: RoofingSlots,
  step: RoofingStep,
  message: string,
): RoofingSlots {
  const next: RoofingSlots = { ...slots }
  const msg = message ?? ''

  switch (step) {
    case 'address': {
      const trimmed = msg.trim()
      // Accept only something that actually looks like an address: a
      // street number plus text, and not a stop/cancel sentence. Stops a
      // reply like "Let's cancel now" being stored as the address.
      if (trimmed.length >= 6 && /\d/.test(trimmed) && !isStopRequest(trimmed)) {
        next.address = trimmed
        const pc = parsePostcode(trimmed)
        if (pc) next.postcode = pc
        const st = parseAuState(trimmed)
        if (st) next.state = st
        next.address_confirmed = false
      }
      break
    }
    case 'confirm_address': {
      if (isAffirmative(msg) && !isNegative(msg)) {
        next.address_confirmed = true
      } else if (isNegative(msg)) {
        // Customer says it's wrong — clear so we re-ask the address.
        next.address = null
        next.postcode = null
        next.state = null
        next.address_confirmed = false
      }
      break
    }
    case 'intent': {
      const v = mapIntent(msg)
      if (v) next.intent = v
      break
    }
    case 'material': {
      const v = mapMaterial(msg)
      if (v) {
        next.material = v
        next.metal_hint = false
      } else if (isAmbiguousMetal(msg)) {
        // Understood ("it's metal") but under-specified — ask which profile.
        next.metal_hint = true
      }
      break
    }
    case 'material_profile': {
      const v = mapMaterial(msg)
      if (v) {
        next.material = v
        next.metal_hint = false
      } else {
        // Second go and still no profile named. Never guess between two
        // differently-priced sheets — look at it on site.
        next.material = 'unknown'
        next.metal_hint = false
      }
      break
    }
    case 'pitch': {
      const v = mapPitch(msg)
      if (v) next.pitch = v
      break
    }
    default:
      break
  }

  // Year is opportunistic — grab it from any turn that mentions one.
  if (next.year_built == null) {
    const y = parseYearBuilt(msg)
    if (y != null) next.year_built = y
  }

  return next
}

// ── Readiness + inspection ────────────────────────────────────────────

/**
 * PURE — can we price, do we need more answers, or must we inspect?
 *   inspection: material is cement_sheet/unknown, or pitch is
 *               very_steep/unknown (the deterministic pricer would route
 *               these to inspection anyway — we surface it earlier).
 *   need_more:  a required slot (confirmed address, intent, material,
 *               pitch) is still missing.
 *   ready:      enough to run measureAndPriceRoofs.
 */
export function roofingReadiness(slots: RoofingSlots): 'ready' | 'need_more' | 'inspection' {
  if (!slots.address || !slots.address_confirmed) return 'need_more'
  if (!slots.intent) return 'need_more'
  if (!slots.material) return 'need_more'
  if (!slots.pitch) return 'need_more'
  if (slots.material === 'cement_sheet' || slots.material === 'unknown') return 'inspection'
  if (slots.pitch === 'very_steep' || slots.pitch === 'unknown') return 'inspection'
  return 'ready'
}

const QUESTIONS: Record<
  Exclude<RoofingStep, 'ready' | 'inspection' | 'confirm_roof' | 'await_booking' | 'quoted' | 'closed'>,
  string
> = {
  address: "Happy to sort a roofing quote for you. What's the property address, including suburb and postcode?",
  confirm_address: '', // filled dynamically with the address read-back
  intent: 'What do you need done? A full re-roof, a repair or patch, a leak traced, or gutters and downpipes?',
  material: "What's the roof made of? For example Colorbond or metal, concrete or terracotta tiles, or fibro / cement sheet.",
  material_profile:
    'Righto — which Colorbond profile is it? Corrugated (the classic wavy sheets) or Trimdek (flat panels with square ribs)? If you\'re not sure, just say so and we\'ll check it on site.',
  pitch: 'Roughly how steep is the roof? Flat, standard, or steep?',
}

/**
 * PURE — the next step + the question to send. When everything required
 * is gathered, returns 'ready' (price now) or 'inspection' (book the
 * on-site inspection instead of quoting).
 */
export function nextRoofingStep(slots: RoofingSlots): {
  step: RoofingStep
  question?: string
  reason?: string
} {
  if (!slots.address) return { step: 'address', question: QUESTIONS.address }
  if (!slots.address_confirmed) {
    return {
      step: 'confirm_address',
      question: `Just to confirm, the property is "${slots.address}". Is that right? Reply yes or no.`,
    }
  }
  if (!slots.intent) return { step: 'intent', question: QUESTIONS.intent }
  // The pricer has no rule for an unknown intent — it would silently price
  // whatever the tiers default to. Route it on site instead.
  if (slots.intent === 'unknown') {
    return { step: 'inspection', reason: "we couldn't confirm what work is needed" }
  }

  // Material gate: short-circuit to inspection the moment we learn it's
  // asbestos-suspect or unknown; no point asking pitch in that case.
  if (slots.material === 'cement_sheet') {
    return { step: 'inspection', reason: 'cement sheet or fibro roofs may contain asbestos' }
  }
  if (slots.material === 'unknown') {
    return { step: 'inspection', reason: "we couldn't confirm the roof material" }
  }
  // They told us it's metal but not which profile — ask that, not the
  // generic question again.
  if (!slots.material && slots.metal_hint) {
    return { step: 'material_profile', question: QUESTIONS.material_profile }
  }
  if (!slots.material) return { step: 'material', question: QUESTIONS.material }

  // Pitch gate: same idea for steep or unknown pitch.
  if (slots.pitch === 'very_steep' || slots.pitch === 'unknown') {
    return { step: 'inspection', reason: 'the roof pitch is steep or unknown' }
  }
  if (!slots.pitch) return { step: 'pitch', question: QUESTIONS.pitch }

  return { step: 'ready' }
}

/** PURE — convert the gathered slots into the RoofAddressInput +
 *  RoofUserInputs the roofing pipeline expects. Returns null when not
 *  ready (missing required fields). */
export function toRoofingRequest(slots: RoofingSlots): {
  address: RoofAddressInput
  inputs: { material: RoofMaterial; pitch: PitchBucket; intent: RoofJobIntent; building_year_built: number | null }
} | null {
  if (!slots.address || !slots.material || !slots.pitch || !slots.intent) return null
  return {
    address: {
      address: slots.address,
      postcode: slots.postcode ?? '',
      state: slots.state ?? 'NSW',
    },
    inputs: {
      material: slots.material,
      pitch: slots.pitch,
      intent: slots.intent,
      building_year_built: slots.year_built ?? null,
    },
  }
}
