#!/usr/bin/env node
// Bootstrap / reset an admin login in the app_users table.
//
// Admin login now authenticates against app_users (see netlify/functions/login.js),
// so there must be at least one active Admin with a password before anyone can sign
// in. This script upserts a user by email and sets a scrypt password hash that
// matches functions/users.js hashPassword().
//
// Usage (PowerShell):
//   $env:MSSQL_HOST=...; $env:MSSQL_USER=...; $env:MSSQL_PASSWORD=...; $env:MSSQL_DATABASE='hy_datawarehouse'
//   node scripts/seed-admin-user.js --email admin@myhealthyou.com --password 'ChangeMe123!' --first Admin --last User
//
// Existing user with that email -> password (and role=Admin, active) is updated.
// New email -> a full Admin row is created with all nav categories enabled.
const sql = require('mssql');
const crypto = require('crypto');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

const email = arg('email');
const password = arg('password');
const first = arg('first', 'Admin');
const last = arg('last', 'User');
const ALL_NAV = JSON.stringify(['admin', 'events', 'wellness', 'reports', 'settings']);

if (!email || !password) {
  console.error('Required: --email <email> --password <password>  [--first <n>] [--last <n>]');
  process.exit(1);
}
if (String(password).length < 6) { console.error('Password must be at least 6 characters.'); process.exit(1); }

const cfg = {
  server: process.env.MSSQL_HOST,
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE || 'hy_datawarehouse',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 20000, requestTimeout: 60000,
};

(async () => {
  const pool = await sql.connect(cfg);
  console.log('Connected to', cfg.database, 'on', cfg.server);
  const pwHash = hashPassword(password);

  const existing = await pool.request()
    .input('email', sql.NVarChar, email)
    .query('SELECT id FROM dbo.app_users WHERE email = @email');

  if (existing.recordset.length) {
    const id = existing.recordset[0].id;
    await pool.request()
      .input('id', sql.Int, id)
      .input('pw', sql.NVarChar, pwHash)
      .query("UPDATE dbo.app_users SET password_hash=@pw, role='Admin', active=1 WHERE id=@id");
    console.log(`Updated existing user #${id} (${email}) — password set, role=Admin, active.`);
  } else {
    const ins = await pool.request()
      .input('first', sql.NVarChar, first)
      .input('last', sql.NVarChar, last)
      .input('email', sql.NVarChar, email)
      .input('nav', sql.NVarChar, ALL_NAV)
      .input('pw', sql.NVarChar, pwHash)
      .query(`INSERT INTO dbo.app_users (first_name, last_name, email, role, nav_categories, coach_portal, screener_portal, active, password_hash)
              OUTPUT INSERTED.id
              VALUES (@first, @last, @email, 'Admin', @nav, 0, 0, 1, @pw)`);
    console.log(`Created Admin user #${ins.recordset[0].id} (${email}).`);
  }
  console.log(`\nYou can now sign in at /admin/login.html with:\n  Email:    ${email}\n  Password: (the one you provided)`);
  await pool.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
