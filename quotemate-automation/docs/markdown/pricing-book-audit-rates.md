# Pricing-book rate audit + outlier flagging (spec R13)

> Migration: `sql/migrations/131_pricing_book_rate_flag.sql` (+ `131_down.sql`, runner `scripts/run-migration-131.mjs`).
> Status: provisional band, derivation documented below. Flag is set AT APPLY TIME — see "Which tenants get flagged".
> Constraint honoured: **flag, never overwrite.** No tenant-entered `hourly_rate` / `default_markup_pct` / `min_labour_hours` value is changed by this work. Ex-GST throughout.

## What R13 asks for

Derive a defensible AU hourly-rate + markup band from a **loaded-cost build**, not a single guessed number; validate every `pricing_book` row against that band (plus NECA for NSW electrical and QBCC/award for QLD plumbing); and where a tenant's entered rate falls outside the band, **flag it for the tradie to confirm in the dashboard — never silently overwrite it.** An out-of-band tenant's quotes are forced to `tradie_review` until confirmed (routing-layer behaviour, not part of this migration).

Migration 131 is the data marker that makes the flag queryable: it adds the additive, nullable column `public.pricing_book.rate_review_flag` and stamps `'rate_out_of_band: confirm'` on out-of-band rows. The column is the single source of truth the routing layer + dashboard read; this migration does not itself change routing.

## Rate-derivation method — loaded-cost build

The defensible hourly rate a tradie must charge is **not** the technician's award wage. It is the *loaded cost* of putting a charged hour on site, plus margin. The band below is built from these components (illustrative AU figures, ex-GST; the point is the method, and that the band edges are bounded engineering estimates, not invented per-tenant rates):

| Component | What it covers | Notes |
|---|---|---|
| **Base award wage** | The technician's hourly pay | Electrical: AU Electrical, Electronic and Communications Contracting Award (MA000025) tradesperson rate. Plumbing: Plumbing and Fire Sprinklers Award (MA000036). The exact current award rate is **flagged for confirmation** — see "Flag, never fabricate" below; it is not hard-coded as a tenant rate. |
| **Superannuation** | Compulsory super on the wage | Statutory super guarantee % on top of base. |
| **Leave + LSL** | Annual leave, sick leave, public holidays, long-service-leave accrual | Non-productive paid time, amortised across productive hours. |
| **Tool + vehicle** | Tools, test gear, van, fuel, insurance, registration | Recovered per charged hour. |
| **Overhead** | Admin, software, licences, insurance, quoting/non-billable time, bad debt | Business overhead recovery; the biggest single reason the charge-out rate is well above the wage. |
| **Margin** | Profit | The business's return after all of the above. |

Stacking base wage → on-costs (super, leave/LSL) → recoverables (tool/vehicle, overhead) → margin produces a charge-out **band**, not a point. The two trades land in slightly different bands because of different award rates, callout norms, and typical markup conventions (plumbing carries more supplied-unit cost so its labour markup runs lower; electrical labour markup runs higher).

### Resulting documented sane bands (what migration 131 encodes)

| Trade | Region / standard | `hourly_rate` band | `default_markup_pct` band |
|---|---|---|---|
| electrical | NSW · NECA / AS3000 | $95 – $150 / hr | 25 – 40 % |
| plumbing | QLD · QBCC / AS3500 | $100 – $150 / hr | 12 – 25 % |

A row is flagged if **either** `hourly_rate` **or** `default_markup_pct` is outside (or NULL within) its trade's band. These are **gross-error / confirm-with-tradie** bounds, intentionally wide — not fine pricing. They catch the rate that is obviously off (a $200/hr or a 14% electrical markup), and ask the tradie to confirm; they do not try to dictate the "right" rate.

Only **electrical** and **plumbing** are live trades, so only those two bands are encoded. Any `pricing_book` row for another trade is left **unflagged** (no documented band yet — we do not guess a band for a trade we have not built).

## Flag, never fabricate

- **No rate or markup value is invented or corrected** by migration 131. The band edges above are documented engineering bounds; they are not tradie-verified per-tenant rates.
- The exact **current award wage figures** used as the base of the loaded-cost build are **flagged for confirmation** rather than hard-coded into any tenant row — award rates change annually (Fair Work increases) and the precise current value should be confirmed against the live award before it is ever written anywhere as a real number. This document records the *method*; it does not assert a specific award dollar figure as ground truth.
- A tenant whose rate is out of band has that rate **left exactly as entered** and is **flagged for confirmation**. The tradie confirms (or corrects) it in the dashboard. The system never rewrites it.

## Which tenants get flagged

⚠ **The actual flagging runs AT APPLY TIME**, against whatever values are live in prod when `scripts/run-migration-131.mjs` is run. This build never writes to the DB, so the list below is the *expected* set, carried over from the **read-only audit already done in migration 119** (`sql/migrations/119_pricing_book_audit.sql`), not a confirmed post-apply result. The runner prints the real flagged set after apply.

Expected to be flagged (from the migration-119 audit, electrical + plumbing prod rows):

| Tenant (per mig-119 audit) | Trade | Entered value | Why out of band |
|---|---|---|---|
| Oakcrest | electrical | $200/hr + 42.8% markup | hourly_rate > $150 **and** markup > 40% — both edges of the electrical band breached. |
| Atomic Electrical | electrical | 14% markup | markup < 25% — well under the electrical markup band (14% is a plumbing-shaped markup on an electrical row). |

Any other prod row whose `hourly_rate` / `default_markup_pct` is out of band (or NULL) at apply time will also be flagged; the in-band rows (e.g. the ~$110/hr × 28–36% electrical defaults and the $120/hr × 15–20% plumbing default noted in the project docs) are **not** flagged. The runner reports both the flagged set and the in-band count so the operator can confirm the band did not over-fire.

## After flagging — routing behaviour (downstream, not this migration)

Once `rate_review_flag` is populated, the routing layer (`lib/routing/decide.ts` per the spec) forces a flagged tenant's quotes to `tradie_review` until the tradie confirms their rate in the dashboard. The dashboard surfaces the flag so the tradie sees "confirm your hourly rate / markup". Clearing the flag (after the tradie confirms) is a separate, dashboard-driven action — re-running migration 131 will **not** re-stamp a manually cleared flag, because the UPDATE is guarded on `rate_review_flag IS NULL`.

## Rollback

`scripts/run-migration-131.mjs --rollback` runs `131_down.sql`, which drops the column. Because the forward migration only added a code-derived marker and never changed a tenant value, dropping the column loses nothing tenant-owned. A full pre-apply snapshot (`pricing_book_backup_mig131`) is taken by the runner on the forward path for a true row-for-row restore if ever required.
