const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (!qs.participant_id) return badRequest('participant_id required');
    try {
      const r = await db.query(
        'SELECT * FROM goals WHERE participant_id=$1 ORDER BY status, created_at DESC',
        [qs.participant_id]
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { participant_id, coach_id, title, description, category, target_date } = b;
    if (!participant_id || !title) return badRequest('participant_id and title required');
    try {
      const r = await db.query(
        `INSERT INTO goals (participant_id,coach_id,title,description,category,target_date)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [participant_id, coach_id||null, title, description||null,
         category||'other', target_date||null]
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, title, description, category, target_date, status, progress_notes } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE goals SET
           title=COALESCE($2,title), description=COALESCE($3,description),
           category=COALESCE($4,category), target_date=COALESCE($5,target_date),
           status=COALESCE($6,status), progress_notes=COALESCE($7,progress_notes),
           updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, title||null, description||null, category||null,
         target_date||null, status||null, progress_notes||null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
