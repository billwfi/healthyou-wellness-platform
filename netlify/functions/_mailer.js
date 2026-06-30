// Unified outbound email. Uses SMTP (nodemailer) when SMTP_* env vars are set,
// otherwise falls back to the Resend HTTP API. Set these in Netlify env vars:
//   SMTP_HOST=smtp.office365.com  SMTP_PORT=587  SMTP_SECURE=false
//   SMTP_USER=wellness@myhealthyou.com  SMTP_PASS=********
//   SMTP_FROM=HealthYou <wellness@myhealthyou.com>
const nodemailer = require('nodemailer');

let _transport;
function transport() {
  if (_transport) return _transport;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,                       // true=465 (implicit TLS), false=587 (STARTTLS)
    requireTLS: !secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transport;
}

function defaultFrom() {
  return process.env.SMTP_FROM || process.env.RESEND_FROM || 'HealthYou <wellness@myhealthyou.com>';
}

// True when at least one transport is configured.
function mailEnabled() {
  return !!(process.env.SMTP_HOST || process.env.RESEND_API_KEY);
}

async function sendEmail({ to, subject, html, from }) {
  const fromAddr = from || defaultFrom();
  if (process.env.SMTP_HOST) {
    const info = await transport().sendMail({ from: fromAddr, to, subject, html });
    return { id: info.messageId, via: 'smtp' };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('No email transport configured (set SMTP_* or RESEND_API_KEY)');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: fromAddr, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return { ...(await res.json()), via: 'resend' };
}

module.exports = { sendEmail, mailEnabled, defaultFrom };
