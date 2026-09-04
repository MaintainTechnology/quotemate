import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const r = await c.query(`select column_name from information_schema.columns where table_name='tenants' order by ordinal_position`)
console.log(r.rows.map(x=>x.column_name).join(', '))
await c.end()
