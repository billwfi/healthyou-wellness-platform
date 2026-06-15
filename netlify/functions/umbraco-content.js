const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Read-only API over the Umbraco content imported from cosreachyourpeak.com.
// GET /api/umbraco-content                  → lightweight list (no raw/properties blobs)
// GET /api/umbraco-content?tree=1           → list ordered for tree rendering
// GET /api/umbraco-content?parent_id=1328   → direct children of a node
// GET /api/umbraco-content?q=heart          → full-text-ish search on name
// GET /api/umbraco-content?content_type=x   → filter by document type alias
// GET /api/umbraco-content/{umb_id}         → single node WITH properties + raw payload
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const segments = event.path.split('/');
  const last = segments[segments.length - 1];
  const isItem = last && last !== 'umbraco-content' && /^\d+$/.test(last);

  try {
    if (event.httpMethod !== 'GET') return badRequest('Read-only endpoint');

    if (isItem) {
      const r = await db.query('SELECT * FROM umbraco_content WHERE umb_id=$1', [last]);
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    }

    const qs = event.queryStringParameters || {};
    let q = `SELECT umb_id, umb_key, udi, name, content_type, parent_id, tree_path,
                    level, sort_order, published, update_date
             FROM umbraco_content WHERE 1=1`;
    const params = [];
    if (qs.parent_id)    { params.push(qs.parent_id);             q += ` AND parent_id=$${params.length}`; }
    if (qs.content_type) { params.push(qs.content_type);          q += ` AND content_type=$${params.length}`; }
    if (qs.q)            { params.push('%' + qs.q.toLowerCase() + '%'); q += ` AND LOWER(name) LIKE $${params.length}`; }
    q += ' ORDER BY level, sort_order, name';
    const r = await db.query(q, params);
    return ok(r.rows);
  } catch (e) {
    console.error('umbraco-content error', e);
    return serverError(e);
  }
};
