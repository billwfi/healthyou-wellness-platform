// Passwordless (magic-link) sign-in for the Coach Portal. Coaches live in the
// coaches table (not app_users) and never have a password.
//   POST /api/coach-login { email }  -> emails a short-lived sign-in link (always 200)
//   POST /api/coach-login { token }  -> exchanges a valid link token for a 12h session token
const { getPool } = require('./_db');
const { signToken, verifyToken, ok, badRequest, serverError, options, CORS } = require('./_auth');
const { sendEmail, mailEnabled } = require('./_mailer');

function baseUrl(event) {
  const proto = ((event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'] || 'https') + '').split(',')[0];
  const host = event.headers.host || event.headers.Host;
  return process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : 'https://healthyou-wellness-platform.netlify.app');
}
const unauth = (msg) => ({ statusCode: 401, headers: CORS, body: JSON.stringify({ error: msg }) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return badRequest('Method not supported');
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
  const db = getPool();

  // ── Verify: exchange a magic-link token for a coach session token ────────────
  if (b.token) {
    const claims = verifyToken(b.token);
    if (!claims || claims.purpose !== 'coach-magic' || !claims.coach_id) {
      return unauth('This sign-in link is invalid or has expired. Please request a new one.');
    }
    try {
      const { rows } = await db.query('SELECT id, name, email, active FROM coaches WHERE id=$1', [claims.coach_id]);
      if (!rows.length || !rows[0].active) return unauth('This coach account is no longer active.');
      const c = rows[0];
      const token = signToken(
        { sub: String(c.id), coach_id: c.id, email: c.email, role: 'Health Coach', full_name: c.name, portal: 'coach' },
        43200 // 12h
      );
      return ok({ token, coach: { id: c.id, name: c.name, email: c.email } });
    } catch (e) { return serverError(e); }
  }

  // ── Request: email a sign-in link (respond the same whether or not it exists) ─
  const email = (b.email || '').toString().trim().toLowerCase();
  if (!email) return badRequest('Email is required');
  const generic = ok({ ok: true });
  try {
    const { rows } = await db.query('SELECT id, name, email FROM coaches WHERE LOWER(email)=$1 AND active=1', [email]);
    if (rows.length && mailEnabled()) {
      const c = rows[0];
      const magic = signToken({ purpose: 'coach-magic', coach_id: c.id, email: c.email, name: c.name }, 1800); // 30 min
      const link = `${baseUrl(event)}/coach/?token=${encodeURIComponent(magic)}`;
      try { await sendEmail({ to: c.email, subject: 'Your HealthYou Coach Portal sign-in link', html: signInHtml(c, link) }); }
      catch (e) { console.error('Coach sign-in email failed:', e.message); }
    }
    return generic;
  } catch (e) { console.error(e); return generic; }
};

function signInHtml(coach, link) {
  const firstName = (coach.name || '').split(' ')[0] || 'there';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Coach Portal sign-in</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;">
<tr><td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
  <tr><td align="center" style="background:#0d9488;padding:28px 40px;">
    <img src="https://healthyou-wellness-platform.netlify.app/assets/img/hylogo-white.png" alt="HealthYou" height="40" style="display:block;">
  </td></tr>
  <tr><td style="background:#fff;padding:40px 48px 36px;">
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#1f2937;">Hi ${firstName},</p>
    <p style="margin:0 0 28px;font-size:14px;color:#4b5563;line-height:1.7;">
      Use the button below to sign in to your HealthYou Coach Portal. This link expires in 30 minutes and can be used once.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px;">
      <tr><td align="center">
        <a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;font-size:15px;font-weight:600;padding:14px 40px;border-radius:8px;text-decoration:none;">Sign in to Coach Portal &rarr;</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
      If you didn't request this, you can ignore this email. Trouble with the button? Paste this link into your browser:<br>
      <span style="color:#0d9488;word-break:break-all;">${link}</span>
    </p>
  </td></tr>
  <tr><td align="center" style="background:#f9fafb;padding:18px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:12px;color:#d1d5db;">&copy; HealthYou Health Coaching &nbsp;&bull;&nbsp; This is an automated message.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}
