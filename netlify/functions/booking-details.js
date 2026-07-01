// Booking Details — admin-configurable booking configs (Admin > Booking Setup).
//   GET  /api/booking-details?slug=X    -> PUBLIC single config (falls back to default)
//   GET  /api/booking-details           -> admin list (auth)
//   POST /api/booking-details           -> create (auth)
//   PUT  /api/booking-details           -> update (auth, id)
//   DELETE /api/booking-details?id=N    -> delete (auth)
const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

const SELECT = `
  SELECT bd.id, bd.name, bd.slug, bd.session_minutes, bd.cancel_cutoff_hours, bd.booking_window_days,
         bd.support_phone, bd.support_email, bd.policy_text, bd.insurance_text,
         bd.group_id, g.GroupName AS group_name, bd.is_default, bd.active
    FROM dbo.booking_details bd
    LEFT JOIN iStrata.dbo.is_groups g ON g.id = bd.group_id`;

function slugify(s) {
  return (s || '').toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'booking';
}
function clean(b) {
  return {
    name: (b.name || '').toString().trim().slice(0, 255),
    session_minutes: Math.max(5, Math.min(240, parseInt(b.session_minutes, 10) || 30)),
    cancel_cutoff_hours: Math.max(0, Math.min(720, parseInt(b.cancel_cutoff_hours, 10) || 0)),
    booking_window_days: Math.max(1, Math.min(365, parseInt(b.booking_window_days, 10) || 90)),
    support_phone: (b.support_phone || '').toString().trim().slice(0, 50) || null,
    support_email: (b.support_email || '').toString().trim().slice(0, 255) || null,
    policy_text: (b.policy_text != null ? String(b.policy_text) : '') || null,
    insurance_text: (b.insurance_text != null ? String(b.insurance_text) : '') || null,
    group_id: b.group_id ? parseInt(b.group_id, 10) : null,
    is_default: b.is_default ? 1 : 0,
    active: (b.active === undefined || b.active) ? 1 : 0,
  };
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const db = getPool();
  const qs = event.queryStringParameters || {};

  // PUBLIC single config (booking page). Any ?slug (even empty) -> resolve to a config.
  if (event.httpMethod === 'GET' && ('slug' in qs || 'default' in qs)) {
    try {
      let r = qs.slug ? await db.query(`${SELECT} WHERE bd.slug=$1 AND bd.active=1`, [qs.slug]) : { rows: [] };
      if (!r.rows.length) r = await db.query(`${SELECT} WHERE bd.is_default=1 AND bd.active=1`);
      if (!r.rows.length) r = await db.query(`${SELECT} WHERE bd.active=1 ORDER BY bd.id`);
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  // Everything else is admin-only.
  const user = getUser(event, context);
  if (!user) return unauthorized();

  if (event.httpMethod === 'GET') {
    try { const r = await db.query(`${SELECT} ORDER BY bd.is_default DESC, bd.name`); return ok(r.rows); }
    catch (e) { return serverError(e); }
  }

  async function clearOtherDefaults(exceptId) {
    await db.query('UPDATE dbo.booking_details SET is_default=0 WHERE is_default=1' + (exceptId ? ' AND id<>$1' : ''), exceptId ? [exceptId] : []);
  }
  async function uniqueSlug(base, exceptId) {
    let s = slugify(base), i = 1;
    while (true) {
      const r = await db.query('SELECT id FROM dbo.booking_details WHERE slug=$1' + (exceptId ? ' AND id<>$2' : ''), exceptId ? [s, exceptId] : [s]);
      if (!r.rows.length) return s;
      s = slugify(base) + '-' + (++i);
    }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const c = clean(b);
    if (!c.name) return badRequest('Name is required');
    try {
      const slug = await uniqueSlug(b.slug || c.name);
      if (c.is_default) await clearOtherDefaults(null);
      const r = await db.query(
        `INSERT INTO dbo.booking_details
           (name,slug,session_minutes,cancel_cutoff_hours,booking_window_days,support_phone,support_email,policy_text,insurance_text,group_id,is_default,active)
         OUTPUT INSERTED.id
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [c.name, slug, c.session_minutes, c.cancel_cutoff_hours, c.booking_window_days, c.support_phone, c.support_email, c.policy_text, c.insurance_text, c.group_id, c.is_default, c.active]);
      return created({ id: r.rows[0].id, slug });
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    if (!b.id) return badRequest('id required');
    const c = clean(b);
    if (!c.name) return badRequest('Name is required');
    try {
      const slug = await uniqueSlug(b.slug || c.name, b.id);
      if (c.is_default) await clearOtherDefaults(b.id);
      const r = await db.query(
        `UPDATE dbo.booking_details SET name=$2,slug=$3,session_minutes=$4,cancel_cutoff_hours=$5,booking_window_days=$6,
           support_phone=$7,support_email=$8,policy_text=$9,insurance_text=$10,group_id=$11,is_default=$12,active=$13,updated_at=SYSUTCDATETIME()
         OUTPUT INSERTED.id WHERE id=$1`,
        [b.id, c.name, slug, c.session_minutes, c.cancel_cutoff_hours, c.booking_window_days, c.support_phone, c.support_email, c.policy_text, c.insurance_text, c.group_id, c.is_default, c.active]);
      if (!r.rows.length) return notFound();
      return ok({ id: b.id, slug });
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return badRequest('id required');
    try { await db.query('DELETE FROM dbo.booking_details WHERE id=$1', [qs.id]); return ok({ deleted: true }); }
    catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
