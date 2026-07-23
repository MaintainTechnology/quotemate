import { advanceRoofing, shouldEngageRoofing } from '../lib/sms/roofing-receptionist'
type Turn = { direction: 'inbound' | 'outbound'; body: string }
function latestInbound(turns: Turn[]): string {
  return [...turns].reverse().find(t => t.direction === 'inbound')?.body ?? ''
}
function run(label: string, turns: Turn[]) {
  const inbound = latestInbound(turns)
  const engage = shouldEngageRoofing(null, inbound, false, true)
  const d = advanceRoofing(null, inbound)
  console.log(`\n${label}`)
  console.log('  all inbound texts:', JSON.stringify(turns.filter(t=>t.direction==='inbound').map(t=>t.body)))
  console.log('  receptionist sees:', JSON.stringify(inbound))
  console.log('  action/step:', d.action, (d as any).step ?? '', '|', (d as any).reply ?? (d as any).reason ?? '')
  console.log('  harvested slots:', JSON.stringify(d.slots))
}
// Opening burst where the ADDRESS is in the middle text and a throwaway trails.
run('Opening burst: address in msg2, "asap" trails', [
  { direction: 'inbound', body: 'hi' },
  { direction: 'inbound', body: 'need a reroof at 12 Smith St Bondi NSW 2026' },
  { direction: 'inbound', body: 'asap please' },
])
// Same but single message (what harvest is designed for)
run('Single opening message (harvest works)', [
  { direction: 'inbound', body: 'need a reroof at 12 Smith St Bondi NSW 2026 asap please' },
])
