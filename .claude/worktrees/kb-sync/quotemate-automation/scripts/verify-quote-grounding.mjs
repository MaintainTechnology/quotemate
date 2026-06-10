// ═══════════════════════════════════════════════════════════════════
// QuoteMate · quote grounding audit
//
// Usage:
//   node --env-file=.env.local scripts/verify-quote-grounding.mjs --token <share_token>
//
// Pulls a quote by share_token, walks every tier's line items, and
// verifies each unit_price_ex_gst against the live catalogue tables
// (shared_materials, shared_assemblies, pricing_books). For every line
// item we either:
//   ✓ MATCH — price (± $0.50) is derivable from a DB row, with or
//             without the standard markup
//   ✗ UNGROUNDED — no row in the catalogue produces this price
//
// Same logic the in-pipeline validator (lib/estimate/validate.ts) uses,
// so an audit run here mirrors what the production grounding gate sees.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const token = getArg("--token");
if (!token) {
  console.error("Usage: node scripts/verify-quote-grounding.mjs --token <share_token>");
  process.exit(1);
}

const PRICE_TOL = 0.5;

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// ─── Pull the quote ──────────────────────────────────────────────────
// Pull the intake's `trade` too — the audit needs to load the
// pricing_book row + filter shared_materials/assemblies for that trade.
// Plumbing books use a different hourly_rate ($120) and markup (20%)
// than electrical ($110, 28%); without the trade filter the candidate
// table contains cross-trade noise and the markup math is wrong.
const { rows: quoteRows } = await client.query(
  `select q.*, i.job_type, i.suburb, i.scope, i.caller, i.confidence, i.confidence_reason,
          i.inspection_required, i.risks, i.trade
     from quotes q
     left join intakes i on i.id = q.intake_id
     where q.share_token = $1`,
  [token],
);
if (quoteRows.length === 0) {
  console.error(`No quote found with share_token=${token}`);
  await client.end();
  process.exit(1);
}
const q = quoteRows[0];

console.log("\n" + "═".repeat(72));
console.log(`QUOTE  share_token=${token}`);
console.log("═".repeat(72));
console.log(`quote_id:           ${q.id}`);
console.log(`intake_id:          ${q.intake_id}`);
console.log(`trade:              ${q.trade ?? "(null — pre-v5 quote, will audit against full catalogue)"}`);
console.log(`tenant_id:          ${q.tenant_id ?? "(null — pre-v6)"}`);
console.log(`job_type:           ${q.job_type}`);
console.log(`suburb:             ${q.suburb ?? "(null)"}`);
console.log(`needs_inspection:   ${q.needs_inspection}`);
console.log(`confidence:         ${q.confidence}`);
console.log(`scope_short:        ${q.scope_short ?? "(null)"}`);
if (q.scope_of_works) {
  console.log(`scope_of_works:     "${q.scope_of_works.slice(0, 120)}${q.scope_of_works.length > 120 ? "…" : ""}"`);
}

// ─── Pull the pricing book for this quote's trade + tenant ───────────
// pricing_book is multi-tenant + multi-trade since v5/v6. When the quote
// has a tenant_id we use the exact (tenant_id, trade) row. When it
// doesn't (test / legacy quotes), we collect EVERY row for the trade so
// the candidate-price builder can try each markup — otherwise picking
// the wrong tenant's markup makes the audit false-flag material lines.
let pbCandidateRows = [];
if (q.tenant_id && q.trade) {
  const { rows } = await client.query(
    `select * from pricing_book where tenant_id = $1 and trade = $2`,
    [q.tenant_id, q.trade],
  );
  pbCandidateRows = rows;
}
if (pbCandidateRows.length === 0 && q.trade) {
  const { rows } = await client.query(
    `select * from pricing_book where trade = $1 order by default_markup_pct desc`,
    [q.trade],
  );
  pbCandidateRows = rows;
}
if (pbCandidateRows.length === 0) {
  const { rows } = await client.query(`select * from pricing_book order by id`);
  pbCandidateRows = rows;
}
const pb = pbCandidateRows[0] ?? null;

console.log("\n" + "─".repeat(72));
console.log("PRICING BOOK  (singleton, the validator loads this row at draft time)");
console.log("─".repeat(72));
if (!pb) {
  console.log("(no row in pricing_book table — quotes would fall back to defaults)");
} else {
  console.log(`hourly_rate:        $${pb.hourly_rate}/hr`);
  console.log(`apprentice_rate:    $${pb.apprentice_rate}/hr`);
  console.log(`call_out_minimum:   $${pb.call_out_minimum}`);
  console.log(`default_markup_pct: ${pb.default_markup_pct}%`);
  console.log(`risk_buffer_pct:    ${pb.risk_buffer_pct}%`);
  console.log(`gst_registered:     ${pb.gst_registered}`);
  if (pb.licence_type) {
    console.log(`licence:            ${pb.licence_type} ${pb.licence_number} (${pb.licence_state}, exp ${pb.licence_expiry})`);
  }
}

