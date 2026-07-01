// Coach availability exceptions — overrides on top of recurring coach_availability.
// An exception is either a single date (exception_date) or a monthly ordinal
// (day_of_week + week_of_month; week_of_month 1..5 = ordinal, 0 = last). Effect is
// 'off' (unavailable) or 'custom' (start_time/end_time replace the day's hours).
//   GET    /api/availability-exceptions?coach_id=N
//   POST   /api/availability-exceptions
//   DELETE /api/availability-exceptions?id=N
const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options, CORS } = require('./_auth');

const forbidden = () => ({ statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'You can only manage your own schedule.' }) });
const owns = (user, coachId) => !user.coach_id || String(user.coach_id) === String(coachId);

// TIME columns come back as Date objects; coerce to 'HH:MM:SS'.
function fmt(rows) {
  for (const r of (Array.isArray(rows) ? rows : [rows])) {
    if (!r) continue;
    if (r.start_time instanceof Date) r.start_time = r.start_time.toISOString().substr(11, 8);
    if (r.end_time   instanceof Date) r.end_time   = r.end_time.toISOString().substr(11, 8);
  }
  return rows;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const coachId = qs.coach_id;
    if (!coachId) return badRequest('coach_id required');
    if (!owns(user, coachId)) return forbidden();
    try {
      const r = await db.query(
        `SELECT id, coach_id,
                CONVERT(varchar(10), exception_date, 23) AS exception_date,
                day_of_week, week_of_month, kind, start_time, end_time,
                CONVERT(varchar(10), effective_from, 23) AS effective_from,
                CONVERT(varchar(10), effective_to, 23)   AS effective_to,
                active
           FROM coach_availability_exceptions
          WHERE coach_id=$1 AND active=1
          ORDER BY day_of_week, week_of_month, exception_date`, [coachId]);
      return ok(fmt(r.rows));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const coach_id = b.coach_id;
    if (!coach_id) return badRequest('coach_id required');
    if (!owns(user, coach_id)) return forbidden();

    const kind = b.kind === 'custom' ? 'custom' : 'off';
    const single = !!b.exception_date;
    if (!single && (b.day_of_week == null || b.week_of_month == null))
      return badRequest('Provide either exception_date, or day_of_week + week_of_month');
    if (kind === 'custom') {
      if (!b.start_time || !b.end_time) return badRequest('Custom hours require start_time and end_time');
      if (b.start_time >= b.end_time)   return badRequest('End time must be after start time');
    }
    try {
      const r = await db.query(
        `INSERT INTO coach_availability_exceptions
           (coach_id, exception_date, day_of_week, week_of_month, kind, start_time, end_time, effective_from, effective_to)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [coach_id,
         single ? b.exception_date : null,
         single ? null : b.day_of_week,
         single ? null : b.week_of_month,
         kind,
         kind === 'custom' ? b.start_time : null,
         kind === 'custom' ? b.end_time   : null,
         b.effective_from || null,
         b.effective_to   || null]);
      return created(fmt(r.rows[0]));
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    const id = qs.id;
    if (!id) return badRequest('id required');
    try {
      if (user.coach_id) {
        const own = await db.query('SELECT coach_id FROM coach_availability_exceptions WHERE id=$1', [id]);
        if (!own.rows.length) return notFound();
        if (!owns(user, own.rows[0].coach_id)) return forbidden();
      }
      await db.query('DELETE FROM coach_availability_exceptions WHERE id=$1', [id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
