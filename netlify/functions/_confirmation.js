// Builds and sends (or re-sends) the screening appointment confirmation email,
// using the event's assigned email template. Shared by the public registration
// flow and the admin "Resend" action.
const { sendEmail, mailEnabled } = require('./_mailer');

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtTime(t) { if (!t) return ''; const p = String(t).split(':'); let h = parseInt(p[0], 10); if (isNaN(h)) return t; const m = (p[1] || '00').slice(0, 2); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${m} ${ap}`; }
function applyVars(s, ctx) { return String(s || '').replace(/{{\s*(\w+)\s*}}/g, (_, k) => esc(ctx[k] != null ? ctx[k] : '')); }

// Load a single appointment and (re)send its confirmation email. Returns
// { sent:true } or { skipped:true } when no transport is configured.
async function sendAppointmentConfirmation(db, appointmentId) {
  const ar = await db.query(
    `SELECT a.first_name, a.last_name, a.email, a.event_id, a.location_id, a.magic_token AS token,
            CONVERT(varchar(10), a.appointment_date, 23) AS appointment_date,
            CONVERT(varchar(5),  a.appointment_time, 108) AS appointment_time
       FROM event_appointments a WHERE a.id=$1`, [appointmentId]);
  const a = ar.rows[0];
  if (!a) throw new Error('Appointment not found');
  if (!a.email) throw new Error('This registrant has no email address on file');
  return buildAndSend(db, a);
}

async function buildAndSend(db, { email, first_name, last_name, event_id, eventId, location_id, appointment_date, appointment_time, token }) {
  if (!mailEnabled()) return { skipped: true };
  const evId = event_id || eventId;
  const ev = await db.query('SELECT name, email_template_id, org_id FROM screening_events WHERE id=$1', [evId]);
  const e = ev.rows[0] || {};
  let tpl = {};
  if (e.email_template_id) {
    const t = await db.query('SELECT subject, body_html FROM email_templates WHERE id=$1 AND active=1', [e.email_template_id]);
    tpl = t.rows[0] || {};
  }
  const grp = e.org_id ? await db.query('SELECT GroupName AS name FROM iStrata.dbo.is_groups WHERE id=$1', [e.org_id]) : { rows: [] };
  const loc = await db.query('SELECT name, address, city, state FROM event_locations WHERE id=$1', [location_id]);
  const l = loc.rows[0] || {};
  const locLine = [l.name, l.address, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const dt = new Date(`${appointment_date}T${appointment_time}:00`);
  const dateStr = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = fmtTime(appointment_time);
  const site = process.env.URL || 'https://healthyou-wellness-platform.netlify.app';
  const manageLink = token ? `${site}/manage/?t=${token}` : site;
  const ctx = { first_name, last_name, event: e.name || 'Screening Event', group: grp.rows[0]?.name || '',
                location: locLine, date: dateStr, time: timeStr, manage_link: manageLink };

  const subject = applyVars(tpl.subject || 'Your screening appointment — {{date}}', ctx);
  const body = tpl.body_html
    ? applyVars(tpl.body_html, ctx)
    : `<p>Hi ${esc(first_name)} ${esc(last_name)}, your screening appointment is confirmed.</p>`;
  const logo = `${site}/assets/img/hylogo.png`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#0d9488;padding:18px;text-align:center;"><img src="${logo}" alt="HealthYou" height="34" style="background:#fff;padding:4px 12px;border-radius:8px;"></div>
    <div style="padding:24px;color:#334155;font-size:14px;">
      ${ctx.group ? `<div style="font-weight:600;margin-bottom:10px;">${esc(ctx.group)}</div>` : ''}
      ${body}
      <div style="margin:18px 0;padding:14px;background:#f1f5f9;border-radius:8px;font-size:13px;">
        <strong>${esc(ctx.event)}</strong><br>${esc(locLine || '—')}<br>${esc(dateStr)} at ${esc(timeStr)}
      </div>
      <p style="font-size:13px;color:#64748b;">Need to make a change? <a href="${manageLink}" style="color:#0d9488;">Cancel or reschedule your appointment</a>.</p>
    </div></div>`;
  await sendEmail({ to: email, subject, html });
  return { sent: true };
}

module.exports = { sendAppointmentConfirmation, buildAndSend };