// ─── Catalogue: every shared_material + shared_assembly with their
//      raw + marked-up candidate prices (matching validator logic). ──
// Trade-filter when we have a trade — otherwise we'd be matching a
// plumbing line against an electrical row that happens to share a price,
// producing false MATCHES that hide real grounding gaps.
const catSql = (table) => q.trade
  ? `select id, name, default_unit_price_ex_gst, properties from ${table} where trade = $1`
  : `select id, name, default_unit_price_ex_gst, properties from ${table}`;
const catParams = q.trade ? [q.trade] : [];
const [materials, assemblies] = await Promise.all([
  client.query(catSql("shared_materials"), catParams),
  client.query(catSql("shared_assemblies"), catParams),
]);

// Trade-aware defaults: plumbing book is $120/hr × 20%, electrical is
// $110/hr × 28%. Fall back to defaults only when neither the row nor a
// trade hint is available.
const defaultMarkup = q.trade === "plumbing" ? 20 : 28;
const defaultHourly = q.trade === "plumbing" ? 120 : 110;
const candidateMarkups = pbCandidateRows.length > 0
  ? [...new Set(pbCandidateRows.map((r) => parseFloat(r.default_markup_pct)))]
  : [defaultMarkup];
const markupPct = parseFloat(pb?.default_markup_pct ?? defaultMarkup);
const hourlyRate = parseFloat(pb?.hourly_rate ?? defaultHourly);
const apprenticeRate = parseFloat(pb?.apprentice_rate ?? 55);

function withMarkup(p, pct = markupPct) {
  return Math.round(p * (1 + pct / 100) * 100) / 100;
}

// Build the candidate-price index — same as buildCandidatePrices() in
// lib/estimate/validate.ts. For each catalogue row we emit:
//   - the raw price
//   - the price under EVERY markup that exists for this trade
// so a null-tenant or legacy quote drafted at one tenant's markup still
// audits cleanly even when the script can't pin the exact pricing_book.
function asCandidates(rows) {
  return rows.flatMap((r) => {
    const raw = parseFloat(r.default_unit_price_ex_gst);
    const variants = [{ name: r.name, raw, marked: raw, markup: 0 }];
    for (const pct of candidateMarkups) {
      variants.push({ name: r.name, raw, marked: withMarkup(raw, pct), markup: pct });
    }
    return variants;
  });
}
const matCands = asCandidates(materials.rows);
const asmCands = asCandidates(assemblies.rows);

// Labour candidates — labour line items can match hourly_rate or
// apprentice_rate at any quantity, so we match on the unit price.
// Hourly rates in pricing_book are stored RAW; the plumbing book uses
// $120/hr raw (already the customer-facing rate) so we don't apply
// markup on labour candidates here.
const tradeLabel = q.trade ? `${q.trade} hourly_rate` : "hourly_rate";
const labourCands = [
  { name: tradeLabel, raw: hourlyRate, marked: hourlyRate },
  { name: "apprentice_rate", raw: apprenticeRate, marked: apprenticeRate },
];

function matchPrice(unit, unitPrice) {
  const candidates = unit === "hr" ? labourCands : [...matCands, ...asmCands];
  for (const c of candidates) {
    if (Math.abs(c.marked - unitPrice) <= PRICE_TOL) {
      const basis = (c.markup ?? 0) === 0 ? "raw" : `+${c.markup}% markup`;
      return { matched: c, basis };
    }
  }
  return null;
}

// ─── Per-tier line item audit ────────────────────────────────────────
const tiers = ["good", "better", "best"];
let overallGrounded = true;
let totalLineItems = 0;
let groundedItems = 0;

