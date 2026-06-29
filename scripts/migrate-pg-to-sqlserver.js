#!/usr/bin/env node
// Copy all HealYou app data from the source Neon/PostgreSQL database into the
// SQL Server target (hy_datawarehouse, dbo). Tables are migrated parent-first so
// foreign keys are satisfied, original primary-key ids are preserved via
// IDENTITY_INSERT, and identity counters are reseeded afterwards.
//
// Env:
//   SOURCE_DATABASE_URL  postgres://...  (the current Neon connection string)
//   MSSQL_HOST / MSSQL_USER / MSSQL_PASSWORD / MSSQL_DATABASE  (SQL Server target)
//   WIPE=1               optional — delete existing rows in the target first
//
// Usage:
//   SOURCE_DATABASE_URL="postgres://..." MSSQL_HOST=64.27.41.252 \
//   MSSQL_USER=claudeservices MSSQL_PASSWORD=... MSSQL_DATABASE=hy_datawarehouse \
//   node scripts/migrate-pg-to-sqlserver.js
const { Pool } = require('pg');
const sql = require('mssql');

// Parent-first order so FK references already exist when children are inserted.
const ORDER = [
  'organizations', 'coaches', 'participants', 'screening_events',
  'biometric_results', 'coaching_sessions', 'coaching_notes', 'goals',
  'coach_availability', 'org_contacts', 'org_locations', 'departments',
  'eligibility', 'event_registrations',
  'health_tips', 'testimonials', 'content_library', 'system_settings',
  'umbraco_content',
];

const pg = new Pool({
  connectionString: process.env.SOURCE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const mssqlCfg = {
  server: process.env.MSSQL_HOST,
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE || 'hy_datawarehouse',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 20000, requestTimeout: 120000,
};

function coerce(v) {
  if (v === undefined || v === null) return null;
  if (Buffer.isBuffer(v) || v instanceof Date) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object') return JSON.stringify(v); // jsonb -> NVARCHAR(MAX)
  return v;
}

(async () => {
  if (!process.env.SOURCE_DATABASE_URL) {
    console.error('SOURCE_DATABASE_URL is required (the Neon connection string).');
    process.exit(1);
  }
  const pool = await sql.connect(mssqlCfg);
  console.log('Connected. Source: Neon  ->  Target:', mssqlCfg.database, '@', mssqlCfg.server, '\n');

  if (process.env.WIPE === '1') {
    console.log('WIPE=1 — clearing target tables (reverse FK order)…');
    for (const name of [...ORDER].reverse()) {
      try { await pool.request().batch(`DELETE FROM dbo.${name}`); }
      catch (e) { console.error(`  wipe ${name}:`, e.message); }
    }
    console.log('');
  }

  const summary = [];
  for (const name of ORDER) {
    let rows;
    try { ({ rows } = await pg.query(`SELECT * FROM ${name}`)); }
    catch (e) { console.error(`SKIP ${name} (source read failed): ${e.message}`); summary.push([name, 'src-error']); continue; }

    if (!rows.length) { console.log(`${name}: 0 rows`); summary.push([name, 0]); continue; }

    const cols = Object.keys(rows[0]);
    const hasId = cols.includes('id');
    const colList = cols.map(c => `[${c}]`).join(',');

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (hasId) await new sql.Request(tx).batch(`SET IDENTITY_INSERT dbo.${name} ON`);
      for (const row of rows) {
        const req = new sql.Request(tx);
        cols.forEach((c, i) => req.input('p' + i, coerce(row[c])));
        const vals = cols.map((_, i) => '@p' + i).join(',');
        await req.query(`INSERT INTO dbo.${name} (${colList}) VALUES (${vals})`);
      }
      if (hasId) await new sql.Request(tx).batch(`SET IDENTITY_INSERT dbo.${name} OFF`);
      await tx.commit();
      if (hasId) { try { await pool.request().batch(`DBCC CHECKIDENT('dbo.${name}', RESEED)`); } catch {} }
      console.log(`${name}: ${rows.length} rows migrated`);
      summary.push([name, rows.length]);
    } catch (e) {
      await tx.rollback();
      console.error(`FAILED ${name}: ${e.message}`);
      summary.push([name, 'FAILED: ' + e.message]);
    }
  }

  console.log('\n── Summary ──');
  for (const [n, c] of summary) console.log(`  ${n}: ${c}`);
  await pg.end();
  await pool.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
