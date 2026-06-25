-- Down-migration for 148 · no-op.
--
-- 148 nulled cached roofing PDF paths to force regeneration with the mode-aware
-- builder. There is nothing to restore — the PDFs regenerate from the stored
-- `quote` on next access, so reverting the code change is sufficient.

select 1;
