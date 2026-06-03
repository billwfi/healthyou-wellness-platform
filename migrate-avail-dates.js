const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  await pool.query(`
    ALTER TABLE coach_availability
      DROP CONSTRAINT IF EXISTS coach_availability_coach_id_day_of_week_start_time_key;
    ALTER TABLE coach_availability
      ADD COLUMN IF NOT EXISTS effective_from DATE;
    ALTER TABLE coach_availability
      ADD COLUMN IF NOT EXISTS effective_to DATE;
  `);
  console.log('Migration complete: effective_from and effective_to added to coach_availability');
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
