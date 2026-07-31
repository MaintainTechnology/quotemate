
---

## Correction: this branch DOES carry a migration

An earlier draft of this description said "No migration." That is wrong, and a reviewer would draw the wrong conclusion about deploy steps.

**`sql/migrations/184_assembly_tasks.sql`** creates `shared_assembly_tasks` and `tenant_assembly_tasks`, with RLS enabled on both (matching the `shared_assembly_bom` / `tenant_assembly_bom` pair they mirror). Its runner asserts `pg_class.relrowsecurity` after apply, because a missing RLS grant is invisible through the service-role key.

**It is already applied to production.** So is a set of data changes:

- 7 category renames — `fan`→`ceiling_fan`, `rcbo`→`safety_switch`, plus 4 hot-water/tap rows resolved from their own product names ("Rheem 5-star 260L **gas** storage HWS" → `hws_gas`)
- 3 new `shared_assembly_bom` rows — the `tap_repair` and `toilet_repair` recipes

All additive, and the new tables are unread by currently-deployed code. **Production's database is therefore ahead of production's code, and merging closes that drift rather than creating it.** Nothing needs running at deploy time.

## Verified before merge

- `npm run build` — compiles
- `tsc --noEmit` — 0 errors
- `npm test` — 7215 pass, 0 failures
- `npm run test:e2e` — 30 passed, 0 failed (38 skipped are `LIVE_DB`-gated)
- `LIVE_DB` guards — both pass; 8/10 electrical job types resolve, 7 reach a recipe
- Catalogue category select — verified in a browser on both hubs: electrical offers 15 options including `EV charger`, `Security cameras`, `Switchboard`; plumbing offers the three `Hot water —` and four `Tapware —` variants with no plain `Hot water systems` or `Taps / mixers`

## Known gaps, stated plainly

- `shared_assembly_tasks` is empty, so Phase 3's "Customise these steps" fork cannot appear yet. The tenant-side add/edit path works. Authoring baselines is separate work.
- Phase 4 (`specs/phase-4-product-choice-drives-the-job.md`) is not in this PR.
- `cctv` is modelled as a material but the live row is "Rent CCTV system, $495" — a day rate. Wants its own decision.
 answers vanished between the form and the price.** `ev_charger`'s phase question reused the code `circuit_required`, which the route filters out of the transcript for every job type — so "three phase" reached nothing, and the rule that three-phase work forces an inspection never fired. The rename is not the fix; the collision-guard test is.

---

## ⚠ Before merging — deploy precondition

`isCronAuthorised` is **fail-closed in production, and `NODE_ENV` is `'production'` on Vercel Preview too.** A deployment without `CRON_SECRET` rejects every internal self-call: no voice call, SMS lead, flyer-QR lead or dashboard quote produces a quote, and three of the four text the customer a failure message.

`GET /api/health` now reports `cron_secret_present` so this is checkable in one request:

```bash
curl -s https://<deployment>/api/health | jq '{commit, cron_secret_present}'
```

Confirm `true` on **both** Production and Preview before merging.

---

## What this deliberately does NOT do

- **No tradie photo upload.** `lib/estimate/*` attaches no images at all, the intake prompt bars photos from `risks[]` and `scope.specs`, and prod has carried zero photo-bearing intakes for 30 days. The real defect there — every portal customer quote shipping a permanently disabled upload button under copy inviting its use — is fixed.
- **No migration.** All five `job_type_bounds` rows remain flagged `PROVISIONAL — confirm with tradie`; 184 is reserved for that pass.
- **No mid-thread trade switch.** An active roofing thread still captures every turn. Changing which receptionist wins a live turn on the two 8-trade tenants needs its own eval corpus first.
- **`SPEC_GUARD_MODE` untouched** (default `shadow`) — an independent money-path decision.

## Known residual risk

`/api/vapi/webhook` still has **no authentication of its own** — no Vapi server secret exists anywhere in the repo — so the pipeline remains reachable through that door. Out of scope here; it needs its own change and is the highest-value security work left.

---

## Review notes

Every change went through spec → build → independent review → fix → re-review. The review passes caught four defects that would otherwise have shipped, including two of mine: a `setBusy` that bricked the form on a lapsed session, and a `wp9Handled` gate that had to widen in lockstep with the product-pin gate or the spec guard would route pinned quotes to the $99 inspection.

Drift is recorded in `docs/strategy.md` **v18** and `CLAUDE.md` (SMS routing, the trade guard, the `CRON_SECRET` requirement). Specs are in `quotemate-automation/specs/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
