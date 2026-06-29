#!/usr/bin/env node
// One-time migration: switch the app from the local dbo.organizations table to
// iStrata.dbo.is_groups as the source of employer "Groups".
//   1) Drop the 5 cross-table FKs to organizations (cross-DB FKs are impossible).
//   2) Add "City of Colorado Springs" to iStrata.dbo.is_groups (the one local org
//      with no iStrata match) and capture its new id.
//   3) Remap existing links (org_id = 1 -> new group id) on participants,
//      screening_events, org_contacts, org_locations, eligibility.
// Idempotent: re-running drops already-dropped FKs harmlessly, reuses the City
// group if it already exists, and remaps nothing once org_id=1 rows are gone.
//
// Usage: MSSQL_HOST=... MSSQL_USER=... MSSQL_PASSWORD=... MSSQL_DATABASE=hy_datawarehouse \
//        node scripts/migrate-orgs-to-groups.js
const sql = require('mssql');

const cfg = {
  server: process.env.MSSQL_HOST, user: process.env.MSSQL_USER, password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE || 'hy_datawarehouse', port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true }, requestTimeout: 60000,
};
const FKS = [
  ['participants', 'fk_participants_org'],
  ['screening_events', 'fk_events_org'],
  ['org_contacts', 'fk_contacts_org'],
  ['org_locations', 'fk_locations_org'],
  ['eligibility', 'fk_eligibility_org'],
];
const LINK_TABLES = ['participants', 'screening_events', 'org_contacts', 'org_locations', 'eligibility'];
const OLD_ORG_ID = 1;          // local dbo.organizations id for City of Colorado Springs
const CITY_GROUPID = 'CITYCOS'; // iStrata GroupId used to find/insert the City group

(async () => {
  const pool = await sql.connect(cfg);
  console.log('Connected to', cfg.database, '\n');

  // 1) drop FKs
  for (const [tbl, fk] of FKS) {
    await pool.request().batch(
      `IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${fk}') ALTER TABLE dbo.${tbl} DROP CONSTRAINT ${fk};`);
    console.log('dropped FK if present:', fk);
  }

  // 2) ensure City of Colorado Springs exists in iStrata
  let g = await pool.request().query(
    `SELECT id FROM iStrata.dbo.is_groups WHERE GroupId='${CITY_GROUPID}' OR GroupName='City of Colorado Springs'`);
  let groupId;
  if (g.recordset.length) {
    groupId = g.recordset[0].id;
    console.log('\nCity group already in iStrata, id =', groupId);
  } else {
    const ins = await pool.request().query(
      `INSERT INTO iStrata.dbo.is_groups (GroupName, GroupId, City, State, GroupStatus, created_at, updated_at)
       OUTPUT INSERTED.id
       VALUES ('City of Colorado Springs', '${CITY_GROUPID}', 'Colorado Springs', 'CO', 'Active', SYSUTCDATETIME(), SYSUTCDATETIME())`);
    groupId = ins.recordset[0].id;
    console.log('\nInserted City of Colorado Springs into iStrata.dbo.is_groups, new id =', groupId, '(first cross-DB write OK)');
  }

  // 3) remap existing links org_id = OLD_ORG_ID -> groupId
  console.log('\nRemapping org_id', OLD_ORG_ID, '->', groupId);
  for (const tbl of LINK_TABLES) {
    const r = await pool.request()
      .input('g', sql.Int, groupId).input('old', sql.Int, OLD_ORG_ID)
      .query(`UPDATE dbo.${tbl} SET org_id=@g WHERE org_id=@old`);
    console.log(`  ${tbl}: ${r.rowsAffected[0]} row(s) remapped`);
  }

  // verify
  const chk = await pool.request().query(
    `SELECT p.id, p.first_name, p.last_name, o.GroupName AS group_name
       FROM dbo.participants p LEFT JOIN iStrata.dbo.is_groups o ON o.id=p.org_id
      WHERE p.org_id=${groupId} ORDER BY p.id`);
  console.log('\nParticipants now linked to the City group:');
  chk.recordset.forEach(r => console.log(`  #${r.id} ${r.first_name} ${r.last_name} -> ${r.group_name}`));

  await pool.close();
  console.log('\nDone.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
