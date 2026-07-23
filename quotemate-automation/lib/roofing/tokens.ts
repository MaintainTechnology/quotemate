// Roofing measurement capability tokens.
//
// Every roofing_measurements row carries TWO unguessable tokens:
//   public_token  → /q/roof/[public_token]  customer's priced quote page
//   measure_token → /m/[measure_token]      tradie's Measurement Results page
//
// Mint them as a PAIR and spread the result into the insert. Minting them
// separately is how the SMS receptionist ended up writing public_token only,
// leaving every SMS-origin job with no Measurement Results page while web
// saves had one (app/api/roofing/save/route.ts minted both by hand).

import { randomBytes } from 'node:crypto'

/** Both capability tokens for a new roofing_measurements row. Spread this
 *  into the insert so a row can never carry one token without the other. */
export function newMeasurementTokens(): {
  public_token: string
  measure_token: string
} {
  return {
    public_token: randomBytes(16).toString('hex'),
    measure_token: randomBytes(16).toString('hex'),
  }
}
