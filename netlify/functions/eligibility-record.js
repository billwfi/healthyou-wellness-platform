// Admin: full detail for one eligibility record (from the iStrata view) plus the
// matched local participant's biometric screenings and coaching appointments.
//   GET /api/eligibility-record?group_id=&first=&last=&dob=&gender=
const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

const SELECT = `
  SELECT LTRIM(RTRIM(el.[First Name])) AS first_name,
         LTRIM(RTRIM(el.[Last Name]))  AS last_name,
         CONVERT(varchar(10), TRY_CONVERT(date, el.[DOB]), 23) AS dob,
         el.[Gender] AS gender,
         el.[Account Status] AS account_status,
         el.[Account Type] AS account_type,
         g.GroupName AS group_name,
         el.[Customer Account Number] AS customer_account_number,
         el.[Employee ID] AS employee_id,
         el.[Work Email] AS work_email,
         el.personalemailaddress AS personal_email,
         el.[Phone] AS phone,
         el.[Address1] AS address1, el.[Address2] AS address2,
         el.city AS city, el.state AS state, el.[Zip] AS zip,
         CONVERT(varchar(10), TRY_CONVERT(date, el.[Initial Hire Date]), 23) AS initial_hire_date,
         el.[Currently Employed] AS currently_employed,
         CONVERT(varchar(10), TRY_CONVERT(date, el.[Termination Date]), 23) AS termination_date,
         el.[Is Registered] AS is_registered,
         el.[Plan Code] AS plan_code, el.plancodedesc AS plan_desc,
         el.[Location] AS location, el.locationdesc AS location_desc,
         el.insurancename AS insurance_name
    FROM iStrata.dbo.is_groups g
    JOIN iStrata.dbo.vw_full_eligibility el ON el.groupid = g.GroupId`;

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  if (event.httpMethod !== 'GET') return badRequest('Method not supported');

  const qs = event.queryStringParameters || {};
  const groupId = qs.group_id;
  const first = (qs.first || '').trim();
  const last = (qs.last || '').trim();
  const dob = (qs.dob || '').trim();
  const gInit = (qs.gender || '').trim() ? (qs.gender || '').trim()[0].toUpperCase() : '';
  if (!groupId || (!first && !last)) return badRequest('group_id and name required');

  const db = getPool();
  try {
    const params = [groupId];
    let sql = `${SELECT} WHERE g.id = $1 AND g.GroupId IS NOT NULL AND g.GroupId <> ''`;
    if (last)  { params.push(last.toLowerCase());  sql += ` AND LOWER(LTRIM(RTRIM(el.[Last Name]))) = $${params.length}`; }
    if (first) { params.push(first.toLowerCase()); sql += ` AND LOWER(LTRIM(RTRIM(el.[First Name]))) = $${params.length}`; }
    if (gInit) { params.push(gInit);               sql += ` AND UPPER(LEFT(LTRIM(el.[Gender]),1)) = $${params.length}`; }

    const er = await db.query(sql, params);
    const record = er.rows.find(r => !dob || r.dob === dob) || er.rows[0] || null;
    if (!record) return notFound();

    // Match a local participant by name, preferring a DOB match.
    const pm = await db.query(
      `SELECT TOP (1) id, email, first_name, last_name,
              CONVERT(varchar(10), date_of_birth, 23) AS dob, phone, org_id
         FROM participants
        WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2)
        ORDER BY CASE WHEN CONVERT(varchar(10), date_of_birth, 23) = $3 THEN 0 ELSE 1 END, id DESC`,
      [record.first_name, record.last_name, dob || record.dob || '']);
    const participant = pm.rows[0] || null;

    let biometrics = [], sessions = [];
    if (participant) {
      const [bio, ses] = await Promise.all([
        db.query('SELECT * FROM biometric_results WHERE participant_id=$1 ORDER BY screened_at DESC', [participant.id]),
        db.query(
          `SELECT cs.id, CONVERT(varchar(19), cs.scheduled_at, 126) AS scheduled_at,
                  cs.duration_minutes, cs.session_type, cs.status, cs.followup_number,
                  c.name AS coach_name
             FROM coaching_sessions cs LEFT JOIN coaches c ON c.id = cs.coach_id
            WHERE cs.participant_id=$1 ORDER BY cs.scheduled_at DESC`, [participant.id]),
      ]);
      biometrics = bio.rows;
      sessions = ses.rows;
    }

    return ok({ record, participant, participant_id: participant ? participant.id : null, biometrics, sessions });
  } catch (e) { return serverError(e); }
};
