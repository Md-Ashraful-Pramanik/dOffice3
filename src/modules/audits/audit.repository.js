const { query } = require('../../db/pool');

function mapAudit(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    ip: row.ip,
    userAgent: row.user_agent,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

async function createAudit(audit, db = { query }) {
  const result = await db.query(
    `INSERT INTO audits (
      id,
      user_id,
      action,
      entity_type,
      entity_id,
      method,
      path,
      status_code,
      ip,
      user_agent,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    RETURNING id, user_id, action, entity_type, entity_id, method, path, status_code, ip, user_agent, metadata, created_at`,
    [
      audit.id,
      audit.userId,
      audit.action,
      audit.entityType,
      audit.entityId,
      audit.method,
      audit.path,
      audit.statusCode,
      audit.ip,
      audit.userAgent,
      JSON.stringify(audit.metadata || {}),
    ],
  );

  return mapAudit(result.rows[0]);
}

async function listAuditsByUserId(userId, db = { query }) {
  const result = await db.query(
    `SELECT id, user_id, action, entity_type, entity_id, method, path, status_code, ip, user_agent, metadata, created_at
     FROM audits
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return result.rows.map(mapAudit);
}

module.exports = {
  createAudit,
  listAuditsByUserId,
};
