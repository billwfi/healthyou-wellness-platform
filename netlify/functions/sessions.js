const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');
const { sendConfirmation } = require('./_booking-email');
const { sendEmail, mailEnabled } = require('./_mailer');
const crypto = require('crypto');

function baseUrl(event) {
  const proto = ((event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'] || 'https') + '').split(',')[0];
  const host = event.headers.host || event.headers.Host;
  return process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : 'https://healthyou-wellness-platform.netlify.app');
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const where = [], vals = [];
    if (qs.participant_id) where.push(`cs.participant_id=$${vals.push(qs.participant_id)}`);
    if (qs.coach_id)       where.push(`cs.coach_id=$${vals.push(qs.coach_id)}`);
    if (qs.from)           where.push(`cs.scheduled_at >= $${vals.push(qs.from)}`);
    if (qs.to)             where.push(`cs.scheduled_at <  $${vals.push(qs.to)}`);
    try {
      const r = await db.query(
        `SELECT cs.*,
                p.first_name, p.last_name, p.email AS participant_email,
                c.name AS coach_name,
                gcol.color AS group_color, g.GroupName AS group_name,
                cn.stage_of_change, cn.session_notes, cn.updated_at AS notes_updated_at
           FROM coaching_sessions cs
           JOIN participants p ON p.id=cs.participant_id
           LEFT JOIN coaches c ON c.id=cs.coach_id
           LEFT JOIN dbo.group_colors gcol ON gcol.group_id=cs.group_id
           LEFT JOIN iStrata.dbo.is_groups g ON g.id=cs.group_id
           LEFT JOIN coaching_notes cn ON cn.session_id=cs.id
          ${where.length ? 'WHERE '+where.join(' AND ') : ''}
          ORDER BY cs.scheduled_at DESC`,
        vals);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  // Schedule the next (follow-up) session with a participant + email them.
  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { participant_id, scheduled_at, duration_minutes, intake_notes } = b;
    if (!participant_id || !scheduled_at) return badRequest('participant_id and scheduled_at required');
    const cId = b.coach_id || user.coach_id || null;
    const type = b.session_type || 'follow_up';
    const dur = duration_minutes || 30;
    try {
      let followupNumber = null;
      if (type === 'follow_up') {
        const cnt = await db.query(
          "SELECT COUNT(*) AS n FROM coaching_sessions WHERE participant_id=$1 AND session_type='follow_up' AND status<>'cancelled'",
          [participant_id]);
        followupNumber = (parseInt(cnt.rows[0].n, 10) || 0) + 1;
      }
      const manageToken = crypto.randomBytes(24).toString('hex');
      const r = await db.query(
        `INSERT INTO coaching_sessions (participant_id,coach_id,scheduled_at,duration_minutes,session_type,intake_notes,manage_token,followup_number)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [participant_id, cId, scheduled_at, dur, type, intake_notes||null, manageToken, followupNumber]);
      const session = r.rows[0];

      // Email the participant that their next session is scheduled.
      try {
        const pr = await db.query('SELECT email, first_name, last_name, phone FROM participants WHERE id=$1', [participant_id]);
        const p = pr.rows[0];
        let coachName = 'Your Health Coach';
        if (cId) { const c = await db.query('SELECT name FROM coaches WHERE id=$1', [cId]); if (c.rows.length) coachName = c.rows[0].name; }
        if (p && p.email && mailEnabled()) {
          await sendConfirmation({
            to: p.email, firstName: p.first_name, lastName: p.last_name, coachName,
            phone: p.phone || null, scheduledAt: scheduled_at, durationMinutes: dur,
            manageUrl: `${baseUrl(event)}/book/?manage=${manageToken}`,
            subject: followupNumber ? `Your next coaching session (Follow-up #${followupNumber}) is scheduled` : 'Your coaching session is scheduled',
          });
        }
      } catch (e) { console.error('Next-session email failed:', e.message); }

      return created(session);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PATCH') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, status } = b;
    if (!id || !status) return badRequest('id and status required');
    try {
      const cur = await db.query(
        'SELECT completion_email_sent, participant_id, coach_id, CONVERT(varchar(19),scheduled_at,126) AS scheduled_at FROM coaching_sessions WHERE id=$1', [id]);
      if (!cur.rows.length) return notFound();
      const prev = cur.rows[0];

      const r = await db.query('UPDATE coaching_sessions SET status=$2 OUTPUT INSERTED.* WHERE id=$1', [id, status]);

      // On completion, email the participant a summary with the session notes (once).
      if (status === 'completed' && !prev.completion_email_sent && mailEnabled()) {
        try {
          const notesR = await db.query('SELECT session_notes FROM coaching_notes WHERE session_id=$1', [id]);
          const notes = notesR.rows.length ? notesR.rows[0].session_notes : null;
          const pr = await db.query('SELECT email, first_name, last_name FROM participants WHERE id=$1', [prev.participant_id]);
          const p = pr.rows[0];
          let coachName = 'Your Health Coach';
          if (prev.coach_id) { const c = await db.query('SELECT name FROM coaches WHERE id=$1', [prev.coach_id]); if (c.rows.length) coachName = c.rows[0].name; }
          if (p && p.email) {
            await sendCompletionEmail({ to: p.email, firstName: p.first_name, coachName, scheduledAt: prev.scheduled_at, notes });
            await db.query('UPDATE coaching_sessions SET completion_email_sent=1 WHERE id=$1', [id]);
          }
        } catch (e) { console.error('Completion email failed:', e.message); }
      }
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};

// ── Session-completed summary email ──────────────────────────────────────────
async function sendCompletionEmail({ to, firstName, coachName, scheduledAt, notes }) {
  const dt = new Date(scheduledAt);
  const dateStr = dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const esc = s => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const notesHtml = notes ? esc(notes).replace(/\n/g, '<br>') : '<em style="color:#9ca3af;">No notes were recorded for this session.</em>';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
  <tr><td align="center" style="background:#0d9488;padding:28px 40px;">
    <img src="https://healthyou-wellness-platform.netlify.app/assets/img/hylogo-white.png" alt="HealthYou" height="40" style="display:block;">
  </td></tr>
  <tr><td style="background:#fff;padding:36px 48px 32px;">
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0d9488;text-align:center;">Your session summary</h1>
    <p style="margin:0 0 22px;font-size:14px;color:#4b5563;line-height:1.7;text-align:center;">
      Thank you for meeting with ${esc(coachName)} on ${dateStr}. Here are the notes from your session:
    </p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;font-size:14px;color:#1f2937;line-height:1.7;">${notesHtml}</div>
  </td></tr>
  <tr><td align="center" style="background:#fff;padding:0 48px 34px;border-top:1px solid #f3f4f6;">
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
      Questions? Reach out to HealthYou Support at
      <a href="mailto:support@myhealthyou.com" style="color:#0d9488;">support@myhealthyou.com</a> or
      <a href="tel:+17193143535" style="color:#0d9488;">719-314-3535</a>.
    </p>
  </td></tr>
  <tr><td align="center" style="background:#f9fafb;padding:18px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:12px;color:#d1d5db;">&copy; HealthYou Health Coaching &nbsp;&bull;&nbsp; This is an automated message.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  await sendEmail({ to, subject: `Your coaching session summary — ${dateStr}`, html });
}
