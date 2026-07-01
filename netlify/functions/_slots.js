// Shared coaching-availability slot logic, used by available-slots.js (display)
// and book.js (random coach assignment). All times are naive wall-clock 'HH:MM'.
const { getPool } = require('./_db');

// Available start times ('HH:MM') for one coach on one date, honoring recurring
// availability, exceptions (off/custom), and already-booked sessions.
async function coachSlots(db, coachId, date, durMins = 60) {
  const { rows: [{ dow }] } = await db.query(
    `SELECT DATEDIFF(day, '19000107', CAST($1 AS date)) % 7 AS dow`, [date]);

  const { rows: windows } = await db.query(
    `SELECT CONVERT(varchar(8), start_time, 108) AS start_time,
            CONVERT(varchar(8), end_time, 108)   AS end_time
       FROM coach_availability
      WHERE coach_id=$1 AND day_of_week=$2 AND active=1
        AND (effective_from IS NULL OR effective_from <= CAST($3 AS date))
        AND (effective_to   IS NULL OR effective_to   >= CAST($3 AS date))
      ORDER BY start_time`, [coachId, dow, date]);

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
    [coachId, date, dow]);

  const dayNum = parseInt(date.slice(8, 10), 10);
  const yr = parseInt(date.slice(0, 4), 10), mo = parseInt(date.slice(5, 7), 10);
  const ordinal = Math.floor((dayNum - 1) / 7) + 1;
  const daysInMonth = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
  const isLast = (dayNum + 7) > daysInMonth;
  const applicable = exceptions.filter(ex => {
    if (ex.exception_date) return ex.exception_date === date;
    if (ex.week_of_month === 0) return isLast;
    return ex.week_of_month === ordinal;
  });
  if (applicable.some(ex => ex.kind === 'off')) return [];
  const custom = applicable.filter(ex => ex.kind === 'custom').map(ex => ({ start_time: ex.start_time, end_time: ex.end_time }));
  const effectiveWindows = custom.length ? custom : windows;
  if (!effectiveWindows.length) return [];

  const { rows: booked } = await db.query(
    `SELECT scheduled_at, duration_minutes FROM coaching_sessions
      WHERE coach_id=$1 AND scheduled_at >= CAST($2 AS date)
        AND scheduled_at < DATEADD(day, 1, CAST($2 AS date))
        AND status NOT IN ('cancelled','no_show')`, [coachId, date]);
  const bookedIntervals = booked.map(r => {
    const dt = new Date(r.scheduled_at);
    const start = dt.getUTCHours() * 60 + dt.getUTCMinutes();
    return [start, start + (parseInt(r.duration_minutes, 10) || 60)];
  });
  const conflicts = s => bookedIntervals.some(([bS, bE]) => s < bE && (s + durMins) > bS);

  const slots = [];
  for (const { start_time, end_time } of effectiveWindows) {
    const [sh, sm] = start_time.split(':').map(Number);
    const [eh, em] = end_time.split(':').map(Number);
    let cur = sh * 60 + sm; const winEnd = eh * 60 + em;
    while (cur + durMins <= winEnd) {
      if (!conflicts(cur)) slots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
      cur += durMins;
    }
  }
  return slots;
}

// Active coach ids assigned to a group.
async function groupCoachIds(db, groupId) {
  const r = await db.query(
    `SELECT DISTINCT cg.coach_id
       FROM coach_groups cg JOIN coaches c ON c.id = cg.coach_id
      WHERE cg.group_id = $1 AND c.active = 1`, [groupId]);
  return r.rows.map(x => x.coach_id);
}

// Union of available start times across all of a group's coaches on a date.
async function groupSlots(db, groupId, date, durMins = 60) {
  const ids = await groupCoachIds(db, groupId);
  const set = new Set();
  for (const id of ids) (await coachSlots(db, id, date, durMins)).forEach(s => set.add(s));
  return [...set].sort();
}

// Coach ids in a group that are free at a specific date+time.
async function freeCoachesForSlot(db, groupId, date, time, durMins = 60) {
  const ids = await groupCoachIds(db, groupId);
  const free = [];
  for (const id of ids) if ((await coachSlots(db, id, date, durMins)).includes(time)) free.push(id);
  return free;
}

module.exports = { coachSlots, groupCoachIds, groupSlots, freeCoachesForSlot, getPool };
