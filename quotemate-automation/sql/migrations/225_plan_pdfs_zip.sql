-- 225: the plan-pdfs bucket takes zip files, for the Roof Wizard pack (TKO-18,
-- DEC-037).
--
-- Each takeoff export stores its pack at
-- roofing/<tenant>/<run>/exports/<stamp>/pack.zip, beside the run's plans, so
-- deleting the run, and the retention sweep, take it too. The bucket's
-- allowlist held PDFs and images only (scripts/create-plan-pdfs-bucket.mjs),
-- so storage refused every pack: "mime type application/zip is not supported".
--
-- A signed upload URL a tradie gets is for a .pdf path the server built, and
-- intake reads each file's %PDF- header, so a zip uploaded there only fails
-- its own run.
--
-- A null allowlist already takes every type; it is left as it is, as is one
-- that already takes zips.

update storage.buckets
   set allowed_mime_types = (
         select array_agg(t order by t)
           from unnest(allowed_mime_types || array['application/zip']) as t
       )
 where id = 'plan-pdfs'
   and allowed_mime_types is not null
   and not ('application/zip' = any(allowed_mime_types));
