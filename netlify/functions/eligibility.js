const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (!qs.org_id) return badRequest('org_id required');
    const search = qs.search || '';
    const limit  = Math.min(parseInt(qs.limit)  || 50, 200);
    const offset = parseInt(qs.offset) || 0;
    const cond   = search
      ? "AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2 OR employee_id ILIKE $2)"
      : '';
    const params = search ? [qs.org_id, `%${search}%`] : [qs.org_id];
    try {
      const [countR, dataR, statsR] = await Promise.all([
        db.query(`SELECT COUNT(*) FROM eligibility WHERE org_id=$1 ${cond}`, params),
        db.query(
          `SELECT * FROM eligibility WHERE org_id=$1 ${cond}
           ORDER BY last_name, first_name
           LIMIT $${params.length+1} OFFSET $${params.length+2}`,
          [...params, limit, offset]
        ),
        db.query(
          `SELECT status, COUNT(*) AS cnt, MAX(created_at) AS latest
             FROM eligibility WHERE org_id=$1 GROUP BY status`,
          [qs.org_id]
        ),
      ]);
      const statusCounts = {};
      let lastUpload = null;
      statsR.rows.forEach(r => {
        statusCounts[r.status] = parseInt(r.cnt);
        if (!lastUpload || r.latest > lastUpload) lastUpload = r.latest;
      });
      return ok({
        total: parseInt(countR.rows[0].count),
        records: dataR.rows,
        status_counts: statusCounts,
        last_upload: lastUpload,
        limit, offset,
      });
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const { org_id, records } = b;
    if (!org_id)                               return badRequest('org_id required');
    if (!Array.isArray(records) || !records.length) return badRequest('records array required');

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM eligibility WHERE org_id=$1', [org_id]);
      let inserted = 0;
      for (const r of records) {
        const first = (r.first_name || '').trim();
        const last  = (r.last_name  || '').trim();
        if (!first && !last) continue;
        await client.query(
          `INSERT INTO eligibility
             (org_id,employee_id,first_name,last_name,email,date_of_birth,
              department,location,status,coverage_tier,effective_date,termination_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            org_id,
            r.employee_id    || null,
            first            || null,
            last             || null,
            r.email          || null,
            r.date_of_birth  || null,
            r.department     || null,
            r.location       || null,
            r.status         || 'active',
            r.coverage_tier  || null,
            r.effective_date || null,
            r.termination_date || null,
          ]
        );
        inserted++;
      }
      await client.query('COMMIT');
      return ok({ replaced: true, inserted });
    } catch (e) {
      await client.query('ROLLBACK');
      return serverError(e);
    } finally { client.release(); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.org_id) return badRequest('org_id required');
    try {
      const r = await db.query('DELETE FROM eligibility WHERE org_id=$1', [qs.org_id]);
      return ok({ deleted: true, count: r.rowCount });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
