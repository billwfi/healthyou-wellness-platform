const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  await pool.query(`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS phone TEXT;`);
  console.log('Migration complete: phone column added to coaches');
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
