// Available time slots for the booking page.
//   GET /api/available-slots?coach_id=N&date=YYYY-MM-DD   -> that coach's open slots
//   GET /api/available-slots?group_id=N&date=YYYY-MM-DD   -> union across the group's coaches ("Anyone")
const { getPool } = require('./_db');
const { ok, badRequest, serverError, options } = require('./_auth');
const { coachSlots, groupSlots } = require('./_slots');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET') return badRequest('GET only');

  const qs = event.queryStringParameters || {};
  const { coach_id, group_id, date } = qs;
  const durMins = parseInt(qs.duration || '60', 10);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest('date must be YYYY-MM-DD');
  if (!coach_id && !group_id) return badRequest('coach_id or group_id required');

  const db = getPool();
  try {
    const slots = coach_id
      ? await coachSlots(db, coach_id, date, durMins)
      : await groupSlots(db, group_id, date, durMins);
    return ok(slots);
  } catch (e) { return serverError(e); }
};
