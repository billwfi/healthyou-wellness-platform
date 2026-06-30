// Eligibility verification for event registration. When an event has
// requires_eligibility set, the public registration form calls this with the
// registrant's name/DOB/gender. We match against the iStrata eligibility view
// (iStrata.dbo.vw_full_eligibility) for the event's group, requiring an Active
// account. Public endpoint (no auth) — used by the registration wizard.
const { getPool } = require('./_db');
const { ok, badRequest, notFound, serverError, options } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return badRequest('Method not supported');
  const db = getPool();
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }

  const slug = b.slug;
  const first = (b.first_name || '').trim();
  const last = (b.last_name || '').trim();
  const dob = (b.date_of_birth || '').trim();         // YYYY-MM-DD
  const genderRaw = (b.gender || '').trim();
  const gender = genderRaw ? genderRaw[0].toUpperCase() : '';   // M / F
  if (!slug) return badRequest('slug required');
  if (!first || !last || !dob || !gender) return badRequest('first_name, last_name, date_of_birth and gender are required');

  try {
    const ev = await db.query('SELECT id, org_id, requires_eligibility FROM screening_events WHERE public_slug=$1', [slug]);
    if (!ev.rows.length) return notFound();
    const e = ev.rows[0];
    // If the event doesn't require verification, treat everyone as eligible.
    if (!e.requires_eligibility) return ok({ eligible: true, required: false });
    if (!e.org_id) return ok({ eligible: false, required: true, reason: 'This event is not linked to an eligibility group.' });

    // Match on name + gender + active in SQL, then compare DOB in JS. (Putting a
    // DOB CONVERT in the WHERE makes the iStrata view throw a conversion error
    // under some query plans; selecting the DOB and comparing here is robust.)
    const r = await db.query(
      `SELECT CONVERT(varchar(10), TRY_CONVERT(date, el.[DOB]), 23) AS dob
         FROM iStrata.dbo.is_groups g
         JOIN iStrata.dbo.vw_full_eligibility el ON el.groupid = g.GroupId
        WHERE g.id = $1
          AND g.GroupId IS NOT NULL AND g.GroupId <> ''
          AND el.[Account Status] = 'Active'
          AND LOWER(LTRIM(RTRIM(el.[First Name]))) = LOWER($2)
          AND LOWER(LTRIM(RTRIM(el.[Last Name])))  = LOWER($3)
          AND UPPER(LEFT(LTRIM(el.[Gender]),1)) = $4`,
      [e.org_id, first.toLowerCase(), last.toLowerCase(), gender]
    );
    const eligible = r.rows.some(row => row.dob === dob);
    return ok({ eligible, required: true });
  } catch (err) { return serverError(err); }
};
