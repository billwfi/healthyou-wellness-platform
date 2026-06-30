const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, serverError, options } = require('./_auth');

// Extensible list of event categories (Screening Event, Flu Clinic, Lunch & Learn …)
// used to populate the Event Type dropdown on screening events.
//   GET  /api/event-categories   -> list active, ordered
//   POST /api/event-categories   -> add one on the fly (name required; idempotent by name)
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();

  if (event.httpMethod === 'GET') {
    try {
      const r = await db.query('SELECT id, name, sort_order FROM event_categories WHERE active=1 ORDER BY sort_order, name');
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const name = (b.name || '').trim();
    if (!name) return badRequest('name is required');
    try {
      const existing = await db.query('SELECT id, name, sort_order FROM event_categories WHERE name=$1', [name]);
      if (existing.rows.length) return ok(existing.rows[0]); // already exists → return it
      const r = await db.query(
        `INSERT INTO event_categories (name, sort_order)
         OUTPUT INSERTED.id, INSERTED.name, INSERTED.sort_order
         VALUES ($1, (SELECT ISNULL(MAX(sort_order),0)+1 FROM event_categories))`, [name]);
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
