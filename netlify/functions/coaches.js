const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Replace a coach's group assignments with the given set of is_groups ids.
async function setCoachGroups(db, coachId, groupIds) {
  await db.query('DELETE FROM coach_groups WHERE coach_id=$1', [coachId]);
  const ids = [...new Set((groupIds || []).map(n => parseInt(n, 10)).filter(Number.isInteger))];
  for (const gid of ids) {
    await db.query('INSERT INTO coach_groups (coach_id, group_id) VALUES ($1,$2)', [coachId, gid]);
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  // Public GET (booking page / dropdowns) — no auth required
  if (event.httpMethod === 'GET' && !event.queryStringParameters?.admin) {
    const groupId = event.queryStringParameters?.group_id;
    try {
      // ?group_id=N -> only coaches assigned to that group (booking step 2).
      const r = groupId
        ? await getPool().query(
            `SELECT c.id,c.name,c.bio,c.specialty,c.avatar_url,c.phone
               FROM coaches c JOIN coach_groups cg ON cg.coach_id = c.id
              WHERE cg.group_id = $1 AND c.active = 1 ORDER BY c.name`, [groupId])
        : await getPool().query(
            'SELECT id,name,bio,specialty,avatar_url,phone FROM coaches WHERE active=1 ORDER BY name');
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  const user = getUser(event, context);
  if (!user) return unauthorized();
  const db = getPool();

  if (event.httpMethod === 'GET') {
    try {
      const r = await db.query('SELECT * FROM coaches ORDER BY active DESC,name');
      // Attach assigned groups (name from the iStrata group table).
      const cg = await db.query(
        `SELECT cg.coach_id, cg.group_id, g.GroupName AS name
           FROM coach_groups cg JOIN iStrata.dbo.is_groups g ON g.id = cg.group_id`);
      const byCoach = {};
      for (const row of cg.rows) (byCoach[row.coach_id] ||= []).push({ id: row.group_id, name: row.name });
      for (const c of r.rows) c.groups = byCoach[c.id] || [];
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { name, email, bio, specialty, phone, avatar_url } = b;
    if (!name || !email) return badRequest('name and email required');
    if (avatar_url && avatar_url.length > 350000) return badRequest('Photo too large');
    try {
      const r = await db.query(
        `INSERT INTO coaches (name,email,bio,specialty,phone,avatar_url)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6)`,
        [name.trim(), email.trim().toLowerCase(), bio||null, specialty||null, phone||null, avatar_url||null]
      );
      if (Array.isArray(b.group_ids)) await setCoachGroups(db, r.rows[0].id, b.group_ids);
      return created(r.rows[0]);
    } catch (e) {
      if (e.number===2627 || e.number===2601) return badRequest('Email already exists');
      return serverError(e);
    }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, email, bio, specialty, active, phone } = b;
    if (!id) return badRequest('id required');
    // avatar_url is handled separately — only updated if explicitly present in body
    const hasAvatar = 'avatar_url' in b;
    if (hasAvatar && b.avatar_url && b.avatar_url.length > 350000) return badRequest('Photo too large');
    try {
      const sets = [
        'name=COALESCE($2,name)',
        'email=COALESCE($3,email)',
        'bio=COALESCE($4,bio)',
        'specialty=COALESCE($5,specialty)',
        'active=COALESCE($6,active)',
        'phone=COALESCE($7,phone)',
      ];
      const params = [id, name||null, email?.toLowerCase()||null, bio||null, specialty||null, active??null, phone||null];
      if (hasAvatar) {
        sets.push(`avatar_url=$${params.length + 1}`);
        params.push(b.avatar_url ?? null);
      }
      const r = await db.query(
        `UPDATE coaches SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=$1`, params
      );
      if (!r.rows.length) return notFound();
      if (Array.isArray(b.group_ids)) await setCoachGroups(db, id, b.group_ids);
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
