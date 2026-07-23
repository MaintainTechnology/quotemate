import { advanceRoofing } from '../lib/sms/roofing-receptionist'
const quoted = { slots: {}, last_step: 'quoted' as const, pending_quote_token: 't', pending_structure_count: 3, last_served_structures: [1] }
const show = (m: string) => { const d = advanceRoofing(quoted, m); console.log(`"${m.slice(0,44)}"`.padEnd(48), d.action + (d.action === 'ask' ? '/' + d.step + ' → ' + d.slots.address : '')) }
console.log('--- warm quoted thread (670 London Rd already quoted) ---')
show('Ok can you price 652 London Rd Chandler QLD 4155')   // the live bug → must reopen
show('2 and 3')                                            // pick → send_saved
show('the others')                                         // complement → send_saved
show('can you quote another re-roof')                      // keyword → reopen
show('how much for 6 downlights?')                         // unrelated → passthrough
show('thanks mate')                                        // unrelated → passthrough
