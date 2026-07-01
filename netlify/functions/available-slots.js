const { getPool } = require('./_db');
const { ok, badRequest, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET') return badRequest('GET only');

  const qs = event.queryStringParameters || {};
  const { coach_id, date } = qs;
  const durMins = parseInt(qs.duration || '60', 10);

  if (!coach_id || !date) return badRequest('coach_id and date required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest('date must be YYYY-MM-DD');

  const db = getPool();
  try {
    // Day of week for this date (0=Sunday…6=Saturday, same as JS Date.getDay).
    // 1900-01-07 was a Sunday, so DATEDIFF days mod 7 is collation/DATEFIRST-safe.
    const { rows: [{ dow }] } = await db.query(
      `SELECT DATEDIFF(day, '19000107', CAST($1 AS date)) % 7 AS dow`, [date]
    );

    // Active availability windows for this coach on this day that cover this date
    const { rows: windows } = await db.query(
      `SELECT CONVERT(varchar(8), start_time, 108) AS start_time,
              CONVERT(varchar(8), end_time, 108)   AS end_time
         FROM coach_availability
       WHERE coach_id=$1 AND day_of_week=$2 AND active=1
         AND (effective_from IS NULL OR effective_from <= CAST($3 AS date))
         AND (effective_to   IS NULL OR effective_to   >= CAST($3 AS date))
       ORDER BY start_time`,
      [coach_id, dow, date]
    );

    // Exceptions that could apply to this date: an exact single date, or a
    // monthly-ordinal rule on this weekday whose effective range covers the date.
    const { rows: exceptions } = await db.query(
      `SELECT kind, week_of_month,
              CONVERT(varchar(10), exception_date, 23) AS exception_date,
              CONVERT(varchar(8), start_time, 108) AS start_time,
              CONVERT(varchar(8), end_time, 108)   AS end_time
         FROM coach_availability_exceptions
        WHERE coach_id=$1 AND active=1
          AND ( exception_date = CAST($2 AS date)
             OR ( day_of_week = $3
                  AND (effective_from IS NULL OR effective_from <= CAST($2 AS date))
                  AND (effective_to   IS NULL OR effective_to   >= CAST($2 AS date)) ) )`,
      [coach_id, date, dow]
    );

    // Which of those actually apply to THIS date (ordinal / last-week math in JS).
    const dayNum = parseInt(date.slice(8, 10), 10);
    const yr = parseInt(date.slice(0, 4), 10), mo = parseInt(date.slice(5, 7), 10);
    const ordinal = Math.floor((dayNum - 1) / 7) + 1;                 // 1..5
    const daysInMonth = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
    const isLast = (dayNum + 7) > daysInMonth;
    const applicable = exceptions.filter(ex => {
      if (ex.exception_date) return ex.exception_date === date;       // single date
      if (ex.week_of_month === 0) return isLast;                       // 0 = last
      return ex.week_of_month === ordinal;                            // 1..5 = ordinal
    });

    // 'off' wins → unavailable. 'custom' replaces the day's windows.
    if (applicable.some(ex => ex.kind === 'off')) return ok([]);
    const customWindows = applicable
      .filter(ex => ex.kind === 'custom')
      .map(ex => ({ start_time: ex.start_time, end_time: ex.end_time }));
    const effectiveWindows = customWindows.length ? customWindows : windows;
    if (!effectiveWindows.length) return ok([]);

    // Already-booked sessions for this coach on this date
    const { rows: booked } = await db.query(
      `SELECT scheduled_at, duration_minutes FROM coaching_sessions
       WHERE coach_id=$1
         AND scheduled_at >= CAST($2 AS date)
         AND scheduled_at <  DATEADD(day, 1, CAST($2 AS date))
         AND status NOT IN ('cancelled','no_show')`,
      [coach_id, date]
    );

    // Convert bookings to [startMins, endMins] intervals (UTC)
    const bookedIntervals = booked.map(row => {
      const dt = new Date(row.scheduled_at);
      const start = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      return [start, start + (parseInt(row.duration_minutes, 10) || 60)];
    });

    function conflicts(slotStart) {
      const slotEnd = slotStart + durMins;
      return bookedIntervals.some(([bS, bE]) => slotStart < bE && slotEnd > bS);
    }

    // Generate available slots from each effective window
    const slots = [];
    for (const { start_time, end_time } of effectiveWindows) {
      const [sh, sm] = start_time.split(':').map(Number);
      const [eh, em] = end_time.split(':').map(Number);
      let cur = sh * 60 + sm;
      const winEnd = eh * 60 + em;
      while (cur + durMins <= winEnd) {
        if (!conflicts(cur)) {
          slots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
        }
        cur += durMins;
      }
    }
    return ok(slots);
  } catch (e) { return serverError(e); }
};
