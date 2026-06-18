// ═══════════════════════════════════════════════════════════════════
// QuoteMate · SMS Agent parity self-test
//
// Pure-function tests of the SMS Agent's logic against the same code
// the Voice Agent uses. Asserts that for an identical intake + quote,
// the SMS path produces the expected customer SMS body, tradie notify
// body, dialog assumption rules, and quality-gate decisions. No network,
// no Supabase, no Twilio — runs purely on TS-imported helpers.
//
// Usage:  node --import tsx scripts/test-sms-parity.mjs
// (or any TS-aware loader; project ships with tsx via next-dev)
//
// IMPORTANT: this harness imports lib/sms/templates.ts (and other lib/*
// modules) which use the `@/lib/...` TS path alias. Raw `node` and
// `node --test` CANNOT resolve that alias (ERR_MODULE_NOT_FOUND on '@/lib')
// — you MUST run it through a TS-aware loader, i.e. `node --import tsx`.
// The vitest suite (npx vitest run) covers the same behaviours via the
// `@`→`.` alias in vitest.config.ts; this script is the cross-channel
// (voice == SMS) parity self-check layered on top.
//
// Exits 0 when all assertions pass, 1 otherwise.
// ═══════════════════════════════════════════════════════════════════

import { strict as assert } from "node:assert";

const results = { passed: 0, failed: 0, failures: [] };

