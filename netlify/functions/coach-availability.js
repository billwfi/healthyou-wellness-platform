const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options, CORS } = require('./_auth');
const forbidden = () => ({ statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'You can only manage your own schedule.' }) });

// Coach tokens carry coach_id and may only touch their own rows; admins (no
// coach_id on the token) may manage anyone.
async function assertOwns(db, user, coachId) {
  if (!user.coach_id) return true;
  return String(user.coach_id) === String(coachId);
}
async function rowCoachId(db, id) {
  const r = await db.query('SELECT coach_id FROM coach_availability WHERE id=$1', [id]);
  return r.rows.length ? r.rows[0].coach_id : null;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  // SQL Server returns TIME columns as JS Date objects; coerce to 'HH:MM:SS'
  // strings so the API matches the old PostgreSQL behaviour.
  const fmtTimes = rows => {
    for (const row of (Array.isArray(rows) ? rows : [rows])) {
      if (!row) continue;
      if (row.start_time instanceof Date) row.start_time = row.start_time.toISOString().substr(11, 8);
      if (row.end_time   instanceof Date) row.end_time   = row.end_time.toISOString().substr(11, 8);
    }
    return rows;
  };

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
              OR DATEFROMPARTS(YEAR(effective_from), MONTH(effective_from), 1)
                 = DATEFROMPARTS(YEAR(CAST($2 AS date)), MONTH(CAST($2 AS date)), 1)
            )
          ORDER BY day_of_week, start_time`;
        params = [coach_id, firstOfMonth];
      } else if (!admin) {
        // Public booking page: active blocks only, filtered by a specific date if provided
        // month param not used here; booking page always passes a date via available-slots instead
        query = `
          SELECT * FROM coach_availability
          WHERE coach_id=$1 AND active=1
          ORDER BY day_of_week, start_time`;
        params = [coach_id];
      } else {
        // Admin, no month filter: return all records
        query = `SELECT * FROM coach_availability WHERE coach_id=$1 ORDER BY day_of_week, start_time`;
        params = [coach_id];
      }
      const r = await db.query(query, params);
      return ok(fmtTimes(r.rows));
    } catch (e) { return serverError(e); }
  }

  const user = getUser(event, context);
  if (!user) return unauthorized();

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { coach_id, day_of_week, start_time, end_time } = b;
    if (!coach_id || day_of_week == null || !start_time || !end_time)
      return badRequest('coach_id, day_of_week, start_time, end_time required');
    if (!(await assertOwns(db, user, coach_id))) return forbidden();
    // effective_from/to are optional. Omitted (null) = a recurring weekly block
    // with no end. The admin monthly editor still passes month bounds.
    const effective_from = b.effective_from || null;
    const effective_to   = b.effective_to   || null;
    try {
      const r = await db.query(
        `INSERT INTO coach_availability
           (coach_id, day_of_week, start_time, end_time, effective_from, effective_to)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6)`,
        [coach_id, day_of_week, start_time, end_time, effective_from, effective_to]
      );
      return created(fmtTimes(r.rows[0]));
    } catch (e) {
      if (e.number === 2627 || e.number === 2601) return badRequest('That time block already exists for this period');
      return serverError(e);
    }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, active, start_time, end_time } = b;
    if (!id) return badRequest('id required');
    if (user.coach_id && !(await assertOwns(db, user, await rowCoachId(db, id)))) return forbidden();
    try {
      const r = await db.query(
        `UPDATE coach_availability
         SET active=COALESCE($2,active),
             start_time=COALESCE($3,start_time),
             end_time=COALESCE($4,end_time)
         OUTPUT INSERTED.*
         WHERE id=$1`,
        [id, active ?? null, start_time || null, end_time || null]
      );
      if (!r.rows.length) return notFound();
      return ok(fmtTimes(r.rows[0]));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    const { id } = qs;
    if (!id) return badRequest('id required');
    if (user.coach_id && !(await assertOwns(db, user, await rowCoachId(db, id)))) return forbidden();
    try {
      await db.query('DELETE FROM coach_availability WHERE id=$1', [id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
