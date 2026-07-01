const { getPool } = require('./_db');
const { ok, badRequest, serverError, options, CORS } = require('./_auth');
const { sendEmail, mailEnabled } = require('./_mailer');
const { coachSlots, freeCoachesForSlot } = require('./_slots');

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
    const dur = duration_minutes || 60;
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

      // Create coaching session
      const { rows: sessionRows } = await db.query(
        `INSERT INTO coaching_sessions
           (participant_id, coach_id, group_id, scheduled_at, duration_minutes, session_type, intake_notes)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,'initial',$6)`,
        [participant_id, chosenCoachId, org_id, scheduled_at, dur, intake_notes || null]
      );

      // Send confirmation email — booking succeeds even if email fails
      let emailError = null;
      try {
        await sendConfirmation({
          to: email.trim().toLowerCase(),
          firstName: first_name.trim(), lastName: last_name.trim(),
          coachName, scheduledAt: scheduled_at, durationMinutes: dur,
        });
      } catch (err) { emailError = err.message; console.error('Confirmation email failed:', err.message); }

      return ok({ success: true, session: sessionRows[0], coach_name: coachName, email_error: emailError });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};

// ── Confirmation email ────────────────────────────────────────────────────────

async function sendConfirmation({ to, firstName, lastName, coachName, scheduledAt, durationMinutes }) {
  if (!mailEnabled()) return; // silently skip if no transport configured

  // Parse scheduled_at as UTC to match how the booking page submitted it
  const dt = new Date(scheduledAt);
  const dateStr = dt.toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const timeStr = dt.toLocaleTimeString('en-US', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true
  });

  await sendEmail({
    to,
    subject: `Your coaching session is confirmed — ${dateStr}`,
    html: buildEmailHtml({ firstName, lastName, coachName, dateStr, timeStr, durationMinutes }),
  });
}

function buildEmailHtml({ firstName, lastName, coachName, dateStr, timeStr, durationMinutes }) {
  const row = (label, value) => `
    <tr>
      <td style="padding:12px 0;font-size:13px;color:#9ca3af;font-weight:500;width:90px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${label}</td>
      <td style="padding:12px 0;font-size:14px;color:#1f2937;font-weight:600;vertical-align:top;border-bottom:1px solid #f3f4f6;">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Coaching Session Confirmed</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation"
           style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

      <!-- Header -->
      <tr>
        <td align="center" style="background:#0d9488;padding:30px 40px;">
          <img src="https://healthyou-wellness-platform.netlify.app/assets/img/hylogo.png"
               alt="HealYou" height="44"
               style="display:block;background:#fff;padding:4px 14px;border-radius:8px;">
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td align="center" style="background:#ffffff;padding:40px 48px 32px;">

          <!-- Checkmark -->
          <div style="width:64px;height:64px;border-radius:50%;background:#d1fae5;display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px;">
            <span style="font-size:32px;color:#059669;line-height:1;">&#10003;</span>
          </div>

          <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0d9488;">You're booked!</h1>
          <p style="margin:0 0 32px;font-size:14px;color:#9ca3af;line-height:1.5;">
            A wellness coordinator will be in touch with connection details.
          </p>

          <!-- Details -->
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                 style="background:#f9fafb;border-radius:10px;overflow:hidden;">
            <tr><td style="padding:4px 24px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                ${row('Name',     `${firstName} ${lastName}`)}
                ${row('Coach',    coachName)}
                ${row('Date',     dateStr)}
                ${row('Time',     timeStr)}
                <tr>
                  <td style="padding:12px 0;font-size:13px;color:#9ca3af;font-weight:500;width:90px;">Duration</td>
                  <td style="padding:12px 0;font-size:14px;color:#1f2937;font-weight:600;">${durationMinutes} minutes</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td align="center" style="background:#ffffff;padding:0 48px 36px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:13px;color:#9ca3af;">
            Have questions? Contact your wellness coordinator.
          </p>
        </td>
      </tr>

      <!-- Brand footer -->
      <tr>
        <td align="center" style="background:#f9fafb;padding:18px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;color:#d1d5db;">
            &copy; HealYou Health Coaching &nbsp;&bull;&nbsp; This is an automated confirmation.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
