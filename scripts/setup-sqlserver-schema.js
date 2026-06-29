#!/usr/bin/env node
// Create the HealYou app tables + indexes in SQL Server (hy_datawarehouse, dbo)
// and add foreign keys. SQL Server rejects multiple cascade paths to the same
// table, so each FK is attempted with its intended ON DELETE action and falls
// back to NO ACTION when the server refuses.
//
// Usage:
//   MSSQL_HOST=64.27.41.252 MSSQL_USER=claudeservices MSSQL_PASSWORD=... \
//   MSSQL_DATABASE=hy_datawarehouse node scripts/setup-sqlserver-schema.js
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const cfg = {
  server: process.env.MSSQL_HOST,
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE || 'hy_datawarehouse',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 20000, requestTimeout: 60000,
};

// table, column, refTable, refColumn, intended ON DELETE
// NOTE: the org_id FKs to dbo.organizations were removed — the app now references
// iStrata.dbo.is_groups (a different database), and SQL Server can't enforce a
// cross-database FK. org_id integrity is enforced in the app (Group dropdowns).
const FKS = [
  ['fk_participants_coach',      'participants', 'assigned_coach_id', 'coaches',          'id', 'SET NULL'],
  ['fk_biometrics_participant',  'biometric_results', 'participant_id','participants',    'id', 'CASCADE'],
  ['fk_biometrics_event',        'biometric_results', 'event_id',     'screening_events', 'id', 'SET NULL'],
  ['fk_biometrics_screener',     'biometric_results', 'screened_by',  'coaches',          'id', 'SET NULL'],
  ['fk_sessions_participant',    'coaching_sessions', 'participant_id','participants',    'id', 'CASCADE'],
  ['fk_sessions_coach',          'coaching_sessions', 'coach_id',     'coaches',          'id', 'SET NULL'],
  ['fk_notes_session',           'coaching_notes', 'session_id',      'coaching_sessions','id', 'CASCADE'],
  ['fk_notes_coach',             'coaching_notes', 'coach_id',        'coaches',          'id', 'SET NULL'],
  ['fk_goals_participant',       'goals', 'participant_id',           'participants',     'id', 'CASCADE'],
  ['fk_goals_coach',             'goals', 'coach_id',                 'coaches',          'id', 'SET NULL'],
  ['fk_availability_coach',      'coach_availability', 'coach_id',    'coaches',          'id', 'CASCADE'],
  ['fk_departments_location',    'departments', 'location_id',        'org_locations',    'id', 'CASCADE'],
  ['fk_event_reg_event',         'event_registrations', 'event_id',   'screening_events', 'id', 'CASCADE'],
  ['fk_event_reg_participant',   'event_registrations', 'participant_id','participants',  'id', 'CASCADE'],
  // Event container → per-location model. The Setup child tables are keyed by
  // location_id (event_locations), not event_id.
  ['fk_event_locations_event',   'event_locations', 'event_id',       'screening_events', 'id', 'CASCADE'],
  ['fk_event_hours_loc',         'event_business_hours', 'location_id', 'event_locations', 'id', 'CASCADE'],
  ['fk_event_slots_loc',         'event_availability_slots', 'location_id','event_locations','id','CASCADE'],
  ['fk_event_notif_loc',         'event_notification_recipients', 'location_id','event_locations','id','CASCADE'],
  // Forms
  ['fk_event_forms_event',       'event_forms', 'event_id',        'screening_events', 'id', 'CASCADE'],
  ['fk_event_forms_form',        'event_forms', 'form_id',         'forms',            'id', 'CASCADE'],
];

(async () => {
  const pool = await sql.connect(cfg);
  console.log('Connected to', cfg.database, 'on', cfg.server);

  // 1) tables + indexes from the .sql file, batch by GO
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sqlserver.sql'), 'utf8');
  const batches = ddl.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
  let made = 0;
  for (const b of batches) {
    try { await pool.request().batch(b); made++; }
    catch (e) { console.error('DDL batch failed:\n', b.slice(0, 120), '\n ->', e.message); }
  }
  console.log(`Ran ${made}/${batches.length} DDL batches.`);

  // 2) foreign keys with NO ACTION fallback
  const downgraded = [];
  for (const [name, tbl, col, rtbl, rcol, onDel] of FKS) {
    const exists = await pool.request().query(
      `SELECT 1 FROM sys.foreign_keys WHERE name='${name}'`
    );
    if (exists.recordset.length) continue;
    const ddlFk = act =>
      `ALTER TABLE dbo.${tbl} WITH NOCHECK ADD CONSTRAINT ${name} ` +
      `FOREIGN KEY (${col}) REFERENCES dbo.${rtbl}(${rcol}) ON DELETE ${act}`;
    try {
      await pool.request().batch(ddlFk(onDel));
    } catch (e) {
      if (/cascade|cycle|multiple/i.test(e.message) && onDel !== 'NO ACTION') {
        try { await pool.request().batch(ddlFk('NO ACTION')); downgraded.push(name); }
        catch (e2) { console.error(`FK ${name} failed:`, e2.message); }
      } else {
        console.error(`FK ${name} failed:`, e.message);
      }
    }
  }
  if (downgraded.length) console.log('FKs downgraded to NO ACTION (cascade-path limits):', downgraded.join(', '));

  // 3) report
  const t = await pool.request().query(
    "SELECT name FROM sys.tables WHERE name IN ('organizations','coaches','participants','screening_events','biometric_results','coaching_sessions','coaching_notes','goals','coach_availability','org_contacts','org_locations','departments','eligibility','health_tips','testimonials','content_library','system_settings','event_registrations','umbraco_content') ORDER BY name"
  );
  console.log(`\nApp tables present (${t.recordset.length}/19):`, t.recordset.map(r => r.name).join(', '));
  await pool.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
