const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

// Search public appointments across all events by group, name, phone, or email.
//   GET /api/appointment-search?group=&first=&last=&phone=&email=&limit=&offset=
// Any subset of filters may be supplied (combined with AND). No filters = most
// recent appointments. Group matches the event's iStrata group name.
const BASE = `
  FROM event_appointments a
  JOIN screening_events e ON e.id = a.event_id
  LEFT JOIN event_locations l ON l.id = a.location_id
  LEFT JOIN iStrata.dbo.is_groups g ON g.id = e.org_id`;

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  if (event.httpMethod !== 'GET') return badRequest('Method not supported');

  const db = getPool();
  const qs = event.queryStringParameters || {};
  const like = v => `%${String(v).trim()}%`;

  const clauses = [];
  const params = [];
  const add = (field, val) => { if (val && String(val).trim()) { params.push(like(val)); clauses.push(`${field} LIKE $${params.length}`); } };
  add('g.GroupName', qs.group);
  add('a.first_name', qs.first);
  add('a.last_name', qs.last);
  add('a.phone', qs.phone);
  add('a.email', qs.email);
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

  const limit = Math.min(parseInt(qs.limit) || 100, 300);
  const offset = parseInt(qs.offset) || 0;

  try {
    const [rows, count] = await Promise.all([
      db.query(
        `SELECT a.id, a.first_name, a.last_name, a.email, a.phone, a.status,
                CONVERT(varchar(10), a.appointment_date, 23) AS appointment_date,
                CONVERT(varchar(5),  a.appointment_time, 108) AS appointment_time,
                e.id AS event_id, e.name AS event_name,
                g.GroupName AS group_name,
                l.name AS location_name
           ${BASE} ${where}
          ORDER BY a.appointment_date DESC, a.appointment_time
          OFFSET $${params.length + 2} ROWS FETCH NEXT $${params.length + 1} ROWS ONLY`,
        [...params, limit, offset]),
      db.query(`SELECT COUNT(*) AS count ${BASE} ${where}`, params),
    ]);
    return ok({ total: parseInt(count.rows[0].count), records: rows.rows });
  } catch (e) { return serverError(e); }
};
