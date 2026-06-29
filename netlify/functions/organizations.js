const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();

  if (event.httpMethod === 'GET') {
    try {
      const r = await db.query('SELECT * FROM organizations ORDER BY active DESC, name');
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { name, slug, contact_name, contact_email } = b;
    if (!name || !slug) return badRequest('name and slug are required');
    try {
      const r = await db.query(
        'INSERT INTO organizations (name,slug,contact_name,contact_email) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4)',
        [name, slug.toLowerCase().replace(/\s+/g,'-'), contact_name||null, contact_email||null]
      );
      return created(r.rows[0]);
    } catch (e) {
      if (e.number===2627 || e.number===2601) return badRequest('Slug already exists');
      return serverError(e);
    }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, contact_name, contact_email, active } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE organizations SET
           name=COALESCE($2,name), contact_name=COALESCE($3,contact_name),
           contact_email=COALESCE($4,contact_email), active=COALESCE($5,active)
         OUTPUT INSERTED.*
         WHERE id=$1`,
        [id, name||null, contact_name||null, contact_email||null, active??null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
