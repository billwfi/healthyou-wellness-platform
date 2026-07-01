const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Employer "Groups", sourced from iStrata.dbo.is_groups (a separate database on
// the same server, reached via the 3-part name). Replaces the old local
// organizations table. Add + edit only (no delete).
//
// GET  /api/groups            -> list (also ?id=N for one)
// POST /api/groups            -> add   (name + status required)
// PUT  /api/groups            -> edit  (id required; COALESCE per field)

// friendly body key -> iStrata column
const COLS = {
  name: 'GroupName', slug: 'GroupId', onbase_objectid: 'onbase_objectid',
  address1: 'Address1', address2: 'Address2',
  city: 'City', state: 'State', zip: 'ZipCode', phone: 'PhoneNumber', email: 'EmailAddresses',
  effective_date: 'EffectiveDate', status: 'GroupStatus', pepm_rate: 'PEPMRate',
  op_group_code: 'OPGroupCode', group_structure: 'GroupStructure', group_tax_id: 'GroupTaxID',
  industry: 'Industry', selecthealth_group_id: 'SelectHealthGroupID',
  insurance_group_number: 'InsuranceGroupNumber', insurance_policy_number: 'InsurancePolicyNumber',
};

const SELECT = `
  SELECT id,
         GroupName AS name, GroupId AS slug,
         Address1 AS address1, Address2 AS address2,
         City AS city, State AS state, ZipCode AS zip,
         PhoneNumber AS phone, EmailAddresses AS email,
         CONVERT(varchar(10), EffectiveDate, 23) AS effective_date,
         GroupStatus AS status,
         CAST(CASE WHEN GroupStatus='Active' THEN 1 ELSE 0 END AS BIT) AS active,
         PEPMRate AS pepm_rate, OPGroupCode AS op_group_code,
         GroupStructure AS group_structure, GroupTaxID AS group_tax_id,
         Industry AS industry, SelectHealthGroupID AS selecthealth_group_id,
         InsuranceGroupNumber AS insurance_group_number,
         InsurancePolicyNumber AS insurance_policy_number,
         gc.color AS color
    FROM iStrata.dbo.is_groups
    LEFT JOIN dbo.group_colors gc ON gc.group_id = is_groups.id`;

async function readOne(db, id) {
  const r = await db.query(`${SELECT} WHERE id=$1`, [id]);
  return r.rows[0] || null;
}

// Upsert (or clear) a group's display color in the local group_colors table.
async function setColor(db, groupId, color) {
  const c = (color || '').toString().trim();
  if (!c) { await db.query('DELETE FROM dbo.group_colors WHERE group_id=$1', [groupId]); return; }
  await db.query(
    `MERGE dbo.group_colors AS t USING (SELECT $1 AS group_id) AS s ON t.group_id=s.group_id
     WHEN MATCHED THEN UPDATE SET color=$2, updated_at=SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (group_id, color, updated_at) VALUES ($1, $2, SYSUTCDATETIME());`,
    [groupId, c.slice(0, 20)]);
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      if (qs.id) {
        const g = await readOne(db, qs.id);
        return g ? ok(g) : notFound();
      }
      const r = await db.query(`${SELECT} ORDER BY GroupName`);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.name) return badRequest('name (GroupName) is required');
    if (!b.status) b.status = 'Active';
    const keys = Object.keys(COLS).filter(k => k in b);
    try {
      const cols = keys.map(k => COLS[k]);
      const vals = keys.map((_, i) => `$${i + 1}`);
      // onbase_objectid is UNIQUE on is_groups (an OnBase ref). When the admin
      // doesn't supply one, assign a negative sentinel — unique, and outside
      // OnBase's positive id range so it never collides.
      if (!('onbase_objectid' in b)) {
        cols.push('onbase_objectid');
        vals.push('(SELECT COALESCE(MIN(onbase_objectid),0)-1 FROM iStrata.dbo.is_groups WHERE onbase_objectid<0)');
      }
      const ins = await db.query(
        `INSERT INTO iStrata.dbo.is_groups (${cols.join(',')}, created_at, updated_at)
         OUTPUT INSERTED.id VALUES (${vals.join(',')}, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        keys.map(k => b[k]));
      if ('color' in b) await setColor(db, ins.rows[0].id, b.color);
      return created(await readOne(db, ins.rows[0].id));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.id) return badRequest('id required');
    const keys = Object.keys(COLS).filter(k => k in b);
    const hasColor = 'color' in b;
    if (!keys.length && !hasColor) return badRequest('no fields to update');
    try {
      if (keys.length) {
        const sets = keys.map((k, i) => `${COLS[k]}=COALESCE($${i + 2}, ${COLS[k]})`).join(', ');
        const params = [b.id, ...keys.map(k => b[k])];
        const r = await db.query(
          `UPDATE iStrata.dbo.is_groups SET ${sets}, updated_at=SYSUTCDATETIME() WHERE id=$1`, params);
        if (!r.rowCount) return notFound();
      }
      if (hasColor) await setColor(db, b.id, b.color);
      return ok(await readOne(db, b.id));
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
