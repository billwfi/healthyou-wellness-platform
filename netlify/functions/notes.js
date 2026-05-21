const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();

  if (event.httpMethod === 'GET') {
    const session_id = event.queryStringParameters?.session_id;
    if (!session_id) return badRequest('session_id required');
    try {
      const r = await db.query('SELECT * FROM coaching_notes WHERE session_id=$1', [session_id]);
      return ok(r.rows[0] || null);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const {
      session_id, coach_id, stage_of_change, presenting_concern,
      client_goals, motivational_factors, barriers,
      action_steps, follow_up_plan, session_notes
    } = b;
    if (!session_id) return badRequest('session_id required');
    try {
      const r = await db.query(
        `INSERT INTO coaching_notes
           (session_id,coach_id,stage_of_change,presenting_concern,client_goals,
            motivational_factors,barriers,action_steps,follow_up_plan,session_notes,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (session_id) DO UPDATE SET
           stage_of_change=EXCLUDED.stage_of_change,
           presenting_concern=EXCLUDED.presenting_concern,
           client_goals=EXCLUDED.client_goals,
           motivational_factors=EXCLUDED.motivational_factors,
           barriers=EXCLUDED.barriers,
           action_steps=EXCLUDED.action_steps,
           follow_up_plan=EXCLUDED.follow_up_plan,
           session_notes=EXCLUDED.session_notes,
           updated_at=NOW()
         RETURNING *`,
        [session_id, coach_id||null, stage_of_change||null, presenting_concern||null,
         client_goals||null, motivational_factors||null, barriers||null,
         action_steps||null, follow_up_plan||null, session_notes||null]
      );
      return ok(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
