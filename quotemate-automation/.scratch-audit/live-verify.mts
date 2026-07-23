import { verifyAuAddress, planConfirmAddress } from '../lib/sms/verify-address'
const cases = [
  '223 Archer St, Chandler',
  '223 Archer Street, Chandler QLD 4155',
  '670 London Road Chandler QLD 4155',
  '15 Schofield drive safety each',
  '123 zzzqqq street nowhereville',
]
for (const raw of cases) {
  const v = await verifyAuAddress(raw)
  const p = planConfirmAddress(raw, v)
  console.log('IN  :', raw)
  console.log('OUT :', v.outcome, v.outcome === 'match' ? `| corrected=${v.corrected} | "${v.formatted}"` : '')
  console.log('SMS :', p.kind === 'keep' ? '(unchanged read-back)' : p.reply)
  console.log()
}
