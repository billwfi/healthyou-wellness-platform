const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Locations belonging to a screening-event container. Each location carries its
// own AppointmentQuest Setup (managed via /api/event-setup?location_id=...).
//   GET    /api/event-locations?event_id=  -> list
//   GET    /api/event-locations?id=        -> one
//   POST   /api/event-locations            -> add (event_id + name required)
//   PUT    /api/event-locations            -> edit (id required)
//   DELETE /api/event-locations?id=        -> remove (cascades hours/slots/recipients)
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      if (qs.id) {
        const r = await db.query('SELECT * FROM event_locations WHERE id=$1', [qs.id]);
        return r.rows.length ? ok(r.rows[0]) : notFound();
      }
      if (!qs.event_id) return badRequest('event_id or id required');
      const r = await db.query(
        'SELECT * FROM event_locations WHERE event_id=$1 ORDER BY sort_order, name', [qs.event_id]);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { event_id, name, address, city, state, zip, phone, max_participants, sort_order } = b;
    if (!event_id || !name) return badRequest('event_id and name required');
    try {
      const r = await db.query(
        `INSERT INTO event_locations (event_id, name, address, city, state, zip, phone, max_participants, sort_order)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [event_id, name, address || null, city || null, state || null, zip || null,
         phone || null, max_participants ?? null, sort_order ?? 0]
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, address, city, state, zip, phone, max_participants, sort_order } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE event_locations SET
           name=COALESCE($2,name), address=COALESCE($3,address), city=COALESCE($4,city),
           state=COALESCE($5,state), zip=COALESCE($6,zip), phone=COALESCE($7,phone),
           max_participants=COALESCE($8,max_participants), sort_order=COALESCE($9,sort_order)
         OUTPUT INSERTED.* WHERE id=$1`,
        [id, name || null, address || null, city || null, state || null, zip || null,
         phone || null, max_participants ?? null, sort_order ?? null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return badRequest('id required');
    try {
      await db.query('DELETE FROM event_locations WHERE id=$1', [qs.id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
