const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();

  try {
    if (event.httpMethod === 'GET') {
      const r = await db.query('SELECT [key], value FROM system_settings ORDER BY [key]');
      const settings = {};
      for (const row of r.rows) {
        try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
      }
      return ok(settings);
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const { section, ...values } = body;
      for (const [key, val] of Object.entries(values)) {
        const serialized = typeof val === 'object' ? JSON.stringify(val) : String(val);
        await db.query(`
          MERGE system_settings AS t
          USING (SELECT $1 AS [key]) AS s ON t.[key] = s.[key]
          WHEN MATCHED THEN UPDATE SET value=$2, updated_at=SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT ([key], value, updated_at)
            VALUES ($1, $2, SYSUTCDATETIME());
        `, [key, serialized]);
      }
      return ok({ saved: true, section: section || null });
    }

    return badRequest('Method not allowed');
  } catch (e) {
    console.error('settings error', e);
    return serverError(e);
  }
};
