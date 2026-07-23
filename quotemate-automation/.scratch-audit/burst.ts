// Prove what the roofing receptionist does with a rapid-fire burst.
import { advanceRoofing, shouldEngageRoofing, type RoofingConversationState } from '../lib/sms/roofing-receptionist'
import { arrivalTimestampsFromTurns, isGlobalOptOut } from '../lib/sms/inbound-helpers'
import { adaptiveDebounceMs, getDeliveryKnobs } from '../lib/sms/send-reliability'

const knobs = getDeliveryKnobs({})
console.log('knobs', knobs)

type Turn = { direction: 'inbound' | 'outbound'; body: string }

// Exactly what handleRoofingTurn does (route.ts:444-445)
function latestInbound(turns: Turn[]): string {
  return [...turns].reverse().find(t => t.direction === 'inbound')?.body ?? ''
}

// Exactly what the general dialog does (route.ts:2011-2023)
function coalesced(turns: Turn[]): string {
  let lastOut = -1
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].direction === 'outbound') { lastOut = i; break }
  const pend = turns.slice(lastOut + 1).filter(t => t.direction === 'inbound').map(t => t.body)
  return pend.length > 1 ? pend.join('\n---\n') : (pend[0] ?? '')
}

function show(label: string, prev: RoofingConversationState | null, inbound: string) {
  const engage = shouldEngageRoofing(prev, inbound, false, true)
  const d = engage ? advanceRoofing(prev, inbound) : null
  console.log(`\n--- ${label}`)
  console.log('   inbound   :', JSON.stringify(inbound))
  console.log('   engage    :', engage)
  if (d) {
    console.log('   action    :', d.action)
    if (d.action === 'ask') console.log('   step/reply:', d.step, '|', d.reply)
    if (d.action === 'inspection') console.log('   reason    :', (d as any).reason)
    console.log('   slots     :', JSON.stringify(d.slots))
  }
  return d
}

console.log('\n================ CASE A: 3-text burst inside the debounce window ================')
const burst: Turn[] = [
  { direction: 'inbound', body: 'hi' },
  { direction: 'inbound', body: 'i need a quote' },
  { direction: 'inbound', body: 'for my roof' },
]
console.log('roofing sees      :', JSON.stringify(latestInbound(burst)))
console.log('general dialog sees:', JSON.stringify(coalesced(burst)))
show('burst -> roofing (last only)', null, latestInbound(burst))

console.log('\n================ CASE B: address split over two texts ================')
// Bot asked for the address; customer sends street then suburb/postcode.
const afterAsk: RoofingConversationState = { slots: {}, last_step: 'address' }
const burst2: Turn[] = [
  { direction: 'outbound', body: "What's the property address, including suburb and postcode?" },
  { direction: 'inbound', body: '12 Smith St' },
  { direction: 'inbound', body: 'Bondi NSW 2026' },
]
console.log('roofing sees      :', JSON.stringify(latestInbound(burst2)))
console.log('general dialog sees:', JSON.stringify(coalesced(burst2)))
show('address burst -> roofing (last only)', afterAsk, latestInbound(burst2))
show('address burst -> if it saw both', afterAsk, coalesced(burst2))

console.log('\n================ CASE C: sequential (each own turn), slow burst ================')
let st: RoofingConversationState | null = null
for (const msg of ['hi', 'i need a quote', 'for my roof', '12 Smith St Bondi NSW 2026']) {
  const d = show(`seq: ${msg}`, st, msg)
  if (!d) { console.log('   (handed to general dialog)'); continue }
  if (d.action === 'ask') st = { slots: d.slots, last_step: d.step, pending_quote_token: null, pending_structure_count: null }
  else if (d.action === 'inspection') st = { slots: d.slots, last_step: 'await_booking' }
}

console.log('\n================ CASE D: debounce sizing ================')
const t0 = Date.now()
const rows = (gaps: number[]) => {
  const out = [{ direction: 'inbound', created_at: new Date(t0).toISOString() }]
  let t = t0
  for (const g of gaps) { t += g; out.push({ direction: 'inbound', created_at: new Date(t).toISOString() }) }
  return out
}
for (const gaps of [[], [400, 400], [3000, 3000], [1400], [30]]) {
  const ts = arrivalTimestampsFromTurns(rows(gaps) as any)
  console.log(`gaps=${JSON.stringify(gaps)} -> arrivals=${ts.length} debounce=${adaptiveDebounceMs(ts, knobs)}ms`)
}

console.log('\n================ CASE E: opt-out keywords vs roofing cancel ================')
for (const m of ['stop', 'cancel', 'CANCEL', 'end', 'quit', 'cancel the booking', 'Cancel please', 'no thanks']) {
  console.log(`${JSON.stringify(m).padEnd(24)} isGlobalOptOut=${isGlobalOptOut(m)}`)
}

console.log('\n================ CASE F: burst where the LAST text is the throwaway ================')
const burst3: Turn[] = [
  { direction: 'outbound', body: "What's the property address, including suburb and postcode?" },
  { direction: 'inbound', body: '12 Smith St Bondi NSW 2026' },
  { direction: 'inbound', body: 'thanks' },
]
console.log('roofing sees:', JSON.stringify(latestInbound(burst3)))
show('address then "thanks"', afterAsk, latestInbound(burst3))
