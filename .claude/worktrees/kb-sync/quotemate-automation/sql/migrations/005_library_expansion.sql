-- Library expansion — adds the missing rows so Opus can produce
-- meaningful Better/Best tiers for every job_type the receptionist
-- accepts. Without these, Better/Best tiers collapse for fans, GPOs,
-- outdoor lighting, smoke alarms, and oven/cooktop jobs because the
-- only valid source row is the Good-tier basic SKU.
--
-- All prices are AU electrical-industry midpoints within the ranges
-- the tradie specified. Override individual rows after install if
-- the tradie's actual buying prices differ.
--
-- Idempotent — uses `where not exists` guards keyed on row name so
-- re-running is a no-op.

-- ── shared_materials additions ────────────────────────────────────
insert into shared_materials (trade, name, brand, unit, default_unit_price_ex_gst)
select * from (values
  ('electrical', 'Weatherproof double GPO (IP56)',          'Clipsal',         'each',  58.00),
  ('electrical', 'Smart Wi-Fi double GPO',                  'Clipsal Iconic',  'each',  95.00),
  ('electrical', 'Quality AC ceiling fan + remote',         'Hunter Pacific',  'each', 220.00),
  ('electrical', 'Premium DC ceiling fan + wall control',   'Beacon Lucci',    'each', 380.00),
  ('electrical', 'Interconnected RF smoke alarm',           'Clipsal',         'each', 120.00),
  ('electrical', 'Premium IP65 outdoor wall light',         'HPM',             'each',  75.00),
  ('electrical', 'Smart dimmable outdoor light',            null::text,        'each', 140.00)
) as v(trade, name, brand, unit, default_unit_price_ex_gst)
where not exists (
  select 1 from shared_materials sm where sm.name = v.name
);

-- ── shared_assemblies additions ───────────────────────────────────
insert into shared_assemblies (trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions)
select * from (values
  ('electrical', 'Install oven (existing wiring)',             'Mount, terminate, test — uses existing dedicated circuit',          'each', 45.00, 1.00, 'Excludes new circuit, switchboard work, appliance supply'),
  ('electrical', 'Install cooktop (existing wiring)',          'Mount, terminate, test — uses existing dedicated circuit',          'each', 45.00, 1.00, 'Excludes new circuit, switchboard work, appliance supply'),
  ('electrical', 'Diagnostic call-out (fault finding)',        'Attendance, diagnostic testing, written summary of repair options', 'each', 165.00, 0.00, 'Quote for repair issued separately after diagnosis'),
  ('electrical', 'Supply + install AC ceiling fan',            'Mount, terminate to existing wiring, test — fan supplied by us',    'each', 35.00, 1.00, 'Fan supplied by us as a separate material line'),
  ('electrical', 'Install premium DC fan with wall control',   'Mount, terminate, fit wall controller, test',                       'each', 55.00, 1.50, 'Fan + wall controller supplied separately as material lines')
) as v(trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions)
where not exists (
  select 1 from shared_assemblies sa where sa.name = v.name
);

-- ── pricing_book — minimum labour hours column ────────────────────
-- Used by the validator to enforce the "small job allowance: minimum
-- 2 hours" rule from the tradie's pricing structure.
alter table pricing_book add column if not exists min_labour_hours numeric(4,2) default 2.00;
update pricing_book set min_labour_hours = coalesce(min_labour_hours, 2.00);
