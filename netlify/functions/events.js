const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');
const crypto = require('crypto');

// Screening event = container: a Group + start/end dates + a public registration
// slug, holding many event_locations (each with its own AppointmentQuest Setup).
const SELECT = `
  SELECT e.*, o.GroupName AS org_name,
         (SELECT COUNT(*) FROM event_locations el WHERE el.event_id=e.id)        AS location_count,
         (SELECT COUNT(*) FROM biometric_results br WHERE br.event_id=e.id)       AS screened_count,
         (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id=e.id)     AS registered_count,
         (SELECT COUNT(*) FROM event_appointments ea WHERE ea.event_id=e.id AND ea.status='registered') AS booked_count
    FROM screening_events e
    LEFT JOIN iStrata.dbo.is_groups o ON o.id=e.org_id`;

function slugify(name) {
  const base = String(name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'event';
  return base + '-' + crypto.randomBytes(3).toString('hex'); // short random suffix → unique
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      if (qs.id) {
        const r = await db.query(`${SELECT} WHERE e.id=$1`, [qs.id]);
        if (!r.rows.length) return notFound();
        return ok(r.rows[0]);
      }
      const r = await db.query(`${SELECT} ORDER BY e.created_at DESC`);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { name, org_id, start_date, end_date, status, description, notes } = b;
    if (!name || !start_date) return badRequest('name and start_date required');
    // event_date column is legacy + NOT NULL — keep it in sync with start_date.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await db.query(
          `INSERT INTO screening_events
             (name, org_id, event_date, start_date, end_date, status, description, notes, public_slug)
           OUTPUT INSERTED.* VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)`,
          [name, org_id || null, start_date, end_date || null, status || 'scheduled',
           description || null, notes || null, slugify(name)]
        );
        return created(r.rows[0]);
      } catch (e) {
        if ((e.number === 2627 || e.number === 2601) && attempt < 2) continue; // slug clash → retry
        return serverError(e);
      }
    }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, org_id, start_date, end_date, status, description, notes, email_subject, email_html } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE screening_events SET
           name=COALESCE($2,name), org_id=COALESCE($3,org_id),
           start_date=COALESCE($4,start_date), event_date=COALESCE($4,event_date),
           end_date=COALESCE($5,end_date), status=COALESCE($6,status),
           description=COALESCE($7,description), notes=COALESCE($8,notes),
           email_subject=COALESCE($9,email_subject), email_html=COALESCE($10,email_html)
         OUTPUT INSERTED.*
         WHERE id=$1`,
        [id, name || null, org_id || null, start_date || null, end_date || null,
         status || null, description || null, notes || null,
         email_subject ?? null, email_html ?? null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return badRequest('id required');
    try {
      await db.query('DELETE FROM screening_events WHERE id=$1', [qs.id]); // cascades to locations/registrations
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
