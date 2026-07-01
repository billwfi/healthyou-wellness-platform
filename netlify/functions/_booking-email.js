// Coaching-session confirmation email (shared by book.js and manage-session.js).
const { sendEmail, mailEnabled } = require('./_mailer');

async function sendConfirmation({ to, firstName, lastName, coachName, phone, scheduledAt, durationMinutes, manageUrl, subject }) {
  if (!mailEnabled()) return; // silently skip if no transport configured
  const dt = new Date(scheduledAt);
  const dateStr = dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true });
  await sendEmail({
    to,
    subject: subject || `Your coaching session is confirmed — ${dateStr}`,
    html: buildEmailHtml({ firstName, lastName, coachName, phone, dateStr, timeStr, durationMinutes, manageUrl }),
  });
}

function buildEmailHtml({ firstName, lastName, coachName, phone, dateStr, timeStr, durationMinutes, manageUrl }) {
  const row = (label, value) => `
    <tr>
      <td style="padding:12px 0;font-size:13px;color:#9ca3af;font-weight:500;width:90px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${label}</td>
      <td style="padding:12px 0;font-size:14px;color:#1f2937;font-weight:600;vertical-align:top;border-bottom:1px solid #f3f4f6;">${value}</td>
    </tr>`;

  const manageBlock = manageUrl ? `
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:26px;">
            <tr><td align="center">
              <a href="${manageUrl}" style="display:inline-block;background:#0d9488;color:#fff;font-size:14px;font-weight:600;padding:12px 30px;border-radius:8px;text-decoration:none;">Reschedule or Cancel</a>
              <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">You can reschedule or cancel up to 48 hours before your appointment.<br>Within 48 hours, please call 719-314-3535.</p>
            </td></tr>
          </table>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Coaching Session Confirmed</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation"
           style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
      <tr>
        <td align="center" style="background:#0d9488;padding:28px 40px;">
          <img src="https://healthyou-wellness-platform.netlify.app/assets/img/hylogo-white.png" alt="HealthYou" height="40" style="display:block;">
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:36px 48px 32px;">
          <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#0d9488;text-align:center;">Your coaching session is confirmed</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.7;text-align:center;">
            Your assigned Health Coach will call you at the provided number on your scheduled coaching date/time. See details below.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;border-radius:10px;overflow:hidden;">
            <tr><td style="padding:4px 24px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                ${row('Name', `${firstName} ${lastName}`)}
                ${row('Coach', coachName)}
                ${row('Phone', phone || '—')}
                ${row('Date', dateStr)}
                ${row('Time', timeStr + ' (Mountain Time)')}
                <tr>
                  <td style="padding:12px 0;font-size:13px;color:#9ca3af;font-weight:500;width:90px;">Duration</td>
                  <td style="padding:12px 0;font-size:14px;color:#1f2937;font-weight:600;">${durationMinutes} minutes</td>
                </tr>
              </table>
            </td></tr>
          </table>
          ${manageBlock}
        </td>
      </tr>
      <tr>
        <td align="center" style="background:#ffffff;padding:8px 48px 34px;border-top:1px solid #f3f4f6;">
          <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
            <strong style="color:#374151;">Have Questions?</strong><br>
            Reach out to HealthYou Support at
            <a href="mailto:support@myhealthyou.com" style="color:#0d9488;">support@myhealthyou.com</a>
            or <a href="tel:+17193143535" style="color:#0d9488;">719-314-3535</a>.
          </p>
        </td>
      </tr>
      <tr>
        <td align="center" style="background:#f9fafb;padding:18px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;color:#d1d5db;">&copy; HealthYou Health Coaching &nbsp;&bull;&nbsp; This is an automated confirmation.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

module.exports = { sendConfirmation };
