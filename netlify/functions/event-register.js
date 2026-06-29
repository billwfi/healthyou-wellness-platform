const { getPool, parseJson, sql } = require('./_db');
const { ok, badRequest, notFound, serverError, options } = require('./_auth');
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
        `SELECT f.id, f.name, f.schema_json FROM event_forms ef JOIN forms f ON f.id=ef.form_id
          WHERE ef.event_id=$1 AND f.active=1 ORDER BY ef.sort_order, f.name`, [e.id]);
      parseJson(forms.rows, ['schema_json']);
      return ok({ event: e, group_name: grp.rows[0]?.name || null, locations: locs.rows, forms: forms.rows });
    } catch (err) { return serverError(err); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { slug, location_id, appointment_date, appointment_time, first_name, last_name, email, phone } = b;
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
             (event_id, location_id, first_name, last_name, email, phone, appointment_date, appointment_time, magic_token)
           OUTPUT INSERTED.id VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [eventId, location_id, first_name, last_name, email || null, phone || null,
           appointment_date, appointment_time, token]);
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

      // confirmation email (best-effort)
      let email_error = null;
      if (email) { try { await sendConfirmation(db, { apptId, email, first_name, last_name, eventId, location_id, appointment_date, appointment_time }); } catch (e) { email_error = e.message; } }
      return ok({ registered: true, appointment_id: apptId, magic_token: token, email_error });
    } catch (err) {
      if (/slot is full/i.test(err.message)) return badRequest(err.message);
      return serverError(err);
    }
  }

  return badRequest('Method not supported');
};

async function sendConfirmation(db, { email, first_name, last_name, eventId, location_id, appointment_date, appointment_time }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const ev = await db.query('SELECT name FROM screening_events WHERE id=$1', [eventId]);
  const loc = await db.query('SELECT name, address, city, state FROM event_locations WHERE id=$1', [location_id]);
  const eName = ev.rows[0]?.name || 'Screening Event';
  const l = loc.rows[0] || {};
  const locLine = [l.name, l.address, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const dt = new Date(`${appointment_date}T${appointment_time}:00`);
  const dateStr = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const from = process.env.RESEND_FROM || 'HealYou <onboarding@resend.dev>';
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;">
    <h2 style="color:#0d9488;">You're registered!</h2>
    <p>Hi ${esc(first_name)} ${esc(last_name)}, your screening appointment is confirmed.</p>
    <table style="font-size:14px;color:#334155;">
      <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Event</td><td><strong>${esc(eName)}</strong></td></tr>
      <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Location</td><td>${esc(locLine || '—')}</td></tr>
      <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Date</td><td>${esc(dateStr)}</td></tr>
      <tr><td style="color:#64748b;padding:4px 12px 4px 0;">Time</td><td>${esc(appointment_time)}</td></tr>
    </table></div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [email], subject: `Your screening appointment — ${dateStr}`, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
