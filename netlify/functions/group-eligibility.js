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

  // Build filter conditions with numbered params (search + account status + dept/location).
  const params = [qs.group_id];
  let cond = '';
  if (search) {
    params.push(`%${search}%`); const p = `$${params.length}`;
    cond += ` AND (e.[First Name] LIKE ${p} OR e.[Last Name] LIKE ${p} OR e.[Employee ID] LIKE ${p}
                   OR e.personalemailaddress LIKE ${p} OR e.[Work Email] LIKE ${p})`;
  }
  if (qs.status) { params.push(qs.status); cond += ` AND e.[Account Status] = $${params.length}`; }
  if (qs.dept)   { params.push(qs.dept);   cond += ` AND e.[Location] = $${params.length}`; }

  try {
    const [countR, dataR, statsR, statusFacet, deptFacet] = await Promise.all([
      db.query(`SELECT COUNT(*) AS count ${FROM} ${cond}`, params),
      db.query(
        `SELECT
            e.[Employee ID]                                   AS employee_id,
            e.[First Name]                                    AS first_name,
            e.[Last Name]                                     AS last_name,
            COALESCE(NULLIF(e.[Work Email],''), e.personalemailaddress) AS email,
            CONVERT(varchar(10), TRY_CONVERT(date, e.[DOB]), 23) AS date_of_birth,
            e.[Gender]                                        AS gender,
            e.[Location]                                      AS department,
            COALESCE(e.locationdesc, e.[Location])            AS location,
            e.[Account Status]                                AS status,
            COALESCE(e.plancodedesc, e.[Plan Code])           AS coverage_tier,
            CONVERT(varchar(10), e.[Initial Hire Date], 23)   AS effective_date
           ${FROM} ${cond}
         ORDER BY e.[Last Name], e.[First Name]
         OFFSET $${params.length + 2} ROWS FETCH NEXT $${params.length + 1} ROWS ONLY`,
        [...params, limit, offset]),
      db.query(
        `SELECT e.[Account Status] AS status, COUNT(*) AS cnt
           ${FROM} ${cond}
          GROUP BY e.[Account Status]`,
        params),
      // Distinct facet values across the whole group (unfiltered) for the pick lists.
      db.query(`SELECT DISTINCT e.[Account Status] AS v ${FROM} AND e.[Account Status] IS NOT NULL AND e.[Account Status] <> '' ORDER BY e.[Account Status]`, [qs.group_id]),
      db.query(`SELECT DISTINCT e.[Location] AS v ${FROM} AND e.[Location] IS NOT NULL AND e.[Location] <> '' ORDER BY e.[Location]`, [qs.group_id]),
    ]);

    const statusCounts = {};
    statsR.rows.forEach(r => { statusCounts[r.status] = parseInt(r.cnt); });
    return ok({
      total: parseInt(countR.rows[0].count),
      records: dataR.rows,
      status_counts: statusCounts,
      statuses: statusFacet.rows.map(r => r.v).filter(Boolean),
      departments: deptFacet.rows.map(r => r.v).filter(Boolean),
      source: 'iStrata',
    });
  } catch (e) { return serverError(e); }
};
