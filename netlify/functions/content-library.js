const { getPool, parseJson } = require('./_db');
const { getUser, ok, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const segments = event.path.split('/');
  const id = segments[segments.length - 1];
  const isItem = id && !/^content-library$/.test(id) && /^\d+$/.test(id);

  try {
    if (event.httpMethod === 'GET') {
      if (isItem) {
        const r = await db.query('SELECT * FROM content_library WHERE id=$1', [id]);
        if (!r.rows.length) return notFound();
        return ok(parseJson(r.rows[0], ['tags']));
      }
      const qs = event.queryStringParameters || {};
      let q = 'SELECT * FROM content_library WHERE 1=1';
      const params = [];
      if (qs.status)        { params.push(qs.status);        q += ` AND status=$${params.length}`; }
      if (qs.category)      { params.push(qs.category);      q += ` AND category=$${params.length}`; }
      if (qs.resource_type) { params.push(qs.resource_type); q += ` AND resource_type=$${params.length}`; }
      q += ' ORDER BY featured DESC, created_at DESC';
      const r = await db.query(q, params);
      return ok(parseJson(r.rows, ['tags']));
    }

    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (!b.title) return badRequest('title is required');
      const r = await db.query(`
        INSERT INTO content_library (title, resource_type, category, status, audience, url, description, author, duration, thumbnail_url, tags, featured)
        OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [b.title, b.resource_type||'article', b.category||'general', b.status||'published',
         b.audience||'all', b.url||null, b.description||null, b.author||null,
         b.duration||null, b.thumbnail_url||null,
         JSON.stringify(b.tags||[]), b.featured||false]
      );
      return ok(parseJson(r.rows[0], ['tags']));
    }

    if (event.httpMethod === 'PUT' && isItem) {
      const b = JSON.parse(event.body || '{}');
      const r = await db.query(`
        UPDATE content_library SET
          title=$1, resource_type=$2, category=$3, status=$4, audience=$5,
          url=$6, description=$7, author=$8, duration=$9, thumbnail_url=$10,
          tags=$11, featured=$12, updated_at=NOW()
        OUTPUT INSERTED.*
        WHERE id=$13`,
        [b.title, b.resource_type||'article', b.category||'general', b.status||'published',
         b.audience||'all', b.url||null, b.description||null, b.author||null,
         b.duration||null, b.thumbnail_url||null,
         JSON.stringify(b.tags||[]), b.featured||false, id]
      );
      if (!r.rows.length) return notFound();
      return ok(parseJson(r.rows[0], ['tags']));
    }

    if (event.httpMethod === 'DELETE' && isItem) {
      await db.query('DELETE FROM content_library WHERE id=$1', [id]);
      return ok({ deleted: true });
    }

    return badRequest('Method not allowed');
  } catch (e) {
    console.error('content-library error', e);
    return serverError(e);
  }
};
