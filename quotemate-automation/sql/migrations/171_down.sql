-- ════════════════════════════════════════════════════════════════════
-- Migration 171 · DOWN — unregister the roofing trade
--
-- Refuses to run while any tenant still points at roofing, because
-- tenants.trade is FK → trades(name): deleting the row out from under a
-- live roofing tenant would fail anyway (or orphan them if the FK were
-- ever relaxed). Reassign those tenants first.
--
-- trade_pricing_defaults.trade_id is ON DELETE CASCADE, so its row goes
-- with the registry row — no explicit delete needed.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  n int;
begin
  select count(*) into n from tenants where trade = 'roofing';
  if n > 0 then
    raise exception 'Refusing to unregister roofing: % tenant(s) still have trade = roofing', n;
  end if;
end $$;

delete from trades where name = 'roofing';

notify pgrst, 'reload schema';
