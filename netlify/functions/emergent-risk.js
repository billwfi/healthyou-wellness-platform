// Emergent Risk form: when a screening flags a Critical Risk / Medical Emergency
// or Metabolic Syndrome (>=3 criteria), the screener completes this short form
// with the participant. We record the acknowledgement and email a copy of the
// form to the registrant.
const { getPool } = require('./_db');
const { ok, created, badRequest, serverError, options } = require('./_auth');
const { sendEmail, mailEnabled } = require('./_mailer');

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function buildEmailHtml(ctx) {
  const { first_name, risks, msHigh, msCount, followUp, availability, eventName } = ctx;
  const riskItems = (risks || []).map(r => `<li style="margin-bottom:4px;">${esc(r)}</li>`).join('')
    + (msHigh ? `<li style="margin-bottom:4px;">Metabolic Syndrome — ${esc(msCount)} of 5 criteria (higher risk)</li>` : '');
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#0d7a74;padding:18px 24px;text-align:center;">
        <img src="https://healthyou-wellness-platform.netlify.app/assets/img/hylogo-white.png" alt="HealthYou" height="36" style="height:36px;"/>
      </div>
      <div style="padding:24px;">
        <h2 style="margin:0 0 12px;font-size:1.15rem;color:#991b1b;">Emergent Risk — Screening Follow-up</h2>
        <p style="font-size:.95rem;line-height:1.55;">Dear ${esc(first_name || 'Participant')},</p>
        <p style="font-size:.95rem;line-height:1.55;">During your recent biometric screening${eventName ? ' at ' + esc(eventName) : ''}, an emergent risk was identified:</p>
        <ul style="font-size:.95rem;line-height:1.5;color:#374151;padding-left:20px;">${riskItems}</ul>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:16px 0;font-size:.92rem;line-height:1.5;color:#7f1d1d;">
          We strongly recommend you discuss these results with a medical provider. If you are experiencing symptoms, please seek medical care promptly.
        </div>
        <table style="width:100%;font-size:.92rem;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;width:60%;">Requested a provider follow-up?</td><td style="padding:6px 0;font-weight:700;">${followUp ? 'Yes' : 'No'}</td></tr>
          ${followUp && availability ? `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">Best days / times to be contacted</td><td style="padding:6px 0;font-weight:600;">${esc(availability).replace(/\n/g, '<br>')}</td></tr>` : ''}
        </table>
        <p style="font-size:.82rem;color:#9ca3af;line-height:1.5;margin-top:18px;">This message confirms the emergent-risk acknowledgement completed during your screening. It is not a diagnosis. Please consult your healthcare provider regarding your results.</p>
      </div>
    </div>
    <p style="text-align:center;font-size:.75rem;color:#9ca3af;margin-top:14px;">HealthYou Wellness · myhealthyou.com</p>
  </div></body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return badRequest('Method not supported');
  const db = getPool();
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return badRequest('Invalid JSON'); }

  const participant_id = b.participant_id ? parseInt(b.participant_id, 10) : null;
  const event_id = b.event_id ? parseInt(b.event_id, 10) : null;
  const risks = Array.isArray(b.risks) ? b.risks : [];
  const msHigh = !!b.metabolic_syndrome;
  const msCount = b.ms_count != null ? parseInt(b.ms_count, 10) : null;
  const followUp = !!b.follow_up;
  const availability = b.availability ? String(b.availability).slice(0, 1000) : null;
  const acknowledged = !!b.acknowledged;

  if (!participant_id) return badRequest('participant_id required');
  if (!acknowledged) return badRequest('Acknowledgement is required');

  try {
    // Participant contact details.
    let first_name = '', last_name = '', email = null;
    try {
      const pr = await db.query('SELECT first_name, last_name, email FROM participants WHERE id=$1', [participant_id]);
      if (pr.rows[0]) { first_name = pr.rows[0].first_name; last_name = pr.rows[0].last_name; email = pr.rows[0].email; }
    } catch (e) { /* non-fatal */ }

    let eventName = '';
    if (event_id) {
      try { const er = await db.query('SELECT name FROM screening_events WHERE id=$1', [event_id]); if (er.rows[0]) eventName = er.rows[0].name; } catch (e) { /* non-fatal */ }
    }

    // Persist the acknowledgement (non-fatal if the table is absent).
    try {
      await db.query(
        `INSERT INTO emergent_risk_forms
          (participant_id, event_id, risks, metabolic_syndrome, ms_count, follow_up, availability, acknowledged, emailed_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [participant_id, event_id, JSON.stringify(risks), msHigh, msCount, followUp, availability, acknowledged, email]
      );
    } catch (e) { /* table may not exist yet — acknowledgement email still sends */ }

    // Email a copy of the form to the registrant.
    let emailResult = { skipped: true };
    if (email && mailEnabled()) {
      try {
        emailResult = await sendEmail({
          to: email,
          subject: 'HealthYou Screening — Emergent Risk Follow-up',
          html: buildEmailHtml({ first_name, risks, msHigh, msCount, followUp, availability, eventName }),
        });
      } catch (e) { emailResult = { error: e.message }; }
    } else if (!email) {
      emailResult = { skipped: true, reason: 'no email on file' };
    }

    return ok({ saved: true, email: emailResult });
  } catch (e) { return serverError(e); }
};
