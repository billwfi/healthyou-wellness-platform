const crypto = require('crypto');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// Secret used to sign/verify our own (app_users) session tokens. Set AUTH_JWT_SECRET
// in Netlify; the fallback keeps local/dev working but should not be relied on in prod.
const AUTH_SECRET = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || 'healthyou-dev-secret-change-me';
const ISS = 'healthyou';

// Mint an HS256 JWT for an authenticated app_users row. `expSec` defaults to 12h.
function signToken(payload, expSec = 43200) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iss: ISS, iat: now, exp: now + expSec };
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

// Verify one of our own tokens. Returns claims on a valid, unexpired signature, else null.
function verifyToken(token) {
  try {
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return null;
    const expect = crypto.createHmac('sha256', AUTH_SECRET).update(`${h}.${p}`).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (claims.iss !== ISS) return null;
    if (claims.exp && Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch { return null; }
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json    = Buffer.from(payload, 'base64url').toString('utf8');
    const claims  = JSON.parse(json);
    if (claims.exp && Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch { return null; }
}

function getUser(event, context) {
  const auth  = (event.headers?.authorization || event.headers?.Authorization || '').trim();
  const token = auth.replace(/^Bearer\s+/i, '');

  // 1) Our own app_users session token (admin portal + User Management logins).
  if (token) {
    const claims = verifyToken(token);
    if (claims?.email) {
      return {
        email: claims.email,
        sub: claims.sub,
        role: claims.role || 'User',
        coach_id: claims.coach_id || null,
        portal: claims.portal || null,
        nav_categories: Array.isArray(claims.nav_categories) ? claims.nav_categories : [],
        coach_portal: !!claims.coach_portal,
        screener_portal: !!claims.screener_portal,
        user_metadata: { full_name: claims.full_name || claims.name || claims.email },
      };
    }
  }

  // 2) Legacy Netlify Identity (coach / screener / participant portals still use it).
  if (context?.clientContext?.user) return context.clientContext.user;
  if (token) {
    const claims = decodeJwt(token);
    if (claims?.email) return { email: claims.email, sub: claims.sub, user_metadata: claims.user_metadata || {} };
  }
  return null;
}

const ok          = d  => ({ statusCode: 200, headers: CORS, body: JSON.stringify(d) });
const created     = d  => ({ statusCode: 201, headers: CORS, body: JSON.stringify(d) });
const badRequest  = m  => ({ statusCode: 400, headers: CORS, body: JSON.stringify({ error: m }) });
const unauthorized = () => ({ statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) });
const notFound    = () => ({ statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) });
const serverError = e  => ({ statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server error', detail: e?.message }) });
const options     = () => ({ statusCode: 204, headers: CORS, body: '' });

module.exports = { getUser, signToken, verifyToken, ok, created, badRequest, unauthorized, notFound, serverError, options, CORS };