function it(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message?.split("\n")[0] ?? err}`);
  }
}

function describe(group, fn) {
  console.log(`\n${group}`);
  fn();
}

// ─── Imports under test ──────────────────────────────────────────────
const templates = await import("../lib/sms/templates.ts");
const quality = await import("../lib/intake/quality.ts");
const assumptions = await import("../lib/sms/assumptions.ts");
const dialog = await import("../lib/sms/dialog.ts");
// R5/R6/R11 — money-path grounding guards (deterministic, no LLM).
const validate = await import("../lib/estimate/validate.ts");
// R13 — inspection-reason sanitiser (no-price-leak on a no-price quote).
const inspectionReason = await import("../lib/estimate/inspection-reason.ts");

// ─── Fixtures ────────────────────────────────────────────────────────
const intakeDownlights = {
  job_type: "downlights",
  caller: { name: "Mike Smith" },
  scope: { item_count: 5, description: "5 LED downlights in kitchen" },
};

const quoteAuto = {
  good: {
    label: "Standard LED",
    subtotal_ex_gst: 600,
    line_items: [
      { unit: "each", quantity: 5, description: "LED downlight", total_ex_gst: 250, unit_price_ex_gst: 50 },
      { unit: "hr", quantity: 3, description: "Labour", total_ex_gst: 330, unit_price_ex_gst: 110 },
    ],
  },
  better: {
    label: "Tri-colour LED",
    subtotal_ex_gst: 800,
    line_items: [
      { unit: "each", quantity: 5, description: "Tri-colour LED downlight", total_ex_gst: 400, unit_price_ex_gst: 80 },
      { unit: "hr", quantity: 3.5, description: "Labour", total_ex_gst: 385, unit_price_ex_gst: 110 },
    ],
  },
  best: {
    label: "Smart dimmable LED",
    subtotal_ex_gst: 1100,
    line_items: [
      { unit: "each", quantity: 5, description: "Smart dimmable LED", total_ex_gst: 600, unit_price_ex_gst: 120 },
      { unit: "hr", quantity: 4, description: "Labour", total_ex_gst: 440, unit_price_ex_gst: 110 },
    ],
  },
  selected_tier: "better",
  scope_of_works: "Replace 5 existing halogen downlights with new LED fittings in kitchen.",
  scope_short: "5 LED downlights in kitchen",
  assumptions: ["flat plaster ceiling", "existing wiring"],
  estimated_timeframe: "Half day",
  needs_inspection: false,
  inspection_reason: null,
  quote_view_url: "https://quote-mate-rho.vercel.app/q/abc123def456",
  pay_links: {
    good: "https://quote-mate-rho.vercel.app/r/abc123def456/good",
    better: "https://quote-mate-rho.vercel.app/r/abc123def456/better",
    best: "https://quote-mate-rho.vercel.app/r/abc123def456/best",
  },
  deposit_pct: 30,
};

const quoteInspection = {
  good: null,
  better: null,
  best: null,
  selected_tier: "inspection",
  scope_of_works: "Switchboard upgrade with EV charger circuit.",
  scope_short: "Switchboard upgrade + EV charger",
  assumptions: [],
  estimated_timeframe: null,
  needs_inspection: true,
  inspection_reason: "switchboard work and new EV circuit need on-site assessment",
  quote_view_url: "https://quote-mate-rho.vercel.app/q/xyz789",
  pay_links: { inspection: "https://quote-mate-rho.vercel.app/r/xyz789/inspection" },
  deposit_pct: null,
};

// ═══════════════════════════════════════════════════════════════════
// 1. CUSTOMER SMS BODY — must include all key UX surfaces
// ═══════════════════════════════════════════════════════════════════
describe("buildQuoteSms — auto-quote customer message (matches voice format)", () => {
  const body = templates.buildQuoteSms(intakeDownlights, quoteAuto);

  it("greets the customer by first name", () => {
    assert.match(body, /^Hi Mike,/);
  });
  it("includes the QuoteMate quote line with item count + job", () => {
    assert.match(body, /Your QuoteMate quote for 5 downlights/);
  });
  it("includes the View full quote URL pointing at /q/<token>", () => {
    assert.match(body, /View full quote: https:\/\/quote-mate-rho\.vercel\.app\/q\/abc123def456/);
  });
  it("includes the 3 OPTIONS header with deposit %", () => {
    assert.match(body, /3 OPTIONS \(inc 10% GST - 30% deposit to confirm\):/);
  });
  it("renders GOOD / BETTER / BEST tiers with prices", () => {
    assert.match(body, /GOOD: \$\d+/);
    assert.match(body, /BETTER: \$\d+/);
    assert.match(body, /BEST: \$\d+/);
  });
  it("marks BETTER as recommended (selected_tier='better')", () => {
    assert.match(body, /BETTER: \$\d+ \(recommended\)/);
  });
  it("includes per-tier Tap to pay links", () => {
    assert.match(body, /Tap to pay: https:\/\/quote-mate-rho\.vercel\.app\/r\/abc123def456\/good/);
    assert.match(body, /Tap to pay: https:\/\/quote-mate-rho\.vercel\.app\/r\/abc123def456\/better/);
    assert.match(body, /Tap to pay: https:\/\/quote-mate-rho\.vercel\.app\/r\/abc123def456\/best/);
  });
  it("includes the SCOPE summary (first sentence of scope_of_works)", () => {
    assert.match(body, /SCOPE: Replace 5 existing halogen downlights with new LED fittings in kitchen\./);
  });
  it("ends with the QuoteMate sign-off", () => {
    assert.match(body, /- QuoteMate$/);
  });
  it("is GSM-7 safe (ASCII-only)", () => {
    assert.equal(/[^\x20-\x7E\n]/.test(body), false, "non-ASCII char leaked through");
  });
});

describe("buildQuoteSms — inspection-required customer message", () => {
  const body = templates.buildQuoteSms(intakeDownlights, quoteInspection);

  it("greets the customer", () => {
    assert.match(body, /^Hi Mike,/);
  });
  it("explains a site visit is needed before pricing", () => {
    assert.match(body, /needs a quick site visit before we can give you a real price/);
  });
  it("includes the View full quote URL", () => {
    assert.match(body, /View full quote: https:\/\/quote-mate-rho\.vercel\.app\/q\/xyz789/);
  });
  it("includes the $99 inspection link", () => {
    assert.match(body, /Tap to lock in your site visit \(\$99 refundable/);
    assert.match(body, /https:\/\/quote-mate-rho\.vercel\.app\/r\/xyz789\/inspection/);
  });
  it("does NOT show fabricated tier numbers", () => {
    assert.equal(/GOOD: \$/.test(body), false, "inspection SMS leaked tier price");
    assert.equal(/BETTER: \$/.test(body), false, "inspection SMS leaked tier price");
    assert.equal(/BEST: \$/.test(body), false, "inspection SMS leaked tier price");
  });
  it("includes the inspection reason", () => {
    assert.match(body, /Why a visit: switchboard work and new EV circuit/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. TRADIE NOTIFY (Phase 4) — SMS-only ping
// ═══════════════════════════════════════════════════════════════════
describe("buildTradieDraftNotification — Phase 4 / SMS-source notify", () => {
  const body = templates.buildTradieDraftNotification({
    customerName: "Mike Smith",
    customerPhone: "+61400111222",
    jobType: "downlights",
    itemCount: 5,
    totalIncGst: 880,
    quoteUrl: "https://quote-mate-rho.vercel.app/q/abc123def456",
  });

  // NOTE: realigned 2026-05-18 (WP6, Option B) — these assertions were
  // stale vs. the current intended buildTradieDraftNotification wording
  // ("Hi, <first> has requested a quote ... Quote: <url>"). Updated to
  // match the templates, which are the source of truth here.
  it("leads with a greeting + the customer's first name", () => {
    assert.match(body, /^Hi, Mike has requested a quote\b/);
  });
  it("states the customer has requested a quote", () => {
    assert.match(body, /\bMike has requested a quote\b/);
  });
  it("includes the item count + job type", () => {
    assert.match(body, /5 downlights/);
  });
  it("includes the total inc GST", () => {
    assert.match(body, /\$880 inc GST/);
  });
  it("includes the quote URL pointing at the customer-facing quote page", () => {
    assert.match(body, /Quote: https:\/\/quote-mate-rho\.vercel\.app\/q\/abc123def456/);
  });
  it("is GSM-7 safe", () => {
    assert.equal(/[^\x20-\x7E\n]/.test(body), false);
  });
});

describe("buildTradieInspectionNotification — Phase 4 / inspection variant", () => {
  const body = templates.buildTradieInspectionNotification({
    customerName: "Mike Smith",
    customerPhone: "+61400111222",
    jobType: "switchboard",
    inspectionReason: "old ceramic fuses + EV charger",
    quoteUrl: "https://quote-mate-rho.vercel.app/q/xyz789",
  });

  // NOTE: realigned 2026-05-18 (WP6, Option B) — stale vs. the current
  // intended buildTradieInspectionNotification wording ("Hi, <first> has
  // requested work that needs a site visit ... $99 inspection. Details:
  // <url>"). Updated to match the templates (source of truth).
  it("leads with a greeting + the customer's first name", () => {
    assert.match(body, /^Hi, Mike has requested work that needs a site visit\b/);
  });
  it("flags it as needing a site visit", () => {
    assert.match(body, /needs a site visit/);
  });
  it("includes the $99 inspection anchor", () => {
    assert.match(body, /\$99 inspection\b/);
  });
  it("includes the customer-facing quote URL", () => {
    assert.match(body, /Details: https:\/\/quote-mate-rho\.vercel\.app\/q\/xyz789/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. INCOMPLETE-CALL SMS (quality gate fired)
// ═══════════════════════════════════════════════════════════════════
describe("buildIncompleteCallSms — empty-intake callback prompt", () => {
  it("greets by first name when present", () => {
    const body = templates.buildIncompleteCallSms({ firstName: "Mike" });
    assert.match(body, /^Hi Mike,/);
  });
  it("works without a name (generic greeting)", () => {
    const body = templates.buildIncompleteCallSms({});
    assert.match(body, /^Hi,/);
  });
  it("ends with the QuoteMate sign-off", () => {
    const body = templates.buildIncompleteCallSms({ firstName: "Mike" });
    assert.match(body, /- QuoteMate$/);
  });
  it("is GSM-7 safe", () => {
    const body = templates.buildIncompleteCallSms({ firstName: "Mike" });
    assert.equal(/[^\x20-\x7E\n]/.test(body), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. QUALITY GATE — same gate the Voice Agent uses
// ═══════════════════════════════════════════════════════════════════
describe("evaluateIntakeQuality — same gate for voice + SMS", () => {
  it("HIGH/MEDIUM confidence always 'usable' regardless of fields", () => {
    assert.equal(quality.evaluateIntakeQuality({
      confidence: "HIGH",
      caller: { name: "" },
      scope: { description: "" },
      job_type: "other",
    }), "usable");
    assert.equal(quality.evaluateIntakeQuality({
      confidence: "MEDIUM",
      caller: { name: "" },
      scope: { description: "" },
      job_type: "other",
    }), "usable");
  });
  it("LOW + missing name → 'empty'", () => {
    assert.equal(quality.evaluateIntakeQuality({
      confidence: "LOW",
      caller: { name: "" },
      scope: { description: "valid scope description here" },
      job_type: "downlights",
    }), "empty");
  });
  it("LOW + short scope → 'empty'", () => {
    assert.equal(quality.evaluateIntakeQuality({
      confidence: "LOW",
      caller: { name: "Mike" },
      scope: { description: "x" },
      job_type: "downlights",
    }), "empty");
  });
  // Updated 2026-05-19: LOW + job_type='other' is NO LONGER a fail when
  // name + scope are usable. The change followed the "bug zapper"
  // incident — custom tenant assemblies (insect zapper, induction
  // cooktop, etc.) legitimately have job_type='other'; the dialog has
  // already gathered enough info and the grounding validator handles
  // the can-we-price decision downstream. See lib/intake/quality.ts.
  it("LOW + job_type='other' → 'usable' when name+scope present (post-bug-zapper)", () => {
    assert.equal(quality.evaluateIntakeQuality({
      confidence: "LOW",
      caller: { name: "Mike" },
      scope: { description: "valid scope description here" },
      job_type: "other",
    }), "usable");
  });
  it("LOW + all critical fields populated → 'usable'", () => {
    assert.equal(quality.evaluateIntakeQuality({
      confidence: "LOW",
      caller: { name: "Mike" },
      scope: { description: "5 downlights in kitchen" },
      job_type: "downlights",
    }), "usable");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. ASSUMPTION RULES — Phase 2 / SMS04
// ═══════════════════════════════════════════════════════════════════
describe("ASSUMPTION_RULES — every easy-5 job covered with mustAsk + safeDefaults", () => {
  const easyFive = ["downlights", "power_points", "ceiling_fans", "smoke_alarms", "outdoor_lighting"];
  for (const jt of easyFive) {
    it(`${jt} has a rule entry`, () => {
      assert.ok(assumptions.ASSUMPTION_RULES[jt], `missing rule for ${jt}`);
    });
    it(`${jt} mustAsk is non-empty`, () => {
      assert.ok(assumptions.ASSUMPTION_RULES[jt].mustAsk.length > 0);
    });
    it(`${jt} safeDefaults is populated`, () => {
      assert.ok(Object.keys(assumptions.ASSUMPTION_RULES[jt].safeDefaults).length > 0);
    });
    it(`${jt} inspectionTriggers is populated`, () => {
      assert.ok(assumptions.ASSUMPTION_RULES[jt].inspectionTriggers.length > 0);
    });
  }
});

describe("UNIVERSAL_MUST_ASK — captures name + suburb (voice parity)", () => {
  it("includes first name", () => {
    const text = assumptions.UNIVERSAL_MUST_ASK.join(" ").toLowerCase();
    assert.match(text, /first name|caller\.name/);
  });
  it("includes suburb", () => {
    const text = assumptions.UNIVERSAL_MUST_ASK.join(" ").toLowerCase();
    assert.match(text, /suburb/);
  });
  it("includes job_type / easy 5", () => {
    const text = assumptions.UNIVERSAL_MUST_ASK.join(" ").toLowerCase();
    assert.match(text, /job_type|easy 5|electrical work/);
  });
});

describe("UNIVERSAL_INSPECTION_TRIGGERS — covers all dangerous scenarios", () => {
  const required = ["burning smell", "sparks", "electric shock", "switchboard", "ev charger", "three-phase", "asbestos"];
  for (const trigger of required) {
    it(`includes "${trigger}"`, () => {
      const found = assumptions.UNIVERSAL_INSPECTION_TRIGGERS.some(t => t.toLowerCase().includes(trigger));
      assert.ok(found, `missing universal trigger: ${trigger}`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 6. DIALOG SCHEMA — Phase 2 / SMS05
// ═══════════════════════════════════════════════════════════════════
describe("TurnDecisionSchema — Zod-validated dialog output", () => {
  it("accepts a valid 'ask' decision", () => {
    const ok = dialog.TurnDecisionSchema.safeParse({
      action: "ask",
      job_type_guess: "downlights",
      reply_to_send: "How many downlights?",
      assumptions_made: [],
      ready_for_intake: false,
      reason_for_escalation: null,
    });
    assert.equal(ok.success, true, JSON.stringify(ok.error));
  });
  it("accepts a valid 'finish' decision", () => {
    const ok = dialog.TurnDecisionSchema.safeParse({
      action: "finish",
      job_type_guess: "downlights",
      reply_to_send: "Got it Mike — 5 downlights in Bondi kitchen. Quote in 2 mins.",
      assumptions_made: ["flat plaster ceiling"],
      ready_for_intake: true,
      reason_for_escalation: null,
    });
    assert.equal(ok.success, true);
  });
  it("accepts a valid 'escalate_inspection' decision", () => {
    const ok = dialog.TurnDecisionSchema.safeParse({
      action: "escalate_inspection",
      job_type_guess: "unknown",
      reply_to_send: "Thanks - I'll send a sparky for a quick look. Want a $99 inspection?",
      assumptions_made: [],
      ready_for_intake: false,
      reason_for_escalation: "switchboard work",
    });
    assert.equal(ok.success, true);
  });
  it("rejects reply_to_send over 320 chars", () => {
    const bad = dialog.TurnDecisionSchema.safeParse({
      action: "ask",
      job_type_guess: "downlights",
      reply_to_send: "x".repeat(321),
      assumptions_made: [],
      ready_for_intake: false,
      reason_for_escalation: null,
    });
    assert.equal(bad.success, false);
  });
  it("rejects unknown action enum", () => {
    const bad = dialog.TurnDecisionSchema.safeParse({
      action: "ignore",
      job_type_guess: "downlights",
      reply_to_send: "ok",
      assumptions_made: [],
      ready_for_intake: false,
      reason_for_escalation: null,
    });
    assert.equal(bad.success, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. DUPLICATE-CHARGE PREVENTION (R5 within-tier / R6 cross-tier)
//
// The grounding validator is the money-path backstop the SMS path shares
// with voice: a draft that double-charges the same catalogue row — within
// one tier (R5) or across tiers at an unframed quantity (R6) — must FAIL
// grounding, which downgrades the whole quote to the $99 inspection route.
// Exercised directly against validateQuoteGrounding /
// detectCrossTierDuplicates — no LLM, fully deterministic.
// ═══════════════════════════════════════════════════════════════════
describe("validateQuoteGrounding — duplicate-charge prevention (R5/R6)", () => {
  const pricingBook = {
    hourly_rate: 110,
    apprentice_rate: 80,
    call_out_minimum: 150,
    default_markup_pct: 28,
    min_labour_hours: 2,
  };
  const candidates = validate.buildCandidatePrices(
    [
      { id: "mat-dux-315", name: "Dux Proflo 315L electric storage HWS", price: 1645, category: "hot_water" },
      { id: "mat-downlight", name: "Brilliant 9W LED downlight", price: 20, category: "downlight" },
    ],
    [],
    pricingBook,
  );
  const labour = (hours) => ({
    description: "Labour",
    quantity: hours,
    unit: "hr",
    unit_price_ex_gst: 110,
    source: "labour",
  });
  // downlight at the 28% markup ($20 × 1.28 = $25.60).
  const downlight = (qty) => ({
    description: "Brilliant 9W LED downlight",
    quantity: qty,
    unit: "each",
    unit_price_ex_gst: 25.6,
    source: "material:mat-downlight",
  });

  it("R5: flags the SAME row charged twice in one tier (raw + marked-up, differing descriptions)", () => {
    const r = validate.validateQuoteGrounding(
      {
        needs_inspection: false,
        good: {
          line_items: [
            labour(3),
            { description: "Premium HWS 315L (supply + install)", quantity: 1, unit: "each", unit_price_ex_gst: 2105.6, source: "material:mat-dux-315" },
            { description: "Storage hot water unit 315 litre", quantity: 1, unit: "each", unit_price_ex_gst: 1645, source: "material" },
          ],
        },
        better: null,
        best: null,
      },
      pricingBook,
      candidates,
    );
    assert.equal(r.valid, false, "within-tier dup should fail grounding");
    assert.ok(
      r.failures.some((f) => f.expected.includes("D-1 dedup")),
      "expected a D-1 dedup failure",
    );
  });

  it("R6: flags the same row stacked at DIFFERENT quantities across tiers with no framing", () => {
    const draft = {
      needs_inspection: false,
      good: { label: "Good", line_items: [labour(2), downlight(3)] },
      better: { label: "Better", line_items: [labour(2), downlight(6)] },
      best: { label: "Best", line_items: [labour(2), downlight(9)] },
    };
    const dups = validate.detectCrossTierDuplicates(draft, candidates);
    assert.equal(dups.length, 1, "one unframed cross-tier stack expected");
    assert.equal(dups[0].anchor, "material:mat-downlight");
    assert.equal(dups[0].sameQuantity, false);
    const r = validate.validateQuoteGrounding(draft, pricingBook, candidates);
    assert.equal(r.valid, false, "unframed cross-tier stack should fail grounding");
    assert.ok(r.failures.some((f) => f.expected.includes("cross-tier duplicate")));
  });

  it("R6: does NOT flag a FRAMED quantity difference (scope_of_works explains the count change)", () => {
    const draft = {
      needs_inspection: false,
      scope_of_works:
        "Install Brilliant 9W LED downlight units: Good covers 3 downlights in the kitchen; " +
        "Best extends to 6 downlights across the kitchen and hallway.",
      good: { label: "Good", line_items: [labour(2), downlight(3)] },
      better: null,
      best: { label: "Best", line_items: [labour(2), downlight(6)] },
    };
    assert.equal(validate.detectCrossTierDuplicates(draft, candidates).length, 0);
    assert.equal(validate.validateQuoteGrounding(draft, pricingBook, candidates).valid, true);
  });

  it("R6: does NOT flag the SAME row at the SAME quantity in every tier (ordinary progression)", () => {
    const draft = {
      needs_inspection: false,
      good: { label: "Good", line_items: [labour(2), downlight(6)] },
      better: { label: "Better", line_items: [labour(3), downlight(6)] },
      best: { label: "Best", line_items: [labour(4), downlight(6)] },
    };
    assert.equal(validate.detectCrossTierDuplicates(draft, candidates).length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. AFTER-HOURS TAG (R11) — the validator only accepts an above-rate
// labour/callout price when the LINE is tagged after-hours AND the
// configured multiplier is a sane surcharge (finite, >1, ≤ the cap). A
// forged tag or garbage multiplier must still fail grounding.
// ═══════════════════════════════════════════════════════════════════
describe("validateQuoteGrounding — after-hours surcharge tag (R11)", () => {
  const baseBook = {
    hourly_rate: 100,
    apprentice_rate: 70,
    call_out_minimum: 150,
    default_markup_pct: 28,
    min_labour_hours: 3,
  };
  const noCandidates = validate.buildCandidatePrices([], [], baseBook);
  const callout = { description: "Call-out", quantity: 1, unit: "each", unit_price_ex_gst: 150, source: "callout" };
  const tier = (lines) => ({ needs_inspection: false, good: { line_items: lines }, better: null, best: null });

  it("ACCEPTS a TAGGED after-hours labour line at hourly × a valid multiplier (×1.5)", () => {
    const r = validate.validateQuoteGrounding(
      tier([callout, { description: "After-hours diagnostic", quantity: 3, unit: "hr", unit_price_ex_gst: 150, source: "after_hours" }]),
      { ...baseBook, after_hours_multiplier: 1.5 },
      noCandidates,
    );
    assert.equal(r.valid, true, "tagged after-hours line at a valid surcharge should ground");
  });

  it("REJECTS the SAME inflated rate on an UNTAGGED labour line (tag required)", () => {
    const r = validate.validateQuoteGrounding(
      tier([callout, { description: "Install labour", quantity: 3, unit: "hr", unit_price_ex_gst: 200, source: "labour" }]),
      { ...baseBook, after_hours_multiplier: 2 },
      noCandidates,
    );
    assert.equal(r.valid, false, "untagged inflated labour must fail grounding");
  });

  it("REJECTS a forged/garbage multiplier from establishing an inflated accepted rate", () => {
    const r = validate.validateQuoteGrounding(
      tier([callout, { description: "After-hours labour", quantity: 3, unit: "hr", unit_price_ex_gst: 5000, source: "after_hours" }]),
      { ...baseBook, after_hours_multiplier: 50 },
      noCandidates,
    );
    assert.equal(r.valid, false, "an absurd multiplier above the cap must not inflate the accepted rate");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. QUESTION ENFORCEMENT (R24/R27) — the per-job MUST-ASK + inspection
// triggers the SMS dialog injects. The deterministic readiness gate and
// the dialog prompt render the SAME canonical list (mustAskLines), so the
// agent can never finish/draft while a mandatory question is unanswered.
// ═══════════════════════════════════════════════════════════════════
describe("rulesAsText / mustAskLines — per-job question enforcement (R24/R27)", () => {
  const EASY_SET = [
    "downlights", "power_points", "ceiling_fans", "smoke_alarms", "outdoor_lighting",
    "blocked_drain", "hot_water", "tap_repair", "tap_replace", "toilet_repair", "toilet_replace",
  ];

  for (const jt of EASY_SET) {
    it(`${jt}: mustAskLines is non-empty + cleaned (one canonical mandatory set)`, () => {
      const lines = assumptions.mustAskLines(jt);
      assert.ok(lines.length > 0, `no MUST-ASK lines for ${jt}`);
      for (const q of lines) {
        assert.ok(q.trim().length > 0, "blank MUST-ASK entry leaked through");
        assert.equal(q, q.trim(), "untrimmed MUST-ASK entry");
      }
    });
    it(`${jt}: rulesAsText renders a HARD MUST-ASK gate that forbids finishing`, () => {
      const t = assumptions.rulesAsText(jt);
      assert.match(t, /MUST ASK before any finish/);
      assert.match(t, /do NOT finish/);
      // Every mandatory question is present and numbered in order.
      assumptions.mustAskLines(jt).forEach((q, i) => {
        assert.ok(t.includes(`${i + 1}. ${q}`), `missing numbered MUST-ASK "${q}" for ${jt}`);
      });
    });
    it(`${jt}: rulesAsText renders inspection triggers as escalation rules`, () => {
      const t = assumptions.rulesAsText(jt);
      assert.match(t, /INSPECTION TRIGGERS/);
      assert.match(t, /escalate_inspection/);
      for (const trig of assumptions.ASSUMPTION_RULES[jt].inspectionTriggers) {
        assert.ok(t.includes(trig), `missing inspection trigger "${trig}" for ${jt}`);
      }
    });
  }

  it("the dialog SYSTEM_PROMPT frames MUST-ASK as a hard pre-finish gate", () => {
    assert.match(dialog.SYSTEM_PROMPT, /MUST-ASK questions are HARD per-job gates/i);
    assert.match(dialog.SYSTEM_PROMPT, /BEFORE action='finish'/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. INSPECTION-REASON NO-PRICE-LEAK (R13) — the customer inspection SMS
// renders the sanitised reason; it must never carry an invented price on a
// quote that has no real price.
// ═══════════════════════════════════════════════════════════════════
describe("sanitizeInspectionReason — no price leaks onto a no-price quote (R13)", () => {
  it("falls back to the safe default for empty / nullish / too-short input", () => {
    assert.equal(inspectionReason.sanitizeInspectionReason(""), inspectionReason.SAFE_INSPECTION_REASON);
    assert.equal(inspectionReason.sanitizeInspectionReason(null), inspectionReason.SAFE_INSPECTION_REASON);
    assert.equal(inspectionReason.sanitizeInspectionReason("n/a"), inspectionReason.SAFE_INSPECTION_REASON);
  });
  it("strips an invented price claim but keeps the surrounding reason", () => {
    const out = inspectionReason.sanitizeInspectionReason("Likely a $1,200 switchboard upgrade");
    assert.equal(/\$|1,200|dollars/i.test(out), false, "price leaked into inspection reason");
    assert.match(out, /switchboard upgrade/i);
  });
  it("passes a clean reason through essentially unchanged", () => {
    const clean = "The meter box is in a hard-to-access location and needs an on-site check.";
    assert.equal(inspectionReason.sanitizeInspectionReason(clean), clean);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`  ${results.passed} passed · ${results.failed} failed`);
console.log("═".repeat(60));

if (results.failed > 0) {
  console.log("\nFailures:");
  for (const f of results.failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.err.message ?? f.err}`);
  }
  process.exit(1);
}
process.exit(0);
