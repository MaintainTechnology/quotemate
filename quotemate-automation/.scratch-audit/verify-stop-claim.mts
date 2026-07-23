// Adversarial-verifier scratch: run the REAL exported functions.
import { isStopRequest, looksLikeRoofingEnquiry } from '../lib/sms/roofing-intake'
import { advanceRoofing, shouldEngageRoofing, nextRoofingConversationState } from '../lib/sms/roofing-receptionist'
import { isGlobalOptOut } from '../lib/sms/inbound-helpers'

const trigger = 'hi can you stop the leak in my roof before the rain comes'

console.log('=== PRIMARY TRIGGER ===')
console.log('msg:', JSON.stringify(trigger))
console.log('isGlobalOptOut (route-level whole-message guard):', isGlobalOptOut(trigger))
console.log('looksLikeRoofingEnquiry:', looksLikeRoofingEnquiry(trigger))
console.log('shouldEngageRoofing(null, msg, false, roofingOnly=false):', shouldEngageRoofing(null, trigger, false, false))
console.log('shouldEngageRoofing(null, msg, false, roofingOnly=true):', shouldEngageRoofing(null, trigger, false, true))
console.log('isStopRequest:', isStopRequest(trigger))
const d = advanceRoofing(null, trigger)
console.log('advanceRoofing(null, msg) decision:', JSON.stringify(d))
console.log('persisted state after turn:', JSON.stringify(nextRoofingConversationState(d)))

console.log('\n=== OTHER CLAIMED STRINGS (isStopRequest) ===')
const claimed = [
  'can you stop the leak before it rains',
  'please stop the water coming in',
  'I want to stop the leak',
  'stop by any time',
  "don't cancel my booking",
  'we cancelled our old quote so go ahead',
  'no thanks not interested in the patch, I want the full reroof',
  'nevermind the shed just do the house',
  'cancel that, I mean the back roof',
  'sorry forget it, I meant 14 not 12',
  'we had another roofer cancel on us last week',
  'the insurance company cancelled the claim',
]
for (const s of claimed) console.log(isStopRequest(s), '|', s)

console.log('\n=== MID-FLOW: address step, customer corrects themselves ===')
const midFlow = { slots: { intent: 'repair' }, last_step: 'address' } as any
const d2 = advanceRoofing(midFlow, 'cancel that, I mean 14 Smith St Coorparoo 4151')
console.log('advanceRoofing(mid-flow addr, "cancel that, I mean 14 Smith St...") →', d2.action)

console.log('\n=== SAME MESSAGE WITHOUT THE STOP WORD ===')
const noStop = 'hi can you fix the leak in my roof before the rain comes'
const d3 = advanceRoofing(null, noStop) as any
console.log('→ action:', d3.action, '| step:', d3.step ?? '', '| reply:', d3.reply ?? '')
