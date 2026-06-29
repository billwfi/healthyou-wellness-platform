#!/usr/bin/env node
// One-time migration: move from event-level Schedule Setup to the container +
// per-location model. The Setup child tables (business hours / availability /
// notification recipients) move from event_id to location_id, and the
// event_service_locations link table is retired. These tables are currently
// EMPTY (the only event was deleted), so we simply drop them and let
// `npm run db:setup` recreate them with the new location_id schema (+ the
// event_locations table, container columns, and new FKs).
//
// Run order:  node scripts/migrate-events-to-locations.js   then   npm run db:setup
const sql = require('mssql');

const cfg = {
  server: process.env.MSSQL_HOST, user: process.env.MSSQL_USER, password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE || 'hy_datawarehouse', port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true }, requestTimeout: 60000,
};
const DROP = ['event_business_hours', 'event_availability_slots', 'event_notification_recipients', 'event_service_locations'];

(async () => {
  const pool = await sql.connect(cfg);
  console.log('Connected to', cfg.database, '\n');

  // Safety: confirm these tables are empty before dropping.
  for (const t of DROP) {
    const exists = await pool.request().query(`SELECT OBJECT_ID('dbo.${t}','U') AS oid`);
    if (!exists.recordset[0].oid) { console.log(`${t}: not present (skip)`); continue; }
    const n = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.${t}`);
    if (n.recordset[0].n > 0) {
      console.error(`ABORT: dbo.${t} has ${n.recordset[0].n} rows — expected empty. No changes made.`);
      process.exit(1);
    }
  }

  // Drop (DROP TABLE also drops the table's own FK constraints).
  for (const t of DROP) {
    await pool.request().batch(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL DROP TABLE dbo.${t};`);
    console.log('dropped (if present):', t);
  }

  console.log('\nDone. Now run:  npm run db:setup');
  await pool.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
