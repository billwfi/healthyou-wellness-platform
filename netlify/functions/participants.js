const { getPool, parseJson } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db  = getPool();
  const qs  = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    // Single participant
    if (qs.id) {
      try {
        const r = await db.query(
          `SELECT p.*, o.name AS org_name,
                  c.name AS coach_name,
                  (SELECT * FROM biometric_results br WHERE br.participant_id=p.id
                     ORDER BY br.screened_at DESC FOR JSON PATH) AS biometrics,
                  (SELECT * FROM goals g WHERE g.participant_id=p.id
                     ORDER BY g.created_at DESC FOR JSON PATH) AS goals,
                  (SELECT * FROM coaching_sessions cs WHERE cs.participant_id=p.id
                     ORDER BY cs.scheduled_at DESC FOR JSON PATH) AS sessions
             FROM participants p
             LEFT JOIN organizations o ON o.id=p.org_id
             LEFT JOIN coaches c ON c.id=p.assigned_coach_id
            WHERE p.id=$1`,
          [qs.id]
        );
        if (!r.rows.length) return notFound();
        const row = r.rows[0];
        parseJson(row, ['biometrics', 'goals', 'sessions']);
        row.biometrics = row.biometrics || [];
        row.goals      = row.goals || [];
        row.sessions   = row.sessions || [];
        return ok(row);
      } catch (e) { return serverError(e); }
    }

    // List with optional filters
    try {
      const conditions = ['1=1'];
      const vals = [];
      if (qs.org_id)   { conditions.push(`p.org_id=$${vals.push(qs.org_id)}`); }
      if (qs.coach_id) { conditions.push(`p.assigned_coach_id=$${vals.push(qs.coach_id)}`); }
      if (qs.search)   { conditions.push(`(CONCAT(p.first_name,' ',p.last_name) ILIKE $${vals.push('%'+qs.search+'%')} OR p.email ILIKE $${vals.length})`); }
      if (qs.active !== undefined) { conditions.push(`p.active=$${vals.push(qs.active==='true')}`); }

      const r = await db.query(
        `SELECT p.id, p.first_name, p.last_name, p.email, p.department,
                p.active, p.created_at,
                o.name AS org_name,
                c.name AS coach_name
           FROM participants p
           LEFT JOIN organizations o ON o.id=p.org_id
           LEFT JOIN coaches c ON c.id=p.assigned_coach_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY p.last_name, p.first_name`,
        vals
      );
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { email, first_name, last_name, org_id, assigned_coach_id,
            date_of_birth, gender, phone, employee_id, department } = b;
    if (!email || !first_name || !last_name) return badRequest('email, first_name, last_name required');
    try {
      const r = await db.query(
        `INSERT INTO participants
           (email,first_name,last_name,org_id,assigned_coach_id,
            date_of_birth,gender,phone,employee_id,department)
         OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [email.toLowerCase().trim(), first_name.trim(), last_name.trim(),
         org_id||null, assigned_coach_id||null,
         date_of_birth||null, gender||null, phone||null,
         employee_id||null, department||null]
      );
      return created(r.rows[0]);
    } catch (e) {
      if (e.number===2627 || e.number===2601) return badRequest('Email already registered');
      return serverError(e);
    }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const { id, first_name, last_name, email, org_id, assigned_coach_id,
            date_of_birth, gender, phone, employee_id, department, active } = b;
    if (!id) return badRequest('id required');
    try {
      const r = await db.query(
        `UPDATE participants SET
           first_name=COALESCE($2,first_name), last_name=COALESCE($3,last_name),
           email=COALESCE($4,email), org_id=COALESCE($5,org_id),
           assigned_coach_id=COALESCE($6,assigned_coach_id),
           date_of_birth=COALESCE($7,date_of_birth), gender=COALESCE($8,gender),
           phone=COALESCE($9,phone), employee_id=COALESCE($10,employee_id),
           department=COALESCE($11,department), active=COALESCE($12,active)
         OUTPUT INSERTED.*
         WHERE id=$1`,
        [id, first_name||null, last_name||null, email?.toLowerCase()||null,
         org_id||null, assigned_coach_id||null, date_of_birth||null,
         gender||null, phone||null, employee_id||null, department||null, active??null]
      );
      if (!r.rows.length) return notFound();
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
