const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

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
      const tempPassword = generatePassword();

      let emailSent = false;
      let emailError = null;
      if (process.env.RESEND_API_KEY) {
        try {
          await sendWelcomeEmail(coach, tempPassword);
          emailSent = true;
        } catch (err) {
          emailError = err.message;
          console.error('Welcome email error:', err.message);
        }
      }

      return ok({ temp_password: tempPassword, email_sent: emailSent, email_error: emailError, email: coach.email });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generatePassword() {
  // Excludes ambiguous chars: 0, O, I, l, 1
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

async function sendWelcomeEmail(coach, tempPassword) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = process.env.RESEND_FROM || 'HealYou Health Coaching <onboarding@resend.dev>';
  const portalUrl = process.env.COACH_PORTAL_URL || 'https://healthyou-wellness-platform.netlify.app/coach/';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to: [coach.email],
      subject: 'Welcome to HealYou Health Coaching — Your Account Details',
      html: buildHtml(coach, tempPassword, portalUrl),
    }),
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function buildHtml(coach, tempPassword, portalUrl) {
  const firstName = coach.name.split(' ')[0];
  const specialtyLine = coach.specialty
    ? `Your expertise in <strong>${coach.specialty}</strong> will make a real difference for our clients.`
    : 'Your dedication will make a real difference for our clients.';

  const row = (label, value, mono) => `
    <tr>
      <td style="padding:10px 0;font-size:13px;color:#9ca3af;font-weight:500;width:110px;vertical-align:middle;border-bottom:1px solid #f3f4f6;">${label}</td>
      <td style="padding:10px 0;font-size:${mono ? '15px' : '13px'};color:#1f2937;font-weight:${mono ? '700' : '600'};letter-spacing:${mono ? '.08em' : '0'};font-family:${mono ? 'monospace' : 'inherit'};vertical-align:middle;border-bottom:1px solid #f3f4f6;">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Welcome to HealYou</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;">
<tr><td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" role="presentation"
       style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

  <!-- Teal header -->
  <tr>
    <td align="center" style="background:#0d9488;padding:28px 40px 0;">
      <img src="https://healthyou-wellness-platform.netlify.app/assets/img/hylogo.png"
           alt="HealYou" height="44"
           style="display:block;background:#fff;padding:4px 14px;border-radius:8px;">
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
        We're thrilled to welcome you to the HealYou Health Coaching team!
        ${specialtyLine}
        Use the credentials below to access your Coach Portal and get started.
      </p>

      <!-- Credentials box -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:28px;">
        <tr><td style="padding:20px 24px;">
          <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;">
            Your Login Credentials
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            ${row('Portal', `<a href="${portalUrl}" style="color:#0d9488;">${portalUrl}</a>`)}
            ${row('Email', coach.email)}
            <tr>
              <td style="padding:10px 0;font-size:13px;color:#9ca3af;font-weight:500;width:110px;">Temp Password</td>
              <td style="padding:10px 0;font-size:17px;font-weight:700;color:#1f2937;letter-spacing:.1em;font-family:monospace;">${tempPassword}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- CTA button -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px;">
        <tr><td align="center">
          <a href="${portalUrl}"
             style="display:inline-block;background:#0d9488;color:#fff;font-size:15px;font-weight:600;padding:14px 40px;border-radius:8px;text-decoration:none;letter-spacing:-.01em;">
            Access Coach Portal &rarr;
          </a>
        </td></tr>
      </table>

      <!-- Security note -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
              <strong>&#9888;&nbsp; Security reminder:</strong> This is a temporary password.
              Please change it after your first login.
            </p>
          </td>
        </tr>
      </table>
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
        &copy; HealYou Health Coaching &nbsp;&bull;&nbsp; This is an automated message.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
