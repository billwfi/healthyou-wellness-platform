const { getPool, parseJson, sql } = require('./_db');
const { ok, badRequest, notFound, serverError, options } = require('./_auth');
const { sendAppointmentConfirmation } = require('./_confirmation');
const { logActivity } = require('./_activity');
const crypto = require('crypto');

// PUBLIC (no auth) multi-step registration backend.
//   GET  /api/event-register?slug=SLUG              -> event + locations + forms
//   GET  /api/event-register?location_id=&date=     -> available time slots
//   POST /api/event-register                        -> book an appointment
function weekdayOf(dateStr) {            // 0=Sun … 6=Sat, matches day_of_week
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

async function availableSlots(db, locationId, date) {
  const wd = weekdayOf(date);
  const [slots, booked] = await Promise.all([
    db.query(`SELECT CONVERT(varchar(5), start_time, 108) AS time, capacity
                FROM event_availability_slots WHERE location_id=$1 AND day_of_week=$2
               ORDER BY start_time`, [locationId, wd]),
    db.query(`SELECT CONVERT(varchar(5), appointment_time, 108) AS time, COUNT(*) AS n
                FROM event_appointments
               WHERE location_id=$1 AND appointment_date=$2 AND status='registered'
               GROUP BY appointment_time`, [locationId, date]),
  ]);
  const bmap = {}; booked.rows.forEach(b => { bmap[b.time] = b.n; });
  return slots.rows.map(s => {
    const used = bmap[s.time] || 0;
    return { time: s.time, capacity: s.capacity, remaining: Math.max(0, (s.capacity || 0) - used) };
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      // available slots for a location + date
      if (qs.location_id && qs.date) {
        return ok(await availableSlots(db, qs.location_id, qs.date));
      }
      // full event payload by public slug
      if (!qs.slug) return badRequest('slug required');
      const ev = await db.query(
        `SELECT id, name, description,
                CONVERT(varchar(10), start_date, 23) AS start_date,
                CONVERT(varchar(10), end_date, 23)   AS end_date, org_id, public_slug
           FROM screening_events WHERE public_slug=$1`, [qs.slug]);
      if (!ev.rows.length) return notFound();
      const e = ev.rows[0];
      const grp = e.org_id
        ? await db.query('SELECT GroupName AS name FROM iStrata.dbo.is_groups WHERE id=$1', [e.org_id])
        : { rows: [] };
      const locs = await db.query(
        `SELECT id, name, address, city, state, zip, phone,
                CONVERT(varchar(10), valid_from, 23) AS valid_from,
                CONVERT(varchar(10), valid_to, 23)   AS valid_to,
                appointment_interval_min, service_duration_min
           FROM event_locations WHERE event_id=$1 ORDER BY sort_order, name`, [e.id]);
      for (const l of locs.rows) {
        const wd = await db.query(
          'SELECT DISTINCT day_of_week FROM event_availability_slots WHERE location_id=$1 ORDER BY day_of_week', [l.id]);
        l.open_weekdays = wd.rows.map(r => r.day_of_week);
      }
      const forms = await db.query(
        `SELECT f.id, f.name, f.body_html, f.requires_ack, f.schema_json FROM event_forms ef JOIN forms f ON f.id=ef.form_id
          WHERE ef.event_id=$1 AND f.active=1 ORDER BY ef.sort_order, f.name`, [e.id]);
      parseJson(forms.rows, ['schema_json']);
      return ok({ event: e, group_name: grp.rows[0]?.name || null, locations: locs.rows, forms: forms.rows });
    } catch (err) { return serverError(err); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { slug, location_id, appointment_date, appointment_time, first_name, last_name, email, phone, date_of_birth, gender } = b;
    if (!slug || !location_id || !appointment_date || !appointment_time || !first_name || !last_name)
      return badRequest('slug, location, date, time, first and last name are required');
    try {
      const ev = await db.query('SELECT id FROM screening_events WHERE public_slug=$1', [slug]);
      if (!ev.rows.length) return notFound();
      const eventId = ev.rows[0].id;
      const token = crypto.randomBytes(24).toString('hex');

      const apptId = await db.withTransaction(async (q) => {
        // capacity guard (re-check inside the transaction)
        const cap = await q(
          `SELECT (SELECT capacity FROM event_availability_slots
                    WHERE location_id=$1 AND day_of_week=$2 AND CONVERT(varchar(5),start_time,108)=$3) AS capacity,
                  (SELECT COUNT(*) FROM event_appointments
                    WHERE location_id=$1 AND appointment_date=$4 AND CONVERT(varchar(5),appointment_time,108)=$3
                      AND status='registered') AS booked`,
          [location_id, weekdayOf(appointment_date), appointment_time, appointment_date]);
        const row = cap.rows[0] || {};
        if (row.capacity != null && row.booked >= row.capacity) throw new Error('That time slot is full');

        const ins = await q(
          `INSERT INTO event_appointments
             (event_id, location_id, first_name, last_name, email, phone, date_of_birth, gender, appointment_date, appointment_time, magic_token)
           OUTPUT INSERTED.id VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [eventId, location_id, first_name, last_name, email || null, phone || null,
           date_of_birth || null, gender || null, appointment_date, appointment_time, token]);
        const id = ins.rows[0].id;

        for (const a of (Array.isArray(b.answers) ? b.answers : [])) {
          await q('INSERT INTO event_appointment_answers (appointment_id, form_id, answers_json) VALUES ($1,$2,$3)',
            [id, a.form_id || null, JSON.stringify(a.values || {})]);
        }
        for (const f of (Array.isArray(b.files) ? b.files : [])) {
          if (!f.data_base64) continue;
          const buf = Buffer.from(String(f.data_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
          await q('INSERT INTO event_appointment_documents (appointment_id, field_key, file_name, content_type, content) VALUES ($1,$2,$3,$4,$5)',
            [id, f.field_key || null, (f.name || 'upload').slice(0, 400), f.content_type || null, buf]);
        }
        return id;
      });

      await logActivity(db, apptId, 'registered');
      // confirmation email (best-effort)
      let email_error = null;
      if (email) { try { await sendAppointmentConfirmation(db, apptId); } catch (e) { email_error = e.message; } }
      return ok({ registered: true, appointment_id: apptId, magic_token: token, email_error });
    } catch (err) {
      if (/slot is full/i.test(err.message)) return badRequest(err.message);
      return serverError(err);
    }
  }

  return badRequest('Method not supported');
};
