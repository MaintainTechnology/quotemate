-- 227: the plan-pdfs bucket takes JSON files, for the eval's fixtures (TKO-15,
-- DEC-040).
--
-- Each eval fixture is a folder of the bucket, eval/<fixture>/, holding its
-- plan PDFs beside its request.json and its hand-measured reference,
-- takeoff.json, so the service's nightly eval reads everything it needs from
-- one place. The bucket's allowlist held PDFs, images and zips (migration 225),
-- so storage refused the JSON.
--
-- A signed upload URL a tradie gets is for a .pdf path the server built, and
-- intake reads each file's %PDF- header, so a JSON file uploaded there only
-- fails its own run.
--
-- A null allowlist already takes every type; it is left as it is, as is one
-- that already takes JSON.

update storage.buckets
   set allowed_mime_types = (
         select array_agg(t order by t)
           from unnest(allowed_mime_types || array['application/json']) as t
       )
 where id = 'plan-pdfs'
   and allowed_mime_types is not null
   and not ('application/json' = any(allowed_mime_types));
