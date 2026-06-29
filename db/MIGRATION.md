# PostgreSQL → SQL Server migration

The platform was migrated from Neon/PostgreSQL (`pg`) to SQL Server (`mssql`),
targeting the existing **`hy_datawarehouse`** database on `64.27.41.252` (schema
`dbo`, alongside the 145 existing warehouse tables — no name collisions).

## What changed

- **`netlify/functions/_db.js`** — now an `mssql` connection pool with a
  pg-compatible shim. Handlers still call `db.query('… $1 …', [params])` and read
  `r.rows` / `r.rowCount`. The shim rewrites `$1`→`@p1`, maps results, and
  auto-translates `NOW()`→`SYSUTCDATETIME()` and `ILIKE`→`LIKE`. It also exposes
  `withTransaction(fn)` and `parseJson(rows, cols)`.
- **`package.json`** — `pg` moved to devDependencies (used only by the migration
  script); `mssql` is the runtime dependency.
- **23 function handlers** — dialect fixes: `RETURNING *`→`OUTPUT INSERTED.*`,
  `ON CONFLICT`→`MERGE` / `INSERT … WHERE NOT EXISTS`, `LIMIT/OFFSET`→`OFFSET …
  FETCH` / `TOP`, `EXTRACT(DOW)`, `DATE_TRUNC`, `INTERVAL`, `||`→`CONCAT`,
  `json_agg`→`FOR JSON PATH`, `AVG()::numeric`→`AVG(CAST(...))`, `active=true`→
  `active=1`, unique-violation `e.code 23505`→`e.number 2627/2601`. JSONB columns
  (`tags`, `properties`, `raw`) are stored as `NVARCHAR(MAX)` and re-parsed on read.
  `TIME` columns are coerced back to `HH:MM:SS` strings.
- **`db/schema.sqlserver.sql`** — the translated DDL (19 tables, indexes, FKs).

## One-time setup

1. **Create the schema** (already done once; safe to re-run — guarded by
   `IF OBJECT_ID … IS NULL`):
   ```
   npm run db:setup
   ```
   Requires `MSSQL_HOST/USER/PASSWORD/DATABASE` in the environment.

2. **Migrate the data** from Neon. Put the Neon connection string in
   `SOURCE_DATABASE_URL`, then:
   ```
   npm run db:migrate          # add WIPE=1 to clear the target first
   ```
   Tables are copied parent-first; original ids are preserved (IDENTITY_INSERT)
   and identity counters reseeded.

3. **Configure the deployed app** — set the `MSSQL_*` variables in Netlify
   (Site settings → Environment variables). `DATABASE_URL` is no longer used.

## Local development

`.env` (gitignored) holds the local `MSSQL_*` values; run `netlify dev` as usual.
