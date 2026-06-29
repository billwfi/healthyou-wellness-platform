const { getPool } = require('./_db');
const { ok, badRequest, serverError, options, CORS } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const db = getPool();

  // GET: look up org by slug (used by the booking page to display org name)
  if (event.httpMethod === 'GET') {
    const { org } = event.queryStringParameters || {};
    if (!org) return badRequest('org slug required');
    try {
      const { rows } = await db.query(
        'SELECT id, name, slug FROM organizations WHERE slug=$1 AND active=1', [org]
      );
      if (!rows.length) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Organization not found' }) };
      return ok(rows[0]);
    } catch (e) { return serverError(e); }
  }

  // POST: submit a booking (public — no auth required)
  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { coach_id, first_name, last_name, email, scheduled_at, duration_minutes, intake_notes, org_slug } = b;
    if (!first_name || !last_name || !email || !scheduled_at)
      return badRequest('first_name, last_name, email, and scheduled_at are required');

    try {
      // Resolve org
      let org_id = null;
      if (org_slug) {
        const { rows } = await db.query('SELECT id FROM organizations WHERE slug=$1', [org_slug]);
        if (rows.length) org_id = rows[0].id;
      }

      // Look up coach name for the confirmation email
      let coachName = 'Your Health Coach';
      if (coach_id) {
        const { rows } = await db.query('SELECT name FROM coaches WHERE id=$1', [coach_id]);
        if (rows.length) coachName = rows[0].name;
      }

      // Upsert participant by email
      const { rows: ptRows } = await db.query(
        `MERGE participants AS t
         USING (SELECT $1 AS email, $2 AS first_name, $3 AS last_name, $4 AS org_id) AS s
         ON t.email = s.email
         WHEN MATCHED THEN UPDATE SET
           first_name = s.first_name,
           last_name  = s.last_name,
           org_id     = COALESCE(s.org_id, t.org_id)
         WHEN NOT MATCHED THEN INSERT (email, first_name, last_name, org_id)
           VALUES (s.email, s.first_name, s.last_name, s.org_id)
         OUTPUT INSERTED.id;`,
        [email.trim().toLowerCase(), first_name.trim(), last_name.trim(), org_id]
      );
      const participant_id = ptRows[0].id;

      // Create coaching session
      const { rows: sessionRows } = await db.query(
        `INSERT INTO coaching_sessions
           (participant_id, coach_id, scheduled_at, duration_minutes, session_type, intake_notes)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,'initial',$5)`,
        [participant_id, coach_id || null, scheduled_at, duration_minutes || 60, intake_notes || null]
      );

      // Send confirmation email — booking succeeds even if email fails
      let emailError = null;
      try {
        await sendConfirmation({
          to: email.trim().toLowerCase(),
          firstName: first_name.trim(),
          lastName:  last_name.trim(),
          coachName,
          scheduledAt: scheduled_at,
          durationMinutes: duration_minutes || 60,
        });
      } catch (err) {
        emailError = err.message;
        console.error('Confirmation email failed:', err.message);
      }

      return ok({ success: true, session: sessionRows[0], email_error: emailError });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};

// ── Confirmation email ────────────────────────────────────────────────────────

async function sendConfirmation({ to, firstName, lastName, coachName, scheduledAt, durationMinutes }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return; // silently skip if not configured

  // Parse scheduled_at as UTC to match how the booking page submitted it
  const dt = new Date(scheduledAt);
  const dateStr = dt.toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const timeStr = dt.toLocaleTimeString('en-US', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true
  });

  const from = process.env.RESEND_FROM || 'HealYou Health Coaching <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your coaching session is confirmed — ${dateStr}`,
      html: buildEmailHtml({ firstName, lastName, coachName, dateStr, timeStr, durationMinutes }),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
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
