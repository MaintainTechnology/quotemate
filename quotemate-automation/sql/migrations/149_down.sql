-- Down-migration 149 · de-register the painting trade
--
-- Reverses 149_register_painting_trade.sql. The trade_pricing_defaults
-- row is removed automatically by its `on delete cascade` FK to
-- trades(id), so deleting the trades row is sufficient.
--
-- GUARDED: only removes the registry row when no tenant or licence still
-- references painting, so the FK on tenants.trade / tenant_licences.trade
-- can never be violated. If a painting tenant exists, this is a safe no-op.

begin;

delete from trades t
 where t.name = 'painting'
   and not exists (select 1 from tenants          where trade = 'painting')
   and not exists (select 1 from tenant_licences  where trade = 'painting');

notify pgrst, 'reload schema';

commit;
