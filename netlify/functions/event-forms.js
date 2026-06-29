const { getPool, parseJson } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

// Forms assigned to a screening event (shown in order during registration).
//   GET /api/event-forms?event_id=  -> assigned forms (joined to forms, with schema)
//   PUT /api/event-forms  body { event_id, form_ids:[ordered] }  -> replace the set
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (!qs.event_id) return badRequest('event_id required');
    try {
      const r = await db.query(
        `SELECT f.id, f.name, f.description, f.schema_json, ef.sort_order
           FROM event_forms ef JOIN forms f ON f.id=ef.form_id
          WHERE ef.event_id=$1 ORDER BY ef.sort_order, f.name`, [qs.event_id]);
      return ok(parseJson(r.rows, ['schema_json']));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.event_id || !Array.isArray(b.form_ids)) return badRequest('event_id and form_ids[] required');
    try {
      await db.withTransaction(async (q) => {
        await q('DELETE FROM event_forms WHERE event_id=$1', [b.event_id]);
        let i = 0;
        for (const fid of b.form_ids) {
          await q('INSERT INTO event_forms (event_id, form_id, sort_order) VALUES ($1,$2,$3)', [b.event_id, fid, i++]);
        }
      });
      const r = await db.query(
        `SELECT f.id, f.name FROM event_forms ef JOIN forms f ON f.id=ef.form_id
          WHERE ef.event_id=$1 ORDER BY ef.sort_order`, [b.event_id]);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
