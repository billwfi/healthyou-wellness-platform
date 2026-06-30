// Best-effort appointment activity logging — never blocks the main action.
// action: 'registered' | 'cancelled' | 'rescheduled' | 'updated'
async function logActivity(db, appointmentId, action, detail) {
  try {
    await db.query(
      'INSERT INTO event_appointment_activity (appointment_id, action, detail) VALUES ($1,$2,$3)',
      [appointmentId, action, detail || null]);
  } catch (e) { /* logging is non-critical */ }
}
module.exports = { logActivity };
