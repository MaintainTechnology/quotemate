# EV charger estimate EST-0018 — conversation and pricing review

Reviewed 15 September 2026. Investigation only: no quote, price-book, application-code, or customer-message changes.

## Conclusion

All three reported issues are confirmed. Bob requested a charger supplied by the business. The receptionist agreed, but the selected $881.10 estimate contains installation and assessment charges only. Its scope promises supply and installation, while two assumptions say the charger model and price will be confirmed separately. The exclusions do not explicitly exclude the charger unit.

This is a failure to reconcile the promised work with the priced work. The arithmetic is correct for the four listed charges; the total is incomplete for the promised supply-and-install job. A complete replacement total cannot be calculated until the tradie specifies and prices the actual charger and verifies the installation design.

## Evidence examined

- [Public quote](https://quotemax.com.au/q/wW7wD5c9MNG8icwZdbV-gg), including scope, materials, inclusions, exclusions, recommendations, assumptions, breakdown and booking copy.
- [Live printable estimate](https://quotemax.com.au/api/q/wW7wD5c9MNG8icwZdbV-gg/html). This is the HTML document surface; the cached PDF binary was not separately downloaded or inspected.
- Quote `58a80943-4ee1-41c5-89db-2abde3897ae3`, intake `ea85d907-764e-4ba2-82a3-51fefad20171`, conversation `f3281393-21d5-4a45-8970-2e45cc7859d3`.
- Electrical3 tenant `81ca2712-61db-49e2-83cf-2db044be8c65` in Supabase project `bobvihqwhtcbxneelfns`.
- All 18 stored conversation messages, SMS dispatch traces, estimation traces, catalogue rows and current price book.
- Current local source at HEAD `e3872b0e6e804afe6bfe10c1be3238d2f1d6f742`, including independent source review and three synthetic reproductions.

The stored quote was created at 2026-09-14 19:41:58 UTC. At review it was `viewed`, with no acceptance or payment timestamps. Its `sent_at` was populated, but no matching quote-link message or outbox row was found in the queried tables. Stored outbound conversation delivery statuses were `unknown`; dispatch traces record provider acceptance, not confirmed handset delivery.

## Complete stored SMS conversation

Times below are UTC on 14 September 2026. Customer contact details and the upload bearer token are omitted.

| Time | Speaker | Message |
| --- | --- | --- |
| 19:35:30 | Bob | Can I get an EV charger |
| 19:35:44 | Receptionist | Welcome back - keen to help with the EV charger install. Quick one, what's your first name? |
| 19:36:02 | Bob | Bob |
| 19:36:12 | Receptionist | Cheers Bob - what suburb's the job in? |
| 19:37:13 | Bob | Chandler |
| 19:37:24 | Receptionist | Good one Bob - is the charger unit already on-site, and if so what model is it? |
| 19:37:35 | Bob | Can you supply? |
| 19:37:47 | Receptionist | No worries Bob, we can supply the unit. Roughly how far is the parking spot from the switchboard? |
| 19:38:08 | Bob | 6m |
| 19:38:21 | Receptionist | Righto - is the property on single-phase or three-phase supply, and any idea of spare capacity in the switchboard? |
| 19:38:57 | Bob | Three-phase,l |
| 19:39:05 | Bob | Yes spare capacity |
| 19:39:11 | Receptionist | Righto, three-phase - and any idea if there's spare capacity in the switchboard for the new circuit? |
| 19:40:15 | Bob | Seems to be spare |
| 19:40:28 | Receptionist | Beauty Bob - we'll supply a 7kW three-phase charger, 6m run from the board, spare capacity there. I'll flick you a link to snap a photo of the parking spot, that's needed before we can quote. Sound right? |
| 19:40:31 | Receptionist | Hi Bob, drop us a couple of photos here so the tradie can lock in the right gear: [upload link]. Optional but a big help. |
| 19:40:45 | Bob | Sounds right |
| 19:40:54 | Receptionist | All good Bob - quote's on its way shortly. Cheers. |

### What the conversation actually establishes

- Customer: Bob; suburb: Chandler.
- Supply responsibility: business/tradie. This is explicit, not ambiguous, and must not be changed to customer-supplied to reconcile the quote.
- Distance: approximately 6 m from switchboard to parking spot.
- Property supply: customer reports three-phase.
- Switchboard capacity: customer believes there is spare capacity; no technical verification or separate confirmation of a spare circuit position.
- The customer does not independently specify a brand, model, charging power, vehicle, connector, mounting method, actual parking location or wiring route.
- The receptionist first introduces **7kW** and a **three-phase charger**. The final “Sounds right” confirms a recap, but does not establish a catalogue product or its price.
- No photos were attached, and no explicit refusal to supply photos appears in the stored conversation.
- A capacity answer arrived before a repeated capacity question. The message timestamps establish the repetition; a precise concurrency cause was not proven.

## Price reconciliation

The tenant uses a single visible option. The selected stored tier is `better`.

| Selected line | Calculation, ex GST | Ex GST | Inc GST |
| --- | --- | ---: | ---: |
| Install 32A three-phase outlet assembly | $120 base plus 30% markup | $156.00 | $171.60 |
| Install labour: circuit, mount, terminate, test and certify | 3 hours × $150 | $450.00 | $495.00 |
| Switchboard health check and load assessment | 1 each × $150 | $150.00 | $165.00 |
| Risk allowance for capacity/load verification | 0.3 hours × $150 | $45.00 | $49.50 |
| **Total** | **$801 + $80.10 GST** | **$801.00** | **$881.10** |

There is no charger-unit line in Good, Better or Best. Live queries found no matching EV charger unit in the tenant material catalogue or shared electrical materials. The recorded `product_choice` is null.

Good is $651 ex GST ($716.10 inc GST). Better is $801 ex GST ($881.10 inc GST). Best was drafted at $896 ex GST, then reduced to $801 when an ungrounded $95 RCBO line was stripped. Its label still promises a safety upgrade and extended warranty. Better/Best are not coherent distinct upgrades after that removal, although only Better is visible here.

The $99 site visit is the immediate booking payment shown on the page. It does not provide the missing charger price. No payment was made in this investigation.

## Findings and causes

### 1. Supply-and-install scope contradicts the priced scope — confirmed

The public and printable documents promise “Supply and install a 7kW three-phase EV charger”. Later assumptions state that the model and price are separate. The main price is not explicitly labelled installation-only, and the unit is absent from exclusions.

`lib/estimate/ev-charger-supply.ts:306`, `ensureChargerSuppliedSeparatelyAssumption`, only appends an assumption. It does not reconcile `scope_of_works`, descriptions, labels, exclusions or totals. A synthetic execution confirmed that the supply-and-install wording survives unchanged.

The existing requirement in `specs/ev-charger-sms-auto-quote.md:188` allows an installation-only estimate when tradie supply is requested but no charger is stocked. It does not justify displaying that subtotal as complete charger supply and installation.

### 2. The selected assembly represents a three-phase outlet — confirmed

The selected source is `assembly:5b48eed9-3f37-4d1c-a3e2-d4afae0a5e32`, named **Install 32A three-phase outlet**, category `gpo`. Its description includes a circuit, three-phase RCBO and certification, not supply of a charger.

There is also an **Install EV charger** assembly, `52f354d2-a5e3-4d9f-a7c9-aa13cbe020c7`, whose description is “Single-phase 7kW home charger install on dedicated circuit”. It explicitly excludes charger supply. Both base assembly prices are $120. Choosing the GPO row explains the displayed outlet description and why that EV-specific charger exclusion is absent. The suitability of an outlet assembly for the requested charger installation was not established by the conversation.

Grounding checks catalogue identity and price; passing those checks does not prove that a chosen assembly covers the promised work. The property phase, charger phase, charger power and circuit design need separate treatment. A three-phase property does not identify a particular charger model.

### 3. Multiple document sources produce inconsistent scope — confirmed

- Public job details use `quotes.scope_of_works` (`app/q/[token]/page.tsx:1673`).
- Printable Description of Works prefers `intakes.scope.description` (`lib/quote/pdf.ts:1015`).
- Inclusions derive from priced line items.
- Exclusions derive partly from the selected assembly.
- The separate-unit assumption is appended independently.

The public materials section additionally labels every assembly “supply & install” (`page.tsx:1805`) and counts it under Items supplied. That presentation cannot tell an installation assembly from a supplied charger. The live page displays **Items supplied: 1 line**, though it contains no charger-unit product.

### 4. Optional extras repeat work already included — confirmed

- RCBO is included in the selected assembly, but “Add RCBO safety switch” is offered for $104.50 inc GST.
- Switchboard health check/load assessment is included for $165 inc GST, and “Switchboard health check” is offered again for $165 inc GST.
- The extra RCBO was removed from Best because it could not be grounded, yet its $95 ex GST optional price remains.

`lib/estimate/upsell-guard.ts:93`, `appendUnpricedUpsells`, copies the existing optional list and skips an item if its name already exists. It therefore preserves a pre-existing price instead of clearing it when the same item fails grounding. A synthetic execution reproduced this. There is also no effective reconciliation of optional extras against the selected tier's inclusions.

### 5. Health-check price passes an unrelated callout rule — confirmed source defect

The live price book has `hourly_rate=150` and `call_out_minimum=150`. The health-check line is `source=labour`, `unit=each`, quantity 1, price $150.

`lib/estimate/validate.ts:944` accepts an `each` line whose price matches the callout minimum before requiring catalogue identity. Synthetic reproduction with zero catalogue candidates passes when the callout minimum is $150 and fails when it is $100. This establishes a validation loophole; it does not establish that the health check itself is unnecessary. Its scope and basis must be validated independently.

The displayed 3.3 labour hours count the hourly installation and risk lines, while the additional $150 health check is stored as `each`. The document does not explain the time or overlap among installation testing, load assessment and the separate risk allowance.

### 6. Customer and receptionist specifications are merged — confirmed live, contributing source identified

The stored scope copies the receptionist's unsupported 7kW three-phase recap. No charger catalogue model was selected. The live EV service description supplies a possible source for “7kW”, while the customer's answer supplies the property phase; combining them into a product specification is a plausible inference, not a proven model decision trace.

The reply guard in `lib/sms/llm-receptionist.ts` exempts numbers below 10 when a reply contains a question mark. This can let an unsupported 7kW assertion pass when the same reply ends with “Sound right?”. Product claims must be checked as claims even when followed by a question.

### 7. SMS phase keys do not match the inspection check — confirmed

Live conversation slots contain `requested_specs.supply_type='three-phase'`. The structured intake later contains `property.phase='three'`, but `inspection_required=false`.

The current structure route's deterministic SMS check expects `requested_specs.phase` and a small set of spellings. The dashboard separately forces the explicit three-phase inspection option. This mismatch needs correction to preserve existing phase routing across channels. The quote currently has a priced draft and a $99 site-visit booking flow; that does not mean the deterministic inspection condition was applied.

### 8. Required-photo and question flows disagree — confirmed

The recap calls the parking photo necessary; the upload SMS calls it optional; the flow finishes without a photo or explicit decline. The live EV assembly still has three legacy clarifying questions, whereas the current location-photo spec requires five topics, including vehicle and charger location. Neither was collected here.

The source has fallback/readiness and photo-dispatch inconsistencies, but the exact deployed branch responsible for the generic optional SMS was not proven. All recorded dispatch decisions identify `ev_charger`; do not attribute this incident to an `unknown` decision without further runtime evidence.

### 9. Internal diagnostics and generic content reach the customer — confirmed

The public risk section exposes `[upsell-guard] ungrounded_lines_stripped: ...`. This belongs in internal diagnostics.

Generic method copy describes load management and app pairing without a selected charger model or matching load-management item. The page includes a standard-method disclaimer, so these are confusing generic descriptions rather than independently verified priced inclusions.

The page reports no uploaded photos, yet displays a preview-generating state and two illustrative samples. Stored preview status is `idle`; samples status is `partial` with the third image failed. The stored sample prompt names the outlet assembly as the product. This is separate presentation drift from the core pricing issue.

## Required correction

### For this estimate

1. Preserve **tradie supplies charger** as the customer request.
2. Have the tradie specify the actual charger/model and verify power, phase, circuit, protection and installation method; obtain its real supply price.
3. Reconcile the installation assembly, health check, risk allowance and optional extras against the actual work.
4. Apply the existing three-phase inspection rule to this case before preparing a replacement priced quote. The existing $881.10 is a reconciliation of stored charges, not an approved replacement installation price. For otherwise eligible jobs where only the unit price is missing, make every surface identify the amount as an **installation estimate excluding the charger unit**, with the complete supply-and-install total pending. Do not invent a charger price or silently reclassify the job as customer supply.
5. Produce a corrected draft for tradie review and release through the normal approval process. No customer communication or replacement release was performed during this review.

Illustrative scope wording, pending technical review:

> Installation estimate for an EV charger at the parking area, approximately 6 m from the switchboard. The customer has requested that we supply the charger. The charger unit is not included in this estimate; its model, specification and supply price require confirmation. Installation design and switchboard capacity will be verified on site before the final supply-and-install quote is approved.

### For the system

- Share one deterministic EV supply interpretation across SMS recap, quote scope, tier labels, exclusions, public page, printable document and image prompts.
- Require a verified charger-unit price in the selected tier, backed by the tenant catalogue or an explicit authorised tradie entry, before saying that the displayed total includes charger supply.
- Clearly distinguish business supply pending a price, business supply included, customer supply, and unresolved supply responsibility.
- Keep property phase separate from charger specifications; normalize phase slot aliases before inspection decisions. Existing inspection conditions take precedence over the otherwise eligible installation-only fallback for a missing charger price.
- Validate assembly compatibility and typed charge sources, rather than treating a matching price as enough.
- Remove included items from optional extras, and clear every price attached to a failed grounding item.
- Apply consistent EV question/photo requirements to database-defined services and fallback services.
- Keep internal validation messages out of customer-facing fields.
- Verify both website and exported Electrical SMS receptionist behavior with this conversation as a regression case.

## Verification limits

Three focused synthetic executions reproduced the scope-only disclaimer, callout-price loophole and retained optional RCBO price. This investigation did not modify application code, run a full suite, deploy a release, replay a live conversation, send an SMS or alter the quote.

GitNexus was bound to `quotemax` at this checkout. Its index was two commits behind HEAD (`0b652e60`, indexed 8 September). The refresh did not return completion and was stopped. Context and impact reported `runEstimation` as the direct caller of `ensureChargerSuppliedSeparatelyAssumption`, LOW graph risk, with no indexed processes. The helper's source was confirmed unchanged since the index commit, and findings were checked against current source and live records. This is not a clean graph assessment for a future multi-file repair.

The quote's routing metadata says `tradie_review`, but customer release timestamps are empty while the public page is readable. The exact deployed website/receptionist revisions and release-history interpretation were not established here. A repair must verify deployed behavior rather than infer it from local source.
