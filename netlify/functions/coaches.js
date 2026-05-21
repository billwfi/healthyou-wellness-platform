const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  // Public GET (for booking / participant-facing dropdowns)
  if (event.httpMethod === 'GET' && !event.queryStringParameters?.admin) {
    try {
      const r = await getPool().query(
        'SELECT id,name,bio,specialty,avatar_url FROM coaches WHERE active=true ORDER BY name'
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  const user = getUser(event, context);
  if (!user) return unauthorized();
  const db = getPool();

  if (event.httpMethod === 'GET') {
    try {
      const r = await db.query('SELECT * FROM coaches ORDER BY active DESC,name');
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { name, email, bio, specialty } = b;
    if (!name || !email) return badRequest('name and email required');
    try {
      const r = await db.query(
        'INSERT INTO coaches (name,email,bio,specialty) VALUES ($1,$2,$3,$4) RETURNING *',
        [name.trim(), email.trim().toLowerCase(), bio||null, specialty||null]
      );
      return created(r.rows[0]);
    } catch (e) {
      if (e.code==='23505') return badRequest('Email already exists');
      return serverError(e);
    }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, email, bio, specialty, active } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE coaches SET
           name=COALESCE($2,name), email=COALESCE($3,email),
           bio=COALESCE($4,bio), specialty=COALESCE($5,specialty),
           active=COALESCE($6,active)
         WHERE id=$1 RETURNING *`,
        [id, name||null, email?.toLowerCase()||null, bio||null, specialty||null, active??null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
