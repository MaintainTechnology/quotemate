// Vapi transcript parser.
//
// Vapi's end-of-call payload stores the conversation as a single string
// in `calls.transcript` with a regular `Role: text` format on each line.
// The exact role label varies by Vapi assistant config — common shapes:
//
//   "AI: G'day, thanks for calling QuoteMate...\n
//    User: Yeah I need a quote for downlights\n
//    AI: Easy - how many?\n
//    User: Six in the lounge"
//
//   "Bot: G'day...\nHuman: ..."
//   "Agent: G'day...\nCustomer: ..."
//   "Assistant: G'day...\nUser: ..."
//
// We split on lines that start with a recognised role label, attribute
// the trailing text to that speaker, and emit a structured array that
// matches the SMS conversation shape ({direction, body, created_at}).
// The dashboard's existing <Transcript> component can then render voice
// calls with the same chat-bubble UI as SMS — visual parity, zero new
// component code.
//
// Lines that don't start with a recognised role get appended to the
// previous speaker's body (Vapi sometimes wraps long replies across
// multiple lines without re-emitting the role prefix).

export type VoiceTurn = {
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
}

// Map every plausible role label to the dashboard's directional sense.
// Outbound = the AI/bot (what we sent the customer); inbound = the
// human caller (what the customer said).
const ROLE_DIRECTION: Record<string, 'inbound' | 'outbound'> = {
  ai: 'outbound',
  bot: 'outbound',
  agent: 'outbound',
  assistant: 'outbound',
  quotemate: 'outbound',
  receptionist: 'outbound',
  user: 'inbound',
  human: 'inbound',
  customer: 'inbound',
  caller: 'inbound',
}

const ROLE_LINE_RE = /^\s*(ai|bot|agent|assistant|quotemate|receptionist|user|human|customer|caller)\s*:\s*(.*)$/i

/**
 * Parse a Vapi transcript blob into structured voice turns.
 *
 * The `callEndedAt` ISO timestamp is used as the timestamp for ALL
 * emitted turns. We don't synthesise per-turn timestamps because the
 * Vapi transcript text doesn't carry them — better to be honest about
 * the limitation than to fake interpolated times that look real.
 *
 * Returns an empty array for null / empty / unparseable transcripts.
 */
export function parseVapiTranscript(
  transcript: string | null | undefined,
  callEndedAt: string | null | undefined,
): VoiceTurn[] {
  if (!transcript || typeof transcript !== 'string') return []
  const ts = callEndedAt ?? new Date().toISOString()
  const lines = transcript.split(/\r?\n/)

  const turns: VoiceTurn[] = []
  let current: VoiceTurn | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(ROLE_LINE_RE)
    if (m) {
      // Push the previous turn before starting a new one.
      if (current && current.body.trim().length > 0) {
        turns.push(current)
      }
      const roleKey = m[1].toLowerCase()
      const direction = ROLE_DIRECTION[roleKey] ?? 'inbound'
      current = {
        direction,
        body: (m[2] ?? '').trim(),
        created_at: ts,
      }
    } else if (current) {
      // Continuation line — append to the current speaker's body.
      current.body = current.body
        ? `${current.body} ${line}`
        : line
    } else {
      // Pre-role text at the very top of the transcript — treat as a
      // single AI utterance so it doesn't get dropped. Vapi rarely
      // does this but the empty-prefix case has been seen on hangups.
      current = { direction: 'outbound', body: line, created_at: ts }
    }
  }

  if (current && current.body.trim().length > 0) {
    turns.push(current)
  }

  return turns
}
