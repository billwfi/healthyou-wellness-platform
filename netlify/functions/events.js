const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (qs.id) {
      try {
        const r = await db.query(
          `SELECT e.*, o.name AS org_name,
                  (SELECT COUNT(*) FROM biometric_results br WHERE br.event_id=e.id) AS screened_count,
                  (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id=e.id) AS registered_count
             FROM screening_events e
             LEFT JOIN organizations o ON o.id=e.org_id
            WHERE e.id=$1`,
          [qs.id]
        );
        if (!r.rows.length) return notFound();
        return ok(r.rows[0]);
      } catch (e) { return serverError(e); }
    }

    try {
      const r = await db.query(
        `SELECT e.*, o.name AS org_name,
                (SELECT COUNT(*) FROM biometric_results br WHERE br.event_id=e.id) AS screened_count,
                (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id=e.id) AS registered_count
           FROM screening_events e
           LEFT JOIN organizations o ON o.id=e.org_id
          ORDER BY e.event_date DESC`
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { name, event_date, org_id, location, event_type, notes } = b;
    if (!name || !event_date) return badRequest('name and event_date required');
    try {
      const r = await db.query(
        'INSERT INTO screening_events (name,event_date,org_id,location,event_type,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [name, event_date, org_id||null, location||null, event_type||'onsite', notes||null]
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, name, event_date, org_id, location, event_type, status, notes } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE screening_events SET
           name=COALESCE($2,name), event_date=COALESCE($3,event_date),
           org_id=COALESCE($4,org_id), location=COALESCE($5,location),
           event_type=COALESCE($6,event_type), status=COALESCE($7,status),
           notes=COALESCE($8,notes)
         WHERE id=$1 RETURNING *`,
        [id, name||null, event_date||null, org_id||null, location||null,
         event_type||null, status||null, notes||null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
