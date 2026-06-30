// Documents attached to a screening record (PCP results, registrant-provided
// blood work). Stored in the screening_documents table as base64 (small files).
//   GET    /api/screening-documents?participant_id=&event_id=  -> list metadata
//   GET    /api/screening-documents?id=N&download=1            -> { filename, content_type, data }
//   POST   /api/screening-documents   { participant_id, event_id, filename, content_type, file_size, data }
//   DELETE /api/screening-documents?id=N
const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

const MAX_BYTES = 5 * 1024 * 1024;

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();
  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      if (qs.id && (qs.download === '1' || qs.download === 'true')) {
        const r = await db.query('SELECT filename, content_type, data FROM screening_documents WHERE id=$1', [parseInt(qs.id, 10)]);
        if (!r.rows.length) return notFound();
        return ok(r.rows[0]);
      }
      const pid = qs.participant_id ? parseInt(qs.participant_id, 10) : null;
      if (!pid) return badRequest('participant_id required');
      let q = `SELECT id, participant_id, event_id, filename, content_type, file_size,
                      CONVERT(varchar(33), uploaded_at, 126) AS uploaded_at
                 FROM screening_documents WHERE participant_id=$1`;
      const vals = [pid];
      if (qs.event_id) { q += ' AND event_id=$2'; vals.push(parseInt(qs.event_id, 10)); }
      q += ' ORDER BY uploaded_at DESC';
      const r = await db.query(q, vals);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON'); }
    const participant_id = b.participant_id ? parseInt(b.participant_id, 10) : null;
    const event_id = b.event_id ? parseInt(b.event_id, 10) : null;
    const filename = (b.filename || '').toString().slice(0, 255);
    const content_type = (b.content_type || 'application/octet-stream').toString().slice(0, 120);
    const data = b.data || '';
    if (!participant_id) return badRequest('participant_id required');
    if (!filename || !data) return badRequest('filename and data are required');
    const fileSize = b.file_size ? parseInt(b.file_size, 10) : Math.floor(data.length * 0.75);
    if (fileSize > MAX_BYTES) return badRequest('File exceeds 5 MB limit');
    try {
      const r = await db.query(
        `INSERT INTO screening_documents (participant_id, event_id, filename, content_type, file_size, data)
         OUTPUT INSERTED.id, INSERTED.participant_id, INSERTED.event_id, INSERTED.filename,
                INSERTED.content_type, INSERTED.file_size,
                CONVERT(varchar(33), INSERTED.uploaded_at, 126) AS uploaded_at
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [participant_id, event_id, filename, content_type, fileSize, data]
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'DELETE') {
    const id = qs.id ? parseInt(qs.id, 10) : null;
    if (!id) return badRequest('id required');
    try {
      await db.query('DELETE FROM screening_documents WHERE id=$1', [id]);
      return ok({ deleted: true });
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
