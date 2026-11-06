-- 227 down: the plan-pdfs bucket takes JSON files no more. Fixtures already
-- stored stay; a fixture's JSON can't be uploaded again, so the eval reads the
-- copies already there.

update storage.buckets
   set allowed_mime_types = (
         select array_agg(t order by t)
           from unnest(allowed_mime_types) as t
          where t <> 'application/json'
       )
 where id = 'plan-pdfs'
   and 'application/json' = any(allowed_mime_types);
