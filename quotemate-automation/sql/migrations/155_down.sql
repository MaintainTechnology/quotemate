-- Rollback for migration 155 — dashboard-activatable job trades.
--
-- Removes only what 155 newly introduced: the commercial_painting registry
-- row and the trade_pricing_defaults rows for solar + commercial_painting
-- (solar's defaults did not exist before 155; commercial_painting had no
-- registry row at all). electrical / plumbing / painting registry + defaults
-- predate 155 (migrations 046/048/100/149) and are intentionally left intact.
delete from trade_pricing_defaults
 where trade_id in (select id from trades where name in ('solar', 'commercial_painting'));

delete from trades
 where name = 'commercial_painting';

notify pgrst, 'reload schema';
