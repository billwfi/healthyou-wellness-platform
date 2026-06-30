// Application user management (admin Settings → User Management).
// Stores app users with a role, assignable left-nav categories, and portal access.
//   GET    /api/users           -> list
//   POST   /api/users           -> create
//   PUT    /api/users           -> update (id required)
//   DELETE /api/users?id=N      -> delete
const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

const ROLES = ['Admin', 'User', 'Health Coach'];

function clean(b) {
  return {
    first_name: (b.first_name || '').toString().trim().slice(0, 100) || null,
    last_name:  (b.last_name  || '').toString().trim().slice(0, 100) || null,
    phone:      (b.phone      || '').toString().trim().slice(0, 40)  || null,
    email:      (b.email      || '').toString().trim().slice(0, 256) || null,
    role:       ROLES.includes(b.role) ? b.role : 'User',
    nav_categories: JSON.stringify(Array.isArray(b.nav_categories) ? b.nav_categories : []),
    coach_portal:    b.coach_portal ? 1 : 0,
    screener_portal: b.screener_portal ? 1 : 0,
    active: (b.active === undefined || b.active) ? 1 : 0,
  };
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      const r = await db.query(
        `SELECT id, first_name, last_name, phone, email, role, nav_categories,
                coach_portal, screener_portal, active,
                CONVERT(varchar(33), created_at, 126) AS created_at
           FROM app_users ORDER BY last_name, first_name`);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!(b.first_name || '').trim() || !(b.last_name || '').trim()) return badRequest('First and last name are required');
    const c = clean(b);
    try {
      const r = await db.query(
        `INSERT INTO app_users (first_name, last_name, phone, email, role, nav_categories, coach_portal, screener_portal, active)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [c.first_name, c.last_name, c.phone, c.email, c.role, c.nav_categories, c.coach_portal, c.screener_portal, c.active]);
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.id) return badRequest('id required');
    const c = clean(b);
    try {
      const r = await db.query(
        `UPDATE app_users SET first_name=$2, last_name=$3, phone=$4, email=$5, role=$6,
                nav_categories=$7, coach_portal=$8, screener_portal=$9, active=$10
         OUTPUT INSERTED.* WHERE id=$1`,
        [b.id, c.first_name, c.last_name, c.phone, c.email, c.role, c.nav_categories, c.coach_portal, c.screener_portal, c.active]);
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return badRequest('id required');
    try {
      await db.query('DELETE FROM app_users WHERE id=$1', [qs.id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
