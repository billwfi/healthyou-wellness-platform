const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Admin: view/edit a single public appointment on behalf of a registrant.
//   GET /api/appointment?id=N   -> appointment + event + that event's locations
//   PUT /api/appointment        -> { id, first_name, last_name, email, phone,
//                                    date_of_birth, gender, location_id,
//                                    appointment_date, appointment_time, status }
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (!qs.id) return badRequest('id required');
    try {
      const r = await db.query(
        `SELECT a.id, a.event_id, a.location_id, a.first_name, a.last_name, a.email, a.phone,
                a.status, a.gender, a.magic_token,
                CONVERT(varchar(10), a.date_of_birth, 23)    AS date_of_birth,
                CONVERT(varchar(10), a.appointment_date, 23) AS appointment_date,
                CONVERT(varchar(5),  a.appointment_time, 108) AS appointment_time,
                e.name AS event_name
           FROM event_appointments a JOIN screening_events e ON e.id=a.event_id
          WHERE a.id=$1`, [qs.id]);
      if (!r.rows.length) return notFound();
      const a = r.rows[0];
      const locs = await db.query(
        `SELECT id, name, address, city, state,
                CONVERT(varchar(10), valid_from, 23) AS valid_from,
                CONVERT(varchar(10), valid_to, 23)   AS valid_to
           FROM event_locations WHERE event_id=$1 ORDER BY sort_order, name`, [a.event_id]);
      for (const l of locs.rows) {
        const wd = await db.query('SELECT DISTINCT day_of_week FROM event_availability_slots WHERE location_id=$1 ORDER BY day_of_week', [l.id]);
        l.open_weekdays = wd.rows.map(x => x.day_of_week);
      }
      a.locations = locs.rows;
      return ok(a);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.id) return badRequest('id required');
    if (!b.first_name || !b.last_name) return badRequest('First and last name are required');
    try {
      // If a location is provided, ensure it belongs to this appointment's event.
      if (b.location_id) {
        const lc = await db.query(
          'SELECT 1 FROM event_locations WHERE id=$1 AND event_id=(SELECT event_id FROM event_appointments WHERE id=$2)',
          [b.location_id, b.id]);
        if (!lc.rows.length) return badRequest('That location is not part of this event');
      }
      const r = await db.query(
        `UPDATE event_appointments SET
            first_name=$2, last_name=$3, email=$4, phone=$5,
            date_of_birth=$6, gender=$7,
            location_id=COALESCE($8,location_id),
            appointment_date=COALESCE($9,appointment_date),
            appointment_time=COALESCE($10,appointment_time),
            status=COALESCE($11,status)
          OUTPUT INSERTED.id
          WHERE id=$1`,
        [b.id, b.first_name.trim(), b.last_name.trim(), b.email || null, b.phone || null,
         b.date_of_birth || null, b.gender || null, b.location_id || null,
         b.appointment_date || null, b.appointment_time || null, b.status || null]);
      if (!r.rows.length) return notFound();
      return ok({ saved: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
