const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  // Public GET (booking page / dropdowns) — no auth required
  if (event.httpMethod === 'GET' && !event.queryStringParameters?.admin) {
    try {
      const r = await getPool().query(
        'SELECT id,name,bio,specialty,avatar_url,phone FROM coaches WHERE active=true ORDER BY name'
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
    const { name, email, bio, specialty, phone, avatar_url } = b;
    if (!name || !email) return badRequest('name and email required');
    if (avatar_url && avatar_url.length > 350000) return badRequest('Photo too large');
    try {
      const r = await db.query(
        `INSERT INTO coaches (name,email,bio,specialty,phone,avatar_url)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [name.trim(), email.trim().toLowerCase(), bio||null, specialty||null, phone||null, avatar_url||null]
      );
      return created(r.rows[0]);
    } catch (e) {
      if (e.code==='23505') return badRequest('Email already exists');
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
        `UPDATE coaches SET ${sets.join(',')} WHERE id=$1 RETURNING *`, params
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
