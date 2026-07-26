import { describe, it, expect } from 'vitest'
import { assertGroundedReply } from './llm-receptionist'

const AUTH = [
  '{"address":"670 London Rd, Chandler QLD 4155","postcode":"4155","year_built":1987,"structures":3}',
  'Your re-roof at 670 London Rd: Good $14,200, Better $18,400, Best $22,900 inc GST. Total roof area 248 m2 across 3 buildings.',
]
const CUST = ['my postcode is 4165', 'house was built in 1985', 'there are 2 buildings', '12 Smith Street Bondi NSW 2026']

const REJECT = [
  "That'll be 75 mate.", 'Bond is 50 up front.', 'Callout is 99, waived if you go ahead.',
  'Gutters run 45 per metre.', 'Ridge caps are 35 each.', 'Add 60 for the skip bin.',
  'We can do it for 90.', 'Our hourly is 95 plus GST.', 'The deposit is five hundred.',
  'It will be twenty-two hundred.', 'Ninety-nine to come out and look.',
  'Rates are ninety-five per square metre.', 'About eight hundred and fifty dollars worth.',
  'Ballpark 670 for the gutter run.', 'We can do it for 4155.', 'The deposit works out at 1987.',
  'Your re-roof comes to $11,682 inc GST.', 'Total is 11682 AUD.', 'Ballpark 11500 for the re-roof.',
  'Price: 32,400 inc GST.', 'Deposit is 500 bucks to lock it in.', 'it is 950 for the repair',
  'the callout is 120', 'pay 99 to lock it in', 'a repair is normally 600 to 900', '300 per m2',
  'around 300 a metre', 'roughly 250 psm', 'about 185 sq m', '185 sq metres', '10% off',
  'we do 5% off for cash', 'three buildings on your block', 'We found 7 buildings on the block.',
  'We measured 9 roofs there.', 'Your roof is about 240 square metres.',
  "We've measured 42 Wattle Road, Toowong.", 'See www.quotemax.com.au/q/roof/FAKE123',
  'Pay at https://quotemax.com.au/pay/abc', 'The deposit is $18,400.',
  'Pay $22,900 today and we start tomorrow.', 'Your roof is 18400 sqm.',
  'There are 22900 buildings.', 'About 12 grand all up.', 'Your roof is 4155 sqm, want the quote?',
  'We found 4155 buildings, price them all?', 'The deposit is ４５０ dollars.',
  'It works out at 9900 all up.', 'Starting from 800 for that.', 'As low as 700 mate.',
  'Your roof measured 900 m2.', 'That is 1,250.50 all up.',
]

const PASS = [
  "No worries. What's the property address, with suburb and postcode?",
  'Is it a single storey or a 2 storey?', 'Is it a single storey or 2 storey place?',
  'Is it a 3 bedroom place?', 'And is it 1 building or are there sheds too?',
  'A hundred percent mate, what is the address?', 'Got it, 4165.', 'Built in 1985, noted.',
  'So 2 buildings then, thanks.', 'Yeah we do painting and electrical as well.',
  'Happy to sort a roofing quote for you.',
  'Good question, I will check with Jeph and come back to you.',
  'What do you need done? A full re-roof, a repair, a leak traced, or gutters?',
  'Is the roof Colorbond, tile, or something else?',
  'Just to confirm, the property is 670 London Rd, Chandler QLD 4155. Is that right?',
  'No worries, electrical it is. What do you need done?', 'We service the 4155 area.',
  'Thanks, I have got that noted. Anything else?',
  'Would you like us to book the on-site inspection? Reply YES or NO.',
  'Your roof measured 248 m2.', 'We measured 248 m2 across the 3 buildings.',
  'How steep is the roof? Standard, steep, or not sure?',
  'Which way is the driveway?', 'No worries mate, all sorted.',
  'Sorry, I did not catch a property address there.',
  'Is that a Colorbond corrugated roof or Trimdek?',
  'Cheers, I will get that organised for you.',
  'Righto. Do you want the whole roof done or just a patch?',
  'We cover Chandler and the surrounding suburbs.',
  'Are you after the gutters done as well?',
  'I can get someone out to take a look if that suits.',
  'What is the best time to reach you?', 'Thanks for that, nearly done.',
  'Do you know roughly when the house was built?',
  'Is anyone home during the day?', 'Happy to help with the electrical instead.',
  'No dramas, I will pass that on to Jeph.',
  'Is the leak above a bedroom or a living area?',
  'All good, I have got 670 London Rd, Chandler QLD 4155 down.',
]

describe('grounding validator — corpus regression (both directions)', () => {
  it('leaks no invented figure', () => {
    for (const r of REJECT) {
      expect(assertGroundedReply(r, AUTH, CUST), ).toMatchObject({ ok: false })
    }
  })

  it('blocks no ordinary receptionist prose', () => {
    // A validator that bails on normal copy is as much a defect as one that
    // leaks: every bail silently reverts the turn to the old state machine
    // and spends a Sonnet call for nothing.
    for (const r of PASS) {
      expect(assertGroundedReply(r, AUTH, CUST), ).toMatchObject({ ok: true })
    }
  })
})
