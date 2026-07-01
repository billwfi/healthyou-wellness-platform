const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');
const { sendEmail, mailEnabled } = require('./_mailer');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { coach_id } = b;
    if (!coach_id) return badRequest('coach_id required');

    const db = getPool();
    try {
      const { rows } = await db.query('SELECT * FROM coaches WHERE id=$1', [coach_id]);
      if (!rows.length) return badRequest('Coach not found');
      const coach = rows[0];

      let emailSent = false;
      let emailError = null;
      if (mailEnabled()) {
        try { await sendWelcomeEmail(coach); emailSent = true; }
        catch (err) { emailError = err.message; console.error('Welcome email error:', err.message); }
      }

      return ok({ email_sent: emailSent, email_error: emailError, email: coach.email });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};

// ── Welcome email ─────────────────────────────────────────────────────────────
// Coaches sign in passwordlessly (magic link requested at the portal), so this
// email just welcomes the coach and links them to the Coach Portal to sign in.

async function sendWelcomeEmail(coach) {
  if (!mailEnabled()) return;
  const portalUrl = process.env.COACH_PORTAL_URL || 'https://healthyou-wellness-platform.netlify.app/coach/';
  await sendEmail({
    to: coach.email,
    subject: 'Welcome to HealthYou Health Coaching',
    html: buildHtml(coach, portalUrl),
  });
}

function buildHtml(coach, portalUrl) {
  const firstName = (coach.name || '').split(' ')[0] || 'there';
  const specialtyLine = coach.specialty
    ? `Your expertise in <strong>${coach.specialty}</strong> will make a real difference for our clients.`
    : 'Your dedication will make a real difference for our clients.';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Welcome to HealthYou</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;">
<tr><td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" role="presentation"
       style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

  <!-- Teal header with white HealthYou logo -->
  <tr>
    <td align="center" style="background:#0d9488;padding:28px 40px 0;">
      <img src="https://healthyou-wellness-platform.netlify.app/assets/img/hylogo-white.png"
           alt="HealthYou" height="40" style="display:block;">
    </td>
  </tr>
  <tr>
    <td align="center" style="background:#0d9488;padding:16px 40px 28px;">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-.02em;">Welcome to the Team!</h1>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#fff;padding:40px 48px 32px;">
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#1f2937;">Hi ${firstName},</p>
      <p style="margin:0 0 28px;font-size:14px;color:#4b5563;line-height:1.7;">
        We're thrilled to welcome you to the HealthYou Health Coaching team!
        ${specialtyLine}
        Your Coach Portal is where you'll see your monthly appointment calendar and manage your caseload.
      </p>

      <!-- CTA button -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px;">
        <tr><td align="center">
          <a href="${portalUrl}"
             style="display:inline-block;background:#0d9488;color:#fff;font-size:15px;font-weight:600;padding:14px 40px;border-radius:8px;text-decoration:none;letter-spacing:-.01em;">
            Go to the Coach Portal &rarr;
          </a>
        </td></tr>
      </table>

      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
        To sign in, open the portal and enter this email address (<strong>${coach.email}</strong>).
        We'll email you a secure one-time sign-in link — no password required.
      </p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#fff;padding:0 48px 32px;">
      <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.5;">
        Have questions? Contact your wellness program administrator.
      </p>
    </td>
  </tr>

  <!-- Brand bar -->
  <tr>
    <td align="center" style="background:#f9fafb;padding:18px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#d1d5db;">
        &copy; HealthYou Health Coaching &nbsp;&bull;&nbsp; This is an automated message.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
