// Public eligibility check for the coaching booking page.
//   POST /api/booking-eligibility { first_name, last_name, date_of_birth, gender }
// Matches ACTIVE records in the iStrata eligibility view by name + DOB + gender,
// then returns the groups the person belongs to that ALSO have an active coach
// assigned (so a coach can be booked). Shape: { eligible, groups:[{id,name}] }.
const { getPool } = require('./_db');
const { ok, badRequest, serverError, options } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return badRequest('Method not supported');
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }

  const first = (b.first_name || '').trim();
  const last = (b.last_name || '').trim();
  const dob = (b.date_of_birth || '').trim();          // YYYY-MM-DD
  const genderRaw = (b.gender || '').trim();
  const gender = genderRaw ? genderRaw[0].toUpperCase() : '';
  if (!first || !last || !dob || !gender) return badRequest('first_name, last_name, date_of_birth and gender are required');

  const db = getPool();
  try {
    // Match on name + gender + active in SQL; compare DOB in JS (the view throws
    // when the date conversion is pushed into a predicate).
    const r = await db.query(
      `SELECT DISTINCT LTRIM(RTRIM(el.groupid)) AS groupid,
              CONVERT(varchar(10), TRY_CONVERT(date, el.[DOB]), 23) AS dob
         FROM iStrata.dbo.vw_full_eligibility el
        WHERE el.[Account Status] = 'Active'
          AND LOWER(LTRIM(RTRIM(el.[First Name]))) = LOWER($1)
          AND LOWER(LTRIM(RTRIM(el.[Last Name])))  = LOWER($2)
          AND UPPER(LEFT(LTRIM(el.[Gender]),1)) = $3`,
      [first.toLowerCase(), last.toLowerCase(), gender]);

    const groupids = [...new Set(r.rows.filter(x => x.dob === dob && x.groupid).map(x => x.groupid))];
    if (!groupids.length) return ok({ eligible: false, groups: [] });

    // Resolve to is_groups (internal id + name).
    const ph = groupids.map((_, i) => `$${i + 1}`).join(',');
    const g = await db.query(
      `SELECT id, GroupName AS name FROM iStrata.dbo.is_groups
        WHERE LTRIM(RTRIM(GroupId)) IN (${ph})`, groupids);
    if (!g.rows.length) return ok({ eligible: false, groups: [] });

    // Keep only groups that have at least one active coach assigned.
    const ids = g.rows.map(x => x.id);
    const iph = ids.map((_, i) => `$${i + 1}`).join(',');
    const withCoach = await db.query(
      `SELECT DISTINCT cg.group_id
         FROM coach_groups cg JOIN coaches c ON c.id = cg.coach_id
        WHERE c.active = 1 AND cg.group_id IN (${iph})`, ids);
    const coachSet = new Set(withCoach.rows.map(x => x.group_id));

    const groups = g.rows
      .filter(x => coachSet.has(x.id))
      .map(x => ({ id: x.id, name: x.name }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return ok({ eligible: groups.length > 0, groups });
  } catch (e) { return serverError(e); }
};
