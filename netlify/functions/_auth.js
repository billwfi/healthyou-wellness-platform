const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

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
  if (context?.clientContext?.user) return context.clientContext.user;
  const auth  = (event.headers?.authorization || event.headers?.Authorization || '').trim();
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const claims = decodeJwt(token);
  if (!claims?.email) return null;
  return { email: claims.email, sub: claims.sub, user_metadata: claims.user_metadata || {} };
}

const ok          = d  => ({ statusCode: 200, headers: CORS, body: JSON.stringify(d) });
const created     = d  => ({ statusCode: 201, headers: CORS, body: JSON.stringify(d) });
const badRequest  = m  => ({ statusCode: 400, headers: CORS, body: JSON.stringify({ error: m }) });
const unauthorized = () => ({ statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) });
const notFound    = () => ({ statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) });
const serverError = e  => ({ statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server error', detail: e?.message }) });
const options     = () => ({ statusCode: 204, headers: CORS, body: '' });

module.exports = { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options, CORS };
