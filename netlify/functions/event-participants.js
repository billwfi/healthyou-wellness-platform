const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  // GET: list participants registered for an event
  if (event.httpMethod === 'GET') {
    const { event_id, search, limit = '100', offset = '0' } = qs;
    if (!event_id) return badRequest('event_id required');
    try {
      const searchFilter = search ? `AND (CONCAT(p.first_name,' ',p.last_name) ILIKE $2 OR p.email ILIKE $2)` : '';
      const vals = search ? [event_id, `%${search}%`] : [event_id];
      const lim = parseInt(limit), off = parseInt(offset);

      const [rowsRes, countRes] = await Promise.all([
        db.query(
          `SELECT p.id, p.first_name, p.last_name, p.email, p.employee_id, p.department, p.phone,
                  er.id AS reg_id, er.registered_at, er.registration_source, er.status AS reg_status,
                  br.id AS bio_id, br.screened_at, br.overall_risk, br.bmi, br.systolic_bp, br.diastolic_bp
             FROM event_registrations er
             JOIN participants p ON p.id=er.participant_id
             LEFT JOIN biometric_results br ON br.participant_id=p.id AND br.event_id=er.event_id
            WHERE er.event_id=$1 ${searchFilter}
            ORDER BY p.last_name, p.first_name
            OFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`,
          vals
        ),
        db.query(
          `SELECT COUNT(*) AS count FROM event_registrations er
             JOIN participants p ON p.id=er.participant_id
            WHERE er.event_id=$1 ${searchFilter}`,
          vals
        ),
      ]);
      return ok({ total: parseInt(countRes.rows[0].count), records: rowsRes.rows });
    } catch (e) { return serverError(e); }
  }

  // POST: add participant(s) to event
  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }

    // Bulk CSV import: { event_id, org_id, records: [...] }
    if (Array.isArray(b.records)) {
      const { event_id, org_id, records } = b;
      if (!event_id || !records.length) return badRequest('event_id and records required');
      try {
        const inserted = await db.withTransaction(async (q) => {
          let n = 0;
          for (const rec of records) {
            const { email, first_name, last_name, employee_id, date_of_birth, gender, phone, department } = rec;
            if (!email || !first_name || !last_name) continue;
            const pRes = await q(
              `MERGE participants AS t
               USING (SELECT $1 AS email, $2 AS first_name, $3 AS last_name, $4 AS org_id,
                             $5 AS employee_id, $6 AS date_of_birth, $7 AS gender, $8 AS phone, $9 AS department) AS s
               ON t.email = s.email
               WHEN MATCHED THEN UPDATE SET
                 first_name=s.first_name, last_name=s.last_name,
                 employee_id=COALESCE(s.employee_id,t.employee_id),
                 department=COALESCE(s.department,t.department)
               WHEN NOT MATCHED THEN INSERT
                 (email,first_name,last_name,org_id,employee_id,date_of_birth,gender,phone,department)
                 VALUES (s.email,s.first_name,s.last_name,s.org_id,s.employee_id,s.date_of_birth,s.gender,s.phone,s.department)
               OUTPUT INSERTED.id;`,
              [email.toLowerCase().trim(), first_name.trim(), last_name.trim(),
               org_id||null, employee_id||null, date_of_birth||null, gender||null, phone||null, department||null]
            );
            const regRes = await q(
              `INSERT INTO event_registrations (event_id,participant_id,registration_source,status)
               SELECT $1,$2,'csv','registered'
               WHERE NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id=$1 AND participant_id=$2)`,
              [event_id, pRes.rows[0].id]
            );
            if (regRes.rowCount > 0) n++;
          }
          return n;
        });
        return ok({ inserted, total: records.length });
      } catch (e) { return serverError(e); }
    }

    // Add individual: { event_id, org_id, participant: {...} }
    const { event_id, org_id, participant: p } = b;
    if (!event_id || !p?.email || !p?.first_name || !p?.last_name)
      return badRequest('event_id and participant (email, first_name, last_name) required');
    try {
      const pRes = await db.query(
        `MERGE participants AS t
         USING (SELECT $1 AS email, $2 AS first_name, $3 AS last_name, $4 AS org_id,
                       $5 AS employee_id, $6 AS date_of_birth, $7 AS phone, $8 AS department) AS s
         ON t.email = s.email
         WHEN MATCHED THEN UPDATE SET first_name=s.first_name, last_name=s.last_name
         WHEN NOT MATCHED THEN INSERT
           (email,first_name,last_name,org_id,employee_id,date_of_birth,phone,department)
           VALUES (s.email,s.first_name,s.last_name,s.org_id,s.employee_id,s.date_of_birth,s.phone,s.department)
         OUTPUT INSERTED.id;`,
        [p.email.toLowerCase().trim(), p.first_name.trim(), p.last_name.trim(),
         org_id||null, p.employee_id||null, p.date_of_birth||null, p.phone||null, p.department||null]
      );
      await db.query(
        `INSERT INTO event_registrations (event_id,participant_id,registration_source,status)
         SELECT $1,$2,'manual','registered'
         WHERE NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id=$1 AND participant_id=$2)`,
        [event_id, pRes.rows[0].id]
      );
      return created({ participant_id: pRes.rows[0].id });
    } catch (e) { return serverError(e); }
  }

  // DELETE: remove participant registration from event
  if (event.httpMethod === 'DELETE') {
    const { event_id, participant_id } = qs;
    if (!event_id || !participant_id) return badRequest('event_id and participant_id required');
    try {
      await db.query(
        'DELETE FROM event_registrations WHERE event_id=$1 AND participant_id=$2',
        [event_id, participant_id]
      );
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
