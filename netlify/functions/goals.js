const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      if (qs.session_id) {
        const r = await db.query('SELECT * FROM goals WHERE session_id=$1 ORDER BY created_at', [qs.session_id]);
        return ok(r.rows);
      }
      if (!qs.participant_id) return badRequest('participant_id or session_id required');
      const r = await db.query('SELECT * FROM goals WHERE participant_id=$1 ORDER BY status, created_at DESC', [qs.participant_id]);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { participant_id, coach_id, session_id, description, category, target_date, stage_of_change } = b;
    if (!participant_id) return badRequest('participant_id required');
    // title is derived from the SMART "Specific" field when not given.
    const title = (b.title || b.smart_specific || 'Goal').toString().slice(0, 255);
    try {
      const r = await db.query(
        `INSERT INTO goals
           (participant_id, coach_id, session_id, title, description, category, target_date, stage_of_change,
            smart_specific, smart_measurable, smart_achievable, smart_relevant, smart_time_bound)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [participant_id, coach_id || null, session_id || null, title, description || null,
         category || 'other', target_date || null, stage_of_change || null,
         b.smart_specific || null, b.smart_measurable || null, b.smart_achievable || null,
         b.smart_relevant || null, b.smart_time_bound || null]);
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE goals SET
           title=COALESCE($2,title), description=COALESCE($3,description),
           category=COALESCE($4,category), target_date=COALESCE($5,target_date),
           status=COALESCE($6,status), progress_notes=COALESCE($7,progress_notes),
           stage_of_change=COALESCE($8,stage_of_change),
           smart_specific=COALESCE($9,smart_specific), smart_measurable=COALESCE($10,smart_measurable),
           smart_achievable=COALESCE($11,smart_achievable), smart_relevant=COALESCE($12,smart_relevant),
           smart_time_bound=COALESCE($13,smart_time_bound),
           updated_at=NOW()
         OUTPUT INSERTED.* WHERE id=$1`,
        [b.id, b.title || null, b.description || null, b.category || null, b.target_date || null,
         b.status || null, b.progress_notes || null, b.stage_of_change || null,
         b.smart_specific || null, b.smart_measurable || null, b.smart_achievable || null,
         b.smart_relevant || null, b.smart_time_bound || null]);
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return badRequest('id required');
    try { await db.query('DELETE FROM goals WHERE id=$1', [qs.id]); return ok({ deleted: true }); }
    catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
