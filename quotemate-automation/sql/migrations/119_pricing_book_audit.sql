-- QuoteMate - migration 119 - pricing_book audit (R19, 2026-06-18)
--
-- READ-ONLY AUDIT of all 7 prod pricing_book rows (electrical + plumbing only)
-- found the numeric pricing fields (hourly_rate, call_out_minimum,
-- default_markup_pct, min_labour_hours, risk_buffer_pct, apprentice_rate,
-- senior_rate, after_hours_multiplier) and gst_registered to all be
-- PRESENT and within sane positive/range bounds. apprentice_rate, senior_rate
-- and after_hours_multiplier are WIRED into the grounding validator
-- (lib/estimate/validate.ts) and the estimator prompt context
-- (lib/estimate/prompt-context.ts) — the earlier "not used by the estimator"
-- note is STALE. They are treated as live config, not dead columns, and must
-- stay sane (the validator caps after_hours_multiplier at 2.5 — all rows ≤ 2.0).
--
-- The ONLY unambiguously-invalid value found is a malformed licence_expiry on
-- one electrical row (Atomic Electrical, id 8e7bf274-...): the stored date is
-- year 0008 (0008-05-22), which is impossible — no AU electrical/plumbing
-- licence expires in year 8 AD. This is the single safe, owner-judgement-free
-- correction in scope: we cannot know the tradie's REAL expiry, so we do NOT
-- invent a year — we NULL the garbage value (removing fabricated-looking data
-- is safer than leaving an impossible date; licence_expiry is NOT consumed by
-- the money-touching estimator path, only by the tenant_licences view).
--
-- Everything else flagged in the audit (Oakcrest $200/hr + 42.8% markup,
-- Atomic 14% markup, the min_labour_hours == after_hours_multiplier rows,
-- the placeholder licence_number "1234567", missing licence_state on the
-- Atomic plumbing row) needs the OWNER's real-rate confirmation and is
-- intentionally LEFT UNTOUCHED here — see this task's flagged_items.
--
-- Idempotent / re-runnable: the WHERE clause matches only impossible years, so
-- a second run affects 0 rows.

update public.pricing_book
   set licence_expiry = null
 where licence_expiry is not null
   and (extract(year from licence_expiry) < 1900
        or extract(year from licence_expiry) > 2100);

notify pgrst, 'reload schema';
