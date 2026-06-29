const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (!qs.org_id) return badRequest('org_id required');
    try {
      const r = await db.query(
        'SELECT * FROM org_contacts WHERE org_id=$1 ORDER BY role, name',
        [qs.org_id]
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { org_id, name, title, email, phone, role } = b;
    if (!org_id || !name) return badRequest('org_id and name required');
    try {
      const r = await db.query(
        `INSERT INTO org_contacts (org_id, name, title, email, phone, role)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6)`,
        [org_id, name, title || null, email || null, phone || null, role || 'contact']
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, title, email, phone, role, active } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE org_contacts SET
           name=COALESCE($2,name), title=COALESCE($3,title),
           email=COALESCE($4,email), phone=COALESCE($5,phone),
           role=COALESCE($6,role), active=COALESCE($7,active)
         OUTPUT INSERTED.*
         WHERE id=$1`,
        [id, name || null, title || null, email || null, phone || null, role || null, active ?? null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    const id = qs.id;
    if (!id) return badRequest('id required');
    try {
      await db.query('DELETE FROM org_contacts WHERE id=$1', [id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
