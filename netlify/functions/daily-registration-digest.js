const { getPool } = require('./_db');
const { sendEmail, mailEnabled } = require('./_mailer');

// Scheduled daily digest of the PRIOR day's registrations (by submitted date,
// in Mountain time), e-mailed to the team with counts by group/event/location
// and a Review link per registrant. Scheduled via netlify.toml (06:00 MT).
//   Manual test: GET /api/daily-registration-digest?date=YYYY-MM-DD
function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtTime(t){ if(!t) return ''; const p=String(t).split(':'); let h=parseInt(p[0],10); if(isNaN(h)) return t; const m=(p[1]||'00').slice(0,2); const ap=h<12?'AM':'PM'; h=h%12||12; return `${h}:${m} ${ap}`; }
function fmtDate(d){ if(!d) return ''; const x=new Date(d+'T00:00:00'); return isNaN(x)?d:x.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); }

// Yesterday's date (YYYY-MM-DD) in Mountain time.
function yesterdayMT(){
  const today = new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Denver', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const d = new Date(today+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const day = qs.date || yesterdayMT();
  const site = process.env.URL || 'https://healthyou-wellness-platform.netlify.app';
  const to = process.env.DIGEST_TO || 'support@myhealthyou.com';
  const db = getPool();

  const SELECT = `SELECT a.id, a.first_name, a.last_name, a.email, a.phone, a.status,
              CONVERT(varchar(10), a.appointment_date, 23) AS appointment_date,
              CONVERT(varchar(5),  a.appointment_time, 108) AS appointment_time,
              e.name AS event_name, g.GroupName AS group_name, l.name AS location_name
         FROM event_appointments a
         JOIN screening_events e ON e.id = a.event_id
         LEFT JOIN event_locations l ON l.id = a.location_id
         LEFT JOIN iStrata.dbo.is_groups g ON g.id = e.org_id`;
  const ORDER = ` ORDER BY g.GroupName, e.name, l.name, a.last_name, a.first_name`;
  const MT = (col) => `CAST(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Mountain Standard Time' AS DATE)`;
  const byActivity = (action) => db.query(
    `${SELECT} WHERE a.id IN (SELECT act.appointment_id FROM event_appointment_activity act
       WHERE act.action='${action}' AND ${MT('act.at')} = $1) ${ORDER}`, [day]).then(x => x.rows);

  try {
    const [rows, cancelled, rescheduled] = await Promise.all([
      db.query(`${SELECT} WHERE ${MT('a.created_at')} = $1 ${ORDER}`, [day]).then(x => x.rows),
      byActivity('cancelled'),
      byActivity('rescheduled'),
    ]);

    const dayLabel = fmtDate(day);
    const tally = (key) => {
      const m = {}; rows.forEach(x => { const k = x[key] || '—'; m[k] = (m[k]||0)+1; });
      return Object.entries(m).sort((a,b)=>b[1]-a[1]);
    };
    const countTable = (title, pairs) => `
      <div style="margin-bottom:14px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#0d9488;margin-bottom:4px;">${title}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
          ${pairs.map(([k,n])=>`<tr><td style="padding:3px 0;border-bottom:1px solid #f1f5f9;">${esc(k)}</td><td style="padding:3px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;">${n}</td></tr>`).join('')}
        </table>
      </div>`;

    const detailTable = (list, accent) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:8px;">
        <tr style="background:#f8fafc;">${['Name','Group','Event','Location','Appt',''].map(h=>`<td style="padding:7px 8px;font-size:11px;text-transform:uppercase;color:#94a3b8;">${h}</td>`).join('')}</tr>
        ${list.map(x => `<tr>
          <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;"><strong>${esc(x.last_name)}, ${esc(x.first_name)}</strong></td>
          <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;">${esc(x.group_name||'—')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;">${esc(x.event_name||'—')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;">${esc(x.location_name||'—')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;white-space:nowrap;">${esc(fmtDate(x.appointment_date))}${x.appointment_time?'<br>'+esc(fmtTime(x.appointment_time)):''}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;"><a href="${site}/admin/appointment.html?id=${x.id}" style="color:${accent||'#0d9488'};font-weight:600;">Review →</a></td>
        </tr>`).join('')}
      </table>`;
    const sectionHead = (label, n, color) => `<div style="font-size:13px;font-weight:700;color:${color};margin:18px 0 6px;">${label} — ${n}</div>`;

    const logo = `${site}/assets/img/hylogo.png`;
    const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:760px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#0d9488;padding:18px;text-align:center;"><img src="${logo}" alt="HealthYou" height="34" style="background:#fff;padding:4px 12px;border-radius:8px;"></div>
      <div style="padding:24px;color:#334155;">
        <h1 style="font-size:18px;margin:0 0 2px;color:#0f172a;">Daily Registration Summary</h1>
        <div style="font-size:13px;color:#64748b;margin-bottom:18px;">Activity on ${esc(dayLabel)} (by submission date) · <strong>${rows.length}</strong> new · ${rescheduled.length} rescheduled · ${cancelled.length} cancelled</div>
        ${rows.length ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="33%" valign="top" style="padding-right:10px;">${countTable('By Group', tally('group_name'))}</td>
          <td width="34%" valign="top" style="padding:0 5px;">${countTable('By Event', tally('event_name'))}</td>
          <td width="33%" valign="top" style="padding-left:10px;">${countTable('By Location', tally('location_name'))}</td>
        </tr></table>
        ${sectionHead('New registrations', rows.length, '#0d9488')}${detailTable(rows)}` :
        `<p style="font-size:14px;color:#64748b;">No new registrations were submitted.</p>`}
        ${rescheduled.length ? sectionHead('Rescheduled', rescheduled.length, '#b45309')+detailTable(rescheduled,'#b45309') : ''}
        ${cancelled.length ? sectionHead('Cancelled', cancelled.length, '#b91c1c')+detailTable(cancelled,'#b91c1c') : ''}
        <p style="font-size:12px;color:#94a3b8;margin-top:18px;">Review links open the appointment in the HealthYou admin (sign-in required).</p>
      </div></div>`;

    const total = rows.length;
    if (!mailEnabled()) return { statusCode: 200, body: `Mail not configured; ${total} new / ${rescheduled.length} resched / ${cancelled.length} cancelled for ${day}` };
    await sendEmail({ to, subject: `HealthYou — ${total} new, ${rescheduled.length} rescheduled, ${cancelled.length} cancelled (${dayLabel})`, html });
    return { statusCode: 200, body: `Sent digest for ${day}: ${total} new, ${rescheduled.length} rescheduled, ${cancelled.length} cancelled to ${to}` };
  } catch (e) {
    return { statusCode: 500, body: 'Digest error: ' + e.message };
  }
};
