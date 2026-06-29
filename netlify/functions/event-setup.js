const { getPool, parseJson } = require('./_db');
const { getUser, ok, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// AppointmentQuest Setup for a single event LOCATION (event_locations row).
//   GET /api/event-setup?location_id=ID  -> full setup payload
//   PUT /api/event-setup  body { location_id, ...scalars, appointment_rules,
//        business_hours[], availability_slots[], notification_recipients[] }
// Scalar columns live on event_locations; the child tables hold the repeating
// rows keyed by location_id. A partial body updates only the keys it includes.

const SCALARS = [
  'description', 'custom_form', 'schedule_status', 'capacity_type',
  'concurrent_limit', 'valid_from', 'valid_to', 'service_location_selection',
  'appointment_interval_min', 'service_duration_min', 'service_duration_flexible',
  'overlap_allowed', 'group_scheduling', 'capacity_uniform', 'uniform_capacity',
  'notify_customers', 'payment_required', 'payment_amount', 'payment_instructions',
];

async function readSetup(db, locationId) {
  const ev = await db.query(
    `SELECT description, custom_form, schedule_status, capacity_type, concurrent_limit,
            CONVERT(varchar(10), valid_from, 23) AS valid_from,
            CONVERT(varchar(10), valid_to, 23)   AS valid_to,
            service_location_selection, appointment_interval_min, service_duration_min,
            service_duration_flexible, overlap_allowed, group_scheduling, capacity_uniform,
            uniform_capacity, notify_customers, payment_required, payment_amount,
            payment_instructions, appointment_rules
       FROM event_locations WHERE id=$1`, [locationId]);
  if (!ev.rows.length) return null;
  const setup = ev.rows[0];
  parseJson(setup, ['appointment_rules']);
  if (!setup.appointment_rules) setup.appointment_rules = {};

  const [bh, slots, recips] = await Promise.all([
    db.query(`SELECT day_of_week, is_open,
                     CONVERT(varchar(5), from_time, 108) AS from_time,
                     CONVERT(varchar(5), to_time, 108)   AS to_time, sort_order
                FROM event_business_hours WHERE location_id=$1
               ORDER BY day_of_week, sort_order`, [locationId]),
    db.query(`SELECT day_of_week, CONVERT(varchar(5), start_time, 108) AS start_time, capacity
                FROM event_availability_slots WHERE location_id=$1
               ORDER BY day_of_week, start_time`, [locationId]),
    db.query(`SELECT name, email FROM event_notification_recipients WHERE location_id=$1`, [locationId]),
  ]);
  setup.business_hours          = bh.rows;
  setup.availability_slots      = slots.rows;
  setup.notification_recipients = recips.rows;
  return setup;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (!qs.location_id) return badRequest('location_id required');
    try {
      const setup = await readSetup(db, qs.location_id);
      if (!setup) return notFound();
      return ok(setup);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'PUT') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const locationId = b.location_id;
    if (!locationId) return badRequest('location_id required');
    try {
      await db.withTransaction(async (q) => {
        const sets = [], params = [locationId];
        for (const col of SCALARS) {
          if (col in b) { params.push(b[col] === undefined ? null : b[col]); sets.push(`${col}=$${params.length}`); }
        }
        if ('appointment_rules' in b) {
          const v = typeof b.appointment_rules === 'object' ? JSON.stringify(b.appointment_rules) : b.appointment_rules;
          params.push(v); sets.push(`appointment_rules=$${params.length}`);
        }
        if (sets.length) await q(`UPDATE event_locations SET ${sets.join(',')} WHERE id=$1`, params);

        if (Array.isArray(b.business_hours)) {
          await q('DELETE FROM event_business_hours WHERE location_id=$1', [locationId]);
          let sort = 0;
          for (const h of b.business_hours) {
            await q(`INSERT INTO event_business_hours (location_id,day_of_week,is_open,from_time,to_time,sort_order)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
              [locationId, h.day_of_week, h.is_open ? 1 : 0, h.from_time || null, h.to_time || null,
               h.sort_order == null ? sort++ : h.sort_order]);
          }
        }
        if (Array.isArray(b.availability_slots)) {
          await q('DELETE FROM event_availability_slots WHERE location_id=$1', [locationId]);
          for (const s of b.availability_slots) {
            await q(`INSERT INTO event_availability_slots (location_id,day_of_week,start_time,capacity)
                     VALUES ($1,$2,$3,$4)`,
              [locationId, s.day_of_week, s.start_time, s.capacity == null ? 1 : s.capacity]);
          }
        }
        if (Array.isArray(b.notification_recipients)) {
          await q('DELETE FROM event_notification_recipients WHERE location_id=$1', [locationId]);
          for (const r of b.notification_recipients) {
            await q('INSERT INTO event_notification_recipients (location_id,name,email) VALUES ($1,$2,$3)',
              [locationId, r.name || null, r.email || null]);
          }
        }
      });
      const setup = await readSetup(db, locationId);
      return ok(setup);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
