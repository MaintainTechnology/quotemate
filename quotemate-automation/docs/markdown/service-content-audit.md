# Service-content audit — `shared_assemblies` (electrical + plumbing)

> Task R23 + R29 · 2026-06-18 · author: question-data + service-content sub-agent
> Source of truth: **prod** Supabase (`SUPABASE_DB_URL`, read-only), 49
> electrical+plumbing rows. Cross-checked against `lib/sms/assumptions.ts`
> (`mustAsk` / `safeDefaults`) and the per-row `clarifying_questions` already
> present on sibling rows.

This is a **B-pass audit, not a wholesale rewrite**. The brief: review
`description` / `default_labour_hours` / `default_exclusions` for obvious
wrongness vs AU trade reality. A value is only **changed in migration 121** if
it is *unambiguously* wrong AND justifiable from a real AU source; everything
else is **flagged for the owner** below. **No value changes were made by
migration 121** — every concern found needs the owner's real-rate / scope
confirmation. Migration 121 is data-only: it backfills the missing
`clarifying_questions` (R23) and touches no pricing/labour/description column.

---

## How to read the labour column

`default_labour_hours` is the labour estimate the estimator multiplies by the
tenant's `pricing_book.hourly_rate` (electrical ≈ $110/hr, plumbing ≈ $120/hr).
`default_unit_price_ex_gst` is a **separate fixed component** (base
materials / handling / call-out portion), NOT the all-in job price — confirmed
by rows like *Diagnostic call-out* (0.00 h / $165) and *Tap washer replacement*
(0.50 h / $8). So labour-hour plausibility is what actually moves the quote;
the audit weighs hours most heavily.

---

## R23 — clarifying_questions backfill (CONFIRMED, fixed in migration 121)

Prod read-only confirmed **exactly 2** electrical/plumbing rows with empty
(`jsonb null`) `clarifying_questions`, both **auto-quote**
(`default_enabled=true`, `always_inspection=false`, `retired_at IS NULL`), both
category `gpo`:

| id (suffix) | trade | name | was | now (migration 121) |
|---|---|---|---|---|
| …a0e5e20 | electrical | Install 20A dedicated GPO | `null` | 4 questions (appliance/room, count, distance to switchboard, wet-area 600mm) |
| …a0e5e32 | electrical | Install 32A three-phase outlet | `null` | 3 questions (which 3φ appliance, supply phase, room + distance) |

All 23 plumbing rows already carried questions — the spec's "mostly NULL"
framing was stale. Verification target met: **0** auto-quote elec/plumbing rows
with empty `clarifying_questions` (verified prod + dev via `BEGIN; … ROLLBACK;`).

> **Env drift noted:** the dev DB (`SUPABASE_DEVELOPMENT_DB_URL`) is behind
> prod — 43 rows, **no `always_inspection` column**, and 16 empty
> `clarifying_questions` rows (the col was never backfilled in dev). Migration
> 121 is keyed by `name` + emptiness guard (not prod UUID) so it is idempotent
> and correct on both DBs; on dev it populates all 16, on prod only the 2.

---

## R29 — per-row service-content findings

Legend: ✅ plausible · ⚠ FLAG (owner judgement) · ✋ changed in migration (none this pass)

### Electrical — enabled / auto-quote rows

| Row | labour | desc / exclusions check | Verdict |
|---|---|---|---|
| Replace LED downlight | 0.40 h | swap fitting on existing wiring | ✅ plausible (≈24 min/fitting is realistic for a like-for-like swap at volume) |
| Install LED downlight (new install, single-storey) | 1.75 h | new cable from switch <5 m, cut hole, fit | ✅ plausible for a first-of-run new install; exclusions correctly carve out raked/multi-storey |
| Replace double GPO | 0.30 h | disconnect/refit, test | ✅ plausible (18 min per outlet at volume) |
| Install 20A dedicated GPO | 2.00 h | new dedicated circuit from switchboard + RCBO + cert | ✅ plausible for a short dedicated run; ⚠ see note 1 |
| Install 32A three-phase outlet | 3.00 h | new 3φ circuit + 3φ RCBO + cert | ✅ plausible; correctly excludes the 1φ→3φ supply upgrade |
| Install ceiling fan (new wiring, no existing rose) | 2.25 h | new cable, mount + wall control | ✅ plausible |
| Install customer-supplied ceiling fan | 1.00 h | mount + terminate to existing wiring | ✅ plausible |
| Supply + install AC ceiling fan | 1.00 h | mount + terminate, fan supplied | ✅ plausible |
| Install premium DC fan with wall control | 1.50 h | mount, terminate, fit controller | ✅ plausible |
| Install cooktop (existing wiring) | 1.00 h | mount, terminate, test | ✅ plausible |
| Install oven (existing wiring) | 1.00 h | mount, terminate, test | ✅ plausible |
| Hardwire 240V smoke alarm | 0.50 h | mount, terminate, interconnect | ✅ plausible (per-alarm swap) |
| Hardwire 240V smoke alarm (whole-house compliance install) | 1.00 h | first-install set, interconnect run | ⚠ see note 2 |
| Install outdoor IP-rated LED light | 0.60 h | mount on existing circuit | ✅ plausible |
| Install outdoor light (new circuit from indoor power) | 1.25 h | run cable through wall, weatherproof fit | ✅ plausible |
| Diagnostic call-out (fault finding) | 0.00 h / $165 | attendance + diagnostic; price is the flat call-out | ✅ intentional (0 h because the $165 is the fixed fee, not hourly) |

