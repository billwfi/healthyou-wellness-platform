const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (!qs.location_id) return badRequest('location_id required');
    try {
      const r = await db.query(
        'SELECT * FROM departments WHERE location_id=$1 ORDER BY name',
        [qs.location_id]
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { location_id, name, code } = b;
    if (!location_id || !name) return badRequest('location_id and name required');
    try {
      const r = await db.query(
        `INSERT INTO departments (location_id, name, code)
         OUTPUT INSERTED.* VALUES ($1,$2,$3)`,
        [location_id, name, code || null]
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, code, active } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE departments SET
           name=COALESCE($2,name), code=COALESCE($3,code),
           active=COALESCE($4,active)
         OUTPUT INSERTED.*
         WHERE id=$1`,
        [id, name || null, code || null, active ?? null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    const id = qs.id;
    if (!id) return badRequest('id required');
    try {
      await db.query('DELETE FROM departments WHERE id=$1', [id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
