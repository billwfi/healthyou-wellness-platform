const { getPool, parseJson } = require('./_db');
const { getUser, ok, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const segments = event.path.split('/');
  const id = segments[segments.length - 1];
  const isItem = id && !/^health-tips$/.test(id) && /^\d+$/.test(id);

  try {
    if (event.httpMethod === 'GET') {
      if (isItem) {
        const r = await db.query('SELECT * FROM health_tips WHERE id=$1', [id]);
        if (!r.rows.length) return notFound();
        return ok(parseJson(r.rows[0], ['tags']));
      }
      const qs = event.queryStringParameters || {};
      let q = 'SELECT * FROM health_tips WHERE 1=1';
      const params = [];
      if (qs.status)   { params.push(qs.status);   q += ` AND status=$${params.length}`; }
      if (qs.category) { params.push(qs.category); q += ` AND category=$${params.length}`; }
      q += ' ORDER BY created_at DESC';
      const r = await db.query(q, params);
      return ok(parseJson(r.rows, ['tags']));
    }

    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (!b.title) return badRequest('title is required');
      const r = await db.query(`
        INSERT INTO health_tips (title, category, status, author, read_time_minutes, summary, content, image_url, tags, published_at)
        OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [b.title, b.category||'general', b.status||'draft', b.author||null,
         b.read_time_minutes||null, b.summary||null, b.content||null, b.image_url||null,
         JSON.stringify(b.tags||[]),
         b.status === 'published' ? new Date() : null]
      );
      return ok(parseJson(r.rows[0], ['tags']));
    }

    if (event.httpMethod === 'PUT' && isItem) {
      const b = JSON.parse(event.body || '{}');
      const existing = await db.query('SELECT status, published_at FROM health_tips WHERE id=$1', [id]);
      if (!existing.rows.length) return notFound();
      const wasPublished = existing.rows[0].status === 'published';
      const nowPublished = b.status === 'published';
      const publishedAt  = nowPublished ? (wasPublished ? existing.rows[0].published_at : new Date()) : null;
      const r = await db.query(`
        UPDATE health_tips SET
          title=$1, category=$2, status=$3, author=$4, read_time_minutes=$5,
          summary=$6, content=$7, image_url=$8, tags=$9, published_at=$10, updated_at=NOW()
        OUTPUT INSERTED.*
        WHERE id=$11`,
        [b.title, b.category||'general', b.status||'draft', b.author||null,
         b.read_time_minutes||null, b.summary||null, b.content||null, b.image_url||null,
         JSON.stringify(b.tags||[]), publishedAt, id]
      );
      return ok(parseJson(r.rows[0], ['tags']));
    }

    if (event.httpMethod === 'DELETE' && isItem) {
      await db.query('DELETE FROM health_tips WHERE id=$1', [id]);
      return ok({ deleted: true });
    }

    return badRequest('Method not allowed');
  } catch (e) {
    console.error('health-tips error', e);
    return serverError(e);
  }
};
