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
    if (!windows.length) return ok([]);

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

    // Generate available slots from each window
    const slots = [];
    for (const { start_time, end_time } of windows) {
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
