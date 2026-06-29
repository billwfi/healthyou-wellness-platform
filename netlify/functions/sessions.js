const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const where = [], vals = [];
    if (qs.participant_id) where.push(`cs.participant_id=$${vals.push(qs.participant_id)}`);
    if (qs.coach_id)       where.push(`cs.coach_id=$${vals.push(qs.coach_id)}`);

    try {
      const r = await db.query(
        `SELECT cs.*,
                p.first_name, p.last_name, p.email AS participant_email,
                c.name AS coach_name,
                cn.stage_of_change, cn.session_notes, cn.updated_at AS notes_updated_at
           FROM coaching_sessions cs
           JOIN participants p ON p.id=cs.participant_id
           LEFT JOIN coaches c ON c.id=cs.coach_id
           LEFT JOIN coaching_notes cn ON cn.session_id=cs.id
          ${where.length ? 'WHERE '+where.join(' AND ') : ''}
          ORDER BY cs.scheduled_at DESC`,
        vals
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { participant_id, coach_id, scheduled_at, duration_minutes, session_type, intake_notes } = b;
    if (!participant_id || !scheduled_at) return badRequest('participant_id and scheduled_at required');
    try {
      const r = await db.query(
        `INSERT INTO coaching_sessions (participant_id,coach_id,scheduled_at,duration_minutes,session_type,intake_notes)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6)`,
        [participant_id, coach_id||null, scheduled_at,
         duration_minutes||60, session_type||'initial', intake_notes||null]
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PATCH') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, status } = b;
    if (!id || !status) return badRequest('id and status required');
    try {
      const r = await db.query(
        'UPDATE coaching_sessions SET status=$2 OUTPUT INSERTED.* WHERE id=$1', [id, status]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
