const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const { coach_id, admin, month } = qs;
    if (!coach_id) return badRequest('coach_id required');
    if (admin) {
      const user = getUser(event, context);
      if (!user) return unauthorized();
    }
    try {
      let query, params;
      if (admin && month) {
        // Admin monthly view: show all (including inactive) blocks for this month
        // "This month" = effective_from is in the same calendar month, OR no date set
        const firstOfMonth = `${month}-01`;
        query = `
          SELECT * FROM coach_availability
          WHERE coach_id=$1
            AND (
              effective_from IS NULL
              OR DATE_TRUNC('month', effective_from)::date = DATE_TRUNC('month', $2::date)::date
            )
          ORDER BY day_of_week, start_time`;
        params = [coach_id, firstOfMonth];
      } else if (!admin) {
        // Public booking page: active blocks only, filtered by a specific date if provided
        // month param not used here; booking page always passes a date via available-slots instead
        query = `
          SELECT * FROM coach_availability
          WHERE coach_id=$1 AND active=true
          ORDER BY day_of_week, start_time`;
        params = [coach_id];
      } else {
        // Admin, no month filter: return all records
        query = `SELECT * FROM coach_availability WHERE coach_id=$1 ORDER BY day_of_week, start_time`;
        params = [coach_id];
      }
      const r = await db.query(query, params);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  const user = getUser(event, context);
  if (!user) return unauthorized();

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { coach_id, day_of_week, start_time, end_time, effective_from, effective_to } = b;
    if (!coach_id || day_of_week == null || !start_time || !end_time)
      return badRequest('coach_id, day_of_week, start_time, end_time required');
    if (!effective_from || !effective_to)
      return badRequest('effective_from and effective_to are required (use first/last day of the month)');
    try {
      const r = await db.query(
        `INSERT INTO coach_availability
           (coach_id, day_of_week, start_time, end_time, effective_from, effective_to)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [coach_id, day_of_week, start_time, end_time, effective_from, effective_to]
      );
      return created(r.rows[0]);
    } catch (e) {
      if (e.code === '23505') return badRequest('That time block already exists for this period');
      return serverError(e);
    }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, active, start_time, end_time } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE coach_availability
         SET active=COALESCE($2,active),
             start_time=COALESCE($3,start_time),
             end_time=COALESCE($4,end_time)
         WHERE id=$1 RETURNING *`,
        [id, active ?? null, start_time || null, end_time || null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    const { id } = qs;
    if (!id) return badRequest('id required');
    try {
      await db.query('DELETE FROM coach_availability WHERE id=$1', [id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
