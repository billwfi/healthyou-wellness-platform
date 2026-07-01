// Public cancel/reschedule of a coaching session via the emailed manage link.
//   GET  /api/manage-session?t=TOKEN                         -> session details
//   POST /api/manage-session { token, action:'cancel' }
//   POST /api/manage-session { token, action:'reschedule', scheduled_at, coach_id? }
// Self-service is allowed only up to the booking detail's cancel cutoff before the
// appointment (default 48h); inside that window it points to the support phone.
const { getPool } = require('./_db');
const { ok, badRequest, notFound, serverError, options } = require('./_auth');
const { coachSlots, freeCoachesForSlot } = require('./_slots');
const { sendConfirmation } = require('./_booking-email');
const { sendEmail, mailEnabled } = require('./_mailer');

const DEFAULT_CUTOFF = 48;
const DEFAULT_PHONE = '719-314-3535';
const DEFAULT_EMAIL = 'support@myhealthyou.com';

function baseUrl(event) {
  const proto = ((event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'] || 'https') + '').split(',')[0];
  const host = event.headers.host || event.headers.Host;
  return process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : 'https://healthyou-wellness-platform.netlify.app');
}
// scheduled_at is naive wall-clock; treat it as the reference instant for the cutoff.
const hoursUntil = (isoNaive) => (Date.parse(isoNaive.replace(' ', 'T') + 'Z') - Date.now()) / 3.6e6;

async function loadByToken(db, token) {
  const r = await db.query(
    `SELECT cs.id, cs.status, cs.coach_id, cs.group_id, cs.duration_minutes,
            CONVERT(varchar(19), cs.scheduled_at, 126) AS scheduled_at,
            p.first_name, p.last_name, p.email, p.phone,
            c.name AS coach_name, g.GroupName AS group_name,
            bd.cancel_cutoff_hours, bd.support_phone, bd.support_email, bd.session_minutes
       FROM coaching_sessions cs
       JOIN participants p ON p.id = cs.participant_id
       LEFT JOIN coaches c ON c.id = cs.coach_id
       LEFT JOIN iStrata.dbo.is_groups g ON g.id = cs.group_id
       LEFT JOIN dbo.booking_details bd ON bd.id = cs.booking_detail_id
      WHERE cs.manage_token = $1`, [token]);
  return r.rows[0] || null;
}
const cutoffOf = (s) => (s.cancel_cutoff_hours != null ? s.cancel_cutoff_hours : DEFAULT_CUTOFF);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const db = getPool();

  if (event.httpMethod === 'GET') {
    const token = (event.queryStringParameters || {}).t;
    if (!token) return badRequest('token required');
    try {
      const s = await loadByToken(db, token);
      if (!s) return notFound();
      const cutoff = cutoffOf(s);
      const canModify = s.status !== 'cancelled' && hoursUntil(s.scheduled_at) >= cutoff;
      return ok({ ...s, can_modify: canModify, cutoff_hours: cutoff, support_phone: s.support_phone || DEFAULT_PHONE });
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { token, action } = b;
    if (!token || !action) return badRequest('token and action required');
    try {
      const s = await loadByToken(db, token);
      if (!s) return notFound();
      const cutoff = cutoffOf(s);
      const phone = s.support_phone || DEFAULT_PHONE;
      const email = s.support_email || DEFAULT_EMAIL;
      if (s.status === 'cancelled') return badRequest('This appointment has already been cancelled.');
      if (hoursUntil(s.scheduled_at) < cutoff) return badRequest(`Within ${cutoff} hours of your appointment, please call ${phone} to cancel or reschedule.`);

      if (action === 'cancel') {
        await db.query("UPDATE coaching_sessions SET status='cancelled' WHERE id=$1", [s.id]);
        if (mailEnabled()) {
          try {
            const dt = new Date(s.scheduled_at + 'Z');
            const when = dt.toLocaleString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            await sendEmail({ to: s.email, subject: 'Your coaching session has been cancelled',
              html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#374151;">
                <h2 style="color:#0d9488;">Appointment cancelled</h2>
                <p>Hi ${s.first_name}, your coaching session scheduled for <strong>${when} (Mountain Time)</strong> has been cancelled.</p>
                <p style="font-size:13px;color:#6b7280;">Questions? Contact HealthYou Support at ${email} or ${phone}.</p></div>` });
          } catch (e) { console.error('Cancel email failed:', e.message); }
        }
        return ok({ status: 'cancelled' });
      }

      if (action === 'reschedule') {
        const scheduled_at = b.scheduled_at;
        if (!scheduled_at) return badRequest('scheduled_at required');
        if (Date.parse(scheduled_at.replace(' ', 'T') + 'Z') <= Date.now()) return badRequest('Please choose a future time.');
        const date = scheduled_at.slice(0, 10), time = scheduled_at.slice(11, 16);
        const dur = s.session_minutes || s.duration_minutes || 30;

        let coachId = b.coach_id ? parseInt(b.coach_id, 10) : null;
        if (coachId) {
          const slots = await coachSlots(db, coachId, date, dur);
          if (!slots.includes(time)) return badRequest('That time is no longer available for the selected coach. Please pick another time.');
        } else {
          const free = await freeCoachesForSlot(db, s.group_id, date, time, dur);
          if (!free.length) return badRequest('No coach is available at that time. Please choose another time.');
          coachId = free[Math.floor(Math.random() * free.length)];
        }

        await db.query("UPDATE coaching_sessions SET scheduled_at=$2, coach_id=$3, status='scheduled' WHERE id=$1",
          [s.id, scheduled_at, coachId]);
        const cn = await db.query('SELECT name FROM coaches WHERE id=$1', [coachId]);
        const coachName = cn.rows.length ? cn.rows[0].name : 'Your Health Coach';

        if (mailEnabled()) {
          try {
            await sendConfirmation({
              to: s.email, firstName: s.first_name, lastName: s.last_name, coachName,
              phone: s.phone || null, scheduledAt: scheduled_at, durationMinutes: dur,
              manageUrl: `${baseUrl(event)}/book/?manage=${token}`,
              subject: 'Your coaching session has been rescheduled',
              cutoffHours: cutoff, supportPhone: phone, supportEmail: email,
            });
          } catch (e) { console.error('Reschedule email failed:', e.message); }
        }
        return ok({ status: 'rescheduled', coach_name: coachName, scheduled_at });
      }

      return badRequest('unknown action');
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