### Plumbing — enabled / auto-quote rows

| Row | labour | desc / exclusions check | Verdict |
|---|---|---|---|
| Tap washer replacement | 0.50 h | reseat washer on dripping tap | ✅ plausible |
| Tap replacement | 1.00 h | remove + install new tap/mixer | ✅ plausible |
| Toilet cistern repair | 0.75 h | fill/flush valve or flapper | ✅ plausible |
| Toilet suite install | 2.00 h | remove + install close-coupled/wall-faced | ✅ plausible; in-wall correctly priced separately |
| Hand rod blocked drain | 1.00 h | mechanical snake/rod | ✅ plausible |
| Jet blast blocked drain | 1.50 h | high-pressure jet | ✅ plausible |
| CCTV drain inspection | 1.00 h / $150 | camera + written report | ✅ plausible |
| Install electric HWS | 3.00 h | remove + install electric storage | ⚠ see note 3 |
| Install gas HWS | 3.50 h (always_inspection) | gas storage / continuous flow | ✅ correctly forced to inspection (AS/NZS 5601) |
| Install heat pump HWS | 4.00 h | supply + install heat-pump HWS | ✅ plausible |
| Pressure reduction valve install | 1.50 h | supply + install PRV | ✅ plausible |
| Gas appliance connection | 1.50 h | connect cooktop/oven to existing gas | ⚠ see note 4 |
| Disposal and site cleanup | 0.25 h / $50 | offsite disposal + cleanup, flat per fixture | ✅ plausible (handling-time only by design) |

---

## ⚠ Flagged items (owner judgement required — NOT changed)

1. **Install 20A dedicated GPO — 2.00 h may be optimistic for long runs.**
   2.0 h covers a short cavity run to a nearby switchboard. A real dedicated
   20A circuit to, say, a garage/workshop with a 15–20 m TPS run + cavity
   fishing is commonly 3–4 h. The row's own exclusions carve out
   "conduit runs beyond standard cavity routes", so the 2.0 h is defensible as
   the *base* case, but the owner should confirm whether the recipe engine
   (mig 074) adds per-metre labour for distance, or whether 2.0 h silently
   under-quotes the long-run case. **Action: owner confirm base-vs-distance
   labour split.** Not changed (ambiguous; no single correct value).

2. **Whole-house smoke compliance — 1.00 h "per-alarm" framing is internally
   inconsistent.** Description says "Per-alarm pricing" then "allow 0.5 hr base
   setup on top", but `default_labour_hours` is a single 1.00 h with no
   structured base-vs-per-unit split. A real 3-bed compliance install
   (interconnect run between bedrooms + hallway, 4–5 alarms) is typically
   4–6 h all-in, not 1 h × alarms with a vague +0.5 h note. The estimator
   has to infer the base from prose. **Action: owner decide whether to model
   base+per-alarm explicitly (and where).** Not changed (needs product
   decision, not a single-value fix).

3. **Install electric HWS — 3.00 h vs likely 2.0–2.5 h for a like-for-like
   swap.** A straight electric-storage like-for-like replacement (existing
   circuit, existing location, drain + reconnect) is commonly 2–2.5 h in AU.
   3.0 h is on the high side but not *wrong* — it absorbs draining the old
   tank, tempering-valve replacement, and access faff. Flagging because it is
   the one electric-HWS row and a 0.5–1.0 h difference at $120/hr is material.
   **Action: owner confirm whether 3.0 h is the intended buffer.** Not changed
   (within defensible range).

4. **Gas appliance connection — labour 1.50 h but `default_unit_price_ex_gst`
   $30 and exclusions only carve out "new gas point or line runs".** Connecting
   a gas cooktop/oven is gas-fitting work (AS/NZS 5601, licensed gasfitter,
   compliance certificate). Unlike *Install gas HWS* this row is **NOT**
   `always_inspection` and is enabled for auto-quote. Connecting to an
   *existing* point is legitimately quotable, but the row gives the dialog no
   signal to confirm there IS a suitable existing, certified gas point — and a
   gas connection always needs a compliance plate. **Action: owner confirm
   whether gas-cooktop connection should auto-quote at all, or route to
   inspection like gas HWS; if it stays auto-quote, it needs a clarifying
   question ("is there an existing certified gas bayonet/point within reach?").**
   This is a **scope/safety policy** call, not a value fix — flagged, not
   changed. (Note: this row already has `clarifying_questions`, so R23 did not
   touch it; the gap here is *content*, not presence.)

### Non-blocking observations (no action needed)

- Exclusions wording is consistent and generally complete across rows
  (each carves out new-circuit / switchboard / supply where relevant).
- `Diagnostic call-out` at 0.00 h is intentional (flat $165 attendance fee),
  not a missing value.
- Several **disabled** rows (EV charger, aircon power point, induction cooktop,
  outdoor IP GPO, etc.) were skimmed but not deeply audited — they are not
  auto-quoteable, so any content drift there is lower-risk. None showed an
  obviously impossible labour figure.

---

## Summary

- **R23: DONE.** 2 prod rows (16 on dev) backfilled; verification target met
  (0 empty auto-quote rows) on both DBs via `BEGIN; … ROLLBACK;`. No
  pricing/labour columns touched.
- **R29: AUDITED.** 4 items flagged for owner (notes 1–4); **0 values changed**
  — none met the "unambiguously wrong AND justifiable from a real AU source"
  bar. The strongest candidate (note 4, gas connection auto-quote vs
  inspection) is a safety/scope policy decision the owner must make, not a
  single-value correction.
