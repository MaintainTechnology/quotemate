// Pull the latest Vapi call transcripts and run the REAL extraction +
// post-call decision against them, to see why a call that clearly discussed
// material/pitch/intent still gets asked for them by text.
// Run: node --env-file=.env.local --import tsx scripts/diag-voice-extraction.mts

import { extractVoiceTradeAnswers, mapVoiceAnswersToRoofingSlots } from '../lib/voice/trade-handover'
import { decidePostCallRoofingAction } from '../lib/voice/post-call-roofing'

const r = await fetch('https://api.vapi.ai/call?limit=3', {
  headers: { Authorization: 'Bearer ' + process.env.VAPI_API_KEY },
})
const calls = await r.json()

for (const c of calls) {
  console.log('==== CALL', (c.createdAt ?? '').slice(0, 19), 'assistant', (c.assistantId ?? '').slice(0, 8), '====')
  const answers = await extractVoiceTradeAnswers(c.transcript ?? '')
  console.log('extracted:', JSON.stringify(answers))
  if (answers) {
    const slots = mapVoiceAnswersToRoofingSlots(answers)
    console.log('mapped slots:', JSON.stringify(slots))
    const d = decidePostCallRoofingAction(slots, Boolean(answers.address_confirmed))
    const tail =
      d.action === 'ask' ? '→ step ' + d.step
      : d.action === 'measure' ? '(isInspection=' + d.isInspection + ')'
      : d.action === 'inspection_reason' ? '→ ' + d.reason
      : ''
    console.log('DECISION:', d.action, tail)
  }
  console.log()
}
