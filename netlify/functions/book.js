const { getPool } = require('./_db');
const { ok, badRequest, serverError, options, CORS } = require('./_auth');
const { sendConfirmation } = require('./_booking-email');
const { coachSlots, freeCoachesForSlot } = require('./_slots');
const crypto = require('crypto');

function baseUrl(event) {
  const proto = ((event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'] || 'https') + '').split(',')[0];
  const host = event.headers.host || event.headers.Host;
  return process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : 'https://healthyou-wellness-platform.netlify.app');
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const db = getPool();

  // GET: look up org by slug (used by the booking page to display org name)
  if (event.httpMethod === 'GET') {
    const { org } = event.queryStringParameters || {};
    if (!org) return badRequest('org slug required');
    try {
      const { rows } = await db.query(
        "SELECT id, GroupName AS name, GroupId AS slug FROM iStrata.dbo.is_groups WHERE GroupId=$1 AND GroupStatus='Active'", [org]
      );
      if (!rows.length) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Organization not found' }) };
      return ok(rows[0]);
    } catch (e) { return serverError(e); }
  }

  // POST: submit a booking (public — no auth required)
  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { coach_id, group_id, first_name, last_name, email, phone, date_of_birth, gender,
            scheduled_at, duration_minutes, intake_notes, org_slug } = b;
    if (!first_name || !last_name || !email || !scheduled_at)
      return badRequest('first_name, last_name, email, and scheduled_at are required');
    if (!group_id && !coach_id) return badRequest('group_id or coach_id required');
    const dur = duration_minutes || 30;
    const date = scheduled_at.slice(0, 10);
    const time = scheduled_at.slice(11, 16);   // HH:MM

    try {
      // Resolve org/group: prefer explicit group_id, else legacy org_slug.
      let org_id = group_id ? parseInt(group_id, 10) : null;
      if (!org_id && org_slug) {
        const { rows } = await db.query('SELECT id FROM iStrata.dbo.is_groups WHERE GroupId=$1', [org_slug]);
        if (rows.length) org_id = rows[0].id;
      }

      // Pick the coach: a specific one (verify still open) or, for "Anyone", a
      // random coach in the group who is free at this slot.
      let chosenCoachId = coach_id ? parseInt(coach_id, 10) : null;
      if (chosenCoachId) {
        const slots = await coachSlots(db, chosenCoachId, date, dur);
        if (!slots.includes(time)) return badRequest('That time is no longer available for the selected coach. Please pick another time.');
      } else {
        const free = await freeCoachesForSlot(db, org_id, date, time, dur);
        if (!free.length) return badRequest('No coach is available at that time. Please choose another time.');
        chosenCoachId = free[Math.floor(Math.random() * free.length)];
      }

      // Coach name for the confirmation email
      let coachName = 'Your Health Coach';
      const cn = await db.query('SELECT name FROM coaches WHERE id=$1', [chosenCoachId]);
      if (cn.rows.length) coachName = cn.rows[0].name;

      // Upsert participant by email (capture phone/DOB/gender/group)
      const { rows: ptRows } = await db.query(
        `MERGE participants AS t
         USING (SELECT $1 AS email, $2 AS first_name, $3 AS last_name, $4 AS org_id,
                       $5 AS date_of_birth, $6 AS gender, $7 AS phone) AS s
         ON t.email = s.email
         WHEN MATCHED THEN UPDATE SET
           first_name = s.first_name, last_name = s.last_name,
           org_id = COALESCE(s.org_id, t.org_id),
           date_of_birth = COALESCE(s.date_of_birth, t.date_of_birth),
           gender = COALESCE(s.gender, t.gender),
           phone  = COALESCE(s.phone, t.phone)
         WHEN NOT MATCHED THEN INSERT (email, first_name, last_name, org_id, date_of_birth, gender, phone)
           VALUES (s.email, s.first_name, s.last_name, s.org_id, s.date_of_birth, s.gender, s.phone)
         OUTPUT INSERTED.id;`,
        [email.trim().toLowerCase(), first_name.trim(), last_name.trim(), org_id,
         date_of_birth || null, gender || null, phone || null]
      );
      const participant_id = ptRows[0].id;

      // Create coaching session (with a public manage token for cancel/reschedule)
      const manageToken = crypto.randomBytes(24).toString('hex');
      const { rows: sessionRows } = await db.query(
        `INSERT INTO coaching_sessions
           (participant_id, coach_id, group_id, scheduled_at, duration_minutes, session_type, intake_notes, manage_token)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,'initial',$6,$7)`,
        [participant_id, chosenCoachId, org_id, scheduled_at, dur, intake_notes || null, manageToken]
      );

      // Send confirmation email — booking succeeds even if email fails
      let emailError = null;
      try {
        await sendConfirmation({
          to: email.trim().toLowerCase(),
          firstName: first_name.trim(), lastName: last_name.trim(),
          coachName, phone: phone || null, scheduledAt: scheduled_at, durationMinutes: dur,
          manageUrl: `${baseUrl(event)}/book/?manage=${manageToken}`,
        });
      } catch (err) { emailError = err.message; console.error('Confirmation email failed:', err.message); }

      return ok({ success: true, session: sessionRows[0], coach_name: coachName, email_error: emailError });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