for (const t of tiers) {
  const tier = q[t];
  if (!tier) {
    console.log(`\n${t.toUpperCase()}: (null — not offered)`);
    continue;
  }

  console.log("\n" + "─".repeat(72));
  console.log(`TIER: ${t.toUpperCase()}    label="${tier.label ?? ""}"    subtotal_ex_gst=$${tier.subtotal_ex_gst}`);
  console.log("─".repeat(72));

  if (!Array.isArray(tier.line_items) || tier.line_items.length === 0) {
    console.log("  (no line items)");
    continue;
  }

  for (let i = 0; i < tier.line_items.length; i++) {
    const li = tier.line_items[i];
    totalLineItems++;
    const unitPrice = parseFloat(li.unit_price_ex_gst);
    const qty = parseFloat(li.quantity);
    const lineTotal = parseFloat(li.total_ex_gst);
    const expectedTotal = Math.round(unitPrice * qty * 100) / 100;

    const m = matchPrice(li.unit, unitPrice);
    if (m) {
      groundedItems++;
      console.log(
        `  #${i + 1}  ✓ MATCH  qty=${qty} ${li.unit} × $${unitPrice} = $${expectedTotal}\n` +
        `        line: "${li.description}"\n` +
        `        DB row: "${m.matched.name}" (${m.basis})`,
      );
    } else {
      overallGrounded = false;
      console.log(
        `  #${i + 1}  ✗ UNGROUNDED  qty=${qty} ${li.unit} × $${unitPrice} = $${expectedTotal}\n` +
        `        line: "${li.description}"\n` +
        `        no DB row in shared_materials, shared_assemblies, or pricing_book labour rates produces $${unitPrice} (raw or marked-up at ${candidateMarkups.join("%, ")}%)`,
      );
    }

    if (Math.abs(expectedTotal - lineTotal) > PRICE_TOL) {
      console.log(
        `      ⚠ arithmetic mismatch: line.total_ex_gst=$${lineTotal} but qty × unit_price = $${expectedTotal}`,
      );
    }
  }

  // Recompute subtotal from line items for sanity.
  const computedSubtotal = tier.line_items.reduce(
    (sum, li) => sum + parseFloat(li.total_ex_gst), 0,
  );
  const recordedSubtotal = parseFloat(tier.subtotal_ex_gst);
  if (Math.abs(computedSubtotal - recordedSubtotal) > PRICE_TOL) {
    console.log(
      `\n  ⚠ subtotal mismatch: stored=$${recordedSubtotal.toFixed(2)} but sum of line_items=$${computedSubtotal.toFixed(2)}`,
    );
  }
  const incGst = Math.round(recordedSubtotal * 1.1);
  console.log(`\n  computed inc-GST (×1.10) = $${incGst}    (this is what the customer SMS shows)`);
}

// ─── Summary ─────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(72));
console.log("AUDIT SUMMARY");
console.log("═".repeat(72));
console.log(`line items checked:   ${totalLineItems}`);
console.log(`grounded in catalogue: ${groundedItems}`);
console.log(`ungrounded:           ${totalLineItems - groundedItems}`);
console.log(`verdict:              ${overallGrounded ? "✓ ALL PRICES GROUNDED IN CATALOGUE" : "✗ SOME LINE ITEMS WERE NOT FOUND IN THE CATALOGUE — possible hallucination"}`);

// ─── Catalogue dump for the relevant job_type so user can sanity-check
//      the prices themselves ──────────────────────────────────────────
const jobKeyword = (q.job_type ?? "").replace(/_/g, " ");
console.log("\n" + "─".repeat(72));
console.log(`RELEVANT CATALOGUE ROWS  (matching "${jobKeyword}" or "fan")`);
console.log("─".repeat(72));

const matchPattern = `%${jobKeyword.split(" ")[0]}%`;
const dumpSql = q.trade
  ? `select 'material' as kind, name, default_unit_price_ex_gst, properties
       from shared_materials
       where trade = $2 and name ilike $1
     union all
     select 'assembly' as kind, name, default_unit_price_ex_gst, properties
       from shared_assemblies
       where trade = $2 and name ilike $1
     order by kind, default_unit_price_ex_gst`
  : `select 'material' as kind, name, default_unit_price_ex_gst, properties
       from shared_materials
       where name ilike $1
     union all
     select 'assembly' as kind, name, default_unit_price_ex_gst, properties
       from shared_assemblies
       where name ilike $1
     order by kind, default_unit_price_ex_gst`;
const dumpParams = q.trade ? [matchPattern, q.trade] : [matchPattern];
const { rows: relevantMats } = await client.query(dumpSql, dumpParams);
if (relevantMats.length === 0) {
  console.log("(no rows match — broader keyword may be needed)");
} else {
  for (const r of relevantMats) {
    const raw = parseFloat(r.default_unit_price_ex_gst);
    const props = r.properties ? JSON.stringify(r.properties).slice(0, 60) : "";
    const markedVariants = candidateMarkups
      .map((pct) => `$${withMarkup(raw, pct).toFixed(2)} (+${pct}%)`)
      .join("  ");
    console.log(
      `  ${r.kind.padEnd(8)}  $${raw.toFixed(2).padStart(7)} (raw)  →  ${markedVariants}  "${r.name}"${props ? "  " + props : ""}`,
    );
  }
}

await client.end();
