# Spec: the address confirmation must never loop

## The incident (live 2026-08-07, QM Sparky, +61480808517)

```
BOT  | Hi Jen, is this your roof at 12 Smith St, Surry Hills NSW 2010?
       Reply YES and I'll send your quote, or NO if it's the wrong building.
CUST | No
BOT  | Just to confirm, the property is "12 Smith St, Surry Hills NSW 2010". Is that right? Reply yes or no.
CUST | Hi Mate
BOT  | Just to confirm, the property is "12 Smith St, Surry Hills NSW 2010". Is that right? Reply yes or no.
CUST | No, I want to do a roofing please
BOT  | Just to confirm, the property is "12 Smith St, Surry Hills NSW 2010". Is that right? Reply yes or no.
CUST | No!
BOT  | Just to confirm, the property is "12 Smith St, Surry Hills NSW 2010". Is that right? Reply yes or no.
```

Byte-identical reply to four different inbound messages, including two
unambiguous rejections. The customer cannot escape and cannot correct the
address. This is the documented debt in the monorepo CLAUDE.md: "Roofing
map-verify layer (lib/sms/verify-address.ts) — unbounded loop when Google
'corrects' to the wrong address."

## What the state actually was

```
roofing_state.last_step  = "closed"
roofing_state.slots      = { address: "12 Smith St, Surry Hills NSW 2010",
                             addr_verified: "12 Smith St, Surry Hills NSW 2010",
                             address_confirmed: true, intent: full_reroof,
                             material: colorbond_corrugated, pitch: standard }
painting_state.last_step = "coats"
```

Neither step machine was at `confirm_address`. Roofing was **closed**, with the
address already confirmed. The read-back is composed by
`confirmAddressQuestion()` in `lib/sms/verify-address.ts:459-464`, so the
verification layer is re-entering on a flow that had already finished, and the
customer's answer is never consumed.

`MAX_ADDRESS_VERIFY_REJECTS = 2` already exists at `verify-address.ts:98`. The
bound is declared but is not stopping this, so either nothing increments the
reject counter on this path, or the counter is not persisted between turns.

## Requirements

1. **A rejection must be consumed.** A negative reply to the read-back
   (`No`, `No!`, `No, I want to do a roofing please`, `nope`, `wrong`) must
   clear the verified address and ask for a new one. It must never re-emit
   the same read-back.
2. **The loop must be bounded, and the bound must actually fire.**
   `MAX_ADDRESS_VERIFY_REJECTS` rejections in one thread ends verification and
   hands off with `addressHandoffReply()`. The reject count must be persisted on
   conversation state so it survives across turns.
3. **A closed flow must not re-enter verification.** When `last_step` is
   `closed` (or the address is already `address_confirmed`), a new message must
   not restart the confirm handshake. It belongs to a fresh enquiry or the
   general dialog.
4. **An unparsed reply must not silently re-ask.** A reply that is neither
   affirmative nor negative ("Hi Mate") counts a miss. After the existing miss
   budget it must move on, not repeat verbatim.
5. **Never the same message twice in a row.** If the composed reply is
   byte-identical to the immediately previous outbound on the same
   conversation, it must not be sent as-is. This is the backstop that makes
   any future variant of this bug visible instead of silent.

## Scope

Fix in the deployed services under
`C:\Users\dalig\Desktop\MaintainTech\MaintainOrg\QuoteMax\Receptionists`:
`qm-roofing-receptionist`, `qm-painting-receptionist`,
`qm-electrical-receptionist`, `qm-plumbing-receptionist` — `verify-address.ts`
is shared, so the fix must land identically in each.

Mirror the change into the monolith `quotemate-automation/lib/sms/` so a future
carve-out regeneration cannot revert it.

## Definition of done

- [ ] A runnable check (the repo's `*.check.ts` pattern) replays the incident
      transcript above and proves the third message differs from the second.
- [ ] Unit tests cover: `No` clears; `No!` clears; `No, I want to do a roofing
      please` clears; two rejections hand off; `Hi Mate` counts a miss and does
      not repeat verbatim; a `closed` flow does not re-enter verification.
- [ ] `npx tsc --noEmit` clean in every edited service and the monolith.
- [ ] `npx vitest run lib/sms` green in the monolith.
- [ ] Each service's own `npm run check` / test script green.
- [ ] The identical-consecutive-reply backstop is in place and tested.

## Non-goals

- Changing pricing, grounding, sanity bounds, or the Geoscape provider.
- Changing the front desk router.
- Changing what a *successful* verification does.

## Traps

- `verify-address.ts` exists in all four services AND the monolith. Fixing one
  ships nothing.
- supabase-js resolves `{data, error}` on failure — it does not throw. A reject
  counter that is written without checking `error` will silently not persist,
  and the bound will keep not firing.
- Do not report a fix as verified without replaying the transcript.
