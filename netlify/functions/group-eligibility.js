const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

// Read-only eligibility for an employer Group, sourced from the iStrata view
// iStrata.dbo.vw_full_eligibility (joined to is_groups by groupid = GroupId).
//   GET /api/group-eligibility?group_id=<is_groups.id>&search=&limit=&offset=
//
// Column names in the view contain spaces, so they're bracket-quoted and aliased
// to the friendly keys the admin UI already renders.
const FROM = `
  FROM iStrata.dbo.is_groups g
  JOIN iStrata.dbo.vw_full_eligibility e ON e.groupid = g.GroupId
 WHERE g.id = $1 AND g.GroupId IS NOT NULL AND g.GroupId <> ''`;

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  if (event.httpMethod !== 'GET') return badRequest('Method not supported');

  const db = getPool();
  const qs = event.queryStringParameters || {};
  if (!qs.group_id) return badRequest('group_id required');

  const search = qs.search || '';
  const limit  = Math.min(parseInt(qs.limit) || 50, 200);
  const offset = parseInt(qs.offset) || 0;
  const searchCond = search
    ? `AND (e.[First Name] LIKE $2 OR e.[Last Name] LIKE $2 OR e.[Employee ID] LIKE $2
            OR e.personalemailaddress LIKE $2 OR e.[Work Email] LIKE $2)`
    : '';
  const baseParams = search ? [qs.group_id, `%${search}%`] : [qs.group_id];

  try {
    const [countR, dataR, statsR] = await Promise.all([
      db.query(`SELECT COUNT(*) AS count ${FROM} ${searchCond}`, baseParams),
      db.query(
        `SELECT
            e.[Employee ID]                                   AS employee_id,
            e.[First Name]                                    AS first_name,
            e.[Last Name]                                     AS last_name,
            COALESCE(NULLIF(e.[Work Email],''), e.personalemailaddress) AS email,
            e.[Location]                                      AS department,
            COALESCE(e.locationdesc, e.[Location])            AS location,
            CASE WHEN e.[Termination Date] IS NOT NULL THEN 'terminated' ELSE 'active' END AS status,
            COALESCE(e.plancodedesc, e.[Plan Code])           AS coverage_tier,
            CONVERT(varchar(10), e.[Initial Hire Date], 23)   AS effective_date
           ${FROM} ${searchCond}
         ORDER BY e.[Last Name], e.[First Name]
         OFFSET $${baseParams.length + 2} ROWS FETCH NEXT $${baseParams.length + 1} ROWS ONLY`,
        [...baseParams, limit, offset]),
      db.query(
        `SELECT CASE WHEN e.[Termination Date] IS NOT NULL THEN 'terminated' ELSE 'active' END AS status,
                COUNT(*) AS cnt
           ${FROM}
          GROUP BY CASE WHEN e.[Termination Date] IS NOT NULL THEN 'terminated' ELSE 'active' END`,
        [qs.group_id]),
    ]);

    const statusCounts = {};
    statsR.rows.forEach(r => { statusCounts[r.status] = parseInt(r.cnt); });
    return ok({
      total: parseInt(countR.rows[0].count),
      records: dataR.rows,
      status_counts: statusCounts,
      source: 'iStrata',
    });
  } catch (e) { return serverError(e); }
};
