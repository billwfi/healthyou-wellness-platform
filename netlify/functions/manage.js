const { getPool } = require('./_db');
const { ok, badRequest, notFound, serverError, options } = require('./_auth');
const { logActivity } = require('./_activity');

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
        `SELECT a.id, a.status, a.first_name, a.last_name, a.location_id, a.event_id,
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
      // All locations for this event (so a multi-location event can be rescheduled elsewhere).
      const locs = await db.query(
        `SELECT id, name, address, city, state, zip,
                CONVERT(varchar(10), valid_from, 23) AS valid_from,
                CONVERT(varchar(10), valid_to, 23)   AS valid_to
           FROM event_locations WHERE event_id=$1 ORDER BY sort_order, name`, [a.event_id]);
      for (const l of locs.rows) {
        const wd = await db.query('SELECT DISTINCT day_of_week FROM event_availability_slots WHERE location_id=$1 ORDER BY day_of_week', [l.id]);
        l.open_weekdays = wd.rows.map(x => x.day_of_week);
      }
      a.locations = locs.rows;
      a.open_weekdays = (locs.rows.find(l => l.id === a.location_id) || {}).open_weekdays || [];
      return ok(a);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { token, action } = b;
    if (!token || !action) return badRequest('token and action required');
    try {
      const r = await db.query('SELECT id, location_id, event_id FROM event_appointments WHERE magic_token=$1', [token]);
      if (!r.rows.length) return notFound();
      const appt = r.rows[0];

      if (action === 'cancel') {
        await db.query("UPDATE event_appointments SET status='cancelled' WHERE id=$1", [appt.id]);
        await logActivity(db, appt.id, 'cancelled', 'via manage link');
        return ok({ status: 'cancelled' });
      }
      if (action === 'reschedule') {
        const { appointment_date, appointment_time } = b;
        if (!appointment_date || !appointment_time) return badRequest('appointment_date and appointment_time required');
        // Allow moving to another location of the same event (multi-location events).
        let targetLoc = appt.location_id;
        if (b.location_id && Number(b.location_id) !== appt.location_id) {
          const lc = await db.query('SELECT id FROM event_locations WHERE id=$1 AND event_id=$2', [b.location_id, appt.event_id]);
          if (!lc.rows.length) return badRequest('That location is not part of this event');
          targetLoc = Number(b.location_id);
        }
        await db.withTransaction(async (q) => {
          const cap = await q(
            `SELECT (SELECT capacity FROM event_availability_slots
                      WHERE location_id=$1 AND day_of_week=$2 AND CONVERT(varchar(5),start_time,108)=$3) AS capacity,
                    (SELECT COUNT(*) FROM event_appointments
                      WHERE location_id=$1 AND appointment_date=$4 AND CONVERT(varchar(5),appointment_time,108)=$3
                        AND status='registered' AND id<>$5) AS booked`,
            [targetLoc, weekdayOf(appointment_date), appointment_time, appointment_date, appt.id]);
          const c = cap.rows[0] || {};
          if (c.capacity != null && c.booked >= c.capacity) throw new Error('That time slot is full');
          await q("UPDATE event_appointments SET location_id=$2, appointment_date=$3, appointment_time=$4, status='registered' WHERE id=$1",
            [appt.id, targetLoc, appointment_date, appointment_time]);
          return true;
        });
        await logActivity(db, appt.id, 'rescheduled', `to ${appointment_date} ${appointment_time}`);
        return ok({ status: 'rescheduled', location_id: targetLoc, appointment_date, appointment_time });
      }
      return badRequest('unknown action');
    } catch (e) {
      if (/slot is full/i.test(e.message)) return badRequest(e.message);
      return serverError(e);
    }
  }

  return badRequest('Method not supported');
};
