// Admin Eligibility Search: look up eligibility records for a Group by last name.
// Reads the iStrata eligibility view (iStrata.dbo.vw_full_eligibility), joined to
// iStrata.dbo.is_groups by GroupId — the same source used by verify-eligibility.
//   GET /api/eligibility-search?group_id=<is_groups.id>&last_name=<text>&status=Active
const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  if (event.httpMethod !== 'GET') return badRequest('Method not supported');

  const qs = event.queryStringParameters || {};
  const groupId = qs.group_id;
  const last = (qs.last_name || '').trim();
  const first = (qs.first_name || '').trim();
  if (!groupId) return badRequest('group_id required');
  if (!last && !first) return badRequest('Enter a last name to search');

  const db = getPool();
  const params = [groupId];
  const conds = [];
  if (last)  { params.push(last.toLowerCase() + '%');  conds.push(`LOWER(LTRIM(RTRIM(el.[Last Name]))) LIKE $${params.length}`); }
  if (first) { params.push(first.toLowerCase() + '%'); conds.push(`LOWER(LTRIM(RTRIM(el.[First Name]))) LIKE $${params.length}`); }
  const activeOnly = (qs.status || '').toLowerCase() === 'active';
  const statusCond = activeOnly ? `AND el.[Account Status] = 'Active'` : '';

  try {
    const r = await db.query(
      `SELECT TOP (200)
              LTRIM(RTRIM(el.[First Name])) AS first_name,
              LTRIM(RTRIM(el.[Last Name]))  AS last_name,
              CONVERT(varchar(10), TRY_CONVERT(date, el.[DOB]), 23) AS dob,
              el.[Gender] AS gender,
              el.[Account Status] AS status
         FROM iStrata.dbo.is_groups g
         JOIN iStrata.dbo.vw_full_eligibility el ON el.groupid = g.GroupId
        WHERE g.id = $1
          AND g.GroupId IS NOT NULL AND g.GroupId <> ''
          ${statusCond}
          AND ${conds.join(' AND ')}
        ORDER BY el.[Last Name], el.[First Name]`,
      params);
    return ok({ records: r.rows, count: r.rows.length, capped: r.rows.length >= 200 });
  } catch (e) { return serverError(e); }
};
