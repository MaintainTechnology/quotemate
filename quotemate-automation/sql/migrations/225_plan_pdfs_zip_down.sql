-- 225 down: the plan-pdfs bucket takes zip files no more. Packs already
-- stored stay until their runs are deleted; new exports fail to store.

update storage.buckets
   set allowed_mime_types = (
         select array_agg(t order by t)
           from unnest(allowed_mime_types) as t
          where t <> 'application/zip'
       )
 where id = 'plan-pdfs'
   and 'application/zip' = any(allowed_mime_types);
