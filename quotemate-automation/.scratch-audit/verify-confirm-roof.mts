import { advanceRoofing, expireIdleRoofingState } from '../lib/sms/roofing-receptionist'
const parked = { slots: { address: '670 London Road' }, last_step: 'confirm_roof' as const, pending_quote_token: 't', pending_structure_count: 3 }
const HOUR = 60 * 60 * 1000
const show = (label: string, v: unknown) => console.log(label.padEnd(46), v)

console.log('--- confirm_roof: regressions the review found (must be send_saved) ---')
for (const m of ['yeah do the re-roof', 'yes new roof please', 'yes it was built in 1990', 'yes', "yes that's my roof"])
  show(`"${m}"`, advanceRoofing(parked, m).action)

console.log('--- confirm_roof: picks / all / no (unchanged) ---')
for (const m of ['2', '2 and 3', 'the main one', 'all of them', 'no'])
  show(`"${m}"`, advanceRoofing(parked, m).action)

console.log('--- confirm_roof: a real NEW address must restart (ask/confirm_address) ---')
for (const m of ['223 Archer St, Chandler QLD 4154', 'I want a roofing quote at 2 Smith St, Bondi NSW 2026']) {
  const d = advanceRoofing(parked, m)
  show(`"${m.slice(0,34)}…"`, d.action + (d.action === 'ask' ? '/' + d.step : ''))
}

console.log('--- idle expiry: only confirm_roof + quoted expire; await_booking survives ---')
for (const step of ['confirm_roof', 'quoted', 'await_booking', 'material'] as const)
  show(`  ${step} @ 3h idle`, expireIdleRoofingState({ slots: { address: 'x' }, last_step: step }, 3 * HOUR)?.last_step ?? 'NOT expired (resumes)')
