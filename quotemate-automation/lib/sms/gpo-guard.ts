import type { ConversationTurn } from './dialog'

type MinimalDecision = {
  action: string
  job_type_guess?: string | null
  reason_for_escalation?: string | null
  reply_to_send?: string | null
}

export type GpoInspectionOverride = {
  reply: string
  reason: string
}

const GPO_TERMS_RE = /\b(?:gpos?|g\.p\.o\.?s?|power\s*points?|powerpoints?|outlets?|sockets?)\b/i
const NEW_GPO_WORDING_RE = /\b(?:new|add|install|put in|putting in)\s+(?:a\s+|two\s+|three\s+|four\s+|\d+\s+)?(?:gpos?|power\s*points?|powerpoints?|outlets?|sockets?)\b/i
const WET_ROOM_RE = /\b(?:ensuite|bathroom|powder room|toilet|wc|laundry|kitchen)\b/i

// These are the cases where the customer really has told us enough to
// route a GPO job to inspection. Broad room names ("ensuite") and broad
// scope words ("new GPO") are intentionally absent.
const EXPLICIT_GPO_INSPECTION_RE = new RegExp([
  String.raw`\b(?:new|add|run|install)\s+(?:a\s+)?(?:dedicated\s+)?circuit\b`,
  String.raw`\bdedicated\s+circuit\b`,
  String.raw`\b(?:new|fresh|brand[- ]?new)\s+(?:run|feed|cable)\s+from\s+(?:the\s+)?switchboard\b`,
  String.raw`\bfrom\s+(?:the\s+)?switchboard\b`,
  String.raw`\bno\s+(?:power|gpo|power\s*point|powerpoint|outlet|socket)s?\s+(?:there|nearby|in\s+(?:that|the)\s+room|on\s+that\s+wall)\b`,
  String.raw`\b(?:outdoor|outside|weatherproof|external)\b`,
  String.raw`\bthree[- ]?phase\b`,
  String.raw`\b(?:switchboard|fuse box|ceramic fuse|old wiring|pre[- ]?1970|asbestos)\b`,
  String.raw`\b(?:burning smell|sparks?|sparking|electric shock|shocked)\b`,
  String.raw`\b(?:near|beside|next to|within\s+\d+\s*(?:mm|cm|m)\s+of)\s+(?:the\s+)?(?:sink|basin|shower|bath)\b`,
  String.raw`\b(?:inside|in)\s+(?:a\s+|the\s+)?(?:wet[- ]?area|bathroom|shower)\s+zone\b`,
].join('|'), 'i')

function inboundText(turns: ConversationTurn[]): string {
  return turns
    .filter((t) => t.direction === 'inbound')
    .map((t) => t.body)
    .join('\n')
}

function latestInbound(turns: ConversationTurn[]): string {
  return [...turns].reverse().find((t) => t.direction === 'inbound')?.body.trim() ?? ''
}

function cleanRoom(s: string): string {
  const match = s.match(WET_ROOM_RE)
  return (match?.[0] ?? s).trim().toLowerCase()
}

export function buildGpoInspectionOverride(args: {
  decision: MinimalDecision
  turns: ConversationTurn[]
  jobTypeFromState?: string | null
}): GpoInspectionOverride | null {
  if (args.decision.action !== 'escalate_inspection') return null

  const text = inboundText(args.turns)
  const isPowerPointJob =
    args.decision.job_type_guess === 'power_points' ||
    args.jobTypeFromState === 'power_points' ||
    GPO_TERMS_RE.test(text)

  if (!isPowerPointJob) return null
  if (EXPLICIT_GPO_INSPECTION_RE.test(text)) return null

  const last = latestInbound(args.turns)
  if (WET_ROOM_RE.test(last) || WET_ROOM_RE.test(text)) {
    const room = cleanRoom(WET_ROOM_RE.test(last) ? last : text)
    return {
      reason: 'gpo wet-room false-positive inspection override',
      reply: `Got it - ${room}. Will the GPO be at least 600mm from any basin, shower, bath or sink?`,
    }
  }

  if (NEW_GPO_WORDING_RE.test(text)) {
    return {
      reason: 'new-gpo false-positive circuit override',
      reply: 'Got it. Is there an existing power point nearby, or would this need a new run from the switchboard?',
    }
  }

  return {
    reason: 'gpo false-positive inspection override',
    reply: 'Got it. Is this replacing existing GPOs, or adding new ones near existing power?',
  }
}
