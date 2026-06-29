const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const segments = event.path.split('/');
  const id = segments[segments.length - 1];
  const isItem = id && !/^testimonials$/.test(id) && /^\d+$/.test(id);

  try {
    if (event.httpMethod === 'GET') {
      if (isItem) {
        const r = await db.query('SELECT * FROM testimonials WHERE id=$1', [id]);
        if (!r.rows.length) return notFound();
        return ok(r.rows[0]);
      }
      const qs = event.queryStringParameters || {};
      let q = 'SELECT * FROM testimonials WHERE 1=1';
      const params = [];
      if (qs.status)   { params.push(qs.status);          q += ` AND status=$${params.length}`; }
      if (qs.featured) { params.push(qs.featured==='true'); q += ` AND featured=$${params.length}`; }
      q += ' ORDER BY sort_order ASC, created_at DESC';
      const r = await db.query(q, params);
      return ok(r.rows);
    }

    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (!b.participant_name) return badRequest('participant_name is required');
      const r = await db.query(`
        INSERT INTO testimonials (participant_name, organization, title_role, status, quote, outcome, photo_url, rating, featured, sort_order)
        OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [b.participant_name, b.organization||null, b.title_role||null, b.status||'draft',
         b.quote||null, b.outcome||null, b.photo_url||null, b.rating||null,
         b.featured||false, b.sort_order||0]
      );
      return ok(r.rows[0]);
    }

    if (event.httpMethod === 'PUT' && isItem) {
      const b = JSON.parse(event.body || '{}');
      const r = await db.query(`
        UPDATE testimonials SET
          participant_name=$1, organization=$2, title_role=$3, status=$4,
          quote=$5, outcome=$6, photo_url=$7, rating=$8, featured=$9, sort_order=$10,
          updated_at=NOW()
        OUTPUT INSERTED.*
        WHERE id=$11`,
        [b.participant_name, b.organization||null, b.title_role||null, b.status||'draft',
         b.quote||null, b.outcome||null, b.photo_url||null, b.rating||null,
         b.featured||false, b.sort_order||0, id]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    }

    if (event.httpMethod === 'DELETE' && isItem) {
      await db.query('DELETE FROM testimonials WHERE id=$1', [id]);
      return ok({ deleted: true });
    }

    return badRequest('Method not allowed');
  } catch (e) {
    console.error('testimonials error', e);
    return serverError(e);
  }
};
