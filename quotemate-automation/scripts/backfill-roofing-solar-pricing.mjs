// Backfill after the 2026-07-17 roofing solar-pricing-parity fix.
//
// The solar detach & reinstate allowance was applied on the customer quote
// page / SMS / promotion-from-/m, but NOT in:
//   • roofing_measurements.combined_better_inc_gst (denormFromSelection) —
//     the dashboard list price read lower than the customer page, and
//   • quotes rows promoted from the DASHBOARD measure flow (its payload sent
//     raw combined.tiers).
//
// Pass 1 — recompute combined_better_inc_gst for every measurement whose
//          stored quote carries an applying solar allowance (mirrors
//          denormFromSelection + applySolarToTiers, incl. the $0-tier guard).
// Pass 2 — for measurements promoted to a quotes row (quote_id), detect a
//          better tier still equal to the RAW (solar-less) narrowed total and
//          add the allowance to the better/best tier jsonb + headline totals,
//          nulling pdf_path so the cached PDF regenerates. A quote whose
//          better total does NOT match the raw narrow was edited since
//          promotion → skipped and reported, never silently mutated. Only
//          draft/sent quotes are touched.
//
// Cached measurement PDFs need no touch here — ROOF_PDF_REV bumped to -v5, so
// every stale PDF regenerates on next download.
//
// Dry-run by default; pass --apply to write.
//   node --env-file=.env.local scripts/backfill-roofing-solar-pricing.mjs [--apply]

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const APPLY = process.argv.includes("--apply");
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

/** Mirror selection.ts denormFromSelection: sanitize → default-to-primary →
 *  narrow (quotable only) → solar on the better tier when it's priced. */
function solarBetterInc(quote, includedIndices) {
  const structures = Array.isArray(quote?.structures) ? quote.structures : [];
  const count = structures.length;
  if (count === 0) return null;
  const idx = [
    ...new Set(
      (includedIndices ?? []).filter(
        (n) => Number.isInteger(n) && n >= 1 && n <= count,
      ),
    ),
  ].sort((a, b) => a - b);
  const primary1 = (structures.findIndex((s) => s?.role === "primary") + 1) || 1;
  const eff = idx.length > 0 ? idx : [primary1];
  const chosen = eff.map((i) => structures[i - 1]).filter(Boolean);
  const quotable = chosen.filter(
    (s) => s?.price?.routing?.decision !== "inspection_required",
  );
  const sum = (i, k) => r2(quotable.reduce((a, s) => a + (s?.price?.tiers?.[i]?.[k] ?? 0), 0));
  const raw = { betterEx: sum(1, "ex_gst"), betterInc: sum(1, "inc_gst") };
  const a = quote?.solar?.allowance;
  const applies = a?.applies === true && (a?.inc_gst ?? 0) > 0;
  return {
    rawBetterInc: raw.betterInc,
    newBetterInc: applies && raw.betterEx > 0 ? r2(raw.betterInc + a.inc_gst) : raw.betterInc,
    allowance: applies ? a : null,
  };
}

/** Add the allowance to a stored good/better/best tier object (buildTierObjects
 *  shape) — totals + a matching each-line so Σ line_items === subtotal. */
function addSolarToTierObj(t, a) {
  if (!t || !(t.subtotal_ex_gst > 0)) return t;
  const arrays = Math.max(1, a.arrays ?? 1);
  return {
    ...t,
    subtotal_ex_gst: r2(t.subtotal_ex_gst + a.ex_gst),
    total_inc_gst: r2(t.total_inc_gst + a.inc_gst),
    line_items: [
      ...(Array.isArray(t.line_items) ? t.line_items : []),
      {
        unit: "each",
        quantity: arrays,
        description: "Solar detach & reinstate",
        unit_price_ex_gst: r2(a.ex_gst / arrays),
        total_ex_gst: r2(a.ex_gst),
        source: "labour",
      },
    ],
  };
}

