const { getPool } = require('./_db');
const { getUser, ok, unauthorized, serverError, options, badRequest } = require('./_auth');

// Calendar feed: registered public appointments grouped by date + event + location.
// Only dates/events/locations that actually have registered participants are returned,
// so the calendar naturally omits empty days and unregistered events.
//   GET /api/calendar  ->  [{ date, event_id, event_name, event_category,
//                             location_id, location_name, registered }]
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  if (event.httpMethod !== 'GET') return badRequest('Method not supported');

  const db = getPool();
  try {
    const r = await db.query(
      `SELECT CONVERT(varchar(10), a.appointment_date, 23) AS date,
              a.event_id, e.name AS event_name, e.event_category,
              a.location_id, l.name AS location_name,
              COUNT(*) AS registered
         FROM event_appointments a
         JOIN screening_events e ON e.id = a.event_id
         LEFT JOIN event_locations l ON l.id = a.location_id
        WHERE a.status = 'registered' AND a.appointment_date IS NOT NULL
        GROUP BY CONVERT(varchar(10), a.appointment_date, 23),
                 a.event_id, e.name, e.event_category, a.location_id, l.name
        ORDER BY date`);
    return ok(r.rows.map(x => ({ ...x, registered: parseInt(x.registered) })));
  } catch (e) { return serverError(e); }
};
