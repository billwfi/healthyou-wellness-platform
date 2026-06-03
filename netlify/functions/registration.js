const { getPool } = require('./_db');
const { ok, badRequest, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const db = getPool();
  const qs = event.queryStringParameters || {};

  // GET: public event info for the registration form
  if (event.httpMethod === 'GET') {
    const { event_id } = qs;
    if (!event_id) return badRequest('event_id required');
    try {
      const r = await db.query(
        `SELECT e.id, e.name, e.event_date, e.location, e.event_type, e.status,
                o.name AS org_name
           FROM screening_events e
           LEFT JOIN organizations o ON o.id=e.org_id
          WHERE e.id=$1`,
        [event_id]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  // POST: self-register for a screening event
  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { event_id, first_name, last_name, email, employee_id, date_of_birth, gender, phone, department } = b;
    if (!event_id || !first_name || !last_name || !email)
      return badRequest('event_id, first_name, last_name, email required');
    try {
      const evRes = await db.query(
        'SELECT id, org_id, status FROM screening_events WHERE id=$1', [event_id]
      );
      if (!evRes.rows.length) return notFound();
      if (evRes.rows[0].status === 'cancelled')
        return badRequest('This event is no longer accepting registrations.');
      const org_id = evRes.rows[0].org_id;

      const pRes = await db.query(
        `INSERT INTO participants (email,first_name,last_name,org_id,employee_id,date_of_birth,gender,phone,department)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (email) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name
         RETURNING id`,
        [email.toLowerCase().trim(), first_name.trim(), last_name.trim(),
         org_id||null, employee_id||null, date_of_birth||null, gender||null, phone||null, department||null]
      );

      await db.query(
        `INSERT INTO event_registrations (event_id,participant_id,registration_source,status)
         VALUES ($1,$2,'self','registered')
         ON CONFLICT (event_id,participant_id) DO NOTHING`,
        [event_id, pRes.rows[0].id]
      );
      return ok({ registered: true, participant_id: pRes.rows[0].id });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
