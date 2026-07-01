// Password login against the app_users table (admin portal + User Management).
//   POST /api/login  { email, password }  ->  { token, user }
// The token is an HS256 JWT minted by _auth.signToken and accepted by _auth.getUser.
const { getPool } = require('./_db');
const { signToken, badRequest, options, serverError, CORS } = require('./_auth');
const crypto = require('crypto');

// Verify a password against a stored `scrypt$<salt>$<hash>` value (see users.js hashPassword).
function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const computed = crypto.scryptSync(String(pw), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

function fail(message, code) {
  return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: message, code: code || 'invalid' }) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return badRequest('Method not supported');

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
  const email = (b.email || '').toString().trim();
  const password = (b.password || '').toString();
  if (!email || !password) return badRequest('Email and password are required');

  try {
    const db = getPool();
    const r = await db.query(
      `SELECT id, first_name, last_name, email, role, nav_categories,
              coach_portal, screener_portal, active, password_hash
         FROM app_users WHERE email = $1`, [email]);
    if (!r.rows.length) return fail('No account found with that email.', 'no_user');
    const u = r.rows[0];
    if (!u.active) return fail('This account is inactive. Contact an administrator.', 'inactive');
    if (!u.password_hash) return fail('No password has been set for this account. Ask an administrator to set one.', 'no_password');
    if (!verifyPassword(password, u.password_hash)) return fail('Incorrect password.', 'bad_password');

    let nav = [];
    try { nav = JSON.parse(u.nav_categories || '[]'); } catch { nav = []; }
    const full_name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email;

    const token = signToken({
      sub: String(u.id),
      email: u.email,
      role: u.role || 'User',
      full_name,
      nav_categories: Array.isArray(nav) ? nav : [],
      coach_portal: !!u.coach_portal,
      screener_portal: !!u.screener_portal,
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        token,
        user: {
          id: u.id, email: u.email, full_name, role: u.role || 'User',
          nav_categories: Array.isArray(nav) ? nav : [],
          coach_portal: !!u.coach_portal, screener_portal: !!u.screener_portal,
        },
      }),
    };
  } catch (e) { return serverError(e); }
};
