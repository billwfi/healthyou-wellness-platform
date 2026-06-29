const { getPool } = require('./_db');
const { ok, badRequest, notFound, serverError, options } = require('./_auth');

// PUBLIC magic-link management of an appointment (no password).
//   GET  /api/manage?t=TOKEN                                   -> appointment + location info
//   POST /api/manage { token, action:'cancel' }               -> cancel
//   POST /api/manage { token, action:'reschedule', appointment_date, appointment_time }
function weekdayOf(d) { const [y, m, dd] = String(d).split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const t = qs.t;
    if (!t) return badRequest('token required');
    try {
      const r = await db.query(
        `SELECT a.id, a.status, a.first_name, a.last_name, a.location_id,
                CONVERT(varchar(10), a.appointment_date, 23) AS appointment_date,
                CONVERT(varchar(5),  a.appointment_time, 108) AS appointment_time,
                e.name AS event_name, e.public_slug,
                l.name AS location_name, l.address, l.city, l.state, l.zip,
                CONVERT(varchar(10), l.valid_from, 23) AS valid_from,
                CONVERT(varchar(10), l.valid_to, 23)   AS valid_to,
                e2.start_date AS ev_start, e2.end_date AS ev_end
           FROM event_appointments a
           JOIN screening_events e  ON e.id=a.event_id
           JOIN event_locations  l  ON l.id=a.location_id
           CROSS APPLY (SELECT CONVERT(varchar(10), start_date, 23) AS start_date, CONVERT(varchar(10), end_date, 23) AS end_date FROM screening_events WHERE id=a.event_id) e2
          WHERE a.magic_token=$1`, [t]);
      if (!r.rows.length) return notFound();
      const a = r.rows[0];
      const wd = await db.query('SELECT DISTINCT day_of_week FROM event_availability_slots WHERE location_id=$1 ORDER BY day_of_week', [a.location_id]);
      a.open_weekdays = wd.rows.map(x => x.day_of_week);
      return ok(a);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { token, action } = b;
    if (!token || !action) return badRequest('token and action required');
    try {
      const r = await db.query('SELECT id, location_id FROM event_appointments WHERE magic_token=$1', [token]);
      if (!r.rows.length) return notFound();
      const appt = r.rows[0];

      if (action === 'cancel') {
        await db.query("UPDATE event_appointments SET status='cancelled' WHERE id=$1", [appt.id]);
        return ok({ status: 'cancelled' });
      }
      if (action === 'reschedule') {
        const { appointment_date, appointment_time } = b;
        if (!appointment_date || !appointment_time) return badRequest('appointment_date and appointment_time required');
        const upd = await db.withTransaction(async (q) => {
          const cap = await q(
            `SELECT (SELECT capacity FROM event_availability_slots
                      WHERE location_id=$1 AND day_of_week=$2 AND CONVERT(varchar(5),start_time,108)=$3) AS capacity,
                    (SELECT COUNT(*) FROM event_appointments
                      WHERE location_id=$1 AND appointment_date=$4 AND CONVERT(varchar(5),appointment_time,108)=$3
                        AND status='registered' AND id<>$5) AS booked`,
            [appt.location_id, weekdayOf(appointment_date), appointment_time, appointment_date, appt.id]);
          const c = cap.rows[0] || {};
          if (c.capacity != null && c.booked >= c.capacity) throw new Error('That time slot is full');
          await q("UPDATE event_appointments SET appointment_date=$2, appointment_time=$3, status='registered' WHERE id=$1",
            [appt.id, appointment_date, appointment_time]);
          return true;
        });
        return ok({ status: 'rescheduled', appointment_date, appointment_time });
      }
      return badRequest('unknown action');
    } catch (e) {
      if (/slot is full/i.test(e.message)) return badRequest(e.message);
      return serverError(e);
    }
  }

  return badRequest('Method not supported');
};