try {
  await c.connect();

  const { rows } = await c.query(`
    select id, public_token, quote_id, included_indices, combined_better_inc_gst, quote
    from roofing_measurements
    where quote -> 'solar' -> 'allowance' ->> 'applies' = 'true'
      and coalesce((quote -> 'solar' -> 'allowance' ->> 'inc_gst')::numeric, 0) > 0
    order by created_at`);
  console.log(`${rows.length} measurement(s) carry an applying solar allowance\n`);

  // ── Pass 1: denormalised better total on the measurement row ──
  let denormFixed = 0;
  for (const m of rows) {
    const res = solarBetterInc(m.quote, m.included_indices);
    if (!res) continue;
    const stored = m.combined_better_inc_gst == null ? null : Number(m.combined_better_inc_gst);
    if (stored != null && Math.abs(stored - res.newBetterInc) < 0.01) continue;
    denormFixed++;
    console.log(
      `[denorm] ${m.public_token.slice(0, 8)}… combined_better_inc_gst ${stored} → ${res.newBetterInc}`,
    );
    if (APPLY) {
      await c.query(
        `update roofing_measurements set combined_better_inc_gst = $1 where id = $2`,
        [res.newBetterInc, m.id],
      );
    }
  }
  console.log(`Pass 1: ${denormFixed} denorm row(s) ${APPLY ? "updated" : "would update"}\n`);

  // ── Pass 2: promoted quotes rows that missed the allowance ──
  let quotesFixed = 0;
  let quotesSkipped = 0;
  for (const m of rows.filter((r) => r.quote_id)) {
    const res = solarBetterInc(m.quote, m.included_indices);
    if (!res?.allowance || res.newBetterInc === res.rawBetterInc) continue;
    const { rows: qr } = await c.query(
      `select id, status, good, better, best, subtotal_ex_gst, total_inc_gst, gst from quotes where id = $1`,
      [m.quote_id],
    );
    const q = qr[0];
    if (!q) continue;
    const better = q.better;
    const betterInc = Number(better?.total_inc_gst ?? NaN);
    // Untouched-since-promotion check: the stored better must still equal the
    // RAW (solar-less) narrowed total (±$1.50 for buildTierObjects rounding).
    if (!Number.isFinite(betterInc) || Math.abs(betterInc - res.rawBetterInc) > 1.5) {
      // Already solar-inclusive (matches new total) → nothing to do.
      if (Number.isFinite(betterInc) && Math.abs(betterInc - res.newBetterInc) <= 1.5) continue;
      quotesSkipped++;
      console.log(
        `[quotes] ${q.id} SKIPPED — better ${betterInc} matches neither raw ${res.rawBetterInc} nor solar-inclusive ${res.newBetterInc} (edited since promotion; review manually)`,
      );
      continue;
    }
    if (q.status !== "draft" && q.status !== "sent") {
      quotesSkipped++;
      console.log(`[quotes] ${q.id} SKIPPED — status '${q.status}' (never auto-mutate a paid/accepted quote)`);
      continue;
    }
    const a = res.allowance;
    const newBetter = addSolarToTierObj(better, a);
    const newBest = addSolarToTierObj(q.best, a);
    // Headline totals were stamped from the better tier at promotion — keep
    // them in lockstep when they still match it.
    const bumpHeadline =
      q.subtotal_ex_gst != null && Math.abs(Number(q.subtotal_ex_gst) - Number(better?.subtotal_ex_gst ?? NaN)) <= 1.5;
    quotesFixed++;
    console.log(
      `[quotes] ${q.id} better ${betterInc} → ${newBetter.total_inc_gst}${bumpHeadline ? " (+headline totals)" : ""}`,
    );
    if (APPLY) {
      await c.query(
        `update quotes set
           better = $1, best = $2,
           subtotal_ex_gst = case when $3 then $4 else subtotal_ex_gst end,
           total_inc_gst  = case when $3 then $5 else total_inc_gst end,
           gst            = case when $3 then $6 else gst end,
           pdf_path = null
         where id = $7`,
        [
          JSON.stringify(newBetter),
          JSON.stringify(newBest),
          bumpHeadline,
          newBetter.subtotal_ex_gst,
          newBetter.total_inc_gst,
          r2(newBetter.total_inc_gst - newBetter.subtotal_ex_gst),
          q.id,
        ],
      );
    }
  }
  console.log(
    `\nPass 2: ${quotesFixed} promoted quote(s) ${APPLY ? "updated" : "would update"}, ${quotesSkipped} skipped`,
  );
  if (!APPLY) console.log("\nDry run — re-run with --apply to write.");
} finally {
  await c.end();
}
