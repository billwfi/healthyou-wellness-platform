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
        `SELECT l.*,
                COUNT(d.id) FILTER (WHERE d.active=true) AS department_count
           FROM org_locations l
           LEFT JOIN departments d ON d.location_id = l.id
          WHERE l.org_id=$1
          GROUP BY l.id
          ORDER BY l.name`,
        [qs.org_id]
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { org_id, name, address, city, state, zip, phone, location_type } = b;
    if (!org_id || !name) return badRequest('org_id and name required');
    try {
      const r = await db.query(
        `INSERT INTO org_locations (org_id, name, address, city, state, zip, phone, location_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [org_id, name, address || null, city || null, state || null,
         zip || null, phone || null, location_type || 'office']
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, address, city, state, zip, phone, location_type, active } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE org_locations SET
           name=COALESCE($2,name), address=COALESCE($3,address),
           city=COALESCE($4,city), state=COALESCE($5,state),
           zip=COALESCE($6,zip), phone=COALESCE($7,phone),
           location_type=COALESCE($8,location_type), active=COALESCE($9,active)
         WHERE id=$1 RETURNING *`,
        [id, name || null, address || null, city || null, state || null,
         zip || null, phone || null, location_type || null, active ?? null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    const id = qs.id;
    if (!id) return badRequest('id required');
    try {
      await db.query('DELETE FROM org_locations WHERE id=$1', [id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
