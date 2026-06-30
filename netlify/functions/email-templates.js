const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Reusable confirmation-email templates built in the admin and assigned to events.
//   GET    /api/email-templates           -> list   (?id= one, ?active=1 to filter)
//   POST   /api/email-templates           -> create (name required)
//   PUT    /api/email-templates           -> edit   (id required)
//   DELETE /api/email-templates?id=        -> delete
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      if (qs.id) {
        const r = await db.query('SELECT * FROM email_templates WHERE id=$1', [qs.id]);
        if (!r.rows.length) return notFound();
        return ok(r.rows[0]);
      }
      const r = qs.active
        ? await db.query('SELECT * FROM email_templates WHERE active=1 ORDER BY name')
        : await db.query('SELECT * FROM email_templates ORDER BY active DESC, name');
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.name) return badRequest('name is required');
    try {
      const r = await db.query(
        `INSERT INTO email_templates (name, description, subject, body_html, active)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5)`,
        [b.name, b.description || null, b.subject || null, b.body_html || null, b.active === false ? 0 : 1]);
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE email_templates SET
           name=COALESCE($2,name), description=COALESCE($3,description),
           subject=COALESCE($4,subject), body_html=COALESCE($5,body_html),
           active=COALESCE($6,active), updated_at=SYSUTCDATETIME()
         OUTPUT INSERTED.* WHERE id=$1`,
        [b.id, b.name || null, b.description ?? null, b.subject ?? null, b.body_html ?? null,
         (b.active === undefined ? null : (b.active ? 1 : 0))]);
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return badRequest('id required');
    try {
      // Detach from any events that reference it, then delete.
      await db.query('UPDATE screening_events SET email_template_id=NULL WHERE email_template_id=$1', [qs.id]);
      await db.query('DELETE FROM email_templates WHERE id=$1', [qs.id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
