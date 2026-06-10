-- Adds a properties jsonb column to shared_materials and shared_assemblies
-- so the estimation engine can filter rows by structured criteria
-- (color_temp, dimmable, smart, weatherproof, supplied_by, ip_rating)
-- instead of fuzzy-matching on the row name.
--
-- Backfills the 15 existing material rows + 10 assembly rows with
-- their actual properties. Any row not explicitly set keeps the
-- default empty object — the lookup tools treat empty/missing
-- properties as "generic, fits anything", so unbackfilled rows are
-- still usable.
--
-- Idempotent — re-running just re-asserts the property values.

alter table shared_materials add column if not exists properties jsonb default '{}'::jsonb;
alter table shared_assemblies add column if not exists properties jsonb default '{}'::jsonb;

-- ── shared_materials backfill ─────────────────────────────────────
-- color_options: array of supported color temperatures (filter is "row supports requested temp")
-- dimmable / smart / weatherproof: bool — strict filter (request true requires row.true)
-- supplied_by: 'tradie' (we supply) | 'customer' (they supply) | unset (generic)
-- ip_rating: weather/wet-area protection level (informational; weatherproof bool is the filter)

update shared_materials set properties =
  '{"color_options":["warm_white"],"dimmable":false,"smart":false,"weatherproof":false}'::jsonb
  where name = 'Basic LED downlight';

update shared_materials set properties =
  '{"color_options":["warm_white","cool_white","tri_colour"],"dimmable":false,"smart":false,"weatherproof":false}'::jsonb
  where name = 'Tri-colour LED downlight';

update shared_materials set properties =
  '{"color_options":["warm_white","cool_white"],"dimmable":true,"smart":false,"weatherproof":true,"ip_rating":"IP44"}'::jsonb
  where name = 'Dimmable IP-rated downlight';

update shared_materials set properties =
  '{"dimmable":false,"smart":false,"weatherproof":false}'::jsonb
  where name = 'Standard double GPO';

update shared_materials set properties =
  '{"usb":true,"dimmable":false,"smart":false,"weatherproof":false}'::jsonb
  where name = 'USB double GPO';

update shared_materials set properties =
  '{"weatherproof":true,"ip_rating":"IP56","smart":false}'::jsonb
  where name = 'Weatherproof double GPO (IP56)';

update shared_materials set properties =
  '{"smart":true,"weatherproof":false,"dimmable":false}'::jsonb
  where name = 'Smart Wi-Fi double GPO';

update shared_materials set properties =
  '{"interconnect":false,"battery_only":false,"hardwired":true}'::jsonb
  where name = 'Hardwired smoke alarm';

update shared_materials set properties =
  '{"interconnect":true,"hardwired":true,"rf":true}'::jsonb
  where name = 'Interconnected RF smoke alarm';

update shared_materials set properties =
  '{"safety_switch":true}'::jsonb
  where name = 'RCBO safety switch';

update shared_materials set properties =
  '{"sundry":true}'::jsonb
  where name = 'Sundries (terminals, wire, clips)';

update shared_materials set properties =
  '{"supplied_by":"tradie","fan_type":"AC","includes_remote":true}'::jsonb
  where name = 'Quality AC ceiling fan + remote';

update shared_materials set properties =
  '{"supplied_by":"tradie","fan_type":"DC","includes_wall_control":true}'::jsonb
  where name = 'Premium DC ceiling fan + wall control';

update shared_materials set properties =
  '{"weatherproof":true,"ip_rating":"IP65","dimmable":false,"smart":false}'::jsonb
  where name = 'Premium IP65 outdoor wall light';

update shared_materials set properties =
  '{"weatherproof":true,"dimmable":true,"smart":true,"ip_rating":"IP65"}'::jsonb
  where name = 'Smart dimmable outdoor light';

-- ── shared_assemblies backfill ────────────────────────────────────
-- Assemblies are mostly labour-only descriptions; properties capture
-- restrictions (supplied_by) or work-area constraints (weatherproof)
-- that should drive lookup filters.

update shared_assemblies set properties =
  '{"weatherproof":false}'::jsonb
  where name = 'Install LED downlight';

update shared_assemblies set properties =
  '{"weatherproof":true,"outdoor":true}'::jsonb
  where name = 'Install outdoor IP-rated LED light';

update shared_assemblies set properties =
  '{}'::jsonb
  where name = 'Replace double GPO';

update shared_assemblies set properties =
  '{"supplied_by":"customer"}'::jsonb
  where name = 'Install customer-supplied ceiling fan';

update shared_assemblies set properties =
  '{"supplied_by":"tradie","fan_type":"AC"}'::jsonb
  where name = 'Supply + install AC ceiling fan';

update shared_assemblies set properties =
  '{"supplied_by":"tradie","fan_type":"DC","includes_wall_control":true}'::jsonb
  where name = 'Install premium DC fan with wall control';

update shared_assemblies set properties =
  '{"hardwired":true}'::jsonb
  where name = 'Hardwire 240V smoke alarm';

update shared_assemblies set properties =
  '{"appliance":"oven","existing_circuit":true}'::jsonb
  where name = 'Install oven (existing wiring)';

update shared_assemblies set properties =
  '{"appliance":"cooktop","existing_circuit":true}'::jsonb
  where name = 'Install cooktop (existing wiring)';

update shared_assemblies set properties =
  '{"diagnostic":true,"call_out":true}'::jsonb
  where name = 'Diagnostic call-out (fault finding)';

-- ── Helpful indexes for jsonb property filters ────────────────────
create index if not exists idx_shared_materials_properties on shared_materials using gin (properties);
create index if not exists idx_shared_assemblies_properties on shared_assemblies using gin (properties);
