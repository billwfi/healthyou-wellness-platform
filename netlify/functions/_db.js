// SQL Server data layer for the HealYou platform (migrated from PostgreSQL/pg).
//
// Exposes a small pg-compatible shim so the existing handlers can keep calling
//   const db = getPool();
//   const r  = await db.query('SELECT ... WHERE id=$1', [id]);
//   r.rows / r.rowCount
// unchanged. The shim:
//   • rewrites $1,$2 placeholders to @p1,@p2 and binds them as request inputs,
//   • returns { rows, rowCount } shaped like node-postgres,
//   • auto-translates two always-safe dialect differences: NOW() -> SYSUTCDATETIME()
//     and ILIKE -> LIKE (the DB collation is case-insensitive).
// All other dialect differences (RETURNING -> OUTPUT, ON CONFLICT -> MERGE,
// LIMIT/OFFSET -> OFFSET/FETCH, casts, EXTRACT, DATE_TRUNC, || concat, ...) are
// handled in the individual handlers.
const sql = require('mssql');

let poolPromise;

function buildConfig() {
  return {
    server:   process.env.MSSQL_HOST,
    user:     process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    database: process.env.MSSQL_DATABASE,
    port:     parseInt(process.env.MSSQL_PORT || '1433', 10),
    options: {
      encrypt:               (process.env.MSSQL_ENCRYPT || 'true') !== 'false',
      trustServerCertificate:(process.env.MSSQL_TRUST_CERT || 'true') !== 'false',
      enableArithAbort:      true,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout:    30000,
  };
}

function connect() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(buildConfig()).connect().catch(err => {
      poolPromise = undefined; // allow retry on a later invocation
      throw err;
    });
  }
  return poolPromise;
}

// node-postgres serializes JS objects/arrays for json columns automatically; the
// SQL Server columns are NVARCHAR(MAX), so do the same here. Leave Buffers/Dates.
function toSqlValue(v) {
  if (v === undefined || v === null) return null;
  if (Buffer.isBuffer(v) || v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function translate(text) {
  return text
    .replace(/\bNOW\(\)/gi, 'SYSUTCDATETIME()')
    .replace(/\bILIKE\b/gi, 'LIKE');
}

// Bind $1,$2 placeholders onto a mssql Request and run the query, returning a
// node-postgres-shaped result. `request` is either pool.request() or a Request
// bound to a transaction.
async function runOn(request, text, params) {
  const used = new Set();
  const converted = translate(text).replace(/\$(\d+)/g, (_, n) => {
    used.add(parseInt(n, 10));
    return '@p' + n;
  });
  for (const idx of used) request.input('p' + idx, toSqlValue(params[idx - 1]));

  const result = await request.query(converted);
  const rows = result.recordset || [];
  const affected = Array.isArray(result.rowsAffected)
    ? result.rowsAffected.reduce((a, b) => a + b, 0)
    : 0;
  return { rows, rowCount: result.recordset ? rows.length : affected };
}

async function query(text, params = []) {
  const pool = await connect();
  return runOn(pool.request(), text, params);
}

// Run `work` inside a transaction. `work` receives a pg-style query(text, params)
// bound to the transaction. Commits on success, rolls back on throw.
async function withTransaction(work) {
  const pool = await connect();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const txQuery = (text, params = []) => runOn(new sql.Request(tx), text, params);
  try {
    const result = await work(txQuery);
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch { /* ignore rollback error */ }
    throw e;
  }
}

// JSON columns are stored as NVARCHAR(MAX). Parse the named columns back into
// objects/arrays so the API response matches the old JSONB behaviour. Accepts a
// single row or an array of rows; returns the same shape.
function parseJson(rows, cols) {
  const list = Array.isArray(rows) ? rows : [rows];
  for (const row of list) {
    if (!row) continue;
    for (const c of cols) {
      if (typeof row[c] === 'string') {
        try { row[c] = JSON.parse(row[c]); } catch { /* leave as-is */ }
      }
    }
  }
  return rows;
}

function getPool() {
  return {
    query,
    connect,
    withTransaction,
    parseJson,
    sql,
    async request() { return (await connect()).request(); },
  };
}

module.exports = { getPool, withTransaction, parseJson, sql };
