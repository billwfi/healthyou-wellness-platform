#!/usr/bin/env node
/*
 * Import the Umbraco content export into the `umbraco_content` table.
 *
 * Source data : data/umbraco/umbraco-content.json  (pulled from cosreachyourpeak.com)
 * Destination : Postgres table umbraco_content (see schema.sql)
 *
 * Usage:
 *   DATABASE_URL="postgres://…" node scripts/import-umbraco.js
 *
 * Idempotent: upserts on umb_id, so it can be re-run after a fresh pull.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA = path.join(__dirname, '..', 'data', 'umbraco', 'umbraco-content.json');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Export it (Neon connection string) and re-run.');
    process.exit(1);
  }
  const nodes = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  console.log(`Loaded ${nodes.length} nodes from ${DATA}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  let done = 0;
  try {
    await client.query('BEGIN');
    for (const n of nodes) {
      await client.query(
        `INSERT INTO umbraco_content
           (umb_id, umb_key, udi, name, content_type, parent_id, tree_path, level,
            sort_order, published, update_date, properties, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (umb_id) DO UPDATE SET
           umb_key=EXCLUDED.umb_key, udi=EXCLUDED.udi, name=EXCLUDED.name,
           content_type=EXCLUDED.content_type, parent_id=EXCLUDED.parent_id,
           tree_path=EXCLUDED.tree_path, level=EXCLUDED.level, sort_order=EXCLUDED.sort_order,
           published=EXCLUDED.published, update_date=EXCLUDED.update_date,
           properties=EXCLUDED.properties, raw=EXCLUDED.raw, imported_at=NOW()`,
        [
          n.umb_id, n.umb_key, n.udi, n.name, n.content_type, n.parent_id,
          n.tree_path, n.level, n.sort_order, n.published,
          n.update_date || null,
          JSON.stringify(n.properties || {}),
          JSON.stringify(n),
        ]
      );
      if (++done % 250 === 0) console.log(`  …${done}/${nodes.length}`);
    }
    await client.query('COMMIT');
    console.log(`Imported/updated ${done} Umbraco content nodes.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Import failed, rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
