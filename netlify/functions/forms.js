const { getPool, parseJson } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Reusable forms built in the admin and assigned to events (filled during public
// registration). schema_json = { fields: [{ key, type, label, required, options }] }.
//   GET    /api/forms            -> list   (?id= one, ?active=1 to filter)
//   POST   /api/forms            -> create (name required)
//   PUT    /api/forms            -> edit   (id required)
//   DELETE /api/forms?id=        -> delete
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      if (qs.id) {
        const r = await db.query('SELECT * FROM forms WHERE id=$1', [qs.id]);
        if (!r.rows.length) return notFound();
        return ok(parseJson(r.rows[0], ['schema_json']));
      }
      const r = qs.active
        ? await db.query('SELECT * FROM forms WHERE active=1 ORDER BY name')
        : await db.query('SELECT * FROM forms ORDER BY active DESC, name');
      return ok(parseJson(r.rows, ['schema_json']));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.name) return badRequest('name is required');
    const schema = typeof b.schema_json === 'object' ? JSON.stringify(b.schema_json) : (b.schema_json || '{"fields":[]}');
    try {
      const r = await db.query(
        `INSERT INTO forms (name, description, schema_json, active)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4)`,
        [b.name, b.description || null, schema, b.active === false ? 0 : 1]);
      return created(parseJson(r.rows[0], ['schema_json']));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.id) return badRequest('id required');
    const schema = b.schema_json == null ? null
      : (typeof b.schema_json === 'object' ? JSON.stringify(b.schema_json) : b.schema_json);
    try {
      const r = await db.query(
        `UPDATE forms SET
           name=COALESCE($2,name), description=COALESCE($3,description),
           schema_json=COALESCE($4,schema_json), active=COALESCE($5,active),
           updated_at=SYSUTCDATETIME()
         OUTPUT INSERTED.* WHERE id=$1`,
        [b.id, b.name || null, b.description ?? null, schema,
         (b.active === undefined ? null : (b.active ? 1 : 0))]);
      if (!r.rows.length) return notFound();
      return ok(parseJson(r.rows[0], ['schema_json']));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return badRequest('id required');
    try {
      await db.query('DELETE FROM forms WHERE id=$1', [qs.id]); // cascades event_forms links
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
